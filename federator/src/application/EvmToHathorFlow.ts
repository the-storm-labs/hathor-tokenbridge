import { toHathorAmount } from '../domain/amounts';
import { TransactionType } from '../domain/transactionTypes';
import { validateMintProposal, validateTransferProposal } from '../domain/validation/proposals';
import type { ValidationResult } from '../domain/validation/proposals';
import type { BridgePort, CrossEvent, TokenMapping } from '../ports/BridgePort';
import type { ProposalIdentity } from '../ports/HathorFederationPort';
import type { HathorWalletPort } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';
import type { ProposalCoordinator, ProposalStrategy } from './ProposalCoordinator';

/**
 * Moves a transfer that started on the EVM side over to Hathor.
 *
 * Which Hathor operation settles it depends on where the token is native. A token native to the
 * EVM chain has no supply on Hathor, so it is minted there; a token native to Hathor was locked in
 * the multisig on its way out and is transferred back.
 *
 * Replaces EvmBroker, which inherited half of this from an abstract Broker that also owned the
 * wallet HTTP calls, the contract factories and the metrics.
 */
export interface EvmToHathorFlowDeps {
  readonly wallet: HathorWalletPort;
  readonly bridge: BridgePort;
  readonly coordinator: ProposalCoordinator;
  readonly logger: LoggerPort;
  readonly evmChainId: number;
  readonly inputLockTtlMs: number;
}

export class EvmToHathorFlow {
  private readonly wallet: HathorWalletPort;
  private readonly bridge: BridgePort;
  private readonly coordinator: ProposalCoordinator;
  private readonly logger: LoggerPort;
  private readonly evmChainId: number;
  private readonly inputLockTtlMs: number;

  constructor(deps: EvmToHathorFlowDeps) {
    this.wallet = deps.wallet;
    this.bridge = deps.bridge;
    this.coordinator = deps.coordinator;
    this.logger = deps.logger;
    this.evmChainId = deps.evmChainId;
    this.inputLockTtlMs = deps.inputLockTtlMs;
  }

  /**
   * @param evmAmount the amount locked on the EVM side, in that token's own precision.
   */
  async transfer(params: {
    senderAddress: string;
    receiverAddress: string;
    evmAmount: bigint;
    evmTokenAddress: string;
    transactionHash: string;
  }): Promise<boolean> {
    const mapping = await this.bridge.mappingByEvmToken(params.evmTokenAddress);
    const isEvmNative = mapping.originChainId === this.evmChainId;

    const identity: ProposalIdentity = {
      originalTokenAddress: params.evmTokenAddress,
      transactionHash: params.transactionHash,
      value: params.evmAmount,
      sender: params.senderAddress,
      receiver: params.receiverAddress,
      transactionType: isEvmNative ? TransactionType.MINT : TransactionType.TRANSFER,
    };

    this.logger.info(
      `EVM -> Hathor: ${params.evmAmount} of ${params.evmTokenAddress} to ${params.receiverAddress} ` +
        `as a ${isEvmNative ? 'mint' : 'transfer'} of ${mapping.hathorToken}.`,
    );

    return this.coordinator.coordinate(identity, this.strategy(mapping, isEvmNative));
  }

  private strategy(mapping: TokenMapping, isEvmNative: boolean): ProposalStrategy {
    return {
      build: async (identity) => this.build(identity, mapping, isEvmNative),
      validate: async (txHex, identity) => this.validate(txHex, identity, mapping, isEvmNative),
    };
  }

  private async build(identity: ProposalIdentity, mapping: TokenMapping, isEvmNative: boolean): Promise<string> {
    const hathorAmount = await this.toHathorAmount(identity.value, mapping);

    // Every change, deposit and authority output goes to the wallet's index-0 address, so
    // proposals stop growing the set of addresses the wallet has to track and re-sync.
    const fixedAddress = await this.wallet.getAddressAtIndex(0);
    const common = { markInputsAsUsed: true, inputLockTtlMs: this.inputLockTtlMs, fixedAddress };

    if (isEvmNative) {
      return this.wallet.createMintProposal({
        ...common,
        token: mapping.hathorToken,
        amount: hathorAmount,
        receiverAddress: identity.receiver,
      });
    }

    return this.wallet.createTransferProposal({
      ...common,
      outputs: [{ address: identity.receiver, value: hathorAmount, token: mapping.hathorToken }],
    });
  }

  private async validate(
    txHex: string,
    identity: ProposalIdentity,
    mapping: TokenMapping,
    isEvmNative: boolean,
  ): Promise<ValidationResult> {
    // The originating event is the source of truth, not the identity handed to us: the identity
    // may have come off a contract event another federator wrote.
    const event = await this.bridge.findCrossEvent(identity.transactionHash);
    if (!event) {
      return { valid: false, reason: `No Cross event found for transaction ${identity.transactionHash}.` };
    }

    const expectedAmount = await this.toHathorAmount(event.amount, mapping);
    const proposal = await this.wallet.decodeTxHex(txHex);

    return isEvmNative
      ? validateMintProposal(proposal, { token: mapping.hathorToken, amount: expectedAmount })
      : validateTransferProposal(proposal, {
          token: mapping.hathorToken,
          amount: expectedAmount,
          receiver: this.receiverOf(event),
        });
  }

  private receiverOf(event: CrossEvent): string {
    return event.receiver;
  }

  /**
   * The previous code multiplied by a hardcoded 10^16 in one direction and sliced decimal strings
   * in the other, both of which assume an 18-decimal token. The scale now comes from the token
   * itself, which is identical for 18-decimal tokens and correct for the rest.
   */
  private async toHathorAmount(evmAmount: bigint, mapping: TokenMapping): Promise<bigint> {
    const decimals = await this.bridge.getEvmTokenDecimals(mapping.evmToken);
    return toHathorAmount(evmAmount, decimals);
  }
}
