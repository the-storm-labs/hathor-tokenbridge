import { Contract } from 'web3-eth-contract';
import { IToken } from './IToken';
import { ContractAbi } from 'web3';

export class ITokenV0 implements IToken {
  tokenContract: Contract<ContractAbi>;
  chainId: any;

  constructor(_tokenContract: Contract<ContractAbi>, _chainId: number) {
    this.tokenContract = _tokenContract;
    this.chainId = _chainId;
  }

  getDecimals(): Promise<number> {
    return this.tokenContract.methods.decimals().call();
  }
}
