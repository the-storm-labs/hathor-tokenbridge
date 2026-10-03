import type { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import type { HistoryEntry } from '../ports/HathorWalletPort';
import { FakeCursorStore } from '../ports/testSupport/FakeCursorStore';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { RecordingLogger } from '../ports/testSupport/fakes';
import { HathorService } from './HathorService';

/** Close to the test transactions, so they all sit inside the time pre-filter. */
const NOW = 1_000;

const tx = (txId: string, timestamp: number): HistoryEntry => ({
  txId,
  timestamp,
  version: 1,
  isVoided: false,
  inputs: [],
  outputs: [],
});

function build(handle: (tx: HistoryEntry) => Promise<boolean> = async () => true) {
  const wallet = new FakeHathorWallet();
  const cursors = new FakeCursorStore();
  const logger = new RecordingLogger();
  const handled: string[] = [];

  const flow = {
    handleIncoming: async (incoming: HistoryEntry) => {
      handled.push(incoming.txId);
      return handle(incoming);
    },
  } as unknown as HathorToEvmFlow;

  const service = new HathorService({
    wallet,
    flow,
    cursors,
    logger,
    fromTimestamp: 100,
    lookbackBlocks: 120,
    now: () => NOW,
  });
  return { service, wallet, cursors, logger, handled };
}

describe('HathorService startup', () => {
  it('starts the wallet and replays what arrived while it was down', async () => {
    const { service, wallet, handled } = build();
    wallet.history = [tx('a', 150), tx('b', 200)];

    await service.start();

    expect(await wallet.status()).toMatchObject({ state: 'ready' });
    expect(handled).toEqual(['a', 'b']);
  });

  it('subscribes before replaying, so nothing arriving mid-replay is lost', async () => {
    // The gap between "history read" and "subscription registered" is exactly where a transaction
    // would vanish. Handling is idempotent, so seeing one twice is harmless; missing one is not.
    const { service, wallet, handled } = build();
    wallet.history = [tx('old', 150)];

    await service.start();
    await wallet.emitNewTransaction(tx('live', 300));

    expect(handled).toEqual(['old', 'live']);
  });

  it('stops the wallet, and can be started again afterwards', async () => {
    const { service, wallet, handled } = build();
    wallet.history = [tx('a', 150)];

    await service.start();
    await service.stop();
    expect(await wallet.status()).toMatchObject({ state: 'closed' });

    await service.start();
    expect(handled).toEqual(['a', 'a']);
  });

  it('is idempotent on a second start', async () => {
    const { service, handled } = build();
    await service.start();
    await service.start();
    expect(handled).toEqual([]);
  });
});

describe('HathorService history replay', () => {
  it('replays only from the recorded cursor onwards', async () => {
    const { service, wallet, cursors, handled } = build();
    cursors.timestamp = 200;
    wallet.history = [tx('before', 150), tx('at', 200), tx('after', 250)];

    await service.start();
    expect(handled).toEqual(['at', 'after']);
  });

  it('falls back to the configured timestamp when nothing has been recorded', async () => {
    const { service, wallet, handled } = build();
    wallet.history = [tx('tooOld', 50), tx('keep', 150)];

    await service.start();
    expect(handled).toEqual(['keep']);
  });

  it('replays oldest first, so the cursor only ever moves forward', async () => {
    const { service, wallet, cursors } = build();
    // getHistory hands back newest first.
    wallet.history = [tx('newest', 300), tx('middle', 200), tx('oldest', 150)];

    await service.start();
    expect(cursors.timestampWrites).toEqual([150, 200, 300]);
  });
});

describe('HathorService cursor handling', () => {
  it('advances the cursor only for transactions that are done with', async () => {
    // A transaction still waiting on confirmations must not take the cursor past itself.
    const { service, wallet, cursors } = build(async (incoming) => incoming.txId !== 'pending');
    wallet.history = [tx('done', 150), tx('pending', 200)];

    await service.start();
    expect(cursors.timestampWrites).toEqual([150]);
    expect(cursors.timestamp).toBe(150);
  });

  it('never drags the cursor backwards', async () => {
    const { service, wallet, cursors } = build();
    wallet.history = [tx('recent', 300)];

    await service.start();
    expect(cursors.timestamp).toBe(300);

    // A late-arriving transaction with an older timestamp must not undo that.
    await wallet.emitNewTransaction(tx('late', 250));
    expect(cursors.timestamp).toBe(300);
    expect(cursors.timestampWrites).toEqual([300]);
  });

  it('does not move the cursor below where it already was', async () => {
    const { service, wallet, cursors } = build();
    cursors.timestamp = 500;
    wallet.history = [tx('old', 400)];

    await service.start();
    // Nothing at or after 500, so nothing is replayed and nothing is written.
    expect(cursors.timestampWrites).toEqual([]);
  });
});

describe('HathorService failure isolation', () => {
  it('does not let one bad transaction block the rest of the replay', async () => {
    const { service, wallet, handled, logger } = build(async (incoming) => {
      if (incoming.txId === 'bad') {
        throw new Error('malformed');
      }
      return true;
    });
    wallet.history = [tx('good1', 150), tx('bad', 200), tx('good2', 250)];

    await service.start();

    expect(handled).toEqual(['good1', 'bad', 'good2']);
    expect(logger.at('error')).toMatch(/Failed to handle replay transaction bad/);
  });

  it('does not advance the cursor past a transaction that failed', async () => {
    const { service, wallet, cursors } = build(async (incoming) => {
      if (incoming.txId === 'bad') {
        throw new Error('malformed');
      }
      return true;
    });
    wallet.history = [tx('good', 150), tx('bad', 200)];

    await service.start();
    expect(cursors.timestamp).toBe(150);
  });

  it('swallows a failure on the live path rather than taking the process down', async () => {
    // The live path is an event handler; throwing would reach an EventEmitter with no error
    // listener and end the process along with the synced wallet.
    const { service, wallet, logger } = build(async () => {
      throw new Error('boom');
    });

    await service.start();
    await expect(wallet.emitNewTransaction(tx('live', 300))).resolves.toBeUndefined();
    expect(logger.at('error')).toMatch(/Failed to handle live transaction live/);
  });
});

describe('HathorService retry of transactions that were not ready', () => {
  it('checks a waiting deposit again on every run until it is done', async () => {
    // Mainnet, 2026-10-03: once confirmations were counted correctly, a deposit seen before its
    // confirmations was never looked at again until the next restart.
    let confirmed = false;
    const { service, wallet, handled } = build(async (incoming) => incoming.txId !== 'deposit' || confirmed);
    wallet.history = [tx('deposit', 200)];

    await service.start();
    expect(service.pendingCount).toBe(1);

    await service.run();
    expect(service.pendingCount).toBe(1);

    confirmed = true;
    await service.run();
    expect(service.pendingCount).toBe(0);
    expect(handled).toEqual(['deposit', 'deposit', 'deposit']);
  });

  it('does not let a later transaction carry the cursor past an earlier one still waiting', async () => {
    let confirmed = false;
    const { service, wallet, cursors } = build(async (incoming) => incoming.txId !== 'deposit' || confirmed);
    wallet.history = [tx('deposit', 200), tx('own-melt', 300)];

    await service.start();
    // The melt at 300 is done, but replay from 300 would skip the deposit at 200.
    expect(cursors.timestamp).toBe(200);

    confirmed = true;
    await service.run();
    expect(cursors.timestamp).toBe(300);
  });

  it('keeps a live transaction that is not ready, too', async () => {
    let confirmed = false;
    const { service, wallet } = build(async () => confirmed);

    await service.start();
    wallet.history = [tx('live', 400)];
    await wallet.emitNewTransaction(tx('live', 400));
    expect(service.pendingCount).toBe(1);

    confirmed = true;
    await service.run();
    expect(service.pendingCount).toBe(0);
  });

  it('stops waiting on a transaction the wallet reports voided or gone', async () => {
    const { service, wallet, logger, cursors } = build(async (incoming) => incoming.txId !== 'deposit');
    wallet.history = [tx('deposit', 200), tx('later', 300)];

    await service.start();
    expect(cursors.timestamp).toBe(200);

    wallet.history = [tx('later', 300)];
    await service.run();
    expect(service.pendingCount).toBe(0);
    expect(logger.at('warn')).toMatch(/deposit is voided or gone/);
    expect(cursors.timestamp).toBe(300);
  });

  it('retries a transaction whose handling failed', async () => {
    let failing = true;
    const { service, wallet, handled } = build(async () => {
      if (failing) {
        throw new Error('node timeout');
      }
      return true;
    });
    wallet.history = [tx('flaky', 200)];

    await service.start();
    failing = false;
    await service.run();
    expect(handled).toEqual(['flaky', 'flaky']);
    expect(service.pendingCount).toBe(0);
  });

  it('does nothing before it has started', async () => {
    const { service, handled } = build();
    await service.run();
    expect(handled).toEqual([]);
  });
});

describe('HathorService lookback window', () => {
  it('handles a deposit whose wallet event never arrived', async () => {
    // The deposit lands in the wallet's history, but neither the live event nor a restart replay
    // delivers it (the cursor is already past it). Only the window can find it.
    const { service, wallet, cursors, handled } = build();
    cursors.timestamp = 900;
    await service.start();
    expect(handled).toEqual([]);

    wallet.history = [tx('lost', 950)];
    wallet.confirmations.set('lost', 25);
    await service.run();
    expect(handled).toEqual(['lost']);
  });

  it('leaves alone a transaction confirmed further back than the window', async () => {
    const { service, wallet, cursors, handled } = build();
    cursors.timestamp = 900;
    await service.start();

    wallet.history = [tx('ancient', 950)];
    wallet.confirmations.set('ancient', 121);
    await service.run();
    expect(handled).toEqual([]);
  });

  it('does not handle again what this process already finished', async () => {
    const { service, wallet, handled } = build();
    wallet.history = [tx('deposit', 200)];

    await service.start();
    await service.run();
    await service.run();
    expect(handled).toEqual(['deposit']);
  });

  it('keeps retrying a pending transaction after it has left the window', async () => {
    // A federator that could not reach a node for longer than the window must still finish it.
    let reachable = false;
    const { service, wallet, handled } = build(async () => {
      if (!reachable) {
        throw new Error('node unreachable');
      }
      return true;
    });
    wallet.history = [tx('deposit', 200)];
    await service.start();

    wallet.confirmations.set('deposit', 500);
    reachable = true;
    await service.run();
    expect(handled).toEqual(['deposit', 'deposit']);
    expect(service.pendingCount).toBe(0);
  });
});
