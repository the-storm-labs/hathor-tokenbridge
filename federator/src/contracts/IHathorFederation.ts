import { Contract } from 'web3-eth-contract';
import { TransactionTypes } from '../types/transactionTypes';

export interface IHathorFederation {
  hathorFederationContract: Contract;

  getPastEvents(eventName: string, options: any): Promise<EventData[]>;
  getSignatureCount(transactionId: string): Promise<any>; 
  isProcessed(transactionId: string): Promise<boolean>;
  isSigned(transactionId: string): Promise<boolean>;
  isProposed(transactionId: string): Promise<boolean>;
  transactionHex(transactionId: string): Promise<string>;
  transactionSignatures(transactionId: string): Promise<string[]>;
  getTransactionId(originalTokenAddress, transactionHash, value, sender, receiver, transactionType): Promise<string>;
  getSendTransactionProposalArgs(
    originalTokenAddress: string,
    transactionHash: string,
    value: number,
    sender: string,
    receiver: string,
    transactionType: TransactionTypes,
    txHex: string,
  ): Promise<any>;
  getUpdateSignatureStateArgs(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
    signature,
    signed
  ) : Promise<any>;
  getUpdateTransactionStateArgs(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
    sent
  ) : Promise<any>;

}
