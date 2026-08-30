import type Web3 from 'web3';

import { EvmChainAdapter } from './EvmChainAdapter';

/** The two calls this adapter makes, and nothing else. */
function fakeWeb3(options: { blockNumber?: number; syncing?: unknown } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const web3 = {
    eth: {
      getBlockNumber: async (...args: unknown[]) => {
        calls.push({ method: 'getBlockNumber', args });
        return options.blockNumber ?? 1_000;
      },
      isSyncing: async () => options.syncing ?? false,
    },
  } as unknown as Web3;
  return { web3, calls };
}

describe('EvmChainAdapter', () => {
  it('asks for the block height as a number, not a bigint', async () => {
    // Heights are compared and subtracted all through the readers, and mixing number with bigint
    // throws at runtime rather than at compile time.
    const { web3, calls } = fakeWeb3({ blockNumber: 11_599_154 });
    const adapter = new EvmChainAdapter(web3);

    const height = await adapter.getBlockNumber();
    expect(height).toBe(11_599_154);
    expect(typeof height).toBe('number');
    expect(calls[0]?.args[0]).toMatchObject({ number: expect.anything() });
  });

  it('reports a synced node as not syncing', async () => {
    // web3 answers `false` when synced and a progress object when not - so a truthiness check on
    // the raw value would read "synced" as "syncing".
    const adapter = new EvmChainAdapter(fakeWeb3({ syncing: false }).web3);
    expect(await adapter.isSyncing()).toBe(false);
  });

  it('reports a node still catching up as syncing', async () => {
    const adapter = new EvmChainAdapter(fakeWeb3({ syncing: { startingBlock: 1, currentBlock: 5 } }).web3);
    expect(await adapter.isSyncing()).toBe(true);
  });
});
