import type { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import type { HistoryEntry } from '../ports/HathorWalletPort';
import { FakeCursorStore } from '../ports/testSupport/FakeCursorStore';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { RecordingLogger } from '../ports/testSupport/fakes';
import { HathorService } from './HathorService';

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

  const service = new HathorService({ wallet, flow, cursors, logger, fromTimestamp: 100 });
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
