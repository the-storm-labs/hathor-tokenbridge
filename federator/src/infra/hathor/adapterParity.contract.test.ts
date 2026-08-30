import { AxiosHttpClient } from './AxiosHttpClient';
import { HeadlessWalletAdapter } from './HeadlessWalletAdapter';
import type { HathorWalletPort } from '../../ports/HathorWalletPort';
import { RecordingLogger } from '../../ports/testSupport/fakes';

/**
 * Runs BOTH adapters against the same wallet and compares what they return, field by field.
 *
 * The shared HathorWalletPort contract proves each adapter satisfies the interface. This proves
 * something stronger and more specific: that they agree. A federator switched from one to the
 * other must derive the same address, decode the same proposal the same way, and see the same
 * history - anything else means the two would coordinate on different transaction ids, or validate
 * the same proposal to different conclusions.
 *
 * Opt-in, and needs both a live headless wallet and the seed for the same wallet:
 *
 *   PARITY_HEADLESS_URL=http://127.0.0.1:8000 \
 *   PARITY_API_KEY=... PARITY_SEED="<24 words>" PARITY_PUBKEYS=xpub... \
 *   PARITY_NUM_SIGNATURES=1 PARITY_FULLNODE=... PARITY_TX_MINING=... \
 *   PARITY_TX_HEX=<a real serialised transaction the wallet can resolve> \
 *   npx jest --selectProjects app --testPathPattern adapterParity --runInBand
 */
const url = process.env.PARITY_HEADLESS_URL;
const apiKey = process.env.PARITY_API_KEY;
const seed = process.env.PARITY_SEED;
const pubkeys = process.env.PARITY_PUBKEYS;
const txHex = process.env.PARITY_TX_HEX;

const LIVE_TIMEOUT_MS = 180_000;

if (url && apiKey && seed && pubkeys) {
  describe('HeadlessWalletAdapter vs WalletLibAdapter, same wallet', () => {
    let headless: HathorWalletPort;
    let lib: HathorWalletPort;

    beforeAll(async () => {
      headless = new HeadlessWalletAdapter(
        new AxiosHttpClient(url, { 'x-api-key': apiKey }),
        {
          walletId: process.env.PARITY_WALLET_ID ?? 'multi',
          seedKey: process.env.PARITY_SEED_KEY ?? 'default',
          multisig: true,
        },
        new RecordingLogger(),
      );

      // Required lazily: importing it pulls in wallet-lib, whose module initialisation starts a
      // timer that Jest will not clear for a file whose tests are all skipped.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
      const { WalletLibAdapter } = require('./WalletLibAdapter') as typeof import('./WalletLibAdapter');
      lib = new WalletLibAdapter(
        {
          seed,
          multisig: {
            pubkeys: pubkeys.split(',').map((key) => key.trim()),
            numSignatures: Number(process.env.PARITY_NUM_SIGNATURES ?? 1),
          },
          network: (process.env.PARITY_NETWORK ?? 'testnet') as 'testnet' | 'mainnet',
          fullnodeUrl: process.env.PARITY_FULLNODE ?? 'https://node1.testnet.hathor.network/v1a/',
          txMiningUrl: process.env.PARITY_TX_MINING ?? 'https://txmining.testnet.hathor.network/',
          gapLimit: Number(process.env.PARITY_GAP_LIMIT ?? 20),
        },
        new RecordingLogger(),
      );

      await Promise.all([headless.start(), lib.start()]);
    }, LIVE_TIMEOUT_MS);

    afterAll(async () => {
      await Promise.all([headless?.stop(), lib?.stop()]);
    }, LIVE_TIMEOUT_MS);

    it(
      'derives the same fixed address',
      async () => {
        // Everything downstream pins change, deposit and authority outputs to this address. Two
        // federators disagreeing here would build proposals nobody else recognises.
        const [a, b] = await Promise.all([headless.getAddressAtIndex(0), lib.getAddressAtIndex(0)]);
        expect(b).toBe(a);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'agrees on which addresses are ours',
      async () => {
        const own = await lib.getAddressAtIndex(0);
        const foreign = 'WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm';

        expect(await headless.isOwnAddress(own)).toBe(await lib.isOwnAddress(own));
        expect(await headless.isOwnAddress(foreign)).toBe(await lib.isOwnAddress(foreign));
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'sees the same set of transactions',
      async () => {
        const [a, b] = await Promise.all([headless.getHistory(), lib.getHistory()]);
        expect(new Set(b.map((tx) => tx.txId))).toEqual(new Set(a.map((tx) => tx.txId)));
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'reports the same values and tokens for every transaction in history',
      async () => {
        // The amounts are what the bridge mints, melts and votes on. A disagreement here is a
        // disagreement about how much money moved.
        const [a, b] = await Promise.all([headless.getHistory(), lib.getHistory()]);
        const summarise = (history: Awaited<ReturnType<HathorWalletPort['getHistory']>>) =>
          Object.fromEntries(
            history.map((tx) => [
              tx.txId,
              {
                inputs: tx.inputs.map((io) => `${io.token}:${io.value}:${io.tokenData}`),
                outputs: tx.outputs.map((io) => `${io.token}:${io.value}:${io.tokenData}`),
                isVoided: tx.isVoided,
                version: tx.version,
              },
            ]),
          );

        expect(summarise(b)).toEqual(summarise(a));
      },
      LIVE_TIMEOUT_MS,
    );

    (txHex ? it : it.skip)(
      'decodes the same proposal to the same inputs and outputs',
      async () => {
        // decodeTxHex is the security-critical path: it is what proposal validation reads. The
        // headless got it for free from an endpoint; the library version had to be written by
        // hand, resolving each input from the transaction that created it.
        const [a, b] = await Promise.all([headless.decodeTxHex(txHex as string), lib.decodeTxHex(txHex as string)]);

        const shape = (tx: Awaited<ReturnType<HathorWalletPort['decodeTxHex']>>) => ({
          inputs: tx.inputs.map((io) => ({
            value: io.value.toString(),
            token: io.token,
            tokenData: io.tokenData,
            address: io.decoded.address,
          })),
          outputs: tx.outputs.map((io) => ({
            value: io.value.toString(),
            token: io.token,
            tokenData: io.tokenData,
            address: io.decoded.address,
          })),
        });

        expect(shape(b)).toEqual(shape(a));

        // `decoded.type` is deliberately left out of the comparison above. The headless omits it
        // entirely on decode, while the library adapter reports it - normalised to the fullnode's
        // vocabulary, which is what history uses and what the domain filters on. That is our
        // adapter supplying more information in the same language, not the two disagreeing, so it
        // is asserted directly rather than diffed.
        for (const output of b.outputs) {
          if (output.decoded.address !== undefined) {
            expect(['MultiSig', 'P2PKH']).toContain(output.decoded.type);
          }
        }
      },
      LIVE_TIMEOUT_MS,
    );
  });
} else {
  describe('adapter parity (live)', () => {
    it.skip('needs PARITY_HEADLESS_URL, _API_KEY, _SEED and _PUBKEYS to run', () => undefined);
  });
}
