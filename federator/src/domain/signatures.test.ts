import { coversAllInputs, parseSignatureEntry, selectCompleteSignatures } from './signatures';

const PUBKEY_A = '031e98e64228360dd2616ee5a9e1831ab07638db40383eb7352607caa20f196a84';
const PUBKEY_B = '027488f1c32779648a556541044ff6a44a4d6eb6c58df57a2037a44c3394253113';

const complete = `${PUBKEY_A}|0:aaaa|1:bbbb`;
const partial = `${PUBKEY_B}|1:cccc`;

describe('parseSignatureEntry', () => {
  it('splits the pubkey from the signed input indices', () => {
    expect(parseSignatureEntry(complete)).toEqual({ pubkey: PUBKEY_A, indices: [0, 1] });
  });

  it('reports the indices a partial signature actually covers', () => {
    expect(parseSignatureEntry(partial)).toEqual({ pubkey: PUBKEY_B, indices: [1] });
  });

  it('handles an entry with no signatures at all', () => {
    expect(parseSignatureEntry(PUBKEY_A)).toEqual({ pubkey: PUBKEY_A, indices: [] });
  });

  it('ignores segments whose index is not a number', () => {
    expect(parseSignatureEntry(`${PUBKEY_A}|0:aaaa|x:bbbb`).indices).toEqual([0]);
  });

  it('does not choke on an empty string', () => {
    expect(parseSignatureEntry('')).toEqual({ pubkey: '', indices: [] });
  });
});

describe('coversAllInputs', () => {
  it.each([
    [complete, 2, true],
    [complete, 3, false], // covers 0 and 1, but the tx has three inputs
    [partial, 2, false],
    [partial, 1, false], // covers index 1, but index 0 is the one required
    [`${PUBKEY_A}|1:b|0:a`, 2, true], // order does not matter
  ])('%s over %i inputs -> %s', (entry, inputCount, expected) => {
    expect(coversAllInputs(entry, inputCount)).toBe(expected);
  });

  it('treats a duplicate index as covering only that index', () => {
    expect(coversAllInputs(`${PUBKEY_A}|0:a|0:a`, 2)).toBe(false);
  });
});

describe('selectCompleteSignatures', () => {
  it('keeps only the entries covering every input', () => {
    expect(selectCompleteSignatures([complete, partial], 2)).toEqual([complete]);
  });

  it('preserves the order of the entries it keeps', () => {
    const second = `${PUBKEY_B}|0:dddd|1:eeee`;
    expect(selectCompleteSignatures([complete, partial, second], 2)).toEqual([complete, second]);
  });

  it('returns nothing when no entry is complete', () => {
    expect(selectCompleteSignatures([partial], 2)).toEqual([]);
  });

  it('accepts every entry when the transaction has no inputs to cover', () => {
    // Degenerate, but it must not silently drop everything: with zero required indices, any
    // entry vacuously covers them all.
    expect(selectCompleteSignatures([complete, partial], 0)).toEqual([complete, partial]);
  });
});
