import { TransactionType } from '../domain/transactionTypes';
import type { CrossEvent } from '../ports/BridgePort';
import { FakeBridge } from '../ports/testSupport/FakeBridge';
import { FakeHathorFederation } from '../ports/testSupport/FakeHathorFederation';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { InstantClock, RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { EvmToHathorFlow } from './EvmToHathorFlow';
import { ProposalCoordinator } from './ProposalCoordinator';

const EVM_CHAIN_ID = 42161;
const HATHOR_CHAIN_ID = 31;
const TX_HASH = '0xCROSSTX';
const RECEIVER = 'HRECEIVER';

/** A token native to the EVM chain: it has to be minted on Hathor. */
const EVM_NATIVE = { evmToken: '0xEVMTOKEN', hathorToken: 'htrEVMTOKEN', originChainId: EVM_CHAIN_ID };
/** A token native to Hathor: it was locked in the multisig and is transferred back. */
const HATHOR_NATIVE = { evmToken: '0xSIDETOKEN', hathorToken: 'htrNATIVE', originChainId: HATHOR_CHAIN_ID };

function crossEvent(overrides: Partial<CrossEvent> = {}): CrossEvent {
  return {
    transactionHash: TX_HASH,
    blockHash: '0xBLOCK',
    blockNumber: 100,
    logIndex: 0,
    receiver: RECEIVER,
    sender: '0xSENDER',
    amount: 1_500_000_000_000_000_000n, // 1.5 of an 18-decimal token -> 150 on Hathor
    tokenAddress: EVM_NATIVE.evmToken,
    originChainId: EVM_CHAIN_ID,
    destinationChainId: HATHOR_CHAIN_ID,
    ...overrides,
  };
}

async function build() {
  const wallet = new FakeHathorWallet();
  await wallet.start();
  const bridge = new FakeBridge().addMapping(EVM_NATIVE).addMapping(HATHOR_NATIVE);
  const federation = new FakeHathorFederation();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();

  const coordinator = new ProposalCoordinator({
    wallet,
    federation,
    logger,
    metrics,
    clock: new InstantClock(),
    options: { federatorAddress: '0xFED', multisigOrder: 1, numSignatures: 2 },
  });

  const flow = new EvmToHathorFlow({
    wallet,
    bridge,
    coordinator,
    logger,
    evmChainId: EVM_CHAIN_ID,
    inputLockTtlMs: 1_800_000,
  });

  return { flow, wallet, bridge, federation, logger, metrics };
}

describe('EvmToHathorFlow', () => {
  it('mints on Hathor for a token native to the EVM chain', async () => {
    const { flow, wallet, bridge, federation } = await build();
    bridge.crossEvents.push(crossEvent());

    await flow.transfer({
      senderAddress: '0xSENDER',
      receiverAddress: RECEIVER,
      evmAmount: 1_500_000_000_000_000_000n,
      evmTokenAddress: EVM_NATIVE.evmToken,
      transactionHash: TX_HASH,
    });

    expect(wallet.proposals).toEqual([
      expect.objectContaining({
        kind: 'mint',
        token: EVM_NATIVE.hathorToken,
        amount: 150n, // converted from 18 decimals down to Hathor's two
        receiverAddress: RECEIVER,
        markInputsAsUsed: true,
        inputLockTtlMs: 1_800_000,
        fixedAddress: 'HFakeMultisigAddress0',
      }),
    ]);
    expect(federation.submitted[0]).toMatchObject({
      kind: 'proposal',
      identity: expect.objectContaining({ transactionType: TransactionType.MINT }),
    });
  });

  it('transfers on Hathor for a token native to Hathor', async () => {
    const { flow, wallet, bridge, federation } = await build();
    bridge.crossEvents.push(crossEvent({ tokenAddress: HATHOR_NATIVE.evmToken, originChainId: HATHOR_CHAIN_ID }));

    await flow.transfer({
      senderAddress: '0xSENDER',
      receiverAddress: RECEIVER,
      evmAmount: 1_500_000_000_000_000_000n,
      evmTokenAddress: HATHOR_NATIVE.evmToken,
      transactionHash: TX_HASH,
    });

    expect(wallet.proposals).toEqual([
      expect.objectContaining({
        kind: 'transfer',
        outputs: [{ address: RECEIVER, value: 150n, token: HATHOR_NATIVE.hathorToken }],
      }),
    ]);
    expect(federation.submitted[0]).toMatchObject({
      identity: expect.objectContaining({ transactionType: TransactionType.TRANSFER }),
    });
  });

  it('uses the token own decimals rather than assuming 18', async () => {
    const { flow, wallet, bridge } = await build();
    bridge.decimals.set(EVM_NATIVE.evmToken, 6);
    bridge.crossEvents.push(crossEvent({ amount: 1_500_000n }));

    await flow.transfer({
      senderAddress: '0xSENDER',
      receiverAddress: RECEIVER,
      evmAmount: 1_500_000n, // 1.5 of a 6-decimal token
      evmTokenAddress: EVM_NATIVE.evmToken,
      transactionHash: TX_HASH,
    });

    expect(wallet.proposals[0]).toMatchObject({ amount: 150n });
  });

  it('refuses to propose when no Cross event backs the transfer', async () => {
    // The identity may have come off a contract event another federator wrote. The originating
    // event is the only thing that proves funds were actually locked.
    const { flow, federation, logger } = await build();

    expect(
      await flow.transfer({
        senderAddress: '0xSENDER',
        receiverAddress: RECEIVER,
        evmAmount: 1_500_000_000_000_000_000n,
        evmTokenAddress: EVM_NATIVE.evmToken,
        transactionHash: TX_HASH,
      }),
    ).toBe(false);

    expect(federation.submitted).toEqual([]);
    expect(logger.at('error')).toMatch(/No Cross event found/);
  });

  it('refuses a proposal that mints a different amount than the event locked', async () => {
    const { flow, wallet, bridge, federation } = await build();
    bridge.crossEvents.push(crossEvent());

    // Another federator proposed a mint of 999 for an event that locked 150.
    federation.proposedTxHex = 'tampered';
    federation.signedBy.add('0xFED');
    federation.signatures = ['pubA|0:a', 'pubB|0:b'];
    wallet.decoded.set('tampered', {
      inputs: [{ value: 1n, tokenData: 0b1000_0001, script: '', token: EVM_NATIVE.hathorToken, decoded: {} }],
      outputs: [
        {
          value: 999n,
          tokenData: 1,
          script: '',
          token: EVM_NATIVE.hathorToken,
          decoded: { type: 'P2PKH', address: RECEIVER, timelock: null },
        },
      ],
    });

    await expect(
      flow.transfer({
        senderAddress: '0xSENDER',
        receiverAddress: RECEIVER,
        evmAmount: 1_500_000_000_000_000_000n,
        evmTokenAddress: EVM_NATIVE.evmToken,
        transactionHash: TX_HASH,
      }),
    ).rejects.toThrow(/mints 999 .* locked 150/);
  });

  it('validates a transfer against the receiver named by the event, not the caller', async () => {
    const { flow, wallet, bridge, federation } = await build();
    bridge.crossEvents.push(crossEvent({ tokenAddress: HATHOR_NATIVE.evmToken, receiver: 'HREALRECEIVER' }));

    federation.proposedTxHex = 'redirected';
    federation.signedBy.add('0xFED');
    federation.signatures = ['pubA|0:a', 'pubB|0:b'];
    // A proposal that nets to zero but pays somebody else.
    wallet.decoded.set('redirected', {
      inputs: [{ value: 150n, tokenData: 1, script: '', token: HATHOR_NATIVE.hathorToken, decoded: {} }],
      outputs: [
        {
          value: 150n,
          tokenData: 1,
          script: '',
          token: HATHOR_NATIVE.hathorToken,
          decoded: { type: 'P2PKH', address: 'HATTACKER', timelock: null },
        },
      ],
    });

    await expect(
      flow.transfer({
        senderAddress: '0xSENDER',
        receiverAddress: 'HATTACKER',
        evmAmount: 1_500_000_000_000_000_000n,
        evmTokenAddress: HATHOR_NATIVE.evmToken,
        transactionHash: TX_HASH,
      }),
    ).rejects.toThrow(/pays 0 .* to HREALRECEIVER/);
  });
});
