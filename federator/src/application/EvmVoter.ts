import type { EvmFederationPort, VoteRequest } from '../ports/EvmFederationPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { MetricsPort } from '../ports/MetricsPort';
import type { RevertedTransferStorePort } from '../ports/RevertedTransferStorePort';

/**
 * Casts this federator's vote to release a transfer on the EVM side.
 *
 * Voting is idempotent by design - the contract counts one vote per federator - so the job here is
 * mostly to avoid pointless work: not voting on something already processed, not voting twice, and
 * not re-submitting a vote the chain has already reverted.
 *
 * Extracted from FederatorHTR._voteTransaction, which HathorBroker reached for by constructing a
 * whole FederatorHTR purely to call that one method.
 */
export interface EvmVoterDeps {
  readonly federation: EvmFederationPort;
  readonly revertedTransfers: RevertedTransferStorePort;
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly federatorAddress: string;
}

export class EvmVoter {
  private readonly federation: EvmFederationPort;
  private readonly revertedTransfers: RevertedTransferStorePort;
  private readonly logger: LoggerPort;
  private readonly metrics: MetricsPort;
  private readonly federatorAddress: string;

  constructor(deps: EvmVoterDeps) {
    this.federation = deps.federation;
    this.revertedTransfers = deps.revertedTransfers;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.federatorAddress = deps.federatorAddress;
  }

  /**
   * @returns true when the transfer needs nothing further from this federator - whether because
   *          the vote succeeded, or because it was already processed or already voted on.
   */
  async vote(request: VoteRequest): Promise<boolean> {
    const transactionId = (await this.federation.getTransactionId(request)).toLowerCase();

    if (await this.federation.transactionWasProcessed(transactionId)) {
      this.logger.info(`Transfer ${transactionId} has already been processed on the EVM side.`);
      return true;
    }

    if (await this.federation.hasVoted(transactionId, this.federatorAddress)) {
      this.logger.debug(`This federator has already voted on ${transactionId}.`);
      return true;
    }

    if (await this.revertedTransfers.has(transactionId)) {
      // A vote that reverted once will revert again for the same reason, and each attempt costs
      // gas. It needs a human, not another round.
      this.logger.warn(`Skipping ${transactionId}: a previous vote on it reverted.`);
      return false;
    }

    this.logger.info(
      `Voting to release ${request.amount} of ${request.originalTokenAddress} to ${request.receiver} ` +
        `(transfer ${transactionId}).`,
    );

    const receipt = await this.federation.vote(request);

    if (!receipt.status) {
      this.metrics.voteFailed();
      this.logger.error(`Vote on ${transactionId} failed; recording it so it is not retried.`, receipt);
      await this.revertedTransfers.record(transactionId, {
        originalTokenAddress: request.originalTokenAddress,
        sender: request.sender,
        receiver: request.receiver,
        amount: request.amount.toString(),
        blockHash: request.blockHash,
        transactionHash: request.transactionHash,
        logIndex: request.logIndex,
        error: receipt.error,
      });
      return false;
    }

    this.metrics.voteSucceeded();
    return true;
  }
}
