import type { AppConfig } from '../config/types';
import { loadConfig } from '../config/load';
import { buildFederator } from './container';

/**
 * A smoke test of the composition root.
 *
 * It does not assert that the wiring is *correct* - only the running federator can show that - but
 * it does catch the failures a wiring file actually has: a dependency that was never constructed, a
 * circular import, an adapter whose constructor rejects the config it is handed. Those otherwise
 * surface at boot, in production, after a wallet has already spent minutes syncing.
 *
 * Nothing here connects to anything: constructing an adapter does not open a connection.
 */
const ENV: NodeJS.ProcessEnv = {
  EVM_NAME: 'sepolia',
  EVM_CHAIN_ID: '11155111',
  EVM_HOST: 'https://sepolia.example.org',
  EVM_BRIDGE_ADDRESS: '0x3f11828A1bE716d911E6A7d3D7ad0586D8CF3307',
  EVM_FEDERATION_ADDRESS: '0xeE97735e9caA9561331E4E47507E0aB7E4EbBF9f',
  EVM_ALLOW_TOKENS_ADDRESS: '0xf074f0717A60e4F59e365c9C134a6ae319fAbEdE',
  EVM_FROM_BLOCK: '11556340',

  STATE_CHAIN_ID: '11155111',
  STATE_CHAIN_HOST: 'https://sepolia.example.org',
  STATE_CONTRACT_ADDRESS: '0xcE0226ACcDFBd32Dd723F927330f1952fB993c0d',
  STATE_FROM_BLOCK: '11556340',
  STATE_CONFIRMATION_BLOCKS: '4',

  HATHOR_NAME: 'golf',
  HATHOR_CHAIN_ID: '31',
  HATHOR_NETWORK: 'testnet',
  HATHOR_FULLNODE_URL: 'https://node1.testnet.hathor.network/v1a/',
  HATHOR_TX_MINING_URL: 'https://txmining.testnet.hathor.network/',
  HATHOR_SEED: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  HATHOR_MULTISIG_PUBKEYS: 'xpubA,xpubB,xpubC',
  HATHOR_NUM_SIGNATURES: '2',
  HATHOR_MULTISIG_ORDER: '1',
  HATHOR_MIN_CONFIRMATIONS: '1',
  HATHOR_INPUT_LOCK_TTL_MS: '1800000',
  HATHOR_FROM_TIMESTAMP: '1733509177',

  FEDERATOR_KEY: '0x08141073f8a519b93255153c334438bb9cd998eb9b51f9723cc07931655c90df',
  STORAGE_PATH: '/tmp/federator-container-test',
};

const config: AppConfig = loadConfig(ENV);

describe('buildFederator', () => {
  it('builds the whole graph without a chain or a wallet behind it', () => {
    const federator = buildFederator(config);

    expect(federator.hathorService).toBeDefined();
    expect(federator.health).toBeDefined();
    expect(federator.metrics).toBeDefined();
    expect(federator.schedulers).toHaveLength(2);
  });

  it('starts nothing', async () => {
    // Construction must not connect. main.ts decides the boot order, and a constructor that dialled
    // out would make that ordering a fiction.
    const federator = buildFederator(config);
    expect(await federator.wallet.status()).toMatchObject({ state: 'closed' });
  });

  it('uses the wallet-lib adapter when no headless is configured', () => {
    expect(buildFederator(config).walletAdapter).toBe('wallet-lib');
  });

  it('uses the headless adapter when one is configured, which is the rollout switch', () => {
    // Configuring a headless is how an operator runs this whole tree against the wallet container
    // they already have, before moving onto the embedded library.
    const withHeadless = loadConfig({
      ...ENV,
      HATHOR_HEADLESS_URL: 'http://localhost:8000',
      HATHOR_HEADLESS_API_KEY: 'key',
    });
    expect(buildFederator(withHeadless).walletAdapter).toBe('headless');
  });

  it('reports what it was built with and how its schedulers are doing', async () => {
    const federator = buildFederator(config);
    expect(await federator.status()).toMatchObject({
      federator: config.federator.address,
      multisigOrder: 1,
      walletAdapter: 'wallet-lib',
      wallet: { state: 'closed' },
      schedulers: [{ failureStreak: 0 }, { failureStreak: 0 }],
    });
  });

  it('stamps the federator address onto its metrics', async () => {
    const federator = buildFederator(config);
    expect(await federator.metrics.render()).toContain(config.federator.address);
  });

  it('wires the metrics endpoint to the same registry the application writes to', async () => {
    // A /metrics that renders a different registry is an endpoint that is always empty.
    const federator = buildFederator(config);
    federator.metrics.evmRunCompleted();

    const rendered = await (
      federator.health as unknown as { deps: { renderMetrics(): Promise<string> } }
    ).deps.renderMetrics();
    expect(rendered).toMatch(/evm_run_count(\{[^}]*\})? 1/);
  });
});
