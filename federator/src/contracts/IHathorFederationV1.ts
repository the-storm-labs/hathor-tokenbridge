import { Contract } from 'web3-eth-contract';
import { CustomError } from '../lib/CustomError';
import { IHathorFederation } from './IHathorFederation';
import Web3 from 'web3';
import { TransactionTypes } from '../types/transactionTypes';

export class IHathorFederationV1 implements IHathorFederation {
  hathorFederationContract: Contract;
  chainId: number;
  web3: Web3;

  constructor(hathorFederationContract: Contract, chainId: number, web3: Web3) {
    this.hathorFederationContract = hathorFederationContract;
    this.chainId = chainId;
    this.web3 = web3;
  }

  async isProcessed(transactionId: string): Promise<boolean> {
    try {
      return this.hathorFederationContract.methods.isProcessed(transactionId).call();
    } catch (err) {
      throw new CustomError(`Exception isProcessed at hathorFederation Contract`, err);
    }
  }

  async isSigned(transactionId: string): Promise<boolean> {
    try {
      return this.hathorFederationContract.methods.isSigned(transactionId).call();
    } catch (err) {
      throw new CustomError(`Exception isSigned at hathorFederation Contract`, err);
    }
  }

  async isProposed(transactionId: string): Promise<boolean> {
    try {
      return this.hathorFederationContract.methods.isProposed(transactionId).call();
    } catch (err) {
      throw new CustomError(`Exception isProposed at hathorFederation Contract`, err);
    }
  }

  async transactionHex(transactionId: string): Promise<string> {
    try {
      return this.hathorFederationContract.methods.transactionHex(transactionId).call();
    } catch (err) {
      throw new CustomError(`Exception transactionHex at hathorFederation Contract`, err);
    }
  }

  async transactionSignatures(transactionId: string): Promise<string[]> {
    try {
      return this.hathorFederationContract.methods.transactionSignatures(transactionId).call();
    } catch (err) {
      throw new CustomError(`Exception transactionSignatures at hathorFederation Contract`, err);
    }
  }

  async getTransactionId(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
  ): Promise<string> {
    try {
      return this.hathorFederationContract.methods
        .getTransactionId(originalTokenAddress, transactionHash, value, sender, receiver, transactionType)
        .call();
    } catch (err) {
      throw new CustomError(`Exception getTransactionId at hathorFederation Contract`, err);
    }
  }

  async getSendTransactionProposalABI(
    originalTokenAddress: string,
    transactionHash: string,
    value: number,
    sender: string,
    receiver: string,
    transactionType: TransactionTypes,
    txHex: string,
  ): Promise<any> {
    const bytesOriginalTokenAddress = this.web3.utils.asciiToHex(originalTokenAddress);
    const bytesTransactionHash = this.web3.utils.asciiToHex(transactionHash);
    const bytesSender = this.web3.utils.asciiToHex(sender);
    const bytesReceiver = this.web3.utils.asciiToHex(receiver);
    return this.hathorFederationContract.methods
      .sendTransactionProposal(
        bytesOriginalTokenAddress,
        bytesTransactionHash,
        value,
        bytesSender,
        bytesReceiver,
        1,
        transactionType.valueOf(),
        txHex,
      )
      .encodeABI();
  }
}
