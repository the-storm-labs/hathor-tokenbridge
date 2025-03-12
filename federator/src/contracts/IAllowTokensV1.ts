import { BN } from 'ethereumjs-util';
import { Contract } from 'web3-eth-contract';
import { CustomError } from '../lib/CustomError';
import { VERSIONS } from './Constants';
import { IAllowTokens } from './IAllowTokens';
import { ConfirmationsReturn } from './IAllowTokensV0';
import { ContractAbi } from 'web3';

export interface GetLimitsParams {
  tokenAddress: string;
}

interface TokenAndLimits {
  info: TokenInfo;
  limit: Limits;
}

interface Limits {
  min: number;
  max: number;
  daily: number;
  mediumAmount: number;
  largeAmount: number;
}

interface TokenInfo {
  allowed: boolean;
  typeId: number;
  spentToday: number;
  lastDay: number;
}

export class IAllowTokensV1 implements IAllowTokens {
  allowTokensContract: Contract<ContractAbi>;
  mapTokenInfoAndLimits: any;
  chainId: number;
  federatorInstance: number;

  constructor(allowTokensContract: Contract<ContractAbi>, chainId: number, federatorInstance = 1) {
    this.allowTokensContract = allowTokensContract;
    this.mapTokenInfoAndLimits = {};
    this.chainId = chainId;
    this.federatorInstance = federatorInstance;
  }

  getVersion(): string {
    return VERSIONS.V1;
  }

  async getConfirmations(): Promise<ConfirmationsReturn> {
    const smallAmount = await this.getSmallAmountConfirmations();
    const mediumAmount = await this.getMediumAmountConfirmations();
    const largeAmount = await this.getLargeAmountConfirmations();
    return {
      smallAmountConfirmations: this.multiplyByFederatorInstance(Number(smallAmount)),
      mediumAmountConfirmations: this.multiplyByFederatorInstance(Number(mediumAmount)),
      largeAmountConfirmations: this.multiplyByFederatorInstance(Number(largeAmount)),
    };
  }

  private multiplyByFederatorInstance(confirmation: number): number {
    return confirmation * this.federatorInstance;
  }

  async getSmallAmountConfirmations(): Promise<BigInt> {
    try {
      return this.allowTokensContract.methods.smallAmountConfirmations().call();
    } catch (err) {
      throw new CustomError(`Exception getSmallAmountConfirmations at AllowTokens Contract`, err);
    }
  }

  async getMediumAmountConfirmations(): Promise<BigInt> {
    try {
      return this.allowTokensContract.methods.mediumAmountConfirmations().call();
    } catch (err) {
      throw new CustomError(`Exception getMediumAmountConfirmations at AllowTokens Contract`, err);
    }
  }

  async getLargeAmountConfirmations(): Promise<BigInt> {
    try {
      return this.allowTokensContract.methods.largeAmountConfirmations().call();
    } catch (err) {
      throw new CustomError(`Exception getLargeAmountConfirmations at AllowTokens Contract`, err);
    }
  }

  async getLimits(objParams: GetLimitsParams) {
    try {
      let result = this.mapTokenInfoAndLimits[objParams.tokenAddress];
      if (!result) {
        const infoAndLimits = (await this.allowTokensContract.methods
          .getInfoAndLimits(objParams.tokenAddress)
          .call()) as TokenAndLimits;
        result = {
          allowed: infoAndLimits.info.allowed,
          mediumAmount: infoAndLimits.limit.mediumAmount,
          largeAmount: infoAndLimits.limit.largeAmount,
        };
        if (result.allowed) {
          this.mapTokenInfoAndLimits[objParams.tokenAddress] = result;
        }
      }
      return result;
    } catch (err) {
      throw new CustomError(`Exception getInfoAndLimits at AllowTokens Contract for ${objParams.tokenAddress}`, err);
    }
  }
}
