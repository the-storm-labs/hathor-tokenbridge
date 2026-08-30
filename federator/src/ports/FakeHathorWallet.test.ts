import { describeHathorWalletContract } from './HathorWalletPort.contract';
import { FakeHathorWallet } from './testSupport/FakeHathorWallet';

/**
 * Holds the fake to the same contract the real adapters answer to. A fake that drifts from the
 * contract makes every use-case test written against it meaningless.
 */
describeHathorWalletContract(
  'FakeHathorWallet',
  { knownTxId: 'b'.repeat(64), decodableTxHex: 'deadbeef', foreignAddress: 'HNotOursAtAll' },
  async () => {
    const wallet = new FakeHathorWallet();
    wallet.history = [
      { txId: 'a'.repeat(64), timestamp: 100, inputs: [], outputs: [], version: 1, isVoided: false },
      {
        txId: 'b'.repeat(64),
        timestamp: 200,
        version: 1,
        isVoided: false,
        inputs: [{ value: 5n, tokenData: 0, script: '', token: '00', decoded: {} }],
        outputs: [{ value: 5n, tokenData: 0, script: '', token: '00', decoded: {} }],
      },
    ];
    wallet.decoded.set('deadbeef', {
      inputs: [{ value: 1n, tokenData: 0, script: '', token: '00', decoded: {} }],
      outputs: [{ value: 1n, tokenData: 0, script: '', token: '00', decoded: {} }],
    });

    return wallet;
  },
);

describe('FakeHathorWallet test controls', () => {
  it('delivers emitted transactions to every registered handler', async () => {
    const wallet = new FakeHathorWallet();
    await wallet.start();

    const seen: string[] = [];
    wallet.onNewTransaction((tx) => {
      seen.push(`first:${tx.txId}`);
    });
    wallet.onNewTransaction(async (tx) => {
      seen.push(`second:${tx.txId}`);
    });

    await wallet.emitNewTransaction({
      txId: 'c'.repeat(64),
      timestamp: 1,
      inputs: [],
      outputs: [],
    });

    expect(seen).toEqual([`first:${'c'.repeat(64)}`, `second:${'c'.repeat(64)}`]);
    expect(await wallet.getHistory()).toHaveLength(1);
  });

  it('records what was proposed, so use-case tests can assert on it', async () => {
    const wallet = new FakeHathorWallet();
    await wallet.start();

    await wallet.createMintProposal({
      token: 'TOKEN',
      amount: 500n,
      receiverAddress: 'HRECEIVER',
      markInputsAsUsed: true,
      inputLockTtlMs: 1_800_000,
      fixedAddress: 'HFakeMultisigAddress0',
    });

    expect(wallet.proposals).toEqual([
      expect.objectContaining({ kind: 'mint', token: 'TOKEN', amount: 500n, receiverAddress: 'HRECEIVER' }),
    ]);
  });

  it('reports a voided transaction as unknown', async () => {
    const wallet = new FakeHathorWallet();
    await wallet.start();
    wallet.history = [{ txId: 'd'.repeat(64), timestamp: 1, inputs: [], outputs: [], isVoided: true }];
    expect(await wallet.getTransaction('d'.repeat(64))).toBeUndefined();
  });

  it('refuses operations before start', async () => {
    const wallet = new FakeHathorWallet();
    await expect(wallet.getAddressAtIndex(0)).rejects.toThrow(/not started/);
  });
});
