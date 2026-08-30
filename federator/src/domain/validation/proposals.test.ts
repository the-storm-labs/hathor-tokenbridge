import { input, meltAuthorityInput, mintAuthorityInput, output, tx } from '../testSupport/builders';
import {
  validateMeltProposal,
  validateMintProposal,
  validateOriginTransaction,
  validateTransferProposal,
} from './proposals';

const RECEIVER = 'HRECEIVER';
const receiverOutput = (value: bigint, token = 'TOKEN') =>
  output({ value, token, decoded: { type: 'P2PKH', address: RECEIVER, timelock: null } });

describe('validateMintProposal', () => {
  const validMint = tx({
    inputs: [mintAuthorityInput()],
    outputs: [receiverOutput(500n)],
  });

  it('accepts a proposal minting exactly the locked amount', () => {
    expect(validateMintProposal(validMint, { token: 'TOKEN', amount: 500n })).toEqual({ valid: true });
  });

  it('rejects a proposal without the mint authority', () => {
    const noAuthority = tx({ inputs: [], outputs: [receiverOutput(500n)] });
    const result = validateMintProposal(noAuthority, { token: 'TOKEN', amount: 500n });
    expect(result).toMatchObject({ valid: false });
    expect(result).toHaveProperty('reason', expect.stringMatching(/mint authority/));
  });

  it('rejects a proposal that does not actually mint', () => {
    const notAMint = tx({
      inputs: [mintAuthorityInput(), input({ value: 500n })],
      outputs: [receiverOutput(500n)],
    });
    expect(validateMintProposal(notAMint, { token: 'TOKEN', amount: 500n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/Not a mint operation/),
    });
  });

  it('rejects a proposal minting more than was locked', () => {
    expect(validateMintProposal(validMint, { token: 'TOKEN', amount: 400n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/mints 500 .* locked 400/),
    });
  });

  it('rejects a proposal sweeping an unrelated token out of the multisig', () => {
    const sweeping = tx({
      inputs: [mintAuthorityInput()],
      outputs: [receiverOutput(500n), output({ token: 'OTHER', mine: false, value: 1n })],
    });
    expect(validateMintProposal(sweeping, { token: 'TOKEN', amount: 500n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/other than TOKEN/),
    });
  });

  it('rejects a mint of a token other than the one expected', () => {
    const wrongToken = tx({ inputs: [mintAuthorityInput('OTHER')], outputs: [receiverOutput(500n, 'OTHER')] });
    expect(validateMintProposal(wrongToken, { token: 'TOKEN', amount: 500n })).toMatchObject({ valid: false });
  });
});

describe('validateMeltProposal', () => {
  const validMelt = tx({
    inputs: [meltAuthorityInput(), input({ value: 500n })],
    outputs: [],
  });

  it('accepts a proposal melting exactly the amount that arrived', () => {
    expect(validateMeltProposal(validMelt, { token: 'TOKEN', amount: 500n })).toEqual({ valid: true });
  });

  it('rejects a proposal without the melt authority', () => {
    const noAuthority = tx({ inputs: [input({ value: 500n })], outputs: [] });
    expect(validateMeltProposal(noAuthority, { token: 'TOKEN', amount: 500n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/melt authority/),
    });
  });

  it('rejects a proposal that does not actually melt', () => {
    const notAMelt = tx({ inputs: [meltAuthorityInput()], outputs: [output({ value: 500n })] });
    expect(validateMeltProposal(notAMelt, { token: 'TOKEN', amount: 500n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/Not a melt operation/),
    });
  });

  it('rejects a proposal melting more than arrived', () => {
    expect(validateMeltProposal(validMelt, { token: 'TOKEN', amount: 400n })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/melts 500 .* moved 400/),
    });
  });

  it('accepts a melt that returns change to the multisig', () => {
    const withChange = tx({
      inputs: [meltAuthorityInput(), input({ value: 800n })],
      outputs: [output({ value: 300n })],
    });
    expect(validateMeltProposal(withChange, { token: 'TOKEN', amount: 500n })).toEqual({ valid: true });
  });
});

describe('validateTransferProposal', () => {
  const validTransfer = tx({
    inputs: [input({ value: 800n })],
    outputs: [receiverOutput(500n), output({ value: 300n })], // 300 change back to the multisig
  });

  it('accepts a proposal paying the receiver the locked amount', () => {
    expect(validateTransferProposal(validTransfer, { token: 'TOKEN', amount: 500n, receiver: RECEIVER })).toEqual({
      valid: true,
    });
  });

  it('rejects a proposal that changes the supply', () => {
    const minting = tx({ inputs: [mintAuthorityInput()], outputs: [receiverOutput(500n)] });
    expect(validateTransferProposal(minting, { token: 'TOKEN', amount: 500n, receiver: RECEIVER })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/Not a transfer operation/),
    });
  });

  it('rejects a proposal that nets to zero but pays the wrong address', () => {
    // The whole reason the receiver's own total is checked: the net balance says nothing about
    // who got paid.
    const wrongPayee = tx({
      inputs: [input({ value: 800n })],
      outputs: [
        output({ value: 500n, decoded: { type: 'P2PKH', address: 'ATTACKER', timelock: null } }),
        output({ value: 300n }),
      ],
    });
    expect(validateTransferProposal(wrongPayee, { token: 'TOKEN', amount: 500n, receiver: RECEIVER })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/pays 0 .* to HRECEIVER/),
    });
  });

  it('rejects a proposal paying the receiver the wrong amount', () => {
    expect(validateTransferProposal(validTransfer, { token: 'TOKEN', amount: 400n, receiver: RECEIVER })).toMatchObject(
      { valid: false, reason: expect.stringMatching(/pays 500 .* locked 400/) },
    );
  });

  it('rejects a transfer proposal sweeping an unrelated token', () => {
    const sweeping = tx({
      inputs: [input({ value: 800n })],
      outputs: [receiverOutput(500n), output({ value: 300n }), output({ token: 'OTHER', mine: false, value: 1n })],
    });
    expect(validateTransferProposal(sweeping, { token: 'TOKEN', amount: 500n, receiver: RECEIVER })).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/other than TOKEN/),
    });
  });

  it('sums multiple outputs to the same receiver', () => {
    const split = tx({
      inputs: [input({ value: 800n })],
      outputs: [receiverOutput(200n), receiverOutput(300n), output({ value: 300n })],
    });
    expect(validateTransferProposal(split, { token: 'TOKEN', amount: 500n, receiver: RECEIVER })).toEqual({
      valid: true,
    });
  });
});

describe('validateOriginTransaction', () => {
  it('accepts a settled version-1 transaction', () => {
    expect(validateOriginTransaction(tx({ txId: 'abc' }))).toEqual({ valid: true });
  });

  it('rejects a voided transaction', () => {
    expect(validateOriginTransaction(tx({ txId: 'abc', isVoided: true }))).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/voided/),
    });
  });

  it('rejects a transaction of another version', () => {
    // Version 1 is a regular transaction; anything else is a block or a different structure.
    expect(validateOriginTransaction(tx({ txId: 'abc', version: 3 }))).toMatchObject({
      valid: false,
      reason: expect.stringMatching(/version 3/),
    });
  });
});
