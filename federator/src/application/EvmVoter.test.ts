import type { EvmFederationPort, VoteRequest, VoteReceipt } from '../ports/EvmFederationPort';
import type { RevertedTransfer, RevertedTransferStorePort } from '../ports/RevertedTransferStorePort';
import { RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { EvmVoter } from './EvmVoter';

const FEDERATOR = '0xFEDERATOR';

const REQUEST: VoteRequest = {
  originalTokenAddress: '0xTOKEN',
  sender: '0xSENDER',
  receiver: '0xRECEIVER',
  amount: 1_500_000_000_000_000_000n,
  blockHash: '0xBLOCK',
  transactionHash: '0xTX',
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 42161,
};

class FakeEvmFederation implements EvmFederationPort {
  public transactionId = '0xABCDEF';
  public processed = false;
  public voters = new Set<string>();
  public receipt: VoteReceipt = { status: true, transactionHash: '0xreceipt' };
  public votes: VoteRequest[] = [];

  async getTransactionId(): Promise<string> {
    return this.transactionId;
  }
  async transactionWasProcessed(): Promise<boolean> {
    return this.processed;
  }
  async hasVoted(_id: string, address: string): Promise<boolean> {
    return this.voters.has(address);
  }
  async vote(request: VoteRequest): Promise<VoteReceipt> {
    this.votes.push(request);
    return this.receipt;
  }
}

class FakeRevertedStore implements RevertedTransferStorePort {
  public readonly entries = new Map<string, RevertedTransfer>();
  async has(transactionId: string): Promise<boolean> {
    return this.entries.has(transactionId);
  }
  async record(transactionId: string, details: RevertedTransfer): Promise<void> {
    this.entries.set(transactionId, details);
  }
}

function build() {
  const federation = new FakeEvmFederation();
  const revertedTransfers = new FakeRevertedStore();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const voter = new EvmVoter({ federation, revertedTransfers, logger, metrics, federatorAddress: FEDERATOR });
  return { voter, federation, revertedTransfers, logger, metrics };
}

describe('EvmVoter', () => {
  it('votes on a transfer nobody has handled', async () => {
    const { voter, federation, metrics } = build();

    expect(await voter.vote(REQUEST)).toBe(true);
    expect(federation.votes).toEqual([REQUEST]);
    expect(metrics.counts.voteSucceeded).toBe(1);
  });

  it('does not vote on a transfer already processed', async () => {
    const { voter, federation } = build();
    federation.processed = true;

    expect(await voter.vote(REQUEST)).toBe(true);
    expect(federation.votes).toEqual([]);
  });

  it('does not vote twice', async () => {
    const { voter, federation } = build();
    federation.voters.add(FEDERATOR);

    expect(await voter.vote(REQUEST)).toBe(true);
    expect(federation.votes).toEqual([]);
  });

  it('still votes when a different federator has voted', async () => {
    const { voter, federation } = build();
    federation.voters.add('0xSOMEONE_ELSE');

    expect(await voter.vote(REQUEST)).toBe(true);
    expect(federation.votes).toHaveLength(1);
  });

  it('lower-cases the transaction id before using it', async () => {
    // The contract returns a mixed-case id while the reverted-transfer store is keyed by string.
    // Two spellings of one id would let a reverted transfer be retried forever.
    const { voter, federation, revertedTransfers } = build();
    federation.transactionId = '0xABCDEF';
    await revertedTransfers.record('0xabcdef', {
      originalTokenAddress: '0xTOKEN',
      sender: '0xSENDER',
      receiver: '0xRECEIVER',
      amount: '1',
      blockHash: '0xBLOCK',
      transactionHash: '0xTX',
      logIndex: 129,
    });

    expect(await voter.vote(REQUEST)).toBe(false);
    expect(federation.votes).toEqual([]);
  });

  it('does not retry a vote that reverted before', async () => {
    const { voter, federation, revertedTransfers, logger } = build();
    await revertedTransfers.record('0xabcdef', {
      originalTokenAddress: '0xTOKEN',
      sender: '0xSENDER',
      receiver: '0xRECEIVER',
      amount: '1',
      blockHash: '0xBLOCK',
      transactionHash: '0xTX',
      logIndex: 129,
    });

    expect(await voter.vote(REQUEST)).toBe(false);
    expect(federation.votes).toEqual([]);
    expect(logger.at('warn')).toMatch(/a previous vote on it reverted/);
  });

  it('records a reverting vote so the next round skips it', async () => {
    const { voter, federation, revertedTransfers, metrics } = build();
    federation.receipt = { status: false, error: 'execution reverted' };

    expect(await voter.vote(REQUEST)).toBe(false);
    expect(metrics.counts.voteFailed).toBe(1);
    expect(revertedTransfers.entries.get('0xabcdef')).toMatchObject({
      originalTokenAddress: '0xTOKEN',
      transactionHash: '0xTX',
      error: 'execution reverted',
    });
  });

  it('stores the amount as a string, since a reverted record is serialised', async () => {
    // JSON.stringify throws on a bigint, so a record carrying one could never be persisted.
    const { voter, federation, revertedTransfers } = build();
    federation.receipt = { status: false };

    await voter.vote(REQUEST);
    const stored = revertedTransfers.entries.get('0xabcdef');
    expect(typeof stored?.amount).toBe('string');
    expect(() => JSON.stringify(stored)).not.toThrow();
  });
});
