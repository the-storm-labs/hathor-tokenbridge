import { IBridge } from '../contracts/IBridge';
import { IAllowTokens } from '../contracts/IAllowTokens';
import { TransactionSender } from '../lib/TransactionSender';
import { ConfigChain } from '../lib/configChain';
import { FederationFactory } from '../contracts/FederationFactory';
import { AllowTokensFactory } from '../contracts/AllowTokensFactory';
import { BridgeFactory } from '../contracts/BridgeFactory';
import { IFederation } from '../contracts/IFederation';
import { EventLog } from 'web3-eth-contract';

export interface BaseLogsParams {
  sideChainId: number;
  mainChainId: number;
  transactionSender: TransactionSender;
  currentBlock: number;
  mediumAndSmall: boolean;
  confirmations: { mediumAmountConfirmations: number; largeAmountConfirmations: number };
  sideChainConfig: ConfigChain;
  federationFactory: FederationFactory;
  allowTokensFactory: AllowTokensFactory;
  bridgeFactory: BridgeFactory;
}

export interface CrossEventReturnValues {
  [key: string]: unknown;
  _to: string;
  _from: string;
  _amount: bigint;
  _tokenAddress: string;
  _typeId: string;
  _originChainId: bigint | number | string;
  _destinationChainId: bigint | number | string;
}

export type CrossEventLog = EventLog & {
  returnValues: CrossEventReturnValues;
};

export interface GetLogsParams extends BaseLogsParams {
  fromBlock: number;
  toBlock: number;
}

export interface ProcessLogsParams extends BaseLogsParams {
  logs: CrossEventLog[];
}

export interface ProcessToHathorLogParams extends BaseLogsParams {
  log: CrossEventLog;
  allowTokens: IAllowTokens;
}

export interface ProcessLogParams extends BaseLogsParams {
  log: CrossEventLog;
  sideFedContract: IFederation;
  allowTokens: IAllowTokens;
  federatorAddress: string;
  sideBridgeContract: IBridge;
}

export interface ProcessTransactionParams extends ProcessLogParams {
  tokenAddress: string;
  senderAddress: string;
  receiver: string;
  amount: bigint;
  typeId: string;
  transactionId: string;
  originChainId: number;
  destinationChainId: number;
}

export interface ProcessToHathorTransactionParams extends ProcessToHathorLogParams {
  tokenAddress: string;
  senderAddress: string;
  receiver: string;
  amount: bigint;
  typeId: string;
  originChainId: number;
  destinationChainId: number;
}

export interface VoteHathorTransactionParams {
  sideChainId: number;
  mainChainId: number;
  transactionSender: TransactionSender;
  sideChainConfig: ConfigChain;
  sideFedContract: IFederation;
  federatorAddress: string;
  tokenAddress: string;
  senderAddress: string;
  receiver: string;
  amount: bigint;
  transactionId: string;
  originChainId: number;
  destinationChainId: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}

export interface VoteTransactionParams extends ProcessTransactionParams {
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}

export interface TransactionIdParams {
  originalTokenAddress: string;
  sender: string;
  receiver: string;
  amount: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  originChainId: number;
  destinationChainId: number;
}

export type VoteTransactionV3Params = TransactionIdParams;
