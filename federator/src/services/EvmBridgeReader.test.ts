import type { EvmToHathorFlow } from '../application/EvmToHathorFlow';
import type { CrossEvent } from '../ports/BridgePort';
import type { EvmChainPort } from '../ports/EvmChainPort';
import { FakeAllowTokens, FakeBridge } from '../ports/testSupport/FakeBridge';
import { FakeCursorStore } from '../ports/testSupport/FakeCursorStore';
import { RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { EVM_BRIDGE_READER, EvmBridgeReader } from './EvmBridgeReader';

const EVM_CHAIN_ID = 42161;
const HATHOR_CHAIN_ID = 31;
const TOKEN = { evmToken: '0xTOKEN', hathorToken: 'htrTOKEN', originChainId: EVM_CHAIN_ID };

class FakeChain implements EvmChainPort {
  public head = 1_000;
  public syncing = false;
  async getBlockNumber(): Promise<number> {
    return this.head;
  }
  async isSyncing(): Promise<boolean> {
    return this.syncing;
  }
}

function crossEvent(overrides: Partial<CrossEvent> = {}): CrossEvent {
  return {
    transactionHash: '0xTX',
    blockHash: '0xBLOCK',
    blockNumber: 500,
    logIndex: 0,
    receiver: 'HRECEIVER',
    sender: '0xSENDER',
    amount: 100n,
    tokenAddress: TOKEN.evmToken,
    originChainId: EVM_CHAIN_ID,
    destinationChainId: HATHOR_CHAIN_ID,
    ...overrides,
  };
}

function build() {
  const chain = new FakeChain();
  const bridge = new FakeBridge().addMapping(TOKEN);
  const allowTokens = new FakeAllowTokens();
  const cursors = new FakeCursorStore();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const transfers: string[] = [];

  const flow = {
    transfer: async (params: { transactionHash: string }) => {
      transfers.push(params.transactionHash);
      return true;
    },
  } as unknown as EvmToHathorFlow;

  const reader = new EvmBridgeReader({
    chain,
    bridge,
    allowTokens,
    flow,
    cursors,
    logger,
    metrics,
    hathorChainId: HATHOR_CHAIN_ID,
    fromBlock: 0,
  });

  return { reader, chain, bridge, allowTokens, cursors, logger, metrics, transfers };
}

describe('EvmBridgeReader guards', () => {
  it('does not read while the node is syncing', async () => {
    // A syncing node serves stale logs, so acting on them means acting on a partial view.
    const { reader, chain, bridge, transfers, logger } = build();
    chain.syncing = true;
    bridge.crossEvents.push(crossEvent());

    await reader.run();
    expect(transfers).toEqual([]);
    expect(logger.at('warn')).toMatch(/still syncing/);
  });

  it('does nothing when the chain is too young for anything to be confirmed', async () => {
    const { reader, chain, cursors, logger } = build();
    // Below BOTH depths: with head 5 and a small-amount depth of 1 the shallow boundary is still
    // positive, so the guard would not fire and the test would pass for the wrong reason.
    chain.head = 1;

    await reader.run();
    expect(cursors.blocks.size).toBe(0);
    expect(logger.at('debug')).toMatch(/nothing is confirmed yet/);
  });

  it('does nothing when the cursor is already at the head', async () => {
    const { reader, cursors, transfers, logger } = build();
    await cursors.setBlockCursor(EVM_BRIDGE_READER, 1_000);

    await reader.run();
    expect(transfers).toEqual([]);
    expect(logger.at('debug')).toMatch(/Nothing new/);
  });
});

describe('EvmBridgeReader reading', () => {
  it('hands each Cross event to the flow', async () => {
    const { reader, bridge, transfers } = build();
    bridge.crossEvents.push(crossEvent({ transactionHash: '0xA' }), crossEvent({ transactionHash: '0xB' }));

    await reader.run();
    expect(transfers).toEqual(['0xA', '0xB']);
  });

  it('only reads events bound for Hathor', async () => {
    const { reader, bridge, transfers } = build();
    bridge.crossEvents.push(
      crossEvent({ transactionHash: '0xHATHOR' }),
      crossEvent({ transactionHash: '0xELSEWHERE', destinationChainId: 999 }),
    );

    await reader.run();
    expect(transfers).toEqual(['0xHATHOR']);
  });

  it('advances the cursor to the deepest settled block', async () => {
    const { reader, chain, cursors } = build();
    chain.head = 1_000; // largeAmountConfirmations is 10 in the fake

    await reader.run();
    expect(await cursors.getBlockCursor(EVM_BRIDGE_READER, 0)).toBe(990);
  });

  it('advances the cursor per page, so a failure does not undo a long catch-up', async () => {
    const { reader, chain, cursors, bridge } = build();
    chain.head = 2_000;
    // One event in the first page; the run must record progress past it either way.
    bridge.crossEvents.push(crossEvent({ blockNumber: 100 }));

    await reader.run();
    expect(await cursors.getBlockCursor(EVM_BRIDGE_READER, 0)).toBe(1_990);
  });

  it('skips a token that is no longer allowed', async () => {
    const { reader, bridge, allowTokens, transfers, logger } = build();
    allowTokens.limits = { allowed: false, min: 0n, mediumAmount: 0n, largeAmount: 0n };
    bridge.crossEvents.push(crossEvent());

    await reader.run();
    expect(transfers).toEqual([]);
    expect(logger.at('error')).toMatch(/not allowed/);
  });

  it('counts a completed run', async () => {
    const { reader, metrics } = build();
    await reader.run();
    expect(metrics.counts.evmRunCompleted).toBe(1);
  });
});

describe('EvmBridgeReader confirmation depth', () => {
  /** Puts an event in the shallow window: newer than the deep pass, old enough for the shallow one. */
  function shallowEvent(amount: bigint) {
    const context = build();
    context.chain.head = 1_000;
    // largeAmountConfirmations 10 -> deep pass ends at 990; smallAmountConfirmations 1 -> 999.
    context.bridge.crossEvents.push(crossEvent({ blockNumber: 995, amount }));
    context.allowTokens.limits = { allowed: true, min: 0n, mediumAmount: 100n, largeAmount: 1_000n };
    return context;
  }

  it('acts on a small amount as soon as it is shallowly confirmed', async () => {
    const { reader, transfers } = shallowEvent(50n);
    await reader.run();
    expect(transfers).toEqual(['0xTX']);
  });

  it('leaves a large amount for a later run', async () => {
    const { reader, transfers, logger } = shallowEvent(5_000n);
    await reader.run();
    expect(transfers).toEqual([]);
    expect(logger.at('debug')).toMatch(/large amount with 5 confirmations/);
  });

  it('leaves a medium amount that is not deep enough yet', async () => {
    // mediumAmountConfirmations is 5 in the fake; this event is 5 blocks deep, so it qualifies.
    const { reader, transfers, allowTokens } = shallowEvent(500n);
    allowTokens.confirmations = {
      smallAmountConfirmations: 1,
      mediumAmountConfirmations: 20,
      largeAmountConfirmations: 10,
    };
    await reader.run();
    expect(transfers).toEqual([]);
  });

  it('does not let the shallow pass move the cursor past unsettled blocks', async () => {
    const { reader, cursors } = shallowEvent(50n);
    await reader.run();
    // 990 is the deep boundary; 999 is the shallow one, and must not be recorded.
    expect(await cursors.getBlockCursor(EVM_BRIDGE_READER, 0)).toBe(990);
  });
});
