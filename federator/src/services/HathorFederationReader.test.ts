import type { EvmToHathorFlow } from '../application/EvmToHathorFlow';
import type { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import type { FederationEvent, FederationTransfer } from '../domain/federationEvents';
import { TransactionType } from '../domain/transactionTypes';
import type { EvmChainPort } from '../ports/EvmChainPort';
import { FakeCursorStore } from '../ports/testSupport/FakeCursorStore';
import { FakeHathorFederation } from '../ports/testSupport/FakeHathorFederation';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { HATHOR_FEDERATION_READER, HathorFederationReader } from './HathorFederationReader';

class FakeChain implements EvmChainPort {
  public head = 1_000;
  public syncing = false;
  async getBlockNumber(): Promise<number> {
    return this.head;
  }
  async isSyncing(): Promise<boolean> {
    return this.syncing;
  }
}

const transfer = (overrides: Partial<FederationTransfer> = {}): FederationTransfer => ({
  transactionId: 'tx-1',
  originalTokenAddress: '0xTOKEN',
  transactionHash: '0xHASH',
  value: 150n,
  sender: 'HSENDER',
  receiver: '0xRECEIVER',
  transactionType: TransactionType.MINT,
  ...overrides,
});

async function build() {
  const chain = new FakeChain();
  const federation = new FakeHathorFederation();
  const wallet = new FakeHathorWallet();
  await wallet.start();
  const cursors = new FakeCursorStore();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();

  const evmCalls: string[] = [];
  const meltCalls: string[] = [];
  const settleCalls: string[] = [];

  const evmToHathor = {
    transfer: async (p: { transactionHash: string }) => {
      evmCalls.push(p.transactionHash);
      return true;
    },
  } as unknown as EvmToHathorFlow;

  const hathorToEvm = {
    transfer: async (p: { hathorTxId: string }) => {
      meltCalls.push(p.hathorTxId);
      return true;
    },
    settleMeltedTransfer: async (p: { hathorTxId: string }) => {
      settleCalls.push(p.hathorTxId);
      return true;
    },
  } as unknown as HathorToEvmFlow;

  const reader = new HathorFederationReader({
    chain,
    federation,
    wallet,
    evmToHathor,
    hathorToEvm,
    cursors,
    logger,
    metrics,
    fromBlock: 0,
    confirmationBlocks: 4,
    inputLockTtlMs: 1_800_000,
  });

  return { reader, chain, federation, wallet, cursors, logger, metrics, evmCalls, meltCalls, settleCalls };
}

/** Records an event at a block the reader will consider settled. */
function at(block: number, event: FederationEvent) {
  return { block, event };
}

describe('HathorFederationReader guards', () => {
  it('does not read while the state chain node is syncing', async () => {
    const { reader, chain, federation, evmCalls, logger } = await build();
    chain.syncing = true;
    federation.events.push(at(100, { kind: 'proposed', ...transfer(), txHex: 'beef' }));

    await reader.run();
    expect(evmCalls).toEqual([]);
    expect(logger.at('warn')).toMatch(/still syncing/);
  });

  it('stays behind the confirmation depth', async () => {
    const { reader, chain, federation, evmCalls } = await build();
    chain.head = 1_000; // settled head is 996
    federation.events.push(at(999, { kind: 'proposed', ...transfer(), txHex: 'beef' }));

    await reader.run();
    expect(evmCalls).toEqual([]);
  });

  it('does nothing when the state chain is too young to have settled blocks', async () => {
    const { reader, chain, cursors, logger } = await build();
    chain.head = 2; // shallower than the 4-block confirmation depth

    await reader.run();
    expect(cursors.blocks.size).toBe(0);
    expect(logger.at('debug')).toMatch(/nothing is settled yet/);
  });

  it('does nothing when the cursor is already at the settled head', async () => {
    const { reader, cursors, logger } = await build();
    await cursors.setBlockCursor(HATHOR_FEDERATION_READER, 996);

    await reader.run();
    expect(logger.at('debug')).toMatch(/Nothing new on the state chain/);
  });
});

describe('HathorFederationReader event routing', () => {
  it('re-enters the EVM flow for a mint proposal it has just seen', async () => {
    const { reader, federation, evmCalls } = await build();
    federation.events.push(at(100, { kind: 'proposed', ...transfer(), txHex: 'beef' }));

    await reader.run();
    expect(evmCalls).toEqual(['0xHASH']);
  });

  it('re-enters the flow on a signature, so it can push once quorum is reached', async () => {
    const { reader, federation, evmCalls } = await build();
    federation.events.push(
      at(100, {
        kind: 'signed',
        ...transfer(),
        member: '0xOTHER',
        signed: true,
        signature: 'pub|0:a',
      }),
    );

    await reader.run();
    expect(evmCalls).toEqual(['0xHASH']);
  });

  it('re-enters the flow on a failure, so the transfer can be retried', async () => {
    const { reader, federation, evmCalls } = await build();
    federation.events.push(at(100, { kind: 'failed', ...transfer() }));

    await reader.run();
    expect(evmCalls).toEqual(['0xHASH']);
  });

  it('routes a melt to the Hathor flow rather than the EVM one', async () => {
    const { reader, federation, evmCalls, meltCalls } = await build();
    federation.events.push(
      at(100, { kind: 'proposed', ...transfer({ transactionType: TransactionType.MELT }), txHex: 'beef' }),
    );

    await reader.run();
    expect(evmCalls).toEqual([]);
    expect(meltCalls).toEqual(['0xHASH']);
  });
});

describe('HathorFederationReader settled proposals', () => {
  it('votes on the EVM side once a melt has settled', async () => {
    // A melt is only half the transfer: the tokens are burned, but nothing has been released yet.
    const { reader, federation, settleCalls } = await build();
    federation.events.push(
      at(100, {
        kind: 'sent',
        ...transfer({ transactionType: TransactionType.MELT }),
        processed: true,
        hathorTxId: 'htrtx',
      }),
    );

    await reader.run();
    expect(settleCalls).toEqual(['0xHASH']);
  });

  it('does nothing further when a mint settles', async () => {
    // A mint completes on Hathor; there is no second leg.
    const { reader, federation, settleCalls, evmCalls } = await build();
    federation.events.push(at(100, { kind: 'sent', ...transfer(), processed: true, hathorTxId: 'htrtx' }));

    await reader.run();
    expect(settleCalls).toEqual([]);
    expect(evmCalls).toEqual([]);
  });
});

describe('HathorFederationReader input locks', () => {
  it('marks inputs another federator has claimed before doing anything else', async () => {
    // Ordering is the point: knowing which UTXOs are spoken for stops this federator building a
    // competing proposal over the same ones.
    const { reader, federation, wallet } = await build();
    federation.events.push(
      at(100, { kind: 'lock', txHex: 'claimed-hex' }),
      at(101, { kind: 'proposed', ...transfer(), txHex: 'beef' }),
    );

    await reader.run();
    expect(wallet.lockedInputs).toEqual([{ txHex: 'claimed-hex', ttlMs: 1_800_000 }]);
  });

  it('keeps going when marking the inputs fails', async () => {
    // Worst case is losing a race the on-chain state resolves anyway.
    const { reader, federation, wallet, evmCalls, logger } = await build();
    wallet.lockProposalInputs = async () => {
      throw new Error('wallet busy');
    };
    federation.events.push(
      at(100, { kind: 'lock', txHex: 'claimed-hex' }),
      at(101, { kind: 'proposed', ...transfer(), txHex: 'beef' }),
    );

    await reader.run();
    expect(logger.at('warn')).toMatch(/Could not mark another federator claimed inputs/);
    expect(evmCalls).toEqual(['0xHASH']);
  });
});

describe('HathorFederationReader cursor', () => {
  it('advances only on the general pass, not the lock pass', async () => {
    const { reader, chain, cursors } = await build();
    chain.head = 1_000;

    await reader.run();
    expect(await cursors.getBlockCursor(HATHOR_FEDERATION_READER, 0)).toBe(996);
  });

  it('counts a completed run', async () => {
    const { reader, metrics } = await build();
    await reader.run();
    expect(metrics.counts.hathorRunCompleted).toBe(1);
  });
});
