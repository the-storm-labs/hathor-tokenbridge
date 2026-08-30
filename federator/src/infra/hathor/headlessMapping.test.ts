import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mapTx, toBigInt } from './headlessMapping';

describe('toBigInt', () => {
  it('converts the JSON numbers the headless sends', () => {
    expect(toBigInt(0, 'v')).toBe(0n);
    expect(toBigInt(1760, 'v')).toBe(1760n);
  });

  it('treats an absent value as zero', () => {
    expect(toBigInt(undefined, 'v')).toBe(0n);
  });

  it('accepts a string, which loses nothing', () => {
    expect(toBigInt('123456789012345678901234567890', 'v')).toBe(123456789012345678901234567890n);
  });

  it('refuses a number that has already lost precision', () => {
    // Beyond 2^53 the JSON parser has already rounded. Converting quietly would launder that
    // loss into an exact-looking bigint, which is worse than failing.
    expect(() => toBigInt(Number.MAX_SAFE_INTEGER + 2, 'v')).toThrow(/precision is already lost/);
  });

  it('passes a bigint straight through', () => {
    expect(toBigInt(42n as unknown as number, 'v')).toBe(42n);
  });

  it('refuses a non-integer', () => {
    expect(() => toBigInt(1.5, 'v')).toThrow(/not an integer/);
  });
});

describe('mapTx', () => {
  it('maps a recorded decode response into the domain shape', () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, '../../testSupport/fixtures/txHexDecoded.json'), 'utf8'));
    const tx = mapTx(fixture.tx);

    expect(tx.inputs.length).toBeGreaterThan(0);
    for (const io of [...tx.inputs, ...tx.outputs]) {
      expect(typeof io.value).toBe('bigint');
      expect(typeof io.tokenData).toBe('number');
    }

    const first = tx.inputs[0];
    expect(first?.decoded.type).toBe('MultiSig');
    expect(first?.decoded.address).toBe('wXonH2U9Bys5EcYsFspZyBVqeTVQ3Htf4Q');
    // The decode endpoint reports `mine` on inputs as well as outputs; it is carried through
    // rather than dropped, since the wallet-lib adapter computes the same thing per input.
    expect(first?.mine).toBe(true);
  });

  it('accepts either spelling of token_data, on inputs as well as outputs', () => {
    // The decode endpoint emits both token_data and tokenData; history emits only the former.
    expect(mapTx({ outputs: [{ token_data: 129, value: 1 }] }).outputs[0]?.tokenData).toBe(129);
    expect(mapTx({ outputs: [{ tokenData: 129, value: 1 }] }).outputs[0]?.tokenData).toBe(129);
    expect(mapTx({ inputs: [{ token_data: 129, value: 1 }] }).inputs[0]?.tokenData).toBe(129);
    expect(mapTx({ inputs: [{ tokenData: 129, value: 1 }] }).inputs[0]?.tokenData).toBe(129);
    expect(mapTx({ inputs: [{ value: 1 }] }).inputs[0]?.tokenData).toBe(0);
  });

  it('carries spent_by and mine through to the domain names', () => {
    const tx = mapTx({ outputs: [{ value: 1, spent_by: 'abc', mine: false }] });
    expect(tx.outputs[0]?.spentBy).toBe('abc');
    expect(tx.outputs[0]?.mine).toBe(false);
  });

  it('maps the transaction-level fields', () => {
    const tx = mapTx({ tx_id: 'abc', version: 1, timestamp: 42, is_voided: true, inputs: [], outputs: [] });
    expect(tx).toMatchObject({ txId: 'abc', version: 1, timestamp: 42, isVoided: true });
  });

  it('tolerates a transaction with no inputs or outputs at all', () => {
    expect(mapTx({})).toMatchObject({ inputs: [], outputs: [] });
  });
});
