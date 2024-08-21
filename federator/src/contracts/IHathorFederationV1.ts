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
    transactionType
  ) {
    try {
      // Convert the string parameters to bytes32 where necessary
      const bytesOriginalTokenAddress = this.web3.utils.padLeft(originalTokenAddress, 64);
      const bytesTransactionHash = this.web3.utils.padLeft(transactionHash, 64);
      const bytesSender = this.web3.utils.padLeft(sender, 64);
      const bytesReceiver = this.web3.utils.padLeft(receiver, 64);

      // Call the smart contract method with the formatted parameters
      return await this.hathorFederationContract.methods
        .getTransactionId(
          bytesOriginalTokenAddress,
          bytesTransactionHash,
          value,
          bytesSender,
          bytesReceiver,
          transactionType.valueOf()
        )
        .call();
    } catch (err) {
      throw new CustomError(`Exception getTransactionId at hathorFederation Contract`, err);
    }
  }

  async getSendTransactionProposalArgs(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
    txHex
  ) {
    // Convert strings to bytes32 format
    const bytesOriginalTokenAddress = this.web3.utils.padLeft(originalTokenAddress, 64);
    const bytesTransactionHash = this.web3.utils.padLeft(transactionHash, 64);
    const bytesSender = this.web3.utils.padLeft(sender, 64);
    const bytesReceiver = this.web3.utils.padLeft(receiver, 64);

    // Prepare the ABI-encoded function call
    return this.hathorFederationContract.methods
      .sendTransactionProposal(
        bytesOriginalTokenAddress,
        bytesTransactionHash,
        value,
        bytesSender,
        bytesReceiver,
        transactionType.valueOf(), // Convert transaction type enum to its underlying value
        txHex
      )
      .encodeABI();
  }

  async getUpdateSignatureStateArgs(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
    signature,
    signed
  ) {
    // Convert strings to bytes32 format
    const bytesOriginalTokenAddress = this.web3.utils.padLeft(originalTokenAddress, 64);
    const bytesTransactionHash = this.web3.utils.padLeft(transactionHash, 64);
    const bytesSender = this.web3.utils.padLeft(sender, 64);
    const bytesReceiver = this.web3.utils.padLeft(receiver, 64);

    // Prepare the ABI-encoded function call
    return this.hathorFederationContract.methods
      .updateSignatureState(
        bytesOriginalTokenAddress,
        bytesTransactionHash,
        value,
        bytesSender,
        bytesReceiver,
        transactionType.valueOf(), // Convert transaction type enum to its underlying value
        signature,
        signed
      )
      .encodeABI();
  }

  async getUpdateTransactionStateArgs(
    originalTokenAddress,
    transactionHash,
    value,
    sender,
    receiver,
    transactionType,
    sent
  ) {
    // Convert strings to bytes32 format
    const bytesOriginalTokenAddress = this.web3.utils.padLeft(originalTokenAddress, 64);
    const bytesTransactionHash = this.web3.utils.padLeft(transactionHash, 64);
    const bytesSender = this.web3.utils.padLeft(sender, 64);
    const bytesReceiver = this.web3.utils.padLeft(receiver, 64);

    // Prepare the ABI-encoded function call
    return this.hathorFederationContract.methods
      .updateTransactionState(
        bytesOriginalTokenAddress,
        bytesTransactionHash,
        value,
        bytesSender,
        bytesReceiver,
        transactionType.valueOf(), // Convert transaction type enum to its underlying value
        sent
      )
      .encodeABI();
  }



}
