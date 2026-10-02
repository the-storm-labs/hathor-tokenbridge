import type Web3 from 'web3';

import allowTokensAbi from '../../../../../bridge/abi/AllowTokens.json';
import type { AllowTokensPort, Confirmations, TransferLimits } from '../../../ports/BridgePort';
import { type ContractLike, contractAt, method } from './contractAccess';

/**
 * The AllowTokens contract: which tokens may cross, in what amounts, and how deeply confirmed.
 *
 * Confirmation depths are multiplied by this federator's multisig order, so each federator waits
 * longer than the one before it rather than all racing to propose the same transfer.
 */
export class AllowTokensAdapter implements AllowTokensPort {
  private readonly contract: ContractLike;
  private readonly multisigOrder: number;
  /** Limits are cached per token, but only once the token is allowed - see getLimits. */
  private readonly limits = new Map<string, TransferLimits>();

  constructor(web3: Web3, address: string, multisigOrder: number, contract?: ContractLike) {
    this.contract = contract ?? contractAt(web3, allowTokensAbi, address);
    this.multisigOrder = multisigOrder;
  }

  async getLimits(evmToken: string): Promise<TransferLimits> {
    const key = evmToken.toLowerCase();
    const cached = this.limits.get(key);
    if (cached) {
      return cached;
    }

    const raw = (await method(this.contract, 'getInfoAndLimits', evmToken).call()) as {
      info: { allowed: boolean };
      limit: { min: bigint | string; mediumAmount: bigint | string; largeAmount: bigint | string };
    };

    const limits: TransferLimits = {
      allowed: Boolean(raw.info.allowed),
      min: BigInt(raw.limit.min),
      mediumAmount: BigInt(raw.limit.mediumAmount),
      largeAmount: BigInt(raw.limit.largeAmount),
    };

    // Only a token that is allowed gets cached. A token can be allowed later, and caching the
    // refusal would keep this federator rejecting it for the life of the process.
    if (limits.allowed) {
      this.limits.set(key, limits);
    }
    return limits;
  }

  async getConfirmations(): Promise<Confirmations> {
    const [small, medium, large] = await Promise.all([
      method(this.contract, 'smallAmountConfirmations').call(),
      method(this.contract, 'mediumAmountConfirmations').call(),
      method(this.contract, 'largeAmountConfirmations').call(),
    ]);

    return {
      smallAmountConfirmations: this.scale(small),
      mediumAmountConfirmations: this.scale(medium),
      largeAmountConfirmations: this.scale(large),
    };
  }

  private scale(confirmations: unknown): number {
    return Number(confirmations) * this.multisigOrder;
  }
}
