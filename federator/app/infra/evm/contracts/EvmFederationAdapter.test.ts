import Web3 from 'web3';

import type { VoteRequest } from '../../../ports/EvmFederationPort';
import { RecordingLogger } from '../../../ports/testSupport/fakes';
import { EvmFederationAdapter } from './EvmFederationAdapter';
import { FakeContract } from './testSupport/FakeContract';

const REQUEST: VoteRequest = {
  originalTokenAddress: '0xTOKEN',
  sender: '0xSENDER',
  receiver: '0xRECEIVER',
  amount: 5_000_000_000_000_000_000n,
  blockHash: '0xBLOCK',
  transactionHash: '0xTX',
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 11155111,
};

function build() {
  const contract = new FakeContract('0xFEDERATION');
  const sent: Array<{ to: string; data: string }> = [];
  const sender = {
    send: async (to: string, data: string) => {
      sent.push({ to, data });
      return { status: true, transactionHash: '0xreceipt' };
    },
  } as never;
  const adapter = new EvmFederationAdapter(new Web3(), '0xFEDERATION', sender, contract);
  void new RecordingLogger();
  return { adapter, contract, sent };
}

describe('EvmFederationAdapter', () => {
  it('passes the nine fields in the order the contract hashes them', async () => {
    // Rearranging these silently changes the derived transaction id, and every federator would
    // then coordinate on a different one.
    const { adapter, contract } = build();
    contract.on('getTransactionId', '0xID');

    await adapter.getTransactionId(REQUEST);
    expect(contract.argsFor('getTransactionId')).toEqual([
      '0xTOKEN',
      '0xSENDER',
      '0xRECEIVER',
      5_000_000_000_000_000_000n,
      '0xBLOCK',
      '0xTX',
      129,
      31,
      11155111,
    ]);
  });

  it('asks hasVoted as the federator, not as the zero address', async () => {
    // The contract reads msg.sender; without `from` it answers about somebody else entirely.
    const { adapter, contract } = build();
    contract.on('hasVoted', true);

    expect(await adapter.hasVoted('0xID', '0xFED')).toBe(true);
    expect(contract.calls.at(-1)).toMatchObject({ name: 'hasVoted', args: ['0xID'], from: '0xFED' });
  });

  it('reports whether a transfer was already processed', async () => {
    const { adapter, contract } = build();
    contract.on('transactionWasProcessed', false);
    expect(await adapter.transactionWasProcessed('0xID')).toBe(false);
  });

  it('votes by sending the encoded call to the federation contract', async () => {
    const { adapter, contract, sent } = build();
    contract.on('voteTransaction', undefined);

    expect(await adapter.vote(REQUEST)).toEqual({ status: true, transactionHash: '0xreceipt' });
    expect(sent).toEqual([{ to: '0xFEDERATION', data: '0xvoteTransaction' }]);
    expect(contract.argsFor('voteTransaction')).toHaveLength(9);
  });
});
