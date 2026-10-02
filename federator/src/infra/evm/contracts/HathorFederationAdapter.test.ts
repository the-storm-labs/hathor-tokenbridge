import Web3 from 'web3';
import type { EventLog } from 'web3';

import { TransactionType } from '../../../domain/transactionTypes';
import type { ProposalIdentity } from '../../../ports/HathorFederationPort';
import { RecordingLogger } from '../../../ports/testSupport/fakes';
import { HathorFederationAdapter } from './HathorFederationAdapter';
import { FakeContract } from './testSupport/FakeContract';

const TOKEN = '0x684a8a976635fb7ad74a0134ace990a6a0fcce84';
const PADDED_TOKEN = '0x000000000000000000000000684a8a976635fb7ad74a0134ace990a6a0fcce84';

const IDENTITY: ProposalIdentity = {
  originalTokenAddress: TOKEN,
  transactionHash: 'deadbeef',
  value: 1500n,
  sender: '0xSENDER',
  receiver: 'HRECEIVER',
  transactionType: TransactionType.MINT,
};

function build() {
  const contract = new FakeContract('0xSTATE');
  const sent: Array<{ to: string; data: string }> = [];
  const sender = {
    send: async (to: string, data: string) => {
      sent.push({ to, data });
      return { status: true, transactionHash: '0xreceipt' };
    },
  } as never;
  const logger = new RecordingLogger();
  const adapter = new HathorFederationAdapter(new Web3(), '0xSTATE', sender, logger, contract);
  return { adapter, contract, sent, logger };
}

describe('HathorFederationAdapter encoding', () => {
  it('pads the token and hash to bytes32 on every call that identifies a transfer', async () => {
    // Every federator must pad identically or they derive different transaction ids.
    const { adapter, contract } = build();
    contract.on('getTransactionId', '0xID');

    await adapter.getTransactionId(IDENTITY);
    const args = contract.argsFor('getTransactionId');
    expect(args?.[0]).toBe(PADDED_TOKEN);
    expect(args?.[1]).toBe(`0x${'0'.repeat(56)}deadbeef`);
    expect(args?.slice(2)).toEqual([1500n, '0xSENDER', 'HRECEIVER', TransactionType.MINT]);
  });

  it('strips the 0x from the proposal hex, which the wallet works in bare', async () => {
    const { adapter, contract } = build();
    contract.on('transactionHex', '0xbeefcafe');
    expect(await adapter.getTransactionHex('0xID')).toBe('beefcafe');
  });

  it('re-adds the 0x when submitting a proposal', async () => {
    const { adapter, contract, sent } = build();
    contract.on('sendTransactionProposal', undefined);

    await adapter.submitProposal(IDENTITY, 'beefcafe');
    expect(contract.argsFor('sendTransactionProposal')?.at(-1)).toBe('0xbeefcafe');
    expect(sent).toEqual([{ to: '0xSTATE', data: '0xsendTransactionProposal' }]);
  });

  it('does not double the prefix when the hex already has one', async () => {
    const { adapter, contract } = build();
    contract.on('sendTransactionProposal', undefined);

    await adapter.submitProposal(IDENTITY, '0xbeefcafe');
    expect(contract.argsFor('sendTransactionProposal')?.at(-1)).toBe('0xbeefcafe');
  });
});

describe('HathorFederationAdapter transfer state', () => {
  it('reads isProcessed straight off the contract', async () => {
    const { adapter, contract } = build();
    contract.on('isProcessed', true);
    expect(await adapter.isProcessed('0xID')).toBe(true);
  });

  it('reads isProposed straight off the contract', async () => {
    const { adapter, contract } = build();
    contract.on('isProposed', false);
    expect(await adapter.isProposed('0xID')).toBe(false);
  });

  it('asks isSigned about this federator specifically', async () => {
    const { adapter, contract } = build();
    contract.on('isSigned', true);

    expect(await adapter.isSigned('0xID', '0xFED')).toBe(true);
    expect(contract.argsFor('isSigned')).toEqual(['0xID', '0xFED']);
  });
});

describe('HathorFederationAdapter signatures', () => {
  it('reads every stored signature by index', async () => {
    const { adapter, contract } = build();
    contract
      .on('getSignatureCount', '3')
      .on('transactionSignatures', (_id: unknown, index: unknown) => `sig-${String(index)}`);

    expect(await adapter.getSignatures('0xID')).toEqual(['sig-0', 'sig-1', 'sig-2']);
  });

  it('returns nothing when none have been collected', async () => {
    const { adapter, contract } = build();
    contract.on('getSignatureCount', '0');
    expect(await adapter.getSignatures('0xID')).toEqual([]);
  });

  it('submits a signature with the signed flag set', async () => {
    const { adapter, contract } = build();
    contract.on('updateSignatureState', undefined);

    await adapter.submitSignature(IDENTITY, 'pub|0:aaaa');
    expect(contract.argsFor('updateSignatureState')?.slice(-2)).toEqual(['pub|0:aaaa', true]);
  });
});

describe('HathorFederationAdapter outcomes', () => {
  it('records a failed push without inventing a transaction id', async () => {
    const { adapter, contract } = build();
    contract.on('updateTransactionState', undefined);

    await adapter.submitOutcome(IDENTITY, false, '4d616e75616c20436865636b');
    expect(contract.argsFor('updateTransactionState')?.slice(-2)).toEqual([false, '0x4d616e75616c20436865636b']);
  });

  it('records a settled push with its Hathor transaction id', async () => {
    const { adapter, contract } = build();
    contract.on('updateTransactionState', undefined);

    await adapter.submitOutcome(IDENTITY, true, 'abc123');
    expect(contract.argsFor('updateTransactionState')?.slice(-2)).toEqual([true, '0xabc123']);
  });
});

describe('HathorFederationAdapter events', () => {
  const log = (event: string, values: Record<string, unknown>) =>
    ({ event, returnValues: values } as unknown as EventLog);

  const transferValues = {
    transactionId: '0xID',
    originalTokenAddress: PADDED_TOKEN,
    transactionHash: '0xdeadbeef',
    value: '1500',
    sender: 'HSENDER',
    receiver: '0xRECEIVER',
    transactionType: TransactionType.MINT,
  };

  it('maps the contract log onto domain events', async () => {
    const { adapter, contract } = build();
    contract.events = [
      log('TransactionProposed', { ...transferValues, txHex: '0xbeef' }),
      log('LockTransactionHex', { txHex: '0xcafe' }),
    ];

    const events = await adapter.getEvents(1, 100);
    expect(events.map((event) => event.kind)).toEqual(['proposed', 'lock']);
  });

  it('narrows to the kinds asked for, so the two reader passes stay disjoint', async () => {
    const { adapter, contract } = build();
    contract.events = [
      log('TransactionProposed', { ...transferValues, txHex: '0xbeef' }),
      log('LockTransactionHex', { txHex: '0xcafe' }),
    ];

    expect((await adapter.getEvents(1, 100, ['lock'])).map((event) => event.kind)).toEqual(['lock']);
  });

  it('ignores contract events the bridge has no part in', async () => {
    const { adapter, contract } = build();
    contract.events = [log('MemberAddition', { member: '0xFED' }), '0xrawhash'];
    expect(await adapter.getEvents(1, 100)).toEqual([]);
  });

  it('reads all events in the range rather than one kind at a time', async () => {
    const { adapter, contract } = build();
    await adapter.getEvents(5, 10);
    expect(contract.eventQueries[0]).toEqual({ eventName: 'allEvents', options: { fromBlock: 5, toBlock: 10 } });
  });
});
