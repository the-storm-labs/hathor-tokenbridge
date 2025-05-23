import { Contract } from 'web3-eth-contract';
import { VERSIONS } from './Constants';
import { IAllowTokens } from './IAllowTokens';
import { ContractAbi } from 'web3';

export interface ConfirmationsReturn {
  smallAmountConfirmations: number;
  mediumAmountConfirmations: number;
  largeAmountConfirmations: number;
}

export class IAllowTokensV0 implements IAllowTokens {
  allowTokensContract: Contract<ContractAbi>;
  mapTokenInfoAndLimits: any;
  chainId: any;
  federatorInstance: number;

  constructor(allowTokensContract: Contract<ContractAbi>, chainId: number, federatorInstance = 1) {
    this.allowTokensContract = allowTokensContract;
    this.mapTokenInfoAndLimits = {};
    this.chainId = chainId;
    this.federatorInstance = federatorInstance;
  }

  getVersion(): string {
    return VERSIONS.V0;
  }

  async getConfirmations(): Promise<ConfirmationsReturn> {
    let confirmations = 0; //for rsk regtest and ganache
    if (this.chainId === 31 || this.chainId === 42) {
      // rsk testnet and kovan
      confirmations = 10;
    }
    if (this.chainId === 1) {
      //ethereum mainnet 24hs
      confirmations = 240;
    }
    if (this.chainId === 30) {
      // rsk mainnet 24hs
      confirmations = 120;
    }

    confirmations *= this.federatorInstance;

    return {
      smallAmountConfirmations: confirmations,
      mediumAmountConfirmations: confirmations,
      largeAmountConfirmations: confirmations,
    };
  }

  async getLimits() {
    return {
      allowed: true,
      mediumAmount: -1,
      largeAmount: 0,
    };
  }
}
