import { WalletOperationError } from '../../ports/HathorWalletPort';
import type { HeadlessAdapterOptions } from './HeadlessWalletAdapter';
import { HeadlessWalletAdapter } from './HeadlessWalletAdapter';
import { RecordingLogger } from '../../ports/testSupport/fakes';
import { StubHttpClient, ok } from './testSupport/StubHttpClient';

const OPTIONS: HeadlessAdapterOptions = {
  walletId: 'multi',
  seedKey: 'default',
  multisig: true,
  readinessDelayMs: 0,
};

/** A sleep that records what it was asked to wait, without actually waiting. */
function recordingSleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

function adapterWith(http: StubHttpClient, overrides: Partial<HeadlessAdapterOptions> = {}) {
  const { waits, sleep } = recordingSleeper();
  const logger = new RecordingLogger();
  return { adapter: new HeadlessWalletAdapter(http, { ...OPTIONS, ...overrides }, logger, sleep), waits, logger };
}

const status = (statusCode: number, statusMessage = '') => ok({ success: true, statusCode, statusMessage });

describe('HeadlessWalletAdapter readiness', () => {
  it('returns immediately when the wallet is already ready', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/status', status(3));
    const { adapter, waits } = adapterWith(http);

    await expect(adapter.start()).resolves.toBeUndefined();
    expect(waits).toEqual([]);
    expect(http.requestsTo('POST', 'start')).toHaveLength(0);
  });

  it('waits through PROCESSING rather than falling through it', async () => {
    // This is the bug that used to hang the federator at boot: status 5 (PROCESSING) matched no
    // branch, the readiness check resolved undefined, and main.ts then waited forever on an event
    // only the ready path emits. The wallet reaches PROCESSING after downloading history, while
    // it works through what it downloaded - a state a restart can easily land on.
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [status(5), status(5), status(3)]);
    const { adapter, waits } = adapterWith(http);

    await expect(adapter.start()).resolves.toBeUndefined();
    expect(waits).toHaveLength(2);
    expect(http.requestsTo('POST', 'start')).toHaveLength(0); // PROCESSING must not trigger a restart
  });

  it.each([
    ['CONNECTING', 1],
    ['SYNCING', 2],
  ])('waits through %s without restarting the wallet', async (_label, code) => {
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [status(code), status(3)]);
    const { adapter } = adapterWith(http);

    await adapter.start();
    expect(http.requestsTo('POST', 'start')).toHaveLength(0);
  });

  it.each([
    ['CLOSED', 0],
    ['ERROR', 4],
  ])('restarts the wallet when it reports %s', async (_label, code) => {
    const http = new StubHttpClient()
      .onSequence('GET', 'wallet/status', [status(code), status(3)])
      .on('POST', 'start', ok({ success: true }));
    const { adapter } = adapterWith(http);

    await adapter.start();
    expect(http.requestsTo('POST', 'start')).toHaveLength(1);
    expect(http.requestsTo('POST', 'start')[0]?.body).toEqual({
      'wallet-id': 'multi',
      seedKey: 'default',
      multisig: true,
    });
  });

  it('starts a wallet that was never started, which reports no statusCode at all', async () => {
    // The real body from a fresh headless is
    // {"success":false,"message":"Invalid wallet id parameter.","statusMessage":""} - no
    // statusCode. Treating that as an unknown state makes the loop poll forever without ever
    // starting the wallet. Found by running the shared contract suite against a live headless;
    // every unit test until then had fed it a statusCode.
    const http = new StubHttpClient()
      .onSequence('GET', 'wallet/status', [
        ok({ success: false, message: 'Invalid wallet id parameter.', statusMessage: '' }),
        status(3),
      ])
      .on('POST', 'start', ok({ success: true }));
    const { adapter } = adapterWith(http);

    await expect(adapter.start()).resolves.toBeUndefined();
    expect(http.requestsTo('POST', 'start')).toHaveLength(1);
  });

  it('does not restart on a missing statusCode that is not an explicit failure', async () => {
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [ok({}), status(3)]);
    const { adapter } = adapterWith(http);

    await adapter.start();
    expect(http.requestsTo('POST', 'start')).toHaveLength(0);
  });

  it('treats an already-running wallet as started, not as a failure', async () => {
    // The headless keeps wallets alive across federator restarts, and the port defines start as
    // idempotent. Treating WALLET_ALREADY_STARTED as an error made start() throw against any
    // headless that was already running - found against a live one.
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [status(0), status(3)]).on('POST', 'start', {
      status: 200,
      data: { success: false, message: 'Failed to start wallet', errorCode: 'WALLET_ALREADY_STARTED' },
    });
    const { adapter } = adapterWith(http);

    await expect(adapter.start()).resolves.toBeUndefined();
  });

  it('still fails on a start error that is not "already started"', async () => {
    const http = new StubHttpClient()
      .on('GET', 'wallet/status', status(0))
      .on('POST', 'start', ok({ success: false, error: 'bad seed', errorCode: 'INVALID_SEED' }));
    const { adapter } = adapterWith(http);

    await expect(adapter.start()).rejects.toThrow(WalletOperationError);
  });

  it('retries an unrecognised status instead of resolving to nothing', async () => {
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [status(99), status(3)]);
    const { adapter, waits } = adapterWith(http);

    await expect(adapter.start()).resolves.toBeUndefined();
    expect(waits).toHaveLength(1);
  });

  it('backs off further on each attempt', async () => {
    const http = new StubHttpClient().onSequence('GET', 'wallet/status', [status(2), status(2), status(3)]);
    const { adapter, waits } = adapterWith(http, { readinessDelayMs: 1000 });

    await adapter.start();
    expect(waits).toEqual([1000, 2000]);
  });

  it('gives up with an explicit error rather than hanging', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/status', status(2));
    const { adapter } = adapterWith(http, { readinessAttempts: 3 });

    await expect(adapter.start()).rejects.toThrow(/did not become ready after 3 attempts/);
  });
});

describe('HeadlessWalletAdapter addresses', () => {
  it('asks for the address at an index without marking it as used', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/address', ok({ success: true, address: 'HADDR0' }));
    const { adapter } = adapterWith(http);

    expect(await adapter.getAddressAtIndex(0)).toBe('HADDR0');
    const request = http.requestsTo('GET', 'wallet/address')[0];
    expect(request?.query).toEqual({ index: 0 });
    // mark_as_used would advance the wallet's internal cursor, growing the address set it has to
    // track and re-sync on every restart.
    expect(JSON.stringify(request)).not.toMatch(/mark_as_used/);
  });

  it('caches the address so repeated callers do not re-ask', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/address', ok({ success: true, address: 'HADDR0' }));
    const { adapter } = adapterWith(http);

    await adapter.getAddressAtIndex(0);
    await adapter.getAddressAtIndex(0);
    expect(http.requestsTo('GET', 'wallet/address')).toHaveLength(1);
  });

  it('reports whether an address is ours', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/address-index', (request) =>
      ok({ success: (request.query as { address: string }).address === 'HMINE' }),
    );
    const { adapter } = adapterWith(http);

    expect(await adapter.isOwnAddress('HMINE')).toBe(true);
    expect(await adapter.isOwnAddress('HTHEIRS')).toBe(false);
  });
});

describe('HeadlessWalletAdapter reading', () => {
  it('returns history newest first with bigint values', async () => {
    const http = new StubHttpClient().on(
      'GET',
      'wallet/tx-history',
      ok([
        { tx_id: 'old', timestamp: 100, outputs: [{ value: 5, token_data: 0 }], inputs: [] },
        { tx_id: 'new', timestamp: 300, outputs: [{ value: 7, token_data: 0 }], inputs: [] },
      ]),
    );
    const { adapter } = adapterWith(http);

    const history = await adapter.getHistory();
    expect(history.map((entry) => entry.txId)).toEqual(['new', 'old']);
    expect(history[0]?.outputs[0]?.value).toBe(7n);
  });

  it('drops history entries with no id or timestamp rather than emitting broken ones', async () => {
    const http = new StubHttpClient().on(
      'GET',
      'wallet/tx-history',
      ok([{ tx_id: 'good', timestamp: 1 }, { timestamp: 2 }, { tx_id: 'no-time' }]),
    );
    const { adapter } = adapterWith(http);

    expect((await adapter.getHistory()).map((e) => e.txId)).toEqual(['good']);
  });

  it('reports an unknown transaction as undefined, not as an error', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/transaction', ok({ error: 'not found' }));
    const { adapter } = adapterWith(http);

    expect(await adapter.getTransaction('abc')).toBeUndefined();
  });

  it('reports a voided transaction as undefined', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/transaction', ok({ tx_id: 'abc', is_voided: true }));
    const { adapter } = adapterWith(http);

    expect(await adapter.getTransaction('abc')).toBeUndefined();
  });

  it('returns a known transaction with bigint values', async () => {
    const http = new StubHttpClient().on(
      'GET',
      'wallet/transaction',
      ok({
        tx_id: 'abc',
        version: 1,
        timestamp: 42,
        is_voided: false,
        inputs: [{ value: 9, token_data: 0 }],
        outputs: [{ value: 9, token_data: 0 }],
      }),
    );
    const { adapter } = adapterWith(http);

    const tx = await adapter.getTransaction('abc');
    expect(tx).toMatchObject({ txId: 'abc', version: 1, timestamp: 42, isVoided: false });
    expect(tx?.inputs[0]?.value).toBe(9n);
    expect(tx?.outputs[0]?.value).toBe(9n);
    expect(http.requestsTo('GET', 'wallet/transaction')[0]?.query).toEqual({ id: 'abc' });
  });

  it('decodes a proposal', async () => {
    const http = new StubHttpClient().on(
      'POST',
      'wallet/decode',
      ok({ success: true, tx: { inputs: [{ value: 3, token_data: 0 }], outputs: [] } }),
    );
    const { adapter } = adapterWith(http);

    expect((await adapter.decodeTxHex('beef')).inputs[0]?.value).toBe(3n);
  });

  it('raises a wallet error when decoding fails', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/decode', ok({ success: false, error: 'bad hex' }));
    const { adapter } = adapterWith(http);

    await expect(adapter.decodeTxHex('nope')).rejects.toThrow(WalletOperationError);
  });
});

describe('HeadlessWalletAdapter proposals', () => {
  const proposalOptions = {
    markInputsAsUsed: true,
    inputLockTtlMs: 1_800_000,
    fixedAddress: 'HFIXED',
  };

  it('pins change and mint authority to the fixed address', async () => {
    const http = new StubHttpClient().on(
      'POST',
      'wallet/p2sh/tx-proposal/mint-tokens',
      ok({ success: true, txHex: 'cafe' }),
    );
    const { adapter } = adapterWith(http);

    const txHex = await adapter.createMintProposal({
      ...proposalOptions,
      token: 'TOKEN',
      amount: 500n,
      receiverAddress: 'HRECV',
    });

    expect(txHex).toBe('cafe');
    expect(http.requestsTo('POST', 'wallet/p2sh/tx-proposal/mint-tokens')[0]?.body).toEqual({
      address: 'HRECV',
      amount: 500,
      token: 'TOKEN',
      mark_inputs_as_used: true,
      ttl: 1_800_000,
      change_address: 'HFIXED',
      mint_authority_address: 'HFIXED',
    });
  });

  it('pins deposit, change and melt authority to the fixed address', async () => {
    const http = new StubHttpClient().on(
      'POST',
      'wallet/p2sh/tx-proposal/melt-tokens',
      ok({ success: true, txHex: 'cafe' }),
    );
    const { adapter } = adapterWith(http);

    await adapter.createMeltProposal({ ...proposalOptions, token: 'TOKEN', amount: 500n });

    expect(http.requestsTo('POST', 'wallet/p2sh/tx-proposal/melt-tokens')[0]?.body).toMatchObject({
      deposit_address: 'HFIXED',
      change_address: 'HFIXED',
      melt_authority_address: 'HFIXED',
    });
  });

  it('sends the ttl in milliseconds, as the wallet expects', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/p2sh/tx-proposal', ok({ success: true, txHex: 'c0de' }));
    const { adapter } = adapterWith(http);

    await adapter.createTransferProposal({
      ...proposalOptions,
      outputs: [{ address: 'HRECV', value: 250n, token: 'TOKEN' }],
    });

    const body = http.requestsTo('POST', 'wallet/p2sh/tx-proposal')[0]?.body as { ttl: number; outputs: unknown[] };
    expect(body.ttl).toBe(1_800_000);
    expect(body.outputs).toEqual([{ address: 'HRECV', value: 250, token: 'TOKEN' }]);
  });

  it('surfaces the wallet message on a failed push, so retry decisions can use it', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/p2sh/tx-proposal/sign-and-push', {
      status: 400,
      data: { success: false, error: 'Invalid transaction. At least one of your inputs has already been spent.' },
    });
    const { adapter } = adapterWith(http);

    await expect(adapter.signAndPush('beef', ['sig'])).rejects.toMatchObject({
      walletMessage: 'Invalid transaction. At least one of your inputs has already been spent.',
    });
  });

  it('locks proposal inputs with the ttl it is given', async () => {
    const http = new StubHttpClient().on('PUT', 'wallet/utxos-selected-as-input', ok({ success: true }));
    const { adapter } = adapterWith(http);

    await adapter.lockProposalInputs('beef', 1_800_000);
    expect(http.requestsTo('PUT', 'wallet/utxos-selected-as-input')[0]?.body).toEqual({
      txHex: 'beef',
      ttl: 1_800_000,
    });
  });
});

describe('HeadlessWalletAdapter failure paths', () => {
  // Every one of these is a case where the wallet answered but did not answer usefully. Silently
  // carrying on with an empty value is how a missing address or an absent txHex turns into a
  // malformed proposal ten steps later.
  it('fails when the address endpoint returns no address', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/address', ok({ success: true }));
    const { adapter } = adapterWith(http);
    await expect(adapter.getAddressAtIndex(0)).rejects.toThrow(/returned no address/);
  });

  it('fails when the address endpoint reports failure', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/address', ok({ success: false, error: 'nope' }));
    const { adapter } = adapterWith(http);
    await expect(adapter.getAddressAtIndex(0)).rejects.toThrow(WalletOperationError);
  });

  it('fails loudly when the address-index endpoint errors, rather than answering "not ours"', async () => {
    // Returning false here would be a security-relevant lie: it is the check that decides whether
    // funds arrived at the bridge's own multisig.
    const http = new StubHttpClient().on('GET', 'wallet/address-index', { status: 500, data: {} });
    const { adapter } = adapterWith(http);
    await expect(adapter.isOwnAddress('HANY')).rejects.toThrow(WalletOperationError);
  });

  it('fails when the history endpoint does not return a list', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/tx-history', ok({ success: false }));
    const { adapter } = adapterWith(http);
    await expect(adapter.getHistory()).rejects.toThrow(/getHistory failed/);
  });

  it('fails when the confirmation endpoint reports failure', async () => {
    const http = new StubHttpClient().on(
      'GET',
      'wallet/tx-confirmation-blocks',
      ok({ success: false, error: 'unknown tx' }),
    );
    const { adapter } = adapterWith(http);
    await expect(adapter.getConfirmationCount('abc')).rejects.toThrow(WalletOperationError);
  });

  it('returns the confirmation count when the wallet has one', async () => {
    const http = new StubHttpClient().on(
      'GET',
      'wallet/tx-confirmation-blocks',
      ok({ success: true, confirmationNumber: 12 }),
    );
    const { adapter } = adapterWith(http);
    expect(await adapter.getConfirmationCount('abc')).toBe(12);
  });

  it('treats a missing confirmation number as zero rather than as confirmed', async () => {
    const http = new StubHttpClient().on('GET', 'wallet/tx-confirmation-blocks', ok({ success: true }));
    const { adapter } = adapterWith(http);
    expect(await adapter.getConfirmationCount('abc')).toBe(0);
  });

  it('fails when decode succeeds but carries no transaction', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/decode', ok({ success: true }));
    const { adapter } = adapterWith(http);
    await expect(adapter.decodeTxHex('beef')).rejects.toThrow(/returned no transaction/);
  });

  it('fails when a proposal succeeds but carries no txHex', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/p2sh/tx-proposal/mint-tokens', ok({ success: true }));
    const { adapter } = adapterWith(http);
    await expect(
      adapter.createMintProposal({
        token: 'TOKEN',
        amount: 1n,
        receiverAddress: 'HRECV',
        markInputsAsUsed: true,
        inputLockTtlMs: 1000,
        fixedAddress: 'HFIXED',
      }),
    ).rejects.toThrow(/returned no txHex/);
  });

  it('returns this wallet signature', async () => {
    const http = new StubHttpClient().on(
      'POST',
      'wallet/p2sh/tx-proposal/get-my-signatures',
      ok({ success: true, signatures: 'pub|0:aaaa' }),
    );
    const { adapter } = adapterWith(http);
    expect(await adapter.getMySignatures('beef')).toBe('pub|0:aaaa');
  });

  it('fails when get-my-signatures succeeds but carries no signature', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/p2sh/tx-proposal/get-my-signatures', ok({ success: true }));
    const { adapter } = adapterWith(http);
    await expect(adapter.getMySignatures('beef')).rejects.toThrow(/returned no signatures/);
  });

  it('returns the broadcast transaction id on a successful push', async () => {
    const http = new StubHttpClient().on(
      'POST',
      'wallet/p2sh/tx-proposal/sign-and-push',
      ok({ success: true, hash: 'abc123' }),
    );
    const { adapter } = adapterWith(http);
    expect(await adapter.signAndPush('beef', ['sig'])).toBe('abc123');
  });

  it('fails when the push succeeds but carries no hash', async () => {
    const http = new StubHttpClient().on('POST', 'wallet/p2sh/tx-proposal/sign-and-push', ok({ success: true }));
    const { adapter } = adapterWith(http);
    await expect(adapter.signAndPush('beef', ['sig'])).rejects.toThrow(/returned no transaction hash/);
  });

  it('fails when locking the inputs is refused', async () => {
    const http = new StubHttpClient().on('PUT', 'wallet/utxos-selected-as-input', ok({ success: false }));
    const { adapter } = adapterWith(http);
    await expect(adapter.lockProposalInputs('beef', 1000)).rejects.toThrow(WalletOperationError);
  });

  it('fails when the wallet refuses to start', async () => {
    const http = new StubHttpClient()
      .on('GET', 'wallet/status', status(0))
      .on('POST', 'start', ok({ success: false, error: 'bad seed' }));
    const { adapter } = adapterWith(http);
    await expect(adapter.start()).rejects.toThrow(WalletOperationError);
  });

  it('has nothing to release on stop, and says so by tolerating repeats', async () => {
    const { adapter } = adapterWith(new StubHttpClient());
    await expect(adapter.stop()).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});

describe('HeadlessWalletAdapter new-transaction events', () => {
  it('refuses to register a handler it can never call', async () => {
    // The headless pushed these onto a message queue - the very thing this migration removes.
    // Accepting the handler and never firing it would look like a wallet that receives nothing.
    const { adapter } = adapterWith(new StubHttpClient());
    expect(() => adapter.onNewTransaction(() => undefined)).toThrow(/cannot deliver new-transaction events/);
  });
});
