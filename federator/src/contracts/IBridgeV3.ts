import { Contract, EventLog } from 'web3-eth-contract';
import { IBridge } from './IBridge';
import { ContractAbi } from 'web3';

interface MappedTokensParams {
  originalTokenAddress: string;
}

export class IBridgeV3 implements IBridge {
  bridgeContract: Contract<ContractAbi>;

  constructor(bridgeContract: Contract<ContractAbi>) {
    this.bridgeContract = bridgeContract;
  }

  getFederation(): Promise<string> {
    return this.bridgeContract.methods.getFederation().call();
  }

  getAllowedTokens(): Promise<string> {
    return this.bridgeContract.methods.allowedTokens().call();
  }

  async getPastEvents(eventName, destinationChainId: number, options: any): Promise<(string | EventLog)[]> {
    return this.bridgeContract.getPastEvents(eventName, options);
  }

  getAddress(): string {
    return this.bridgeContract.options.address;
  }

  getTransactionDataHash({ to, amount, blockHash, transactionHash, logIndex }): Promise<string> {
    return this.bridgeContract.methods.getTransactionDataHash(to, amount, blockHash, transactionHash, logIndex).call();
  }

  getProcessed(transactionDataHash: string): Promise<boolean> {
    return this.bridgeContract.methods.claimed(transactionDataHash).call();
  }

  getVersion(): Promise<string> {
    return this.bridgeContract.methods.version().call();
  }

  getMappedToken(paramsObj: MappedTokensParams): Promise<string> {
    return this.bridgeContract.methods.mappedTokens(paramsObj.originalTokenAddress).call();
  }
}
