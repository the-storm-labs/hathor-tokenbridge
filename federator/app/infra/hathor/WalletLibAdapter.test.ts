import { Network, transactionUtils } from '@hathor/wallet-lib';

import { RecordingLogger } from '../../ports/testSupport/fakes';
import { WalletLibAdapter } from './WalletLibAdapter';
import type { WalletLibAdapterConfig } from './WalletLibAdapter';
import { StubLibWallet, stubWalletDriver } from './testSupport/StubLibWallet';

/**
 * Exercises the glue this adapter is made of - decoding, proposal assembly, the input lock, the
 * send lock - against a stubbed library wallet. The library's own pure helpers are the real ones,
 * so the transaction serialisation under test is genuine.
 *
 * What this cannot cover is whether the library talks to a fullnode correctly. That is what the
 * shared HathorWalletPort contract suite is for, run live against a testnet wallet.
 */
/** Real testnet addresses: the library validates base58 when it serialises a transaction. */
const MULTISIG_ADDRESS = 'wXonH2U9Bys5EcYsFspZyBVqeTVQ3Htf4Q';
const RECEIVER_ADDRESS = 'WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm';

const CONFIG: WalletLibAdapterConfig = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  multisig: { pubkeys: ['xpubA', 'xpubB', 'xpubC'], numSignatures: 2 },
  network: 'testnet',
  fullnodeUrl: 'https://node.example/v1a/',
  txMiningUrl: 'https://mining.example/',
  gapLimit: 20,
};

function build() {
  const stub = new StubLibWallet();
  const logger = new RecordingLogger();
  const adapter = new WalletLibAdapter(CONFIG, logger, stubWalletDriver(stub));
  return { adapter, stub, logger };
}

/** Builds a real serialised transaction, so decode operates on genuine bytes. */
function realTxHex(
  outputs: Array<{ address: string; value: bigint; token?: string }>,
  inputs: Array<{ txId: string; index: number }>,
) {
  const network = new Network('testnet');
  const tx = transactionUtils.createTransactionFromData(
    {
      version: 1,
      tokens: [],
      inputs: inputs.map((input) => ({
        txId: input.txId,
        index: input.index,
        value: 0n,
        address: '',
        token: '00',
        authorities: 0n,
      })),
      outputs: outputs.map((output) => ({
        address: output.address,
        value: output.value,
        token: output.token ?? '00',
        authorities: 0n,
        timelock: null,
      })),
    } as never,
    network,
  );
  return tx.toHex();
}

describe('WalletLibAdapter lifecycle', () => {
  it('is closed before it is started', async () => {
    const { adapter } = build();
    expect(await adapter.status()).toMatchObject({ state: 'closed' });
  });

  it('reports ready once started', async () => {
    const { adapter } = build();
    await adapter.start();
    expect(await adapter.status()).toMatchObject({ state: 'ready' });
  });

  it('refuses operations before start rather than building a half-configured wallet', async () => {
    const { adapter } = build();
    await expect(adapter.getAddressAtIndex(0)).rejects.toThrow(/has not been started/);
  });

  it('tolerates stop being called twice', async () => {
    const { adapter } = build();
    await adapter.start();
    await expect(adapter.stop()).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('maps an unrecognised library state to unknown, never to error', async () => {
    // error triggers a restart, and restarting discards a synced MemoryStore.
    const { adapter, stub } = build();
    await adapter.start();
    stub.state = 99;
    expect(await adapter.status()).toMatchObject({ state: 'unknown' });
  });
});

describe('WalletLibAdapter readiness', () => {
  it('waits through syncing until the wallet reports ready', async () => {
    const stub = new StubLibWallet();
    stub.state = 2; // SYNCING
    const adapter = new WalletLibAdapter(
      { ...CONFIG, startTimeoutMs: 5_000 },
      new RecordingLogger(),
      stubWalletDriver(stub),
    );

    const starting = adapter.start();
    // The library flips to READY on its own once the history is in.
    setTimeout(() => {
      stub.state = 3;
    }, 10);

    await expect(starting).resolves.toBeUndefined();
  });

  it('gives up with a message that explains why a cold start is slow', async () => {
    // Storage is MemoryStore: the whole history is rebuilt on every start, so a timeout here is
    // usually "not enough time" rather than "broken".
    const stub = new StubLibWallet();
    stub.state = 2;
    const adapter = new WalletLibAdapter(
      { ...CONFIG, startTimeoutMs: 5 },
      new RecordingLogger(),
      stubWalletDriver(stub),
    );

    await expect(adapter.start()).rejects.toThrow(/still syncing after 5ms.*rebuilds the whole history/s);
  });

  it('fails immediately when the wallet enters the error state', async () => {
    const stub = new StubLibWallet();
    stub.state = 4; // ERROR
    const adapter = new WalletLibAdapter(CONFIG, new RecordingLogger(), stubWalletDriver(stub));

    await expect(adapter.start()).rejects.toThrow(/error state while starting/);
  });

  it('returns straight away when already started and ready', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    const before = stub.state;
    await adapter.start();
    expect(stub.state).toBe(before);
  });
});

describe('WalletLibAdapter confirmations', () => {
  it('counts confirmations as the distance from the best block', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.fullTxs.set('abc', { meta: { height: 990 } });
    stub.bestBlockHeight = 1_000;

    expect(await adapter.getConfirmationCount('abc')).toBe(10);
  });

  it('never reports a negative count when the best height lags the transaction', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.fullTxs.set('abc', { meta: { height: 1_010 } });
    stub.bestBlockHeight = 1_000;

    expect(await adapter.getConfirmationCount('abc')).toBe(0);
  });
});

describe('WalletLibAdapter proposals', () => {
  it('builds a mint pinned to the fixed address and left unsigned', async () => {
    const { adapter, stub } = build();
    await adapter.start();

    const txHex = await adapter.createMintProposal({
      token: 'TOKEN',
      amount: 150n,
      receiverAddress: RECEIVER_ADDRESS,
      markInputsAsUsed: false,
      inputLockTtlMs: 1_800_000,
      fixedAddress: MULTISIG_ADDRESS,
    });

    expect(txHex).toBe('deadbeef');
    const [token, amount, options] = stub.mintCalls[0] ?? [];
    expect(token).toBe('TOKEN');
    expect(amount).toBe(150n);
    expect(options).toMatchObject({
      address: RECEIVER_ADDRESS,
      changeAddress: MULTISIG_ADDRESS,
      mintAuthorityAddress: MULTISIG_ADDRESS,
      // The proposal is signed by each federator in turn and pushed later; signing or mining it
      // here would settle it before the multisig had agreed.
      signTx: false,
      startMiningTx: false,
    });
  });

  it('builds a melt with deposit, change and authority all coming back to us', async () => {
    const { adapter, stub } = build();
    await adapter.start();

    await adapter.createMeltProposal({
      token: 'TOKEN',
      amount: 150n,
      markInputsAsUsed: false,
      inputLockTtlMs: 1_800_000,
      fixedAddress: MULTISIG_ADDRESS,
    });

    expect(stub.meltCalls[0]?.[2]).toMatchObject({
      address: MULTISIG_ADDRESS,
      changeAddress: MULTISIG_ADDRESS,
      meltAuthorityAddress: MULTISIG_ADDRESS,
      signTx: false,
      startMiningTx: false,
    });
  });

  it('locks the proposal inputs in milliseconds when asked', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.proposalHex = realTxHex(
      [{ address: MULTISIG_ADDRESS, value: 10n }],
      [
        { txId: 'a'.repeat(64), index: 0 },
        { txId: 'b'.repeat(64), index: 1 },
      ],
    );

    await adapter.createMintProposal({
      token: 'TOKEN',
      amount: 150n,
      receiverAddress: RECEIVER_ADDRESS,
      markInputsAsUsed: true,
      inputLockTtlMs: 1_800_000,
      fixedAddress: MULTISIG_ADDRESS,
    });

    // ttl goes straight into setTimeout, so it has always been milliseconds - the shipped example
    // of `1` meant one millisecond, i.e. no lock at all.
    expect(stub.markedUtxos).toEqual([
      { txId: 'a'.repeat(64), index: 0, value: true, ttl: 1_800_000 },
      { txId: 'b'.repeat(64), index: 1, value: true, ttl: 1_800_000 },
    ]);
  });

  it('does not lock inputs when not asked to', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.proposalHex = realTxHex([{ address: MULTISIG_ADDRESS, value: 10n }], [{ txId: 'a'.repeat(64), index: 0 }]);

    await adapter.createMeltProposal({
      token: 'TOKEN',
      amount: 1n,
      markInputsAsUsed: false,
      inputLockTtlMs: 1_800_000,
      fixedAddress: MULTISIG_ADDRESS,
    });

    expect(stub.markedUtxos).toEqual([]);
  });
});

describe('WalletLibAdapter signAndPush', () => {
  it('passes the storage weight constants to prepareToSend', async () => {
    // Without them the library falls back to hardcoded mainnet values and produces the wrong
    // weight off mainnet - a testnet-only failure that is very easy to miss.
    const { adapter, stub } = build();
    await adapter.start();

    const hash = await adapter.signAndPush('beef', ['sigA', 'sigB']);

    expect(stub.assembled).toEqual({ txHex: 'beef', signatures: ['sigA', 'sigB'] });
    expect(stub.preparedWeightConstants).toEqual(transactionUtils.getWeightConstantsFromStorage(stub.storage as never));
    expect(hash).toBe('pushed-hash');
  });

  it('fails loudly when the pushed transaction comes back without a hash', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.pushHash = '';

    await expect(adapter.signAndPush('beef', ['sigA'])).rejects.toThrow(/without a hash/);
  });
});

describe('WalletLibAdapter decodeTxHex', () => {
  const PARENT = 'a'.repeat(64);

  it('resolves each input from the transaction that created it', async () => {
    // The hex carries only input references; the value, token and script of the spent output have
    // to be fetched. This is the operation the headless gave away for free.
    const { adapter, stub } = build();
    await adapter.start();

    stub.txs.set(PARENT, {
      tx_id: PARENT,
      outputs: [
        {
          value: 500n,
          token_data: 1,
          script: 'c2NyaXB0',
          token: 'TOKEN',
          decoded: { type: 'MultiSig', address: MULTISIG_ADDRESS, timelock: null },
        },
      ],
    });

    const decoded = await adapter.decodeTxHex(
      realTxHex([{ address: MULTISIG_ADDRESS, value: 500n }], [{ txId: PARENT, index: 0 }]),
    );

    expect(decoded.inputs).toHaveLength(1);
    expect(decoded.inputs[0]).toMatchObject({
      value: 500n,
      tokenData: 1,
      token: 'TOKEN',
      txId: PARENT,
      index: 0,
      mine: true,
    });
  });

  it('refuses to decode against an input it cannot resolve', async () => {
    // Validating a proposal against inputs of unknown value is exactly how a federator would sign
    // away funds it never checked.
    const { adapter } = build();
    await adapter.start();

    await expect(
      adapter.decodeTxHex(realTxHex([{ address: MULTISIG_ADDRESS, value: 1n }], [{ txId: PARENT, index: 0 }])),
    ).rejects.toThrow(/which this wallet does not know/);
  });

  it('reports script types in the fullnode vocabulary, not the parser own', async () => {
    // parseScript says `p2sh`; the fullnode, and therefore transaction history, says `MultiSig`.
    // The domain filters on `MultiSig`, so an untranslated decode would find no funds in a
    // proposal while history showed them - the adapter contradicting itself.
    const { adapter, stub } = build();
    await adapter.start();
    stub.ownAddresses.add(MULTISIG_ADDRESS);

    const decoded = await adapter.decodeTxHex(realTxHex([{ address: MULTISIG_ADDRESS, value: 5n }], []));
    expect(decoded.outputs[0]?.decoded.type).toBe('MultiSig');
  });

  it('translates a plain address output too', async () => {
    const { adapter } = build();
    await adapter.start();

    const decoded = await adapter.decodeTxHex(realTxHex([{ address: RECEIVER_ADDRESS, value: 5n }], []));
    expect(decoded.outputs[0]?.decoded.type).toBe('P2PKH');
  });

  it('marks which outputs are ours', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.ownAddresses.add(MULTISIG_ADDRESS);

    const decoded = await adapter.decodeTxHex(realTxHex([{ address: MULTISIG_ADDRESS, value: 7n }], []));
    expect(decoded.outputs[0]).toMatchObject({ value: 7n, mine: true });
    expect(decoded.outputs[0]?.decoded.address).toBe(MULTISIG_ADDRESS);
  });

  it('reads a data output without treating it as an error', async () => {
    // Data outputs carry the bridge destination, so they are the point rather than an anomaly.
    // They have no address, so the script parse legitimately yields nothing.
    const { adapter } = build();
    await adapter.start();

    const network = new Network('testnet');
    const withData = transactionUtils.createTransactionFromData(
      {
        version: 1,
        tokens: [],
        inputs: [],
        outputs: [
          { type: 'data', data: '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2', value: 1n, authorities: 0n, token: '00' },
          { address: MULTISIG_ADDRESS, value: 5n, token: '00', authorities: 0n, timelock: null },
        ],
      } as never,
      network,
    );

    const decoded = await adapter.decodeTxHex(withData.toHex());
    expect(decoded.outputs).toHaveLength(2);
    expect(decoded.outputs[0]?.decoded.address).toBeUndefined();
    expect(decoded.outputs[0]?.mine).toBeUndefined();
    expect(decoded.outputs[1]?.decoded.address).toBe(MULTISIG_ADDRESS);
  });
});

describe('WalletLibAdapter simple reads', () => {
  it('reports whether an address is ours', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.ownAddresses.add('WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm');

    expect(await adapter.isOwnAddress('WjTMMX5Rs8oinnpRQfyMuxFYYaPWEPSRPm')).toBe(true);
    expect(await adapter.isOwnAddress(RECEIVER_ADDRESS.replace('W', 'w'))).toBe(false);
  });

  it('returns the fixed address from index 0', async () => {
    const { adapter } = build();
    await adapter.start();
    expect(await adapter.getAddressAtIndex(0)).toBe(MULTISIG_ADDRESS);
  });

  it('returns a known transaction', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.txs.set('abc', {
      tx_id: 'abc',
      timestamp: 5,
      version: 1,
      is_voided: false,
      inputs: [],
      outputs: [{ value: 42n, token_data: 0, script: '', token: '00', decoded: {}, spent_by: null }],
    });

    const tx = await adapter.getTransaction('abc');
    expect(tx).toMatchObject({ txId: 'abc', version: 1 });
    expect(tx?.outputs[0]?.value).toBe(42n);
  });

  it('asks the wallet for this federator signature', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.signature = 'pubA|0:aaaa|1:bbbb';

    expect(await adapter.getMySignatures('beef')).toBe('pubA|0:aaaa|1:bbbb');
  });
});

describe('WalletLibAdapter guards against use before start', () => {
  it.each([
    ['decodeTxHex', (adapter: WalletLibAdapter) => adapter.decodeTxHex('beef')],
    ['lockProposalInputs', (adapter: WalletLibAdapter) => adapter.lockProposalInputs('beef', 1000)],
    ['getMySignatures', (adapter: WalletLibAdapter) => adapter.getMySignatures('beef')],
    ['getHistory', (adapter: WalletLibAdapter) => adapter.getHistory()],
  ])('%s refuses rather than reaching into an undefined wallet', async (_name, call) => {
    const { adapter } = build();
    await expect(call(adapter)).rejects.toThrow(/has not been started/);
  });
});

describe('WalletLibAdapter new-transaction events', () => {
  it('delivers transactions registered for before the wallet existed', async () => {
    // Callers should not have to order their wiring around this adapter's lifecycle.
    const { adapter, stub } = build();
    const seen: string[] = [];
    adapter.onNewTransaction((tx) => {
      seen.push(tx.txId);
    });

    await adapter.start();
    stub.emitNewTx({ tx_id: 'abc', timestamp: 1, version: 1, is_voided: false, inputs: [], outputs: [] });

    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual(['abc']);
  });

  it('does not let a failing handler take the process down with the synced wallet', async () => {
    const { adapter, stub, logger } = build();
    await adapter.start();
    adapter.onNewTransaction(() => {
      throw new Error('handler blew up');
    });

    stub.emitNewTx({ tx_id: 'abc', timestamp: 1, version: 1, is_voided: false, inputs: [], outputs: [] });
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.at('error')).toMatch(/new-transaction handler failed/);
  });
});

describe('WalletLibAdapter reading', () => {
  it('returns history newest first', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.history = [
      { tx_id: 'old', timestamp: 100, version: 1, is_voided: false, inputs: [], outputs: [] },
      { tx_id: 'new', timestamp: 300, version: 1, is_voided: false, inputs: [], outputs: [] },
    ];

    expect((await adapter.getHistory()).map((entry) => entry.txId)).toEqual(['new', 'old']);
  });

  it('reports a voided transaction as unknown', async () => {
    const { adapter, stub } = build();
    await adapter.start();
    stub.txs.set('abc', { tx_id: 'abc', timestamp: 1, version: 1, is_voided: true, inputs: [], outputs: [] });

    expect(await adapter.getTransaction('abc')).toBeUndefined();
  });

  it('reports zero confirmations for a transaction not yet in a block', async () => {
    // "Not yet" is the normal answer for something just pushed, and callers compare against a
    // threshold - an error here would turn a normal state into a failed round.
    const { adapter, stub } = build();
    await adapter.start();
    stub.fullTxs.set('abc', { meta: { height: null } });

    expect(await adapter.getConfirmationCount('abc')).toBe(0);
  });
});
