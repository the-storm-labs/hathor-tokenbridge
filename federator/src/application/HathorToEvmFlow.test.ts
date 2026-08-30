import { deriveEvmOriginIdentity } from '../domain/hathorOrigin';
import { TransactionType } from '../domain/transactionTypes';
import type { EvmFederationPort, VoteReceipt, VoteRequest } from '../ports/EvmFederationPort';
import type { HistoryEntry } from '../ports/HathorWalletPort';
import type { RevertedTransfer, RevertedTransferStorePort } from '../ports/RevertedTransferStorePort';
import { FakeAllowTokens, FakeBridge } from '../ports/testSupport/FakeBridge';
import { FakeHathorFederation } from '../ports/testSupport/FakeHathorFederation';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { InstantClock, RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { EvmVoter } from './EvmVoter';
import { HathorToEvmFlow } from './HathorToEvmFlow';
import { ProposalCoordinator } from './ProposalCoordinator';

const EVM_CHAIN_ID = 42161;
const HATHOR_CHAIN_ID = 31;
const MULTISIG = 'HFakeMultisigAddress0';
const SENDER = 'HSENDER';
const DESTINATION = '0xE23d59ef0c1F63B53234b00a1e1EaBEf822397D2';
const TX_ID = 'a'.repeat(64);

const EVM_NATIVE = { evmToken: '0xEVMTOKEN', hathorToken: 'htrEVMTOKEN', originChainId: EVM_CHAIN_ID };
const HATHOR_NATIVE = { evmToken: '0xSIDETOKEN', hathorToken: 'htrNATIVE', originChainId: HATHOR_CHAIN_ID };

class FakeEvmFederation implements EvmFederationPort {
  public receipt: VoteReceipt = { status: true };
  public votes: VoteRequest[] = [];
  async getTransactionId(): Promise<string> {
    return '0xVOTEID';
  }
  async transactionWasProcessed(): Promise<boolean> {
    return false;
  }
  async hasVoted(): Promise<boolean> {
    return false;
  }
  async vote(request: VoteRequest): Promise<VoteReceipt> {
    this.votes.push(request);
    return this.receipt;
  }
}

class FakeRevertedStore implements RevertedTransferStorePort {
  private readonly entries = new Map<string, RevertedTransfer>();
  async has(id: string): Promise<boolean> {
    return this.entries.has(id);
  }
  async record(id: string, details: RevertedTransfer): Promise<void> {
    this.entries.set(id, details);
  }
}

/** Builds the base64 data-output script carrying an EVM destination. */
function destinationScript(address: string): string {
  const data = Buffer.from(address, 'utf-8');
  return Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0xac])]).toString('base64');
}

/** Indexed access that fails loudly, so fixture tweaks need no non-null assertions. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No element at index ${index}`);
  }
  return item;
}

function incomingTx(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    txId: TX_ID,
    timestamp: 1_700_000_000,
    version: 1,
    isVoided: false,
    inputs: [
      {
        value: 150n,
        tokenData: 1,
        script: '',
        token: EVM_NATIVE.hathorToken,
        decoded: { type: 'P2PKH', address: SENDER, timelock: null },
      },
    ],
    outputs: [
      {
        value: 150n,
        tokenData: 1,
        script: '',
        token: EVM_NATIVE.hathorToken,
        decoded: { type: 'MultiSig', address: MULTISIG, timelock: null },
        spentBy: null,
      },
      {
        value: 0n,
        tokenData: 0,
        script: destinationScript(DESTINATION),
        token: '00',
        decoded: { timelock: null },
        spentBy: null,
      },
    ],
    ...overrides,
  };
}

/**
 * Delivers a transaction the way the wallet actually would: it is already in the wallet's history
 * by the time the flow is handed it. The melt validator re-reads it from there, so a test that
 * skips this step exercises "origin transaction unknown" rather than the path it means to.
 */
async function deliver(flow: HathorToEvmFlow, wallet: FakeHathorWallet, tx: HistoryEntry): Promise<boolean> {
  wallet.history = [tx];
  return flow.handleIncoming(tx);
}

async function build(options: { multisigOrder?: number; minConfirmations?: number } = {}) {
  const wallet = new FakeHathorWallet();
  await wallet.start();
  const bridge = new FakeBridge().addMapping(EVM_NATIVE).addMapping(HATHOR_NATIVE);
  const allowTokens = new FakeAllowTokens();
  const federation = new FakeHathorFederation();
  const evmFederation = new FakeEvmFederation();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();

  const coordinator = new ProposalCoordinator({
    wallet,
    federation,
    logger,
    metrics,
    clock: new InstantClock(),
    options: { federatorAddress: '0xFED', multisigOrder: options.multisigOrder ?? 1, numSignatures: 2 },
  });

  const voter = new EvmVoter({
    federation: evmFederation,
    revertedTransfers: new FakeRevertedStore(),
    logger,
    metrics,
    federatorAddress: '0xFED',
  });

  const flow = new HathorToEvmFlow({
    wallet,
    bridge,
    allowTokens,
    coordinator,
    voter,
    logger,
    evmChainId: EVM_CHAIN_ID,
    hathorChainId: HATHOR_CHAIN_ID,
    inputLockTtlMs: 1_800_000,
    minConfirmations: options.minConfirmations ?? 1,
    multisigOrder: options.multisigOrder ?? 1,
  });

  return { flow, wallet, bridge, allowTokens, federation, evmFederation, logger, metrics };
}

describe('HathorToEvmFlow: deciding whether to act', () => {
  it('waits until the transaction has enough confirmations', async () => {
    const { flow, wallet, federation, evmFederation } = await build();
    wallet.confirmations.set(TX_ID, 0);

    expect(await deliver(flow, wallet, incomingTx())).toBe(false);
    expect(federation.submitted).toEqual([]);
    expect(evmFederation.votes).toEqual([]);
  });

  it('requires more confirmations the later this federator sits in the multisig', async () => {
    // Each federator waits longer than the one before it, so they do not all race to propose.
    const { flow, wallet } = await build({ multisigOrder: 3, minConfirmations: 2 });
    wallet.confirmations.set(TX_ID, 5); // needs 2 * 3 = 6

    expect(await deliver(flow, wallet, incomingTx())).toBe(false);
  });

  it('ignores a voided transaction', async () => {
    const { flow, wallet, federation, logger } = await build();
    wallet.confirmations.set(TX_ID, 10);

    expect(await deliver(flow, wallet, incomingTx({ isVoided: true }))).toBe(true);
    expect(federation.submitted).toEqual([]);
    expect(logger.at('warn')).toMatch(/voided/);
  });

  it('ignores a transaction that pays an address which is not ours', async () => {
    const { flow, wallet, federation } = await build();
    wallet.confirmations.set(TX_ID, 10);

    const elsewhere = incomingTx();
    const outputs = [...elsewhere.outputs];
    outputs[0] = { ...at(outputs, 0), decoded: { type: 'MultiSig', address: 'HSOMEONEELSE', timelock: null } };

    expect(await deliver(flow, wallet, { ...elsewhere, outputs })).toBe(true);
    expect(federation.submitted).toEqual([]);
  });

  it('ignores a transaction carrying no EVM destination', async () => {
    const { flow, wallet, federation, logger } = await build();
    wallet.confirmations.set(TX_ID, 10);

    const noData = incomingTx();
    expect(await deliver(flow, wallet, { ...noData, outputs: [at(noData.outputs, 0)] })).toBe(true);
    expect(federation.submitted).toEqual([]);
    expect(logger.at('info')).toMatch(/no EVM destination/);
  });

  it('ignores a transaction moving no custom token into the multisig', async () => {
    const { flow, wallet, federation } = await build();
    wallet.confirmations.set(TX_ID, 10);

    expect(await deliver(flow, wallet, incomingTx({ outputs: [] }))).toBe(true);
    expect(federation.submitted).toEqual([]);
  });

  it('reads funds that have already been spent, so a history replay still sees them', async () => {
    // By the time history is replayed the outputs may have been consumed by the melt this very
    // flow created. Requiring them unspent would make the replay silently skip its own work.
    const { flow, wallet, federation } = await build();
    wallet.confirmations.set(TX_ID, 10);

    const spent = incomingTx();
    const outputs = [...spent.outputs];
    outputs[0] = { ...at(outputs, 0), spentBy: 'somelatertx' };

    await deliver(flow, wallet, { ...spent, outputs });
    expect(federation.submitted).not.toEqual([]);
  });
});

describe('HathorToEvmFlow: a token native to the EVM chain', () => {
  it('melts on Hathor rather than voting straight away', async () => {
    const { flow, wallet, federation, evmFederation } = await build();
    wallet.confirmations.set(TX_ID, 10);

    await deliver(flow, wallet, incomingTx());

    expect(wallet.proposals).toEqual([
      expect.objectContaining({ kind: 'melt', token: EVM_NATIVE.hathorToken, amount: 150n }),
    ]);
    expect(federation.submitted[0]).toMatchObject({
      kind: 'proposal',
      identity: expect.objectContaining({ transactionType: TransactionType.MELT }),
    });
    // The vote waits for the melt to settle.
    expect(evmFederation.votes).toEqual([]);
  });

  it('votes in the bridge 18-decimal unit even for a 6-decimal token', async () => {
    // USDC is the production case. The bridge stores limits in 18 decimals and divides a voted
    // amount by 10^(18-decimals) on release, so voting in the token's own decimals would release
    // a millionth of the transfer - and would never clear the minimum in the first place.
    const { flow, bridge, evmFederation } = await build();
    bridge.decimals.set(EVM_NATIVE.evmToken, 6);

    await flow.settleMeltedTransfer({
      hathorSenderAddress: SENDER,
      evmReceiverAddress: DESTINATION,
      hathorAmount: 150n, // 1.50 on Hathor
      hathorTokenAddress: EVM_NATIVE.hathorToken,
      hathorTxId: TX_ID,
    });

    expect(evmFederation.votes[0]?.amount).toBe(1_500_000_000_000_000_000n);
  });

  it('votes on the EVM side once the melt has settled', async () => {
    const { flow, evmFederation } = await build();

    expect(
      await flow.settleMeltedTransfer({
        hathorSenderAddress: SENDER,
        evmReceiverAddress: DESTINATION,
        hathorAmount: 150n,
        hathorTokenAddress: EVM_NATIVE.hathorToken,
        hathorTxId: TX_ID,
      }),
    ).toBe(true);

    const expected = deriveEvmOriginIdentity(SENDER, TX_ID);
    expect(evmFederation.votes).toEqual([
      {
        originalTokenAddress: EVM_NATIVE.evmToken,
        sender: expected.sender,
        receiver: DESTINATION,
        amount: 1_500_000_000_000_000_000n, // 150 at two decimals -> 1.5 of an 18-decimal token
        blockHash: expected.idHash,
        transactionHash: expected.idHash,
        logIndex: 129,
        originChainId: HATHOR_CHAIN_ID,
        destinationChainId: EVM_CHAIN_ID,
      },
    ]);
  });
});

describe('HathorToEvmFlow: a token native to Hathor', () => {
  it('votes on the EVM side directly, with no melt', async () => {
    const { flow, wallet, federation, evmFederation } = await build();
    wallet.confirmations.set(TX_ID, 10);

    const nativeTx = incomingTx();
    const inputs = [{ ...at(nativeTx.inputs, 0), token: HATHOR_NATIVE.hathorToken }];
    const outputs = [...nativeTx.outputs];
    outputs[0] = { ...at(outputs, 0), token: HATHOR_NATIVE.hathorToken };

    await deliver(flow, wallet, { ...nativeTx, inputs, outputs });

    expect(wallet.proposals).toEqual([]);
    expect(federation.submitted).toEqual([]);
    expect(evmFederation.votes).toHaveLength(1);
    expect(evmFederation.votes[0]).toMatchObject({
      originalTokenAddress: HATHOR_NATIVE.evmToken,
      receiver: DESTINATION,
    });
  });
});

describe('HathorToEvmFlow: the melt validator guards its origin', () => {
  /** Puts the flow in the state where it is about to validate a melt somebody else proposed. */
  async function aboutToSign(originTx: HistoryEntry | undefined) {
    const context = await build();
    const { wallet, federation } = context;
    wallet.confirmations.set(TX_ID, 10);
    wallet.history = originTx ? [originTx] : [];
    federation.proposedTxHex = 'someone-elses-melt';
    wallet.decoded.set('someone-elses-melt', { inputs: [], outputs: [] });
    wallet.signatures.set('someone-elses-melt', 'pubA|0:a');
    return context;
  }

  it('refuses when the origin transaction is unknown', async () => {
    const { flow, federation } = await aboutToSign(undefined);

    await expect(
      flow.transfer({
        hathorSenderAddress: SENDER,
        evmReceiverAddress: DESTINATION,
        hathorAmount: 150n,
        hathorTokenAddress: EVM_NATIVE.hathorToken,
        hathorTxId: TX_ID,
      }),
    ).rejects.toThrow(/unknown or voided/);
    expect(federation.submitted).toEqual([]);
  });

  it('refuses when the origin transaction has the wrong version', async () => {
    const { flow } = await aboutToSign(incomingTx({ version: 3 }));

    await expect(
      flow.transfer({
        hathorSenderAddress: SENDER,
        evmReceiverAddress: DESTINATION,
        hathorAmount: 150n,
        hathorTokenAddress: EVM_NATIVE.hathorToken,
        hathorTxId: TX_ID,
      }),
    ).rejects.toThrow(/version 3/);
  });

  it('refuses when the origin transaction moves no custom token', async () => {
    const { flow } = await aboutToSign(incomingTx({ outputs: [] }));

    await expect(
      flow.transfer({
        hathorSenderAddress: SENDER,
        evmReceiverAddress: DESTINATION,
        hathorAmount: 150n,
        hathorTokenAddress: EVM_NATIVE.hathorToken,
        hathorTxId: TX_ID,
      }),
    ).rejects.toThrow(/moves no custom token/);
  });
});

describe('HathorToEvmFlow: transfer limits', () => {
  it('ignores an amount below the token minimum', async () => {
    const { flow, wallet, allowTokens, federation, evmFederation, logger } = await build();
    wallet.confirmations.set(TX_ID, 10);
    allowTokens.limits = { allowed: true, min: 10n ** 20n, mediumAmount: 0n, largeAmount: 0n };

    expect(await deliver(flow, wallet, incomingTx())).toBe(true);
    expect(federation.submitted).toEqual([]);
    expect(evmFederation.votes).toEqual([]);
    expect(logger.at('info')).toMatch(/below the minimum/);
  });

  it('acts on an amount exactly at the minimum', async () => {
    const { flow, wallet, allowTokens, federation } = await build();
    wallet.confirmations.set(TX_ID, 10);
    allowTokens.limits = {
      allowed: true,
      min: 1_500_000_000_000_000_000n,
      mediumAmount: 0n,
      largeAmount: 0n,
    };

    await deliver(flow, wallet, incomingTx());
    expect(federation.submitted).not.toEqual([]);
  });
});
