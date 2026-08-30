import type Web3 from 'web3';

import type { FederationEvent } from '../../../domain/federationEvents';
import type { HathorFederationPort, ProposalIdentity, SubmitResult } from '../../../ports/HathorFederationPort';
import type { LoggerPort } from '../../../ports/LoggerPort';
import type { EvmTransactionSender } from '../EvmTransactionSender';
import hathorFederationAbi from './HathorFederation.abi.json';
import { type ContractLike, contractAt, method, pastEventsOf } from './contractAccess';
import { toBytes32, toFederationEvent } from './federationEncoding';

/**
 * The HathorFederation contract, where federators coordinate proposals and signatures.
 *
 * Two encoding details are load-bearing and easy to get wrong, because the contract takes bytes32
 * where the rest of the system has strings:
 *
 *  - Token addresses and transaction hashes are left-padded to 32 bytes on the way in. Every
 *    federator must pad identically or they derive different transaction ids and never converge.
 *  - On the way out, a bytes32 token address has to be un-padded back to a 20-byte address - but
 *    only for MINT and TRANSFER. A MELT carries a Hathor token uid, which is genuinely 32 bytes
 *    and must be left alone.
 */
export class HathorFederationAdapter implements HathorFederationPort {
  private readonly web3: Web3;
  private readonly contract: ContractLike;
  private readonly sender: EvmTransactionSender;
  private readonly address: string;
  private readonly logger: LoggerPort;

  constructor(web3: Web3, address: string, sender: EvmTransactionSender, logger: LoggerPort, contract?: ContractLike) {
    this.web3 = web3;
    this.contract = contract ?? contractAt(web3, hathorFederationAbi, address);
    this.sender = sender;
    this.address = address;
    this.logger = logger;
  }

  private identityArgs(identity: ProposalIdentity): unknown[] {
    return [
      toBytes32(identity.originalTokenAddress),
      toBytes32(identity.transactionHash),
      identity.value,
      identity.sender,
      identity.receiver,
      identity.transactionType,
    ];
  }

  async getTransactionId(identity: ProposalIdentity): Promise<string> {
    return (await method(this.contract, 'getTransactionId', ...this.identityArgs(identity)).call()) as string;
  }

  async isProcessed(transactionId: string): Promise<boolean> {
    return (await method(this.contract, 'isProcessed', transactionId).call()) as boolean;
  }

  async isSigned(transactionId: string, federatorAddress: string): Promise<boolean> {
    return (await method(this.contract, 'isSigned', transactionId, federatorAddress).call()) as boolean;
  }

  async isProposed(transactionId: string): Promise<boolean> {
    return (await method(this.contract, 'isProposed', transactionId).call()) as boolean;
  }

  async getTransactionHex(transactionId: string): Promise<string> {
    const hex = (await method(this.contract, 'transactionHex', transactionId).call()) as string;
    // The port and the wallet both work in bare hex; the `0x` is a contract encoding detail.
    return hex.startsWith('0x') ? hex.slice(2) : hex;
  }

  async getSignatures(transactionId: string): Promise<string[]> {
    const count = Number(await method(this.contract, 'getSignatureCount', transactionId).call());

    const signatures: string[] = [];
    for (let index = 0; index < count; index++) {
      signatures.push((await method(this.contract, 'transactionSignatures', transactionId, index).call()) as string);
    }
    return signatures;
  }

  async submitProposal(identity: ProposalIdentity, txHex: string): Promise<SubmitResult> {
    const data = method(
      this.contract,
      'sendTransactionProposal',
      ...this.identityArgs(identity),
      `0x${txHex.replace(/^0x/, '')}`,
    ).encodeABI();
    return this.sender.send(this.address, data);
  }

  async submitSignature(identity: ProposalIdentity, signature: string): Promise<SubmitResult> {
    const data = method(
      this.contract,
      'updateSignatureState',
      ...this.identityArgs(identity),
      signature,
      true,
    ).encodeABI();
    return this.sender.send(this.address, data);
  }

  async submitOutcome(identity: ProposalIdentity, sent: boolean, hathorTxId: string): Promise<SubmitResult> {
    const data = method(
      this.contract,
      'updateTransactionState',
      ...this.identityArgs(identity),
      sent,
      `0x${hathorTxId.replace(/^0x/, '')}`,
    ).encodeABI();
    return this.sender.send(this.address, data);
  }

  async getEvents(
    fromBlock: number,
    toBlock: number,
    kinds?: readonly FederationEvent['kind'][],
  ): Promise<FederationEvent[]> {
    const logs = await pastEventsOf(this.contract)('allEvents', { fromBlock, toBlock });

    const events: FederationEvent[] = [];
    for (const log of logs) {
      if (typeof log === 'string') {
        continue;
      }
      const event = toFederationEvent(log.event, log.returnValues as Record<string, unknown>, (message, error) =>
        this.logger.warn(message, error),
      );
      if (event && (!kinds || kinds.includes(event.kind))) {
        events.push(event);
      }
    }
    return events;
  }
}
