import { AxiosHttpClient } from './AxiosHttpClient';
import { HeadlessWalletAdapter } from './HeadlessWalletAdapter';
import { describeHathorWalletContract } from '../../ports/HathorWalletPort.contract';
import { RecordingLogger } from '../../ports/testSupport/fakes';

/**
 * Runs the shared HathorWalletPort contract against a real headless wallet.
 *
 * Opt-in: it needs a wallet on the network, so it stays out of the normal run. Enable with
 *
 *   HEADLESS_CONTRACT_URL=http://localhost:8000 \
 *   HEADLESS_CONTRACT_API_KEY=... \
 *   HEADLESS_CONTRACT_FOREIGN_ADDRESS=<an address the wallet does not own> \
 *   npx jest --selectProjects app --testPathPattern HeadlessWalletAdapter.contract
 *
 * Optionally set HEADLESS_CONTRACT_TX_ID and HEADLESS_CONTRACT_TX_HEX to enable the cases that
 * need something the wallet actually knows about.
 *
 * The same suite runs against the wallet-lib adapter once it exists. That pairing is what turns
 * "the library behaves like the headless did" from an assumption into a check.
 */
const url = process.env.HEADLESS_CONTRACT_URL;
const apiKey = process.env.HEADLESS_CONTRACT_API_KEY;
const foreignAddress = process.env.HEADLESS_CONTRACT_FOREIGN_ADDRESS;

if (url && apiKey && foreignAddress) {
  describeHathorWalletContract(
    'HeadlessWalletAdapter (live)',
    {
      foreignAddress,
      knownTxId: process.env.HEADLESS_CONTRACT_TX_ID,
      decodableTxHex: process.env.HEADLESS_CONTRACT_TX_HEX,
    },
    async () =>
      new HeadlessWalletAdapter(
        new AxiosHttpClient(url, { 'x-api-key': apiKey }),
        {
          walletId: process.env.HEADLESS_CONTRACT_WALLET_ID ?? 'multi',
          seedKey: process.env.HEADLESS_CONTRACT_SEED_KEY ?? 'default',
          multisig: process.env.HEADLESS_CONTRACT_MULTISIG !== 'false',
        },
        new RecordingLogger(),
      ),
  );
} else {
  // A file with no tests fails the run, and a silent skip is how a suite quietly stops covering
  // anything. State the reason instead.
  describe('HeadlessWalletAdapter contract (live)', () => {
    it.skip('needs HEADLESS_CONTRACT_URL, _API_KEY and _FOREIGN_ADDRESS to run', () => undefined);
  });
}
