import { IBridge } from '../contracts/IBridge';
import { IAllowTokens } from '../contracts/IAllowTokens';
import { TransactionSender } from '../lib/TransactionSender';
import { ConfigChain } from '../lib/configChain';
import { FederationFactory } from '../contracts/FederationFactory';
import { AllowTokensFactory } from '../contracts/AllowTokensFactory';
import { BridgeFactory } from '../contracts/BridgeFactory';
import { IFederation } from '../contracts/IFederation';

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

export interface GetLogsParams extends BaseLogsParams {
  fromBlock: number;
  toBlock: number;
}

export interface ProcessLogsParams extends BaseLogsParams {
  logs: any[];
}

export interface ProcessToHathorLogParams extends BaseLogsParams {
  log: any;
  allowTokens: IAllowTokens;
}

export interface ProcessLogParams extends BaseLogsParams {
  log: any;
  sideFedContract: IFederation;
  allowTokens: IAllowTokens;
  federatorAddress: string;
  sideBridgeContract: IBridge;
}

export interface ProcessTransactionParams extends ProcessLogParams {
  tokenAddress: string;
  senderAddress: string;
  receiver: string;
  amount: BigInt;
  typeId: string;
  transactionId: string;
  originChainId: number;
  destinationChainId: number;
}

export interface ProcessToHathorTransactionParams extends ProcessToHathorLogParams {
  tokenAddress: string;
  senderAddress: string;
  receiver: string;
  amount: BigInt;
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
  amount: BigInt;
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
  amount: BigInt;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  originChainId: number;
  destinationChainId: number;
}

export type VoteTransactionV3Params = TransactionIdParams;
