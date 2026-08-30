import { ConfigError, loadConfig } from './load';

/**
 * A complete, valid environment. Every test starts from this and perturbs exactly one thing, so a
 * failure names the variable it is about.
 */
const KEY = '0x08141073f8a519b93255153c334438bb9cd998eb9b51f9723cc07931655c90df';
const ADDRESS_FOR_KEY = '0xC7E2506A8Aa65F35C7A524Aef399fa731aF1780d';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    EVM_NAME: 'arbitrum',
    EVM_CHAIN_ID: '42161',
    EVM_HOST: 'https://arb1.example.org',
    EVM_BRIDGE_ADDRESS: '0x684a8a976635fb7ad74a0134ace990a6a0fcce84',
    EVM_FEDERATION_ADDRESS: '0x5d663981d930e8ec108280b9d80885658148ab0f',
    EVM_ALLOW_TOKENS_ADDRESS: '0xc65bf0ae75dc1a5fc9e6f4215125692a548c773a',
    EVM_FROM_BLOCK: '105291988',

    STATE_CHAIN_ID: '421614',
    STATE_CHAIN_HOST: 'https://state.example.org',
    STATE_CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111',
    STATE_FROM_BLOCK: '105291988',
    STATE_CONFIRMATION_BLOCKS: '4',

    HATHOR_NAME: 'golf',
    HATHOR_CHAIN_ID: '31',
    HATHOR_NETWORK: 'testnet',
    HATHOR_FULLNODE_URL: 'https://node1.testnet.hathor.network/v1a/',
    HATHOR_TX_MINING_URL: 'https://txmining.testnet.hathor.network/',
    HATHOR_SEED: SEED,
    HATHOR_MULTISIG_PUBKEYS: 'xpubA, xpubB ,xpubC,',
    HATHOR_NUM_SIGNATURES: '2',
    HATHOR_MULTISIG_ORDER: '1',
    HATHOR_MIN_CONFIRMATIONS: '1',
    HATHOR_INPUT_LOCK_TTL_MS: '1800000',
    HATHOR_FROM_TIMESTAMP: '1733509177',

    FEDERATOR_KEY: KEY,
    ...overrides,
  };
}

/** Collects the ConfigError thrown by loadConfig, failing the test if it does not throw. */
function issuesFrom(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues as string[];
  }
  throw new Error('expected loadConfig to throw, but it succeeded');
}

describe('loadConfig', () => {
  it('maps a complete environment onto the config shape', () => {
    const config = loadConfig(validEnv());

    expect(config.evm).toEqual({
      name: 'arbitrum',
      chainId: 42161,
      host: 'https://arb1.example.org',
      bridgeAddress: '0x684a8a976635fb7ad74a0134ace990a6a0fcce84',
      federationAddress: '0x5d663981d930e8ec108280b9d80885658148ab0f',
      allowTokensAddress: '0xc65bf0ae75dc1a5fc9e6f4215125692a548c773a',
      fromBlock: 105291988,
      blockTimeMs: 15000,
    });
    expect(config.state.chainId).toBe(421614);
    expect(config.hathor.multisig).toEqual({
      pubkeys: ['xpubA', 'xpubB', 'xpubC'],
      numSignatures: 2,
      order: 1,
    });
    expect(config.hathor.inputLockTtlMs).toBe(1800000);
  });

  it('does not read process.env', () => {
    // The whole point of taking `env` as an argument: a stray real variable must not leak in.
    // Restore by deleting the key, never by reassigning process.env - that swaps Node's native
    // env object for a plain one and breaks env access for the rest of the worker.
    const had = Object.prototype.hasOwnProperty.call(process.env, 'EVM_NAME');
    const previous = process.env.EVM_NAME;
    process.env.EVM_NAME = 'should-be-ignored';
    try {
      expect(loadConfig(validEnv()).evm.name).toBe('arbitrum');
    } finally {
      if (had) {
        process.env.EVM_NAME = previous;
      } else {
        delete process.env.EVM_NAME;
      }
    }
  });

  describe('defaults', () => {
    it('applies them when the variable is absent', () => {
      const { runtime, hathor, evm } = loadConfig(validEnv());
      expect(runtime.storagePath).toBe('./db');
      expect(runtime.endpointsPort).toBe(5000);
      expect(runtime.pollingIntervalMs).toBe(45000);
      expect(runtime.retries).toBe(3);
      expect(runtime.requireHttps).toBe(true);
      expect(hathor.gapLimit).toBe(20);
      expect(evm.blockTimeMs).toBe(15000);
    });

    it('lets an explicit value win over the default', () => {
      const config = loadConfig(validEnv({ HATHOR_GAP_LIMIT: '40', POLLING_INTERVAL_MS: '60000' }));
      expect(config.hathor.gapLimit).toBe(40);
      expect(config.runtime.pollingIntervalMs).toBe(60000);
    });
  });

  describe('rejects malformed values', () => {
    it('reports every problem at once rather than only the first', () => {
      const env = validEnv();
      delete env.EVM_NAME;
      delete env.STATE_CHAIN_ID;
      delete env.HATHOR_SEED;

      const issues = issuesFrom(env);
      expect(issues.join('\n')).toMatch(/EVM_NAME/);
      expect(issues.join('\n')).toMatch(/STATE_CHAIN_ID/);
      expect(issues.join('\n')).toMatch(/HATHOR_SEED/);
    });

    it.each([
      ['EVM_BRIDGE_ADDRESS', 'not-an-address'],
      ['EVM_BRIDGE_ADDRESS', '0x684a8a976635fb7ad74a0134ace990a6a0fcce8'], // one nibble short
      ['EVM_HOST', 'ftp://example.org'],
      ['EVM_CHAIN_ID', 'abc'],
      ['EVM_CHAIN_ID', '1.5'],
      ['HATHOR_NETWORK', 'stagenet'],
      ['FEDERATOR_KEY', 'deadbeef'],
      ['HATHOR_SEED', 'only three words'],
      ['HATHOR_INPUT_LOCK_TTL_MS', '0'],
    ])('%s = %p', (name, value) => {
      const issues = issuesFrom(validEnv({ [name]: value }));
      expect(issues.join('\n')).toMatch(new RegExp(name));
    });

    it('treats an empty string as missing rather than as zero', () => {
      // Number('') is 0, so a blank numeric variable used to become a silently valid zero -
      // e.g. EVM_FROM_BLOCK='' would have replayed the chain from genesis.
      const issues = issuesFrom(validEnv({ EVM_FROM_BLOCK: '' }));
      expect(issues.join('\n')).toMatch(/EVM_FROM_BLOCK/);
    });

    it('rejects a negative block number', () => {
      expect(issuesFrom(validEnv({ EVM_FROM_BLOCK: '-1' })).join('\n')).toMatch(/EVM_FROM_BLOCK/);
    });
  });

  describe('federator identity', () => {
    it('derives the address from the key', () => {
      expect(loadConfig(validEnv()).federator.address).toBe(ADDRESS_FOR_KEY);
    });

    it('accepts a matching FEDERATOR_ADDRESS regardless of checksum casing', () => {
      const config = loadConfig(validEnv({ FEDERATOR_ADDRESS: ADDRESS_FOR_KEY.toLowerCase() }));
      expect(config.federator.address).toBe(ADDRESS_FOR_KEY);
    });

    it('rejects a FEDERATOR_ADDRESS that belongs to a different key', () => {
      const issues = issuesFrom(validEnv({ FEDERATOR_ADDRESS: '0x0000000000000000000000000000000000000001' }));
      expect(issues.join('\n')).toMatch(/FEDERATOR_ADDRESS.*does not match/s);
    });

    it('accepts a key without the 0x prefix and normalises it', () => {
      const config = loadConfig(validEnv({ FEDERATOR_KEY: KEY.slice(2) }));
      expect(config.federator.privateKey).toBe(KEY);
      expect(config.federator.address).toBe(ADDRESS_FOR_KEY);
    });
  });

  describe('multisig coherence', () => {
    it('rejects a quorum larger than the number of participants', () => {
      const issues = issuesFrom(validEnv({ HATHOR_NUM_SIGNATURES: '4' })); // only 3 pubkeys
      expect(issues.join('\n')).toMatch(/HATHOR_NUM_SIGNATURES.*exceeds/s);
    });

    it('rejects an order outside the participant list', () => {
      const issues = issuesFrom(validEnv({ HATHOR_MULTISIG_ORDER: '9' }));
      expect(issues.join('\n')).toMatch(/HATHOR_MULTISIG_ORDER.*exceeds/s);
    });
  });

  describe('transport safety', () => {
    it('rejects a plaintext remote host while REQUIRE_HTTPS is on', () => {
      const issues = issuesFrom(validEnv({ EVM_HOST: 'http://insecure.example.org' }));
      expect(issues.join('\n')).toMatch(/EVM_HOST must use https/);
    });

    it('allows plaintext against localhost', () => {
      expect(() => loadConfig(validEnv({ EVM_HOST: 'http://localhost:8545' }))).not.toThrow();
      expect(() => loadConfig(validEnv({ EVM_HOST: 'http://127.0.0.1:8545' }))).not.toThrow();
    });

    it('allows plaintext anywhere once REQUIRE_HTTPS is off', () => {
      expect(() =>
        loadConfig(validEnv({ EVM_HOST: 'http://insecure.example.org', REQUIRE_HTTPS: 'false' })),
      ).not.toThrow();
    });
  });

  describe('logging', () => {
    it('defaults to the path the container mounts and the scraper reads', () => {
      const { runtime } = loadConfig(validEnv());
      expect(runtime.logFile).toBe('/var/log/federator.log');
      expect(runtime.logLevel).toBe('trace');
    });

    it('can be pointed somewhere writable, which is what running outside Docker needs', () => {
      const config = loadConfig(validEnv({ LOG_FILE: '/tmp/federator.log', LOG_LEVEL: 'info' }));
      expect(config.runtime.logFile).toBe('/tmp/federator.log');
      expect(config.runtime.logLevel).toBe('info');
    });

    it('rejects a log level it does not know', () => {
      expect(issuesFrom(validEnv({ LOG_LEVEL: 'verbose' })).join('\n')).toMatch(/LOG_LEVEL/);
    });
  });

  describe('transitional headless configuration', () => {
    it('is absent by default', () => {
      expect(loadConfig(validEnv()).hathor.headless).toBeUndefined();
    });

    it('is present when both variables are given', () => {
      const config = loadConfig(
        validEnv({ HATHOR_HEADLESS_URL: 'http://localhost:8000', HATHOR_HEADLESS_API_KEY: 'k' }),
      );
      expect(config.hathor.headless).toEqual({ url: 'http://localhost:8000', apiKey: 'k' });
    });

    it('rejects a half-configured pair', () => {
      const issues = issuesFrom(validEnv({ HATHOR_HEADLESS_URL: 'http://localhost:8000' }));
      expect(issues.join('\n')).toMatch(/must be set together/);
    });
  });
});
