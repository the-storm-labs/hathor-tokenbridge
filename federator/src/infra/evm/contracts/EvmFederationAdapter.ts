import type Web3 from 'web3';

import federationAbi from '../../../../../bridge/abi/Federation.json';
import type { EvmFederationPort, VoteReceipt, VoteRequest } from '../../../ports/EvmFederationPort';
import type { EvmTransactionSender } from '../EvmTransactionSender';
import { type ContractLike, contractAt, method } from './contractAccess';

/** The Federation contract on the EVM side: where a Hathor-originated transfer is voted through. */
export class EvmFederationAdapter implements EvmFederationPort {
  private readonly contract: ContractLike;
  private readonly sender: EvmTransactionSender;
  private readonly address: string;

  constructor(web3: Web3, address: string, sender: EvmTransactionSender, contract?: ContractLike) {
    this.contract = contract ?? contractAt(web3, federationAbi, address);
    this.sender = sender;
    this.address = address;
  }

  /** The nine fields the contract hashes. Order is the contract's, and must not be rearranged. */
  private args(request: VoteRequest): unknown[] {
    return [
      request.originalTokenAddress,
      request.sender,
      request.receiver,
      request.amount,
      request.blockHash,
      request.transactionHash,
      request.logIndex,
      request.originChainId,
      request.destinationChainId,
    ];
  }

  async getTransactionId(request: VoteRequest): Promise<string> {
    return (await method(this.contract, 'getTransactionId', ...this.args(request)).call()) as string;
  }

  async transactionWasProcessed(transactionId: string): Promise<boolean> {
    return (await method(this.contract, 'transactionWasProcessed', transactionId).call()) as boolean;
  }

  async hasVoted(transactionId: string, federatorAddress: string): Promise<boolean> {
    // `hasVoted` reads msg.sender, so the caller has to be declared - asking without `from` asks
    // whether the zero address voted.
    return (await method(this.contract, 'hasVoted', transactionId).call({ from: federatorAddress })) as boolean;
  }

  async vote(request: VoteRequest): Promise<VoteReceipt> {
    const data = method(this.contract, 'voteTransaction', ...this.args(request)).encodeABI();
    return this.sender.send(this.address, data);
  }
}
