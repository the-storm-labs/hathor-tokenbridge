import type { EvmToHathorFlow } from '../application/EvmToHathorFlow';
import { toBridgeUnit } from '../domain/amounts';
import type { AllowTokensPort, BridgePort, CrossEvent } from '../ports/BridgePort';
import type { CursorStorePort } from '../ports/CursorStorePort';
import type { EvmChainPort } from '../ports/EvmChainPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { MetricsPort } from '../ports/MetricsPort';
import type { SchedulerJob } from './Scheduler';

/**
 * Reads `Cross` events off the EVM bridge and hands each one to the EVM -> Hathor flow.
 *
 * A `run()` is idempotent and carries no state between calls: everything it needs it reads from
 * the chain and the cursor store. That is deliberate - it is what would let this become a cron
 * invocation later without touching anything above it.
 *
 * Larger transfers wait for more confirmations than smaller ones, so the range is read twice: once
 * up to the depth large amounts require, and once up to the shallower depth, where anything still
 * too large for its depth is skipped and picked up on a later run. Only the deep pass advances the
 * cursor, since the shallow pass has deliberately looked at blocks that are not settled yet.
 */
export const EVM_BRIDGE_READER = 'evm-bridge';

/** Blocks per `getPastEvents` call. Chosen to stay under typical RPC log-range limits. */
const BLOCKS_PER_PAGE = 450;

export interface EvmBridgeReaderDeps {
  readonly chain: EvmChainPort;
  readonly bridge: BridgePort;
  readonly allowTokens: AllowTokensPort;
  readonly flow: EvmToHathorFlow;
  readonly cursors: CursorStorePort;
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly hathorChainId: number;
  /** Block to start from when no cursor has been recorded yet. */
  readonly fromBlock: number;
}

export class EvmBridgeReader implements SchedulerJob {
  public readonly name = 'EVM bridge reader';
  private readonly deps: EvmBridgeReaderDeps;

  constructor(deps: EvmBridgeReaderDeps) {
    this.deps = deps;
  }

  async run(): Promise<void> {
    const { chain, allowTokens, cursors, logger, metrics, fromBlock } = this.deps;

    if (await chain.isSyncing()) {
      // A syncing node serves stale logs, so reading now would mean acting on a partial view.
      logger.warn('The EVM node is still syncing; skipping this run.');
      return;
    }

    const currentBlock = await chain.getBlockNumber();
    const confirmations = await allowTokens.getConfirmations();

    const settledBlock = currentBlock - confirmations.largeAmountConfirmations;
    const shallowBlock = currentBlock - confirmations.smallAmountConfirmations;

    if (settledBlock <= 0 && shallowBlock <= 0) {
      logger.debug(`Chain is only at block ${currentBlock}; nothing is confirmed yet.`);
      return;
    }

    const cursor = await cursors.getBlockCursor(EVM_BRIDGE_READER, fromBlock);
    if (cursor >= settledBlock && cursor >= shallowBlock) {
      logger.debug(`Nothing new: cursor is at ${cursor}, chain head is ${currentBlock}.`);
      return;
    }

    const start = cursor + 1;

    // The deep pass: blocks old enough for any amount. It is the one that moves the cursor.
    await this.readRange(start, settledBlock, currentBlock, confirmations, false);

    // The shallow pass: newer blocks, where only small enough amounts may be acted on.
    await this.readRange(settledBlock, shallowBlock, currentBlock, confirmations, true);

    metrics.evmRunCompleted();
  }

  private async readRange(
    fromBlock: number,
    toBlock: number,
    currentBlock: number,
    confirmations: { mediumAmountConfirmations: number; largeAmountConfirmations: number },
    shallow: boolean,
  ): Promise<void> {
    const { bridge, cursors, logger, hathorChainId } = this.deps;

    if (fromBlock >= toBlock) {
      return;
    }

    for (let pageStart = fromBlock; pageStart <= toBlock; pageStart += BLOCKS_PER_PAGE) {
      const pageEnd = Math.min(pageStart + BLOCKS_PER_PAGE - 1, toBlock);

      logger.debug(`Reading Cross events in blocks ${pageStart}..${pageEnd}${shallow ? ' (shallow)' : ''}.`);
      const events = await bridge.getCrossEvents(pageStart, pageEnd, hathorChainId);
      logger.info(`Found ${events.length} Cross event(s) in blocks ${pageStart}..${pageEnd}.`);

      for (const event of events) {
        await this.handle(event, currentBlock, confirmations, shallow);
      }

      if (!shallow) {
        // The cursor advances per page, not per range: a failure halfway through a long catch-up
        // should not mean re-reading everything from the start.
        await cursors.setBlockCursor(EVM_BRIDGE_READER, pageEnd);
      }
    }
  }

  private async handle(
    event: CrossEvent,
    currentBlock: number,
    confirmations: { mediumAmountConfirmations: number; largeAmountConfirmations: number },
    shallow: boolean,
  ): Promise<void> {
    const { bridge, allowTokens, flow, logger } = this.deps;

    const mapping = await bridge.mappingByEvmToken(event.tokenAddress);
    const limits = await allowTokens.getLimits(mapping.evmToken);

    if (!limits.allowed) {
      logger.error(`Token ${event.tokenAddress} is not allowed; skipping transfer ${event.transactionHash}.`);
      return;
    }

    if (shallow) {
      // The limits are stored in the bridge's 18-decimal unit while the Cross event carries the
      // token's own decimals, so the two have to be brought to the same scale before they can be
      // compared. Skipping that reads every USDC amount as a million times smaller than it is, and
      // a large transfer would then clear on the shallow confirmation depth instead of the deep
      // one. The previous federator compared them raw.
      const decimals = await bridge.getEvmTokenDecimals(mapping.evmToken);
      const normalisedAmount = toBridgeUnit(event.amount, decimals);
      if (!this.isDeepEnough(event, normalisedAmount, currentBlock, confirmations, limits)) {
        return;
      }
    }

    await flow.transfer({
      senderAddress: event.sender,
      receiverAddress: event.receiver,
      evmAmount: event.amount,
      evmTokenAddress: event.tokenAddress,
      transactionHash: event.transactionHash,
    });
  }

  /**
   * On the shallow pass we are looking at blocks that are not settled for every amount. A transfer
   * is only acted on here if its own size is confirmed deeply enough; anything larger is left for
   * a later run, when the deep pass reaches it.
   */
  private isDeepEnough(
    event: CrossEvent,
    /** The event's amount in the bridge's 18-decimal unit, comparable with the limits. */
    normalisedAmount: bigint,
    currentBlock: number,
    confirmations: { mediumAmountConfirmations: number; largeAmountConfirmations: number },
    limits: { mediumAmount: bigint; largeAmount: bigint },
  ): boolean {
    const { logger } = this.deps;
    const depth = currentBlock - event.blockNumber;

    if (normalisedAmount > limits.largeAmount) {
      logger.debug(
        `Transfer ${event.transactionHash} is a large amount with ${depth} confirmations; it needs ` +
          `${confirmations.largeAmountConfirmations}. Leaving it for a later run.`,
      );
      return false;
    }

    if (normalisedAmount > limits.mediumAmount && depth < confirmations.mediumAmountConfirmations) {
      logger.debug(
        `Transfer ${event.transactionHash} is a medium amount with ${depth} confirmations; it needs ` +
          `${confirmations.mediumAmountConfirmations}. Leaving it for a later run.`,
      );
      return false;
    }

    return true;
  }
}
