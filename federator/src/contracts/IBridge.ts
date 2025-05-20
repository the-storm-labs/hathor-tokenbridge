import { ContractAbi } from 'web3';
import { Contract, EventLog } from 'web3-eth-contract';

export interface IBridge {
  bridgeContract: Contract<ContractAbi>;

  getFederation();

  getAllowedTokens();

  getPastEvents(eventName: string, destinationChainId: number, options: any): Promise<(string | EventLog)[]>;

  getAddress(): string;

  getProcessed(transactionDataHash: string);

  getVersion(): Promise<string>;

  getTransactionDataHash({
    to,
    amount,
    blockHash,
    transactionHash,
    logIndex,
    originChainId,
    destinationChainId,
  }): Promise<string>;

  getMappedToken(paramsObj: any): Promise<string>;
}
