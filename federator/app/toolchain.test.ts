/**
 * Scaffold smoke test: guards the two toolchain prerequisites the rest of the migration is built
 * on. Both are silent failures if they regress - a wrong `target` turns bigint literals into a
 * compile error only once real domain code uses them, and a missing wallet-lib turns into a
 * runtime crash only at wallet bootstrap.
 */
describe('app toolchain', () => {
  it('compiles bigint literals (requires target >= ES2020)', () => {
    const amount = 1_000_000n;
    expect(amount * 2n).toBe(2_000_000n);
    expect(BigInt('42')).toBe(42n);
  });

  it('resolves @hathor/wallet-lib at the version the migration was planned against', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version } = require('@hathor/wallet-lib/package.json') as { version: string };
    expect(version).toBe('4.1.0');
  });

  it('exposes the wallet-lib entry points the adapter will build on', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('@hathor/wallet-lib');
    expect(typeof lib.HathorWallet).toBe('function');
    expect(typeof lib.SendTransaction).toBe('function');
    expect(lib.transactionUtils).toBeDefined();
    expect(lib.walletUtils).toBeDefined();
  });
});
