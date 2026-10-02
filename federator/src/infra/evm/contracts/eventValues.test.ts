import { fieldString } from './eventValues';

describe('fieldString', () => {
  it('passes strings through and stringifies numbers, bigints and booleans', () => {
    expect(fieldString('0xabc')).toBe('0xabc');
    expect(fieldString(42)).toBe('42');
    expect(fieldString(10n ** 20n)).toBe('100000000000000000000');
    expect(fieldString(true)).toBe('true');
  });

  it('falls back for absent or non-scalar values instead of "[object Object]"', () => {
    expect(fieldString(undefined)).toBe('');
    expect(fieldString(null, '0')).toBe('0');
    expect(fieldString({ some: 'object' })).toBe('');
  });
});
