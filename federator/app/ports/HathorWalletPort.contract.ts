import type { HathorWalletPort } from './HathorWalletPort';

/**
 * The contract every HathorWalletPort implementation must satisfy.
 *
 * This is the mechanism that de-risks the migration. The same suite runs against the headless
 * HTTP adapter and against the wallet-lib adapter, so "the library behaves like the headless did"
 * stops being an assumption and becomes a check. It also runs against the in-memory fake, which
 * keeps the fake honest - a fake that drifts from the contract makes every use-case test above it
 * meaningless.
 *
 * The assertions are invariants that hold whatever state the wallet is in, because a suite that
 * runs against a live testnet wallet cannot dictate its history. Anything state-dependent is
 * supplied through `fixtures` by whoever knows the environment.
 */

export interface WalletContractFixtures {
  /** A transaction id this wallet knows about, if one can be named. */
  readonly knownTxId?: string | undefined;
  /** A serialised proposal this wallet can decode, if one can be named. */
  readonly decodableTxHex?: string | undefined;
  /** An address this wallet definitely does not own. */
  readonly foreignAddress: string;
}

/**
 * Fixtures are taken synchronously and separately from the wallet on purpose. Whether a
 * fixture-dependent case runs is decided while the describe block is being built, long before any
 * beforeAll has had a chance to run - so a suite that resolved them asynchronously would skip
 * every one of those cases while reporting itself green.
 *
 * @param name how this implementation shows up in the test output
 * @param fixtures values only the caller can know; may connect to nothing
 * @param createWallet builds the subject; may connect to a real network
 */
/**
 * Per-test budget. Every case here may talk to a real node, and a live wallet's teardown alone was
 * measured at ~15s against Hathor testnet - the 5s default is a unit-test budget, not this.
 */
const LIVE_TEST_TIMEOUT_MS = 60_000;

export function describeHathorWalletContract(
  name: string,
  fixtures: WalletContractFixtures,
  createWallet: () => Promise<HathorWalletPort>,
): void {
  describe(`HathorWalletPort contract: ${name}`, () => {
    let wallet: HathorWalletPort;

    beforeAll(async () => {
      wallet = await createWallet();
      await wallet.start();
    }, 120_000);

    afterAll(async () => {
      await wallet?.stop();
    });

    describe('lifecycle', () => {
      it('reports a state from the known set', async () => {
        const status = await wallet.status();
        expect(['closed', 'connecting', 'syncing', 'processing', 'ready', 'error', 'unknown']).toContain(status.state);
      });

      it('is ready once start resolves', async () => {
        // start() is defined as "bring it up and wait until it can answer", so a caller that
        // awaited it must not have to poll afterwards.
        expect((await wallet.status()).state).toBe('ready');
      });

      it('tolerates start being called again', async () => {
        await expect(wallet.start()).resolves.not.toThrow();
      });
    });

    describe('addresses', () => {
      it('returns the same address at index 0 every time', async () => {
        // The whole point of the fixed address: it must not advance any internal cursor, or every
        // proposal grows the set of addresses the wallet has to track and re-sync.
        const first = await wallet.getAddressAtIndex(0);
        const second = await wallet.getAddressAtIndex(0);
        expect(second).toBe(first);
        expect(first).toBeTruthy();
      });

      it('recognises its own address', async () => {
        expect(await wallet.isOwnAddress(await wallet.getAddressAtIndex(0))).toBe(true);
      });

      it('does not claim an address it does not own', async () => {
        expect(await wallet.isOwnAddress(fixtures.foreignAddress)).toBe(false);
      });
    });

    describe('history', () => {
      it(
        'returns entries newest first',
        async () => {
          const history = await wallet.getHistory();
          const timestamps = history.map((entry) => entry.timestamp);
          expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
        },
        LIVE_TEST_TIMEOUT_MS,
      );

      it(
        'carries values as bigint, never as number',
        async () => {
          // The single most likely way this migration breaks quietly: wallet-lib 4.x types values
          // as bigint, and an adapter that leaks a number truncates silently above 2^53.
          const history = await wallet.getHistory();
          for (const entry of history.slice(0, 20)) {
            for (const io of [...entry.inputs, ...entry.outputs]) {
              expect(typeof io.value).toBe('bigint');
            }
          }
        },
        LIVE_TEST_TIMEOUT_MS,
      );

      it(
        'gives every entry an id and a timestamp',
        async () => {
          for (const entry of (await wallet.getHistory()).slice(0, 20)) {
            expect(typeof entry.txId).toBe('string');
            expect(entry.txId).toBeTruthy();
            expect(Number.isFinite(entry.timestamp)).toBe(true);
          }
        },
        LIVE_TEST_TIMEOUT_MS,
      );
    });

    describe('transactions', () => {
      it('returns undefined for a transaction it does not know', async () => {
        // Not an error: "unknown" and "failed to ask" must be distinguishable at the call site.
        const absent = await wallet.getTransaction('0'.repeat(64));
        expect(absent).toBeUndefined();
      });

      (fixtures.knownTxId ? it : it.skip)('returns a known transaction with bigint values', async () => {
        const tx = await wallet.getTransaction(fixtures.knownTxId as string);
        expect(tx).toBeDefined();
        for (const io of [...(tx?.inputs ?? []), ...(tx?.outputs ?? [])]) {
          expect(typeof io.value).toBe('bigint');
        }
      });
    });

    describe('decoding', () => {
      (fixtures.decodableTxHex ? it : it.skip)('decodes a proposal into inputs and outputs', async () => {
        const decoded = await wallet.decodeTxHex(fixtures.decodableTxHex as string);
        expect(Array.isArray(decoded.inputs)).toBe(true);
        expect(Array.isArray(decoded.outputs)).toBe(true);
        for (const io of [...decoded.inputs, ...decoded.outputs]) {
          expect(typeof io.value).toBe('bigint');
          expect(typeof io.tokenData).toBe('number');
        }
      });
    });

    describe('shutdown', () => {
      // Last, and it does not restart afterwards. An earlier version started the wallet again to
      // "leave it usable", which against a live wallet means a full resync - MemoryStore rebuilds
      // the whole history - for no benefit, since afterAll only stops it again. Being safe to stop
      // twice is exactly what makes that safe.
      it(
        'tolerates stop being called more than once',
        async () => {
          await wallet.stop();
          await expect(wallet.stop()).resolves.not.toThrow();
        },
        LIVE_TEST_TIMEOUT_MS,
      );
    });
  });
}
