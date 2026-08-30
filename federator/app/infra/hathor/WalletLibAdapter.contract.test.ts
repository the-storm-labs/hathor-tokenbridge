import { describeHathorWalletContract } from '../../ports/HathorWalletPort.contract';
import { RecordingLogger } from '../../ports/testSupport/fakes';

/**
 * Runs the shared HathorWalletPort contract against a real, network-bound wallet-lib wallet.
 *
 * This is the pairing the whole migration rests on: the same suite runs against the headless
 * adapter (HeadlessWalletAdapter.contract.test.ts), so "the library behaves like the headless did"
 * is checked rather than assumed.
 *
 * Opt-in, because it syncs a real wallet. Enable with
 *
 *   WALLETLIB_CONTRACT_SEED="<24 words>" \
 *   WALLETLIB_CONTRACT_PUBKEYS="xpub1,xpub2,..." \
 *   WALLETLIB_CONTRACT_NUM_SIGNATURES=3 \
 *   WALLETLIB_CONTRACT_FULLNODE=https://node1.testnet.hathor.network/v1a/ \
 *   WALLETLIB_CONTRACT_TX_MINING=https://txmining.testnet.hathor.network/ \
 *   WALLETLIB_CONTRACT_FOREIGN_ADDRESS=<an address the wallet does not own> \
 *   npx jest --selectProjects app --testPathPattern WalletLibAdapter.contract
 *
 * Expect a cold start to take minutes: storage is MemoryStore, so the entire history is rebuilt.
 *
 * The adapter is required lazily rather than imported. Importing it pulls in @hathor/wallet-lib,
 * whose module initialisation starts a self-renewing timer, and Jest does not run afterAll for a
 * file whose tests are all skipped - so without the credentials this file would create a timer
 * that nothing ever stops, and the worker would never exit.
 */
const seed = process.env.WALLETLIB_CONTRACT_SEED;
const pubkeys = process.env.WALLETLIB_CONTRACT_PUBKEYS;
const foreignAddress = process.env.WALLETLIB_CONTRACT_FOREIGN_ADDRESS;

if (seed && pubkeys && foreignAddress) {
  describeHathorWalletContract(
    'WalletLibAdapter (live)',
    {
      foreignAddress,
      knownTxId: process.env.WALLETLIB_CONTRACT_TX_ID,
      decodableTxHex: process.env.WALLETLIB_CONTRACT_TX_HEX,
    },
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { WalletLibAdapter } = require('./WalletLibAdapter') as typeof import('./WalletLibAdapter');
      return new WalletLibAdapter(
        {
          seed,
          multisig: {
            pubkeys: pubkeys.split(',').map((key) => key.trim()),
            numSignatures: Number(process.env.WALLETLIB_CONTRACT_NUM_SIGNATURES ?? 3),
          },
          network: (process.env.WALLETLIB_CONTRACT_NETWORK ?? 'testnet') as 'testnet' | 'mainnet',
          fullnodeUrl: process.env.WALLETLIB_CONTRACT_FULLNODE ?? 'https://node1.testnet.hathor.network/v1a/',
          txMiningUrl: process.env.WALLETLIB_CONTRACT_TX_MINING ?? 'https://txmining.testnet.hathor.network/',
          gapLimit: Number(process.env.WALLETLIB_CONTRACT_GAP_LIMIT ?? 20),
        },
        new RecordingLogger(),
      );
    },
  );
} else {
  // A silent skip is how a suite quietly stops covering anything. State the reason.
  describe('WalletLibAdapter contract (live)', () => {
    it.skip('needs WALLETLIB_CONTRACT_SEED, _PUBKEYS and _FOREIGN_ADDRESS to run', () => undefined);
  });
}
