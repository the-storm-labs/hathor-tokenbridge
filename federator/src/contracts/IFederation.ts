import { Contract, EventLog } from 'web3-eth-contract';
import { ConfigChain } from '../lib/configChain';
import { TransactionIdParams, VoteTransactionV3Params } from '../types/federator';
import { ContractAbi } from 'web3';

export interface IFederation {
  federationContract: Contract<ContractAbi>;
  config: ConfigChain;

  getVersion(): string;

  isMember(address: string): Promise<any>;

  getTransactionId(paramsObj: TransactionIdParams): Promise<any>;

  transactionWasProcessed(txId: string): Promise<any>;

  hasVoted(txId: string, from: string): Promise<any>;

  getVoteTransactionABI(paramsObj: VoteTransactionV3Params): string;

  getAddress(): string;

  getPastEvents(eventName: string, options: any): Promise<(string | EventLog)[]>;

  emitHeartbeat(
    txSender: { sendTransaction: (arg0: string, arg1: any, arg2: number, arg3: string) => any },
    fedVersion: any,
    fedChainsIds: any[],
    fedChainsBlocks: any[],
    fedChainsInfo: any[],
  );
}
