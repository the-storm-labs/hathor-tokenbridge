import type { EvmToHathorFlow } from '../application/EvmToHathorFlow';
import type { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import type { FederationEvent } from '../domain/federationEvents';
import { TransactionType } from '../domain/transactionTypes';
import type { CursorStorePort } from '../ports/CursorStorePort';
import type { EvmChainPort } from '../ports/EvmChainPort';
import type { HathorFederationPort } from '../ports/HathorFederationPort';
import type { HathorWalletPort } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { MetricsPort } from '../ports/MetricsPort';
import type { SchedulerJob } from './Scheduler';

/**
 * Reads the HathorFederation contract - where federators coordinate - and reacts to what the
 * others have done.
 *
 * The chain is the coordination medium: one federator proposes, the rest see the proposal here and
 * sign it, and whoever sees enough signatures pushes. So every event is an invitation to redo the
 * step that is now outstanding, and the flows are re-entered rather than resumed. Nothing is held
 * in memory between runs.
 */
export const HATHOR_FEDERATION_READER = 'hathor-federation';

const BLOCKS_PER_PAGE = 450;

export interface HathorFederationReaderDeps {
  readonly chain: EvmChainPort;
  readonly federation: HathorFederationPort;
  readonly wallet: HathorWalletPort;
  readonly evmToHathor: EvmToHathorFlow;
  readonly hathorToEvm: HathorToEvmFlow;
  readonly cursors: CursorStorePort;
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly fromBlock: number;
  /** How far behind the head to stay before treating a block as settled. */
  readonly confirmationBlocks: number;
  readonly inputLockTtlMs: number;
}

export class HathorFederationReader implements SchedulerJob {
  public readonly name = 'Hathor federation reader';
  private readonly deps: HathorFederationReaderDeps;

  constructor(deps: HathorFederationReaderDeps) {
    this.deps = deps;
  }

  async run(): Promise<void> {
    const { chain, cursors, logger, metrics, fromBlock, confirmationBlocks } = this.deps;

    if (await chain.isSyncing()) {
      logger.warn('The state chain node is still syncing; skipping this run.');
      return;
    }

    const currentBlock = await chain.getBlockNumber();
    const toBlock = currentBlock - confirmationBlocks;
    if (toBlock <= 0) {
      logger.debug(`State chain is only at block ${currentBlock}; nothing is settled yet.`);
      return;
    }

    const cursor = await cursors.getBlockCursor(HATHOR_FEDERATION_READER, fromBlock);
    if (cursor >= toBlock) {
      logger.debug(`Nothing new on the state chain: cursor ${cursor}, settled head ${toBlock}.`);
      return;
    }

    const start = cursor + 1;

    // Two passes over the same range, in this order on purpose. Lock events tell this federator
    // which UTXOs another one has already claimed; marking them first means anything proposed in
    // the general pass will not reach for the same inputs.
    //
    // The passes are disjoint: the general one names its kinds rather than reading everything, so
    // a lock event is acted on exactly once. Reading it twice would only reset a TTL, but it would
    // also mean the two passes silently overlap.
    await this.readRange(start, toBlock, ['lock'], false);
    await this.readRange(start, toBlock, ['proposed', 'signed', 'sent', 'failed'], true);

    metrics.hathorRunCompleted();
  }

  private async readRange(
    fromBlock: number,
    toBlock: number,
    kinds: readonly FederationEvent['kind'][] | undefined,
    advanceCursor: boolean,
  ): Promise<void> {
    const { federation, cursors, logger } = this.deps;

    for (let pageStart = fromBlock; pageStart <= toBlock; pageStart += BLOCKS_PER_PAGE) {
      const pageEnd = Math.min(pageStart + BLOCKS_PER_PAGE - 1, toBlock);

      const events = await federation.getEvents(pageStart, pageEnd, kinds);
      if (events.length > 0) {
        logger.info(`Found ${events.length} federation event(s) in blocks ${pageStart}..${pageEnd}.`);
      }

      for (const event of events) {
        await this.handle(event);
      }

      if (advanceCursor) {
        await cursors.setBlockCursor(HATHOR_FEDERATION_READER, pageEnd);
      }
    }
  }

  private async handle(event: FederationEvent): Promise<void> {
    const { logger } = this.deps;

    switch (event.kind) {
      case 'lock':
        await this.markInputsClaimed(event.txHex);
        return;

      case 'sent':
        await this.onProposalSent(event);
        return;

      case 'proposed':
      case 'signed':
      case 'failed':
        await this.advance(event);
        return;

      default: {
        // Exhaustiveness: a new event kind becomes a compile error here rather than being ignored
        // at runtime, which is what the previous string-switch did with a log line.
        const unhandled: never = event;
        logger.warn(`Unhandled federation event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Another federator has claimed these UTXOs for a proposal. Marking them locally stops this
   * federator selecting the same ones and producing a competing proposal that can never settle.
   */
  private async markInputsClaimed(txHex: string): Promise<void> {
    const { wallet, logger, inputLockTtlMs } = this.deps;
    try {
      await wallet.lockProposalInputs(txHex, inputLockTtlMs);
    } catch (error) {
      // Worth continuing over: the worst case is this federator building a proposal that loses the
      // race, which the on-chain state resolves anyway.
      logger.warn('Could not mark another federator claimed inputs.', error);
    }
  }

  /**
   * A proposal reached Hathor. For a melt that is only half the transfer - the tokens are burned,
   * but nothing has been released on the EVM side yet, and that vote is what completes it.
   */
  private async onProposalSent(event: Extract<FederationEvent, { kind: 'sent' }>): Promise<void> {
    const { hathorToEvm, logger } = this.deps;

    if (event.transactionType !== TransactionType.MELT) {
      logger.debug(`Proposal ${event.transactionId} settled; nothing further for this federator.`);
      return;
    }

    logger.info(`Melt ${event.transactionId} settled on Hathor; voting to release on the EVM side.`);
    await hathorToEvm.settleMeltedTransfer({
      hathorSenderAddress: event.sender,
      evmReceiverAddress: event.receiver,
      hathorAmount: event.value,
      hathorTokenAddress: event.originalTokenAddress,
      hathorTxId: event.transactionHash,
    });
  }

  /**
   * Re-enters the flow for a transfer so this federator does whatever step is now outstanding -
   * sign a proposal it has just seen, or push one that has reached quorum.
   */
  private async advance(event: Extract<FederationEvent, { kind: 'proposed' | 'signed' | 'failed' }>): Promise<void> {
    const { evmToHathor, hathorToEvm } = this.deps;

    if (event.transactionType === TransactionType.MELT) {
      await hathorToEvm.transfer({
        hathorSenderAddress: event.sender,
        evmReceiverAddress: event.receiver,
        hathorAmount: event.value,
        hathorTokenAddress: event.originalTokenAddress,
        hathorTxId: event.transactionHash,
      });
      return;
    }

    await evmToHathor.transfer({
      senderAddress: event.sender,
      receiverAddress: event.receiver,
      evmAmount: event.value,
      evmTokenAddress: event.originalTokenAddress,
      transactionHash: event.transactionHash,
    });
  }
}
