import Web3 from 'web3';
import type { EventLog } from 'web3';

import { RecordingLogger } from '../../../ports/testSupport/fakes';
import { BridgeAdapter } from './BridgeAdapter';
import type { ContractLike } from './contractAccess';
import { FakeContract } from './testSupport/FakeContract';

const HATHOR_TOKEN = '0000091b1e3609e661f72efaac78ac96f9321cc97ac2c257f349c2553edaeeac';
const EVM_TOKEN = '0xA5b366e257a09DC8B5A63E97De89B5F29131DaBd';
const SEPOLIA = 11155111;

/** Exposes the token contract seam, so decimals can be driven without a chain. */
class TestableBridge extends BridgeAdapter {
  public tokenContracts = new Map<string, ContractLike>();
  protected override tokenContract(evmToken: string): ContractLike {
    const contract = this.tokenContracts.get(evmToken);
    if (!contract) {
      throw new Error(`no token contract stubbed for ${evmToken}`);
    }
    return contract;
  }
}

function build() {
  const contract = new FakeContract();
  const logger = new RecordingLogger();
  const adapter = new TestableBridge(new Web3(), '0xBRIDGE', logger, contract);
  contract
    .on('EvmToHathorTokenMap', () => HATHOR_TOKEN)
    .on('HathorToEvmTokenMap', () => ({ tokenAddress: EVM_TOKEN, originChainId: String(SEPOLIA) }));
  return { adapter, contract, logger };
}

const crossLog = (overrides: Record<string, unknown> = {}): EventLog =>
  ({
    event: 'Cross',
    transactionHash: '0xTX',
    blockHash: '0xBLOCK',
    blockNumber: 100n,
    logIndex: 3n,
    returnValues: {
      _to: 'Wi2pW7mxK9DfJQ85RcmVWAQChqpBRCHeUz',
      _from: '0xSENDER',
      _amount: '5000000000000000000',
      _tokenAddress: EVM_TOKEN,
      _originChainId: '11155111',
      _destinationChainId: '31',
    },
    ...overrides,
  } as unknown as EventLog);

describe('BridgeAdapter token mapping', () => {
  it('resolves a Hathor token to its EVM side and origin chain', async () => {
    const { adapter } = build();
    expect(await adapter.mappingByHathorToken(HATHOR_TOKEN)).toEqual({
      hathorToken: HATHOR_TOKEN,
      evmToken: EVM_TOKEN,
      originChainId: SEPOLIA,
    });
  });

  it('resolves the same mapping from either side', async () => {
    // Which side is "original" decides whether a transfer mints or transfers, so both lookups have
    // to agree.
    const { adapter } = build();
    expect(await adapter.mappingByEvmToken(EVM_TOKEN)).toEqual(await adapter.mappingByHathorToken(HATHOR_TOKEN));
  });

  it('caches a mapping from both keys after one lookup', async () => {
    const { adapter, contract } = build();
    await adapter.mappingByEvmToken(EVM_TOKEN);
    await adapter.mappingByEvmToken(EVM_TOKEN);
    await adapter.mappingByHathorToken(HATHOR_TOKEN);

    expect(contract.countOf('EvmToHathorTokenMap')).toBe(1);
    expect(contract.countOf('HathorToEvmTokenMap')).toBe(1);
  });

  it('fails clearly when the bridge has no Hathor token for an EVM one', async () => {
    const { adapter, contract } = build();
    contract.on('EvmToHathorTokenMap', () => '');
    await expect(adapter.mappingByEvmToken('0xUNKNOWN')).rejects.toThrow(/no Hathor token registered/);
  });

  it('fails clearly when the bridge has no mapping', async () => {
    const { adapter, contract } = build();
    contract.on('HathorToEvmTokenMap', () => ({ tokenAddress: '', originChainId: '0' }));
    await expect(adapter.mappingByHathorToken('unknown')).rejects.toThrow(/no EVM token registered/);
  });

  it('reads originChainId as a number, whatever the contract returns it as', async () => {
    const { adapter, contract } = build();
    contract.on('HathorToEvmTokenMap', () => ({ tokenAddress: EVM_TOKEN, originChainId: BigInt(SEPOLIA) }));
    expect((await adapter.mappingByHathorToken(HATHOR_TOKEN)).originChainId).toBe(SEPOLIA);
  });
});

describe('BridgeAdapter findCrossEvent', () => {
  /** Gives the adapter a web3 whose getTransaction answers, so the two-step lookup can run. */
  function withTransaction(blockNumber: number | null) {
    const contract = new FakeContract();
    const web3 = {
      eth: {
        getTransaction: async () =>
          blockNumber === null ? { blockNumber: null } : { blockNumber: BigInt(blockNumber) },
      },
    } as unknown as Web3;
    const adapter = new BridgeAdapter(web3, '0xBRIDGE', new RecordingLogger(), contract);
    return { adapter, contract };
  }

  it('looks the event up in the block its transaction landed in', async () => {
    // Scanning a range for one hash would be a far more expensive query.
    const { adapter, contract } = withTransaction(500);
    contract.events = [crossLog()];

    const event = await adapter.findCrossEvent('0xTX');
    expect(event?.transactionHash).toBe('0xTX');
    expect(contract.eventQueries[0]?.options).toEqual({ fromBlock: 500, toBlock: 500 });
  });

  it('ignores other events in the same block', async () => {
    const { adapter, contract } = withTransaction(500);
    contract.events = [crossLog({ transactionHash: '0xOTHER' })];
    expect(await adapter.findCrossEvent('0xTX')).toBeUndefined();
  });

  it('returns undefined for a transaction that is not mined yet', async () => {
    const { adapter } = withTransaction(null);
    expect(await adapter.findCrossEvent('0xTX')).toBeUndefined();
  });

  it('returns undefined when the node does not know the transaction at all', async () => {
    const contract = new FakeContract();
    const web3 = {
      eth: {
        getTransaction: async () => {
          throw new Error('not found');
        },
      },
    } as unknown as Web3;
    const adapter = new BridgeAdapter(web3, '0xBRIDGE', new RecordingLogger(), contract);
    expect(await adapter.findCrossEvent('0xTX')).toBeUndefined();
  });
});

describe('BridgeAdapter decimals', () => {
  it('caches the decimals per token', async () => {
    const { adapter } = build();
    const token = new FakeContract(EVM_TOKEN).on('decimals', '18');
    adapter.tokenContracts.set(EVM_TOKEN, token);

    expect(await adapter.getEvmTokenDecimals(EVM_TOKEN)).toBe(18);
    await adapter.getEvmTokenDecimals(EVM_TOKEN);
    expect(token.countOf('decimals')).toBe(1);
  });

  it('refuses a token reporting nonsense decimals', async () => {
    const { adapter } = build();
    adapter.tokenContracts.set(EVM_TOKEN, new FakeContract(EVM_TOKEN).on('decimals', 'not-a-number'));
    await expect(adapter.getEvmTokenDecimals(EVM_TOKEN)).rejects.toThrow(/non-integer decimals/);
  });
});

describe('BridgeAdapter Cross events', () => {
  it('maps a log onto the domain event, with the amount as bigint', async () => {
    const { adapter, contract } = build();
    contract.events = [crossLog()];

    const [event] = await adapter.getCrossEvents(1, 100, 31);
    expect(event).toEqual({
      transactionHash: '0xTX',
      blockHash: '0xBLOCK',
      blockNumber: 100,
      logIndex: 3,
      receiver: 'Wi2pW7mxK9DfJQ85RcmVWAQChqpBRCHeUz',
      sender: '0xSENDER',
      amount: 5_000_000_000_000_000_000n,
      tokenAddress: EVM_TOKEN,
      originChainId: SEPOLIA,
      destinationChainId: 31,
    });
  });

  it('filters the query by destination chain rather than after the fact', async () => {
    const { adapter, contract } = build();
    await adapter.getCrossEvents(1, 100, 31);
    expect(contract.eventQueries[0]).toMatchObject({
      eventName: 'Cross',
      options: { fromBlock: 1, toBlock: 100, filter: { _destinationChainId: 31 } },
    });
  });

  it('drops a log with no transaction hash instead of emitting a broken event', async () => {
    // A pending log has none, and the whole pipeline keys on it.
    const { adapter, contract, logger } = build();
    contract.events = [crossLog({ transactionHash: undefined })];

    expect(await adapter.getCrossEvents(1, 100, 31)).toEqual([]);
    expect(logger.at('warn')).toMatch(/no transaction hash/);
  });

  it('fills in defaults for a log with fields missing', async () => {
    // Better an event with zeros than one carrying the string "undefined" into an amount.
    const { adapter, contract } = build();
    contract.events = [{ event: 'Cross', transactionHash: '0xTX', returnValues: {} } as unknown as EventLog];

    const [event] = await adapter.getCrossEvents(1, 100, 31);
    expect(event).toMatchObject({
      transactionHash: '0xTX',
      blockHash: '',
      blockNumber: 0,
      logIndex: 0,
      amount: 0n,
      receiver: '',
      sender: '',
    });
  });

  it('ignores the string form a node may return', async () => {
    const { adapter, contract } = build();
    contract.events = ['0xsomehash'];
    expect(await adapter.getCrossEvents(1, 100, 31)).toEqual([]);
  });
});
