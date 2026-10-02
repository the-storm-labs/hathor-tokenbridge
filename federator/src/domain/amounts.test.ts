import { BRIDGE_NORMALISED_DECIMALS, toBridgeUnit, toEvmAmount, toHathorAmount } from './amounts';
import { AmountConversionError } from './errors';

describe('toHathorAmount', () => {
  it('drops the precision an 18-decimal token has beyond Hathor two decimals', () => {
    // 1.5 of an 18-decimal token -> 150 (i.e. 1.50 at Hathor's two decimals)
    expect(toHathorAmount(1_500_000_000_000_000_000n, 18)).toBe(150n);
  });

  it('truncates rather than rounds, so the bridge never credits more than was locked', () => {
    // 1.999999... of an 18-decimal token is 1.99 on Hathor, not 2.00
    expect(toHathorAmount(1_999_999_999_999_999_999n, 18)).toBe(199n);
  });

  it('is exact for a token that already has two decimals', () => {
    expect(toHathorAmount(4_242n, 2)).toBe(4_242n);
  });

  it('scales up for a token with fewer decimals than Hathor', () => {
    expect(toHathorAmount(7n, 0)).toBe(700n);
    expect(toHathorAmount(7n, 1)).toBe(70n);
  });

  it('survives amounts beyond Number.MAX_SAFE_INTEGER', () => {
    // The previous implementation ended in parseInt, so a result above 2^53 came back rounded.
    // 10^21 wei of an 18-decimal token is 1000 tokens -> 100000 at two decimals.
    const huge = 10n ** 21n;
    expect(toHathorAmount(huge, 18)).toBe(100_000n);

    // And a Hathor-side amount that itself exceeds the safe integer range stays exact.
    const beyondSafe = 10n ** 18n * 12_345_678_901n;
    expect(toHathorAmount(beyondSafe, 18)).toBe(1_234_567_890_100n);
    expect(Number.isSafeInteger(Number(1_234_567_890_100n))).toBe(true);
    expect(toHathorAmount(10n ** 36n, 18)).toBe(10n ** 20n);
  });

  it('does not round up past the safe integer range, as the string-slicing version did', () => {
    // Differential run against convertToHathorDecimals found four divergences, all of them the
    // legacy parseInt losing precision - and in two cases rounding UP, which would have credited
    // more than was locked. Only reachable at amounts far beyond any real token supply, but the
    // arithmetic is exact now regardless.
    expect(toHathorAmount(1_999_999_999_999_999_999n, 2)).toBe(1_999_999_999_999_999_999n); // was 2e18
    expect(toHathorAmount(123_456_789_012_345_678_901n, 6)).toBe(12_345_678_901_234_567n); // was ...568
    expect(toHathorAmount(10n ** 21n, 2)).toBe(10n ** 21n); // was the float 1e+21
  });

  it('rejects an amount that would convert to nothing', () => {
    // 0.001 of a 6-decimal token cannot be represented at two decimals.
    expect(() => toHathorAmount(1_000n, 6)).toThrow(AmountConversionError);
    expect(() => toHathorAmount(0n, 18)).toThrow(AmountConversionError);
  });

  it('rejects a negative amount', () => {
    expect(() => toHathorAmount(-1n, 18)).toThrow(AmountConversionError);
  });

  it('rejects nonsensical decimals', () => {
    expect(() => toHathorAmount(1n, -1)).toThrow(AmountConversionError);
    expect(() => toHathorAmount(1n, 1.5)).toThrow(AmountConversionError);
    expect(() => toHathorAmount(1n, 200)).toThrow(AmountConversionError);
  });
});

describe('toEvmAmount', () => {
  it('scales Hathor two decimals up to the token precision', () => {
    expect(toEvmAmount(150n, 18)).toBe(1_500_000_000_000_000_000n);
  });

  it('uses the token decimals rather than assuming 18', () => {
    // convertToEvmDecimals hardcoded 10^16, i.e. it assumed every token had 18 decimals.
    expect(toEvmAmount(150n, 6)).toBe(1_500_000n);
    expect(toEvmAmount(150n, 2)).toBe(150n);
  });

  it('round-trips with toHathorAmount for amounts Hathor can represent', () => {
    for (const decimals of [2, 6, 8, 18]) {
      expect(toHathorAmount(toEvmAmount(12_345n, decimals), decimals)).toBe(12_345n);
    }
  });

  it('rejects a negative amount instead of returning undefined', () => {
    // convertToEvmDecimals caught its own errors, logged, and returned undefined - so a failed
    // conversion travelled onward as a missing amount rather than stopping the transfer.
    expect(() => toEvmAmount(-1n, 18)).toThrow(AmountConversionError);
  });

  it('converts zero without complaint, unlike the Hathor direction', () => {
    expect(toEvmAmount(0n, 18)).toBe(0n);
  });

  it('scales down for a token with fewer decimals than Hathor', () => {
    // A 0-decimal token cannot hold Hathor's cents, so the fractional part is dropped.
    expect(toEvmAmount(700n, 0)).toBe(7n);
    expect(toEvmAmount(750n, 1)).toBe(75n);
    expect(toEvmAmount(799n, 0)).toBe(7n);
  });
});

describe('toBridgeUnit', () => {
  it('scales a 6-decimal token up to the bridge internal unit', () => {
    // 10 USDC. The AllowTokens limits are stored in this unit, and the release path divides a
    // voted amount back down by 10^(18-decimals) - so anything compared against a limit, or voted
    // on, has to be expressed here first.
    expect(toBridgeUnit(10_000_000n, 6)).toBe(10n * 10n ** 18n);
  });

  it('leaves an 18-decimal token alone, which is why the bug hid', () => {
    expect(toBridgeUnit(10n * 10n ** 18n, 18)).toBe(10n * 10n ** 18n);
  });

  it('is a factor of a million out for USDC if the token decimals are used instead', () => {
    const naive = 10_000_000n; // what comparing the raw Cross amount against the limits does
    expect(toBridgeUnit(10_000_000n, 6) / naive).toBe(10n ** 12n);
  });

  it('keeps amounts below a hundredth of a token, unlike a round trip through Hathor', () => {
    // Routing through Hathor's two decimals would floor this to zero and then throw.
    expect(toBridgeUnit(50n, 18)).toBe(50n);
    expect(toBridgeUnit(1n, 18)).toBe(1n);
  });

  it('scales down for a token with more decimals than the bridge unit', () => {
    expect(toBridgeUnit(10n ** 20n, 20)).toBe(10n ** 18n);
  });

  it('normalises to 18 decimals, whatever the token', () => {
    expect(BRIDGE_NORMALISED_DECIMALS).toBe(18);
    for (const decimals of [2, 6, 8, 18]) {
      expect(toBridgeUnit(5n * 10n ** BigInt(decimals), decimals)).toBe(5n * 10n ** 18n);
    }
  });
});
