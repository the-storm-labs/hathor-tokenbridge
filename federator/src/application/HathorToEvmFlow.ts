import { BRIDGE_NORMALISED_DECIMALS, toEvmAmount } from '../domain/amounts';
import { InvalidTransactionError } from '../domain/errors';
import { deriveEvmOriginIdentity } from '../domain/hathorOrigin';
import { readDestination } from '../domain/bridgePayload';
import { readBridgedToken } from '../domain/tokenData';
import { TransactionType } from '../domain/transactionTypes';
import { validateMeltProposal, validateOriginTransaction } from '../domain/validation/proposals';
import type { ValidationResult } from '../domain/validation/proposals';
import type { AllowTokensPort, BridgePort, TokenMapping } from '../ports/BridgePort';
import type { ProposalIdentity } from '../ports/HathorFederationPort';
import type { HathorWalletPort, HistoryEntry } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { EvmVoter } from './EvmVoter';
import type { ProposalCoordinator, ProposalStrategy } from './ProposalCoordinator';

/**
 * Moves a transfer that started on Hathor over to the EVM side.
 *
 * Two shapes, again decided by where the token is native. A token native to the EVM chain arrived
 * on Hathor as minted supply, so it is melted there before being released on the EVM side - two
 * steps, and the vote only happens once the melt has settled. A token native to Hathor is simply
 * locked in the multisig, so the vote is the whole job.
 *
 * Replaces HathorBroker, which reached this second case by constructing a whole FederatorHTR just
 * to borrow its _voteTransaction method.
 */
export interface HathorToEvmFlowDeps {
  readonly wallet: HathorWalletPort;
  readonly bridge: BridgePort;
  readonly allowTokens: AllowTokensPort;
  readonly coordinator: ProposalCoordinator;
  readonly voter: EvmVoter;
  readonly logger: LoggerPort;
  readonly evmChainId: number;
  readonly hathorChainId: number;
  readonly inputLockTtlMs: number;
  /** Confirmations required before acting, multiplied by this federator's order. */
  readonly minConfirmations: number;
  readonly multisigOrder: number;
}

export class HathorToEvmFlow {
  private readonly deps: HathorToEvmFlowDeps;

  constructor(deps: HathorToEvmFlowDeps) {
    this.deps = deps;
  }

  /**
   * Handles a transaction that arrived at the bridge's multisig.
   *
   * @returns whether the transaction is done with - false means "come back to it", which for the
   *          history replay means its progress cursor must not advance past it.
   */
  async handleIncoming(tx: HistoryEntry): Promise<boolean> {
    const { wallet, logger, minConfirmations, multisigOrder } = this.deps;

    // Each federator waits longer than the one before it, so they do not all race to propose.
    const required = minConfirmations * multisigOrder;
    const confirmations = await wallet.getConfirmationCount(tx.txId);
    if (confirmations < required) {
      logger.info(`Transaction ${tx.txId} has ${confirmations} of ${required} confirmations; waiting.`);
      return false;
    }

    const origin = validateOriginTransaction(tx);
    if (!origin.valid) {
      logger.warn(`Ignoring ${tx.txId}: ${origin.reason}`);
      return true;
    }

    // Read the funds as they were recorded, spent or not: by the time history is replayed the
    // outputs may already have been consumed by the melt this very flow created.
    //
    // An unreadable transaction is not a failure here, it is a verdict: this is a scan of
    // everything the multisig touches, and most of that is not a bridge request. The federator's
    // own mints are the clearest case - they pay HTR change and the token authorities back to the
    // multisig, so they carry two tokens and readBridgedToken rejects them. That rejection is
    // right for validating a proposal, where ambiguity must be refused loudly, and wrong here,
    // where it is just another "not for us". Letting it escape would log an error and promise a
    // retry for something that can never become valid.
    let token: ReturnType<typeof readBridgedToken>;
    try {
      token = readBridgedToken(tx.inputs, tx.outputs, { requireUnspent: false });
    } catch (error) {
      if (error instanceof InvalidTransactionError) {
        logger.info(`Transaction ${tx.txId} is not a bridge request: ${error.message}`);
        return true;
      }
      throw error;
    }
    if (!token) {
      logger.info(`Transaction ${tx.txId} moves no custom token into the multisig; nothing to do.`);
      return true;
    }

    if (!(await wallet.isOwnAddress(token.receiverAddress))) {
      logger.info(`Transaction ${tx.txId} pays ${token.receiverAddress}, which is not ours; ignoring.`);
      return true;
    }

    const destination = readDestination(tx);
    if (!destination) {
      logger.info(`Transaction ${tx.txId} carries no EVM destination; nothing to do.`);
      return true;
    }

    return this.transfer({
      hathorSenderAddress: token.senderAddress,
      evmReceiverAddress: destination,
      hathorAmount: token.amount,
      hathorTokenAddress: token.tokenAddress,
      hathorTxId: tx.txId,
    });
  }

  async transfer(params: {
    hathorSenderAddress: string;
    evmReceiverAddress: string;
    hathorAmount: bigint;
    hathorTokenAddress: string;
    hathorTxId: string;
  }): Promise<boolean> {
    const { bridge, allowTokens, logger, evmChainId, coordinator } = this.deps;

    const mapping = await bridge.mappingByHathorToken(params.hathorTokenAddress);
    const isEvmNative = mapping.originChainId === evmChainId;
    const evmAmount = await this.toEvmAmount(params.hathorAmount, mapping);

    const limits = await allowTokens.getLimits(mapping.evmToken);
    if (evmAmount < limits.min) {
      logger.info(
        `Transaction ${params.hathorTxId} moves ${evmAmount} of ${mapping.evmToken}, below the ` +
          `minimum of ${limits.min}; ignoring.`,
      );
      return true;
    }

    if (!isEvmNative) {
      // Native to Hathor: the funds sit in the multisig, and releasing them on the EVM side is
      // the whole transfer.
      return this.vote(params, mapping, evmAmount);
    }

    // Native to the EVM chain: burn the Hathor-side supply first. The vote follows once the melt
    // has settled, via settleMeltedTransfer.
    const identity: ProposalIdentity = {
      originalTokenAddress: params.hathorTokenAddress,
      transactionHash: params.hathorTxId,
      value: params.hathorAmount,
      sender: params.hathorSenderAddress,
      receiver: params.evmReceiverAddress,
      transactionType: TransactionType.MELT,
    };

    return coordinator.coordinate(identity, this.meltStrategy(params.hathorTxId, mapping));
  }

  /**
   * Casts the EVM vote for a transfer whose melt has settled. Driven by the ProposalSent event
   * rather than by the melt call, because the melt only counts once it is on chain.
   */
  async settleMeltedTransfer(params: {
    hathorSenderAddress: string;
    evmReceiverAddress: string;
    hathorAmount: bigint;
    hathorTokenAddress: string;
    hathorTxId: string;
  }): Promise<boolean> {
    const mapping = await this.deps.bridge.mappingByHathorToken(params.hathorTokenAddress);
    const evmAmount = await this.toEvmAmount(params.hathorAmount, mapping);
    return this.vote(params, mapping, evmAmount);
  }

  private async vote(
    params: { hathorSenderAddress: string; evmReceiverAddress: string; hathorTxId: string },
    mapping: TokenMapping,
    evmAmount: bigint,
  ): Promise<boolean> {
    const origin = deriveEvmOriginIdentity(params.hathorSenderAddress, params.hathorTxId);

    return this.deps.voter.vote({
      originalTokenAddress: mapping.evmToken,
      sender: origin.sender,
      receiver: params.evmReceiverAddress,
      amount: evmAmount,
      blockHash: origin.idHash,
      transactionHash: origin.idHash,
      logIndex: origin.logIndex,
      originChainId: this.deps.hathorChainId,
      destinationChainId: this.deps.evmChainId,
    });
  }

  private meltStrategy(hathorTxId: string, mapping: TokenMapping): ProposalStrategy {
    const { wallet, inputLockTtlMs } = this.deps;

    return {
      build: async (identity) =>
        wallet.createMeltProposal({
          token: mapping.hathorToken,
          amount: identity.value,
          markInputsAsUsed: true,
          inputLockTtlMs,
          fixedAddress: await wallet.getAddressAtIndex(0),
        }),

      validate: async (txHex): Promise<ValidationResult> => {
        // The transaction being melted against must still exist and still be valid: a voided one
        // means the funds never really arrived.
        const originTx = await wallet.getTransaction(hathorTxId);
        if (!originTx) {
          return { valid: false, reason: `Origin transaction ${hathorTxId} is unknown or voided.` };
        }

        const structural = validateOriginTransaction(originTx);
        if (!structural.valid) {
          return structural;
        }

        const originToken = readBridgedToken(originTx.inputs, originTx.outputs, { requireUnspent: false });
        if (!originToken) {
          return { valid: false, reason: `Origin transaction ${hathorTxId} moves no custom token.` };
        }

        const proposal = await wallet.decodeTxHex(txHex);
        return validateMeltProposal(proposal, { token: originToken.tokenAddress, amount: originToken.amount });
      },
    };
  }

  /**
   * Converts a Hathor amount into the bridge's internal unit - 18 decimals, always, regardless of
   * what the token itself uses.
   *
   * Both things this feeds speak that unit: the AllowTokens limits are stored in it, and the
   * release path divides a voted amount by `10^(18 - tokenDecimals)` to get back to the token's
   * own scale. Using the token's decimals here instead would vote 10^(18-decimals) too little -
   * a factor of a million for USDC - and would compare every amount against a limit a million
   * times larger, so nothing would ever clear the minimum.
   */
  private async toEvmAmount(hathorAmount: bigint, _mapping: TokenMapping): Promise<bigint> {
    return toEvmAmount(hathorAmount, BRIDGE_NORMALISED_DECIMALS);
  }
}
