import { TransactionType } from '../domain/transactionTypes';
import type { ProposalIdentity } from '../ports/HathorFederationPort';
import { WalletOperationError } from '../ports/HathorWalletPort';
import { FakeHathorFederation } from '../ports/testSupport/FakeHathorFederation';
import { FakeHathorWallet } from '../ports/testSupport/FakeHathorWallet';
import { InstantClock, RecordingLogger, RecordingMetrics } from '../ports/testSupport/fakes';
import { MANUAL_CHECK_MARKER, ProposalCoordinator } from './ProposalCoordinator';
import type { ProposalStrategy } from './ProposalCoordinator';

const FEDERATOR = '0xFEDERATOR';
const TX_HEX = 'beef';

const IDENTITY: ProposalIdentity = {
  originalTokenAddress: '0xTOKEN',
  transactionHash: '0xHASH',
  value: 500n,
  sender: '0xSENDER',
  receiver: 'HRECEIVER',
  transactionType: TransactionType.MINT,
};

/** A signature covering both inputs of the two-input proposal used throughout. */
const sig = (pubkey: string) => `${pubkey}|0:aaaa|1:bbbb`;
const partialSig = (pubkey: string) => `${pubkey}|1:bbbb`;

async function build(overrides: { numSignatures?: number; multisigOrder?: number } = {}) {
  const wallet = new FakeHathorWallet();
  await wallet.start();
  const federation = new FakeHathorFederation();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const clock = new InstantClock();

  // A two-input proposal, so partial-signature handling is exercisable.
  const twoInputs = {
    inputs: [
      { value: 1n, tokenData: 0, script: '', token: '00', decoded: {} },
      { value: 1n, tokenData: 0, script: '', token: '00', decoded: {} },
    ],
    outputs: [],
  };
  wallet.decoded.set(TX_HEX, twoInputs);
  wallet.decoded.set('built-hex', twoInputs);

  const strategy: ProposalStrategy = {
    build: jest.fn(async () => 'built-hex'),
    validate: jest.fn(async () => ({ valid: true as const })),
  };

  const coordinator = new ProposalCoordinator({
    wallet,
    federation,
    logger,
    metrics,
    clock,
    options: {
      federatorAddress: FEDERATOR,
      multisigOrder: overrides.multisigOrder ?? 1,
      numSignatures: overrides.numSignatures ?? 2,
      signatureRetryDelayMs: 5_000,
    },
  });

  return { coordinator, wallet, federation, logger, metrics, clock, strategy };
}

describe('ProposalCoordinator: choosing the outstanding step', () => {
  it('does nothing for a transfer already processed', async () => {
    const { coordinator, federation, strategy } = await build();
    federation.processed = true;

    expect(await coordinator.coordinate(IDENTITY, strategy)).toBe(true);
    expect(federation.submitted).toEqual([]);
    expect(strategy.build).not.toHaveBeenCalled();
  });

  it('proposes when nothing has been proposed yet', async () => {
    const { coordinator, federation, strategy, metrics } = await build();

    expect(await coordinator.coordinate(IDENTITY, strategy)).toBe(true);
    expect(strategy.build).toHaveBeenCalledWith(IDENTITY);
    expect(federation.submitted).toEqual([{ kind: 'proposal', identity: IDENTITY, txHex: 'built-hex' }]);
    expect(metrics.counts.proposalSubmitted).toBe(1);
  });

  it('signs an existing proposal instead of making another', async () => {
    const { coordinator, wallet, federation, strategy } = await build();
    federation.proposedTxHex = TX_HEX;
    wallet.signatures.set(TX_HEX, sig('pubA'));

    await coordinator.coordinate(IDENTITY, strategy);

    expect(strategy.build).not.toHaveBeenCalled();
    expect(federation.submitted).toEqual([{ kind: 'signature', identity: IDENTITY, signature: sig('pubA') }]);
  });

  it('pushes once this federator has already signed', async () => {
    const { coordinator, federation, strategy, wallet } = await build();
    federation.proposedTxHex = TX_HEX;
    federation.signedBy.add(FEDERATOR);
    federation.signatures = [sig('pubA'), sig('pubB')];

    await coordinator.coordinate(IDENTITY, strategy);

    expect(wallet.pushed).toEqual([{ txHex: TX_HEX, signatures: [sig('pubA'), sig('pubB')] }]);
    expect(federation.submitted).toEqual([
      { kind: 'outcome', identity: IDENTITY, sent: true, hathorTxId: `pushed-${TX_HEX}` },
    ]);
  });

  it('never proposes when this federator is not at multisig order 1', async () => {
    // Every federator runs the same routine; letting more than one propose would put competing
    // proposals on chain for the same transfer.
    const { coordinator, federation, strategy } = await build({ multisigOrder: 2 });

    expect(await coordinator.coordinate(IDENTITY, strategy)).toBe(true);
    expect(strategy.build).not.toHaveBeenCalled();
    expect(federation.submitted).toEqual([]);
  });

  it('still signs and pushes at order 2 - only proposing is restricted', async () => {
    const { coordinator, federation, strategy, wallet } = await build({ multisigOrder: 2 });
    federation.proposedTxHex = TX_HEX;
    wallet.signatures.set(TX_HEX, sig('pubB'));

    await coordinator.coordinate(IDENTITY, strategy);
    expect(federation.submitted).toHaveLength(1);
    expect(federation.submitted[0]?.kind).toBe('signature');
  });
});

describe('ProposalCoordinator: validation gates every step', () => {
  it('refuses to propose an invalid transaction', async () => {
    const { coordinator, federation, strategy, metrics, logger } = await build();
    (strategy.validate as jest.Mock).mockResolvedValue({ valid: false, reason: 'Not a mint operation.' });

    expect(await coordinator.coordinate(IDENTITY, strategy)).toBe(false);
    expect(federation.submitted).toEqual([]);
    expect(metrics.rejectedProposals).toEqual(['0xHASH']);
    expect(logger.at('error')).toMatch(/Not a mint operation/);
  });

  it('refuses to sign an invalid proposal', async () => {
    const { coordinator, federation, strategy, metrics } = await build();
    federation.proposedTxHex = TX_HEX;
    (strategy.validate as jest.Mock).mockResolvedValue({ valid: false, reason: 'wrong amount' });

    await expect(coordinator.coordinate(IDENTITY, strategy)).rejects.toThrow(/Refusing to sign/);
    expect(metrics.counts.signatureRejected).toBe(1);
  });

  it('refuses to push an invalid proposal even with quorum reached', async () => {
    const { coordinator, federation, strategy, wallet } = await build();
    federation.proposedTxHex = TX_HEX;
    federation.signedBy.add(FEDERATOR);
    federation.signatures = [sig('pubA'), sig('pubB')];
    (strategy.validate as jest.Mock).mockResolvedValue({ valid: false, reason: 'tampered' });

    await expect(coordinator.coordinate(IDENTITY, strategy)).rejects.toThrow(/Refusing to push/);
    expect(wallet.pushed).toEqual([]);
  });

  it('re-validates a proposal it did not build itself', async () => {
    // The proposal on chain came from another federator. Taking it on trust is the whole attack.
    const { coordinator, federation, strategy, wallet } = await build();
    federation.proposedTxHex = TX_HEX;
    wallet.signatures.set(TX_HEX, sig('pubA'));

    await coordinator.coordinate(IDENTITY, strategy);
    expect(strategy.validate).toHaveBeenCalledWith(TX_HEX, IDENTITY, 'tx-id-1');
  });
});

describe('ProposalCoordinator: signing', () => {
  it('retries when the wallet returns a partial signature, then gives up without signing', async () => {
    const { coordinator, federation, strategy, wallet, metrics, clock, logger } = await build();
    federation.proposedTxHex = TX_HEX;
    wallet.signatures.set(TX_HEX, partialSig('pubA'));

    await coordinator.coordinate(IDENTITY, strategy);

    expect(clock.waits).toEqual([5_000, 5_000]); // three attempts, two waits between them
    expect(federation.submitted).toEqual([]);
    expect(metrics.counts.signatureRejected).toBe(1);
    expect(logger.at('warn')).toMatch(/could not produce a signature covering all 2 input/);
  });

  it('accepts a signature that becomes complete on a later attempt', async () => {
    const { coordinator, federation, strategy, wallet } = await build();
    federation.proposedTxHex = TX_HEX;

    let attempt = 0;
    wallet.getMySignatures = async () => {
      attempt += 1;
      return attempt < 3 ? partialSig('pubA') : sig('pubA');
    };

    await coordinator.coordinate(IDENTITY, strategy);
    expect(federation.submitted).toEqual([{ kind: 'signature', identity: IDENTITY, signature: sig('pubA') }]);
  });

  it('retries when the wallet throws, rather than treating it as a refusal', async () => {
    const { coordinator, federation, strategy, wallet, clock } = await build();
    federation.proposedTxHex = TX_HEX;

    let attempt = 0;
    wallet.getMySignatures = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new WalletOperationError('wallet busy');
      }
      return sig('pubA');
    };

    await coordinator.coordinate(IDENTITY, strategy);
    expect(clock.waits).toEqual([5_000]);
    expect(federation.submitted).toHaveLength(1);
  });

  it('records a failed signature submission rather than counting it as sent', async () => {
    const { coordinator, federation, strategy, wallet, metrics } = await build();
    federation.proposedTxHex = TX_HEX;
    federation.failSubmit = 'signature';
    wallet.signatures.set(TX_HEX, sig('pubA'));

    await coordinator.coordinate(IDENTITY, strategy);
    expect(metrics.counts.signatureSubmitted).toBeUndefined();
    expect(metrics.counts.signatureRejected).toBe(1);
  });
});

describe('ProposalCoordinator: pushing', () => {
  async function readyToPush(overrides: { numSignatures?: number } = {}) {
    const context = await build(overrides);
    context.federation.proposedTxHex = TX_HEX;
    context.federation.signedBy.add(FEDERATOR);
    return context;
  }

  it('waits while fewer signatures than the quorum have been collected', async () => {
    const { coordinator, federation, strategy, wallet } = await readyToPush();
    federation.signatures = [sig('pubA')];

    await coordinator.coordinate(IDENTITY, strategy);
    expect(wallet.pushed).toEqual([]);
    expect(federation.submitted).toEqual([]);
  });

  it('waits when the quorum is met in count but not in coverage', async () => {
    // Selecting by array position alone would pick the partial one and break the redeem script.
    const { coordinator, federation, strategy, wallet, logger } = await readyToPush();
    federation.signatures = [partialSig('pubA'), sig('pubB')];

    await coordinator.coordinate(IDENTITY, strategy);
    expect(wallet.pushed).toEqual([]);
    expect(logger.at('warn')).toMatch(/Only 1\/2 stored signatures/);
  });

  it('selects only complete signatures, skipping partial ones in between', async () => {
    const { coordinator, federation, strategy, wallet } = await readyToPush();
    federation.signatures = [partialSig('pubA'), sig('pubB'), sig('pubC')];

    await coordinator.coordinate(IDENTITY, strategy);
    expect(wallet.pushed[0]?.signatures).toEqual([sig('pubB'), sig('pubC')]);
  });

  it('sends exactly the quorum, never more', async () => {
    // assemblePartialTransaction accepts exactly numSignatures entries.
    const { coordinator, federation, strategy, wallet } = await readyToPush({ numSignatures: 2 });
    federation.signatures = [sig('pubA'), sig('pubB'), sig('pubC'), sig('pubD')];

    await coordinator.coordinate(IDENTITY, strategy);
    expect(wallet.pushed[0]?.signatures).toHaveLength(2);
  });

  it('marks a transfer for manual check when its inputs were already spent', async () => {
    const { coordinator, federation, strategy, wallet, metrics } = await readyToPush();
    federation.signatures = [sig('pubA'), sig('pubB')];
    wallet.pushFailure = 'Invalid transaction. At least one of your inputs has already been spent.';

    await coordinator.coordinate(IDENTITY, strategy);

    expect(federation.submitted).toEqual([
      { kind: 'outcome', identity: IDENTITY, sent: false, hathorTxId: MANUAL_CHECK_MARKER },
    ]);
    expect(metrics.counts.pushRejected).toBe(1);
  });

  it('records nothing on chain for an unrecognised push failure, so it can be retried', async () => {
    // The previous code fell through and wrote the outcome with an undefined transaction id,
    // producing the literal "0xundefined" and failing inside ABI encoding.
    const { coordinator, federation, strategy, wallet } = await readyToPush();
    federation.signatures = [sig('pubA'), sig('pubB')];
    wallet.pushFailure = 'tx-mining service unavailable';

    await expect(coordinator.coordinate(IDENTITY, strategy)).rejects.toThrow(/tx-mining service unavailable/);
    expect(federation.submitted).toEqual([]);
    expect(federation.processed).toBe(false);
  });

  it('counts a push as submitted only once the outcome is recorded', async () => {
    const { coordinator, federation, strategy, metrics } = await readyToPush();
    federation.signatures = [sig('pubA'), sig('pubB')];
    federation.failSubmit = 'outcome';

    await coordinator.coordinate(IDENTITY, strategy);
    expect(metrics.counts.pushSubmitted).toBeUndefined();
    expect(metrics.counts.pushRejected).toBe(1);
  });
});

describe('ProposalCoordinator: metrics honesty', () => {
  it('does not count a failed proposal as both a success and a failure', async () => {
    // The previous code bumped the success counter before inspecting the receipt.
    const { coordinator, federation, strategy, metrics } = await build();
    federation.failSubmit = 'proposal';

    expect(await coordinator.coordinate(IDENTITY, strategy)).toBe(false);
    expect(metrics.counts.proposalSubmitted).toBeUndefined();
    expect(metrics.counts.proposalRejected).toBe(1);
  });
});
