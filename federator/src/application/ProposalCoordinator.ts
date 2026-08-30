import { selectCompleteSignatures } from '../domain/signatures';
import type { ValidationResult } from '../domain/validation/proposals';
import type { ClockPort } from '../ports/ClockPort';
import type { HathorFederationPort, ProposalIdentity } from '../ports/HathorFederationPort';
import type { HathorWalletPort } from '../ports/HathorWalletPort';
import { WalletOperationError } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { MetricsPort } from '../ports/MetricsPort';

/**
 * Drives one transfer through the federation's proposal lifecycle: propose, sign, push.
 *
 * Coordination is on-chain, so every federator runs this same routine against the same contract
 * state and each one does whichever step is still outstanding. Only the federator at multisig
 * order 1 creates proposals; the rest join an existing one.
 *
 * How the direction-specific parts get in: a `ProposalStrategy` supplies "how to build the
 * transaction" and "how to check it is honest". Those are the only two things that differ between
 * EVM->Hathor and Hathor->EVM, and they were previously supplied by subclassing an abstract Broker
 * that also owned the wallet, the contracts, the metrics and the HTTP calls.
 */

export interface ProposalStrategy {
  /** Builds the Hathor transaction that settles this transfer, returning its serialised hex. */
  build(identity: ProposalIdentity): Promise<string>;
  /**
   * Whether a proposal faithfully represents the transfer it claims to. Called before proposing,
   * before signing and before pushing - a federator must never take somebody else's word for it.
   */
  validate(txHex: string, identity: ProposalIdentity, transactionId: string): Promise<ValidationResult>;
}

/**
 * Written to the contract when a push fails because its inputs were already spent. Hex for
 * "Manual Check Transaction": the transfer cannot settle on its own and needs a human, and this
 * marks it as such rather than leaving it to be retried forever.
 */
export const MANUAL_CHECK_MARKER = '4d616e75616c20436865636b205472616e73616374696f6e0000000000000000';

const ALREADY_SPENT_MESSAGE = 'Invalid transaction. At least one of your inputs has already been spent.';

export interface ProposalCoordinatorOptions {
  readonly federatorAddress: string;
  /** This federator's 1-based position. Only order 1 creates proposals. */
  readonly multisigOrder: number;
  /** Signatures the multisig requires to redeem. */
  readonly numSignatures: number;
  /** How many times to re-ask this wallet for a signature covering every input. */
  readonly signatureAttempts?: number;
  readonly signatureRetryDelayMs?: number;
}

export interface ProposalCoordinatorDeps {
  readonly wallet: HathorWalletPort;
  readonly federation: HathorFederationPort;
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly clock: ClockPort;
  readonly options: ProposalCoordinatorOptions;
}

export class ProposalCoordinator {
  private readonly wallet: HathorWalletPort;
  private readonly federation: HathorFederationPort;
  private readonly logger: LoggerPort;
  private readonly metrics: MetricsPort;
  private readonly clock: ClockPort;
  private readonly options: Required<ProposalCoordinatorOptions>;

  constructor(deps: ProposalCoordinatorDeps) {
    this.wallet = deps.wallet;
    this.federation = deps.federation;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.clock = deps.clock;
    this.options = { signatureAttempts: 3, signatureRetryDelayMs: 5_000, ...deps.options };
  }

  /**
   * Advances one transfer by whatever step the contract state says is outstanding.
   *
   * @returns whether the transfer is in a good state - false only when a proposal was built but
   *          failed validation, which is a refusal to propose rather than an error.
   */
  async coordinate(identity: ProposalIdentity, strategy: ProposalStrategy): Promise<boolean> {
    const transactionId = await this.federation.getTransactionId(identity);

    if (await this.federation.isProcessed(transactionId)) {
      this.logger.debug(`Transfer ${transactionId} is already processed.`);
      return true;
    }

    if (await this.federation.isSigned(transactionId, this.options.federatorAddress)) {
      const txHex = await this.federation.getTransactionHex(transactionId);
      await this.push(identity, transactionId, txHex, strategy);
      return true;
    }

    if (await this.federation.isProposed(transactionId)) {
      const txHex = await this.federation.getTransactionHex(transactionId);
      await this.sign(identity, transactionId, txHex, strategy);
      return true;
    }

    if (this.options.multisigOrder > 1) {
      this.logger.debug(
        `No proposal for ${transactionId} yet; this federator is at multisig order ` +
          `${this.options.multisigOrder} and only order 1 proposes.`,
      );
      return true;
    }

    const txHex = await strategy.build(identity);
    return this.propose(identity, transactionId, txHex, strategy);
  }

  private async propose(
    identity: ProposalIdentity,
    transactionId: string,
    txHex: string,
    strategy: ProposalStrategy,
  ): Promise<boolean> {
    const validation = await strategy.validate(txHex, identity, transactionId);
    if (!validation.valid) {
      this.metrics.proposalRejected(identity.transactionHash);
      this.logger.error(`Refusing to propose for ${transactionId}: ${validation.reason}`);
      return false;
    }

    const receipt = await this.federation.submitProposal(identity, txHex);

    // The counter is bumped from the receipt, not before it. The previous code counted a success
    // as soon as the call returned and then checked the receipt separately, so a failed proposal
    // incremented both the success and the failure counters.
    if (!receipt.status) {
      this.metrics.proposalRejected(identity.transactionHash);
      this.logger.error(`Submitting the proposal for ${transactionId} failed.`, receipt);
      return false;
    }

    this.metrics.proposalSubmitted();
    return true;
  }

  private async sign(
    identity: ProposalIdentity,
    transactionId: string,
    txHex: string,
    strategy: ProposalStrategy,
  ): Promise<void> {
    const validation = await strategy.validate(txHex, identity, transactionId);
    if (!validation.valid) {
      this.metrics.signatureRejected();
      throw new Error(`Refusing to sign ${transactionId}: ${validation.reason}`);
    }

    const { inputs } = await this.wallet.decodeTxHex(txHex);
    const signature = await this.completeSignature(txHex, inputs.length);

    if (signature === null) {
      // Submitting a signature that cannot cover every input is worse than submitting none: it
      // can later be selected for a push and break Hathor's P2SH redeem script validation with
      // "Signatures are incompatible with redeemScript". Sitting this round out is safe, because
      // quorum only needs numSignatures of all federators.
      this.logger.warn(
        `Not signing ${transactionId}: this wallet could not produce a signature covering all ` +
          `${inputs.length} input(s) after ${this.options.signatureAttempts} attempt(s).`,
      );
      this.metrics.signatureRejected();
      return;
    }

    const receipt = await this.federation.submitSignature(identity, signature);
    if (!receipt.status) {
      this.metrics.signatureRejected();
      this.logger.error(`Submitting the signature for ${transactionId} failed.`, receipt);
      return;
    }

    this.metrics.signatureSubmitted();
  }

  private async push(
    identity: ProposalIdentity,
    transactionId: string,
    txHex: string,
    strategy: ProposalStrategy,
  ): Promise<void> {
    const signatures = await this.federation.getSignatures(transactionId);

    if (signatures.length < this.options.numSignatures) {
      this.logger.debug(
        `Waiting on signatures for ${transactionId}: ${signatures.length} of ` +
          `${this.options.numSignatures} collected.`,
      );
      return;
    }

    const validation = await strategy.validate(txHex, identity, transactionId);
    if (!validation.valid) {
      this.metrics.pushRejected();
      throw new Error(`Refusing to push ${transactionId}: ${validation.reason}`);
    }

    // Not every stored signature necessarily covers every input: a signer whose wallet had not yet
    // recognised a UTXO as spendable produces a partial one. Selecting by array position alone
    // silently breaks the whole push, since Hathor rejects the redeem script the moment one
    // selected signer is missing coverage for any input.
    const { inputs } = await this.wallet.decodeTxHex(txHex);
    const complete = selectCompleteSignatures(signatures, inputs.length);

    if (complete.length < this.options.numSignatures) {
      this.logger.warn(
        `Only ${complete.length}/${signatures.length} stored signatures for ${transactionId} cover ` +
          `all ${inputs.length} input(s); ${this.options.numSignatures} are needed. Waiting for more.`,
      );
      return;
    }

    // Exactly numSignatures, no more: assemblePartialTransaction accepts nothing else.
    const selected = complete.slice(0, this.options.numSignatures);

    let hathorTxId: string;
    let sent: boolean;

    try {
      hathorTxId = await this.wallet.signAndPush(txHex, selected);
      sent = true;
    } catch (error) {
      const walletMessage = error instanceof WalletOperationError ? error.walletMessage : undefined;

      if (walletMessage !== ALREADY_SPENT_MESSAGE) {
        // Any other failure is not a settled outcome, so nothing is recorded on chain and the
        // transfer stays eligible for a later attempt. The previous code fell through to write
        // the outcome with an undefined transaction id, which produced the literal string
        // "0xundefined" and failed inside ABI encoding.
        this.metrics.pushRejected();
        this.logger.error(`Pushing ${transactionId} failed and will be retried.`, error);
        throw error;
      }

      // The inputs are gone, so this proposal can never succeed. Record it as unsent with the
      // manual-check marker so it stops being retried and a human can pick it up.
      this.logger.error(`Push of ${transactionId} hit already-spent inputs; marking for manual check.`);
      this.metrics.pushRejected();
      hathorTxId = MANUAL_CHECK_MARKER;
      sent = false;
    }

    const receipt = await this.federation.submitOutcome(identity, sent, hathorTxId);
    if (!receipt.status) {
      this.metrics.pushRejected();
      this.logger.error(`Recording the outcome of ${transactionId} failed.`, receipt);
      return;
    }

    this.metrics.pushSubmitted();
  }

  /**
   * Asks this wallet for a signature and only accepts one covering every input, retrying a few
   * times in between. A wallet that has not yet caught up on one of the referenced UTXOs returns
   * a partial signature; waiting is usually enough.
   *
   * @returns the signature, or null - never a partial one.
   */
  private async completeSignature(txHex: string, inputCount: number): Promise<string | null> {
    for (let attempt = 1; attempt <= this.options.signatureAttempts; attempt++) {
      const last = attempt === this.options.signatureAttempts;

      let signature: string;
      try {
        signature = await this.wallet.getMySignatures(txHex);
      } catch (error) {
        this.logger.warn(`getMySignatures attempt ${attempt}/${this.options.signatureAttempts} failed.`, error);
        if (!last) {
          await this.clock.sleep(this.options.signatureRetryDelayMs);
        }
        continue;
      }

      if (selectCompleteSignatures([signature], inputCount).length === 1) {
        return signature;
      }

      this.logger.warn(
        `getMySignatures attempt ${attempt}/${this.options.signatureAttempts} returned a signature that ` +
          `does not cover all ${inputCount} input(s). ` +
          (last ? 'Giving up for this round.' : 'Retrying - the wallet may still be syncing an input.'),
      );
      if (!last) {
        await this.clock.sleep(this.options.signatureRetryDelayMs);
      }
    }

    return null;
  }
}
