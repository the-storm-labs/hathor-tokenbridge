import type { FederationEvent } from '../../domain/federationEvents';
import type { HathorFederationPort, ProposalIdentity, SubmitResult } from '../HathorFederationPort';

/**
 * In-memory HathorFederation contract. Models the coordination state the real contract holds -
 * proposal, signatures, settled - so a coordinator test reads as a sequence of federator actions
 * rather than as a list of stubbed return values.
 */
export class FakeHathorFederation implements HathorFederationPort {
  public transactionId = 'tx-id-1';
  public processed = false;
  public proposedTxHex?: string;
  public signatures: string[] = [];
  public signedBy = new Set<string>();

  /** Set to make the next submit of that kind report failure. */
  public failSubmit?: 'proposal' | 'signature' | 'outcome';

  public readonly submitted: Array<
    | { kind: 'proposal'; identity: ProposalIdentity; txHex: string }
    | { kind: 'signature'; identity: ProposalIdentity; signature: string }
    | { kind: 'outcome'; identity: ProposalIdentity; sent: boolean; hathorTxId: string }
  > = [];

  async getTransactionId(): Promise<string> {
    return this.transactionId;
  }

  async isProcessed(): Promise<boolean> {
    return this.processed;
  }

  async isSigned(_transactionId: string, federatorAddress: string): Promise<boolean> {
    return this.signedBy.has(federatorAddress);
  }

  async isProposed(): Promise<boolean> {
    return this.proposedTxHex !== undefined;
  }

  async getTransactionHex(): Promise<string> {
    if (this.proposedTxHex === undefined) {
      throw new Error('No proposal recorded.');
    }
    return this.proposedTxHex;
  }

  async getSignatures(): Promise<string[]> {
    return [...this.signatures];
  }

  /** Events the contract has emitted, keyed by the block they were emitted in. */
  public readonly events: Array<{ block: number; event: FederationEvent }> = [];

  async getEvents(
    fromBlock: number,
    toBlock: number,
    kinds?: readonly FederationEvent['kind'][],
  ): Promise<FederationEvent[]> {
    return this.events
      .filter((entry) => entry.block >= fromBlock && entry.block <= toBlock)
      .filter((entry) => !kinds || kinds.includes(entry.event.kind))
      .map((entry) => entry.event);
  }

  private result(kind: 'proposal' | 'signature' | 'outcome'): SubmitResult {
    return { status: this.failSubmit !== kind, transactionHash: '0xreceipt' };
  }

  async submitProposal(identity: ProposalIdentity, txHex: string): Promise<SubmitResult> {
    this.submitted.push({ kind: 'proposal', identity, txHex });
    const result = this.result('proposal');
    if (result.status) {
      this.proposedTxHex = txHex;
    }
    return result;
  }

  async submitSignature(identity: ProposalIdentity, signature: string): Promise<SubmitResult> {
    this.submitted.push({ kind: 'signature', identity, signature });
    const result = this.result('signature');
    if (result.status) {
      this.signatures.push(signature);
    }
    return result;
  }

  async submitOutcome(identity: ProposalIdentity, sent: boolean, hathorTxId: string): Promise<SubmitResult> {
    this.submitted.push({ kind: 'outcome', identity, sent, hathorTxId });
    const result = this.result('outcome');
    if (result.status) {
      this.processed = true;
    }
    return result;
  }
}
