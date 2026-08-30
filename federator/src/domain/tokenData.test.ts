import { InvalidTransactionError } from './errors';
import {
  assertNoForeignTokenOutputs,
  balanceOf,
  isAuthority,
  isMeltAuthority,
  isMintAuthority,
  readBridgedToken,
  sumByAddressAndToken,
  transactionEffect,
} from './tokenData';
import {
  AUTHORITY_TOKEN_DATA,
  MELT_AUTHORITY_VALUE,
  MINT_AUTHORITY_VALUE,
  input,
  meltAuthorityInput,
  mintAuthorityInput,
  output,
} from './testSupport/builders';

describe('authority masks', () => {
  it('recognises an authority output by its token_data bit', () => {
    expect(isAuthority(AUTHORITY_TOKEN_DATA)).toBe(true);
    expect(isAuthority(1)).toBe(false);
    expect(isAuthority(0)).toBe(false);
  });

  it('distinguishes mint from melt by the value bit field', () => {
    expect(isMintAuthority(AUTHORITY_TOKEN_DATA, MINT_AUTHORITY_VALUE)).toBe(true);
    expect(isMeltAuthority(AUTHORITY_TOKEN_DATA, MINT_AUTHORITY_VALUE)).toBe(false);

    expect(isMeltAuthority(AUTHORITY_TOKEN_DATA, MELT_AUTHORITY_VALUE)).toBe(true);
    expect(isMintAuthority(AUTHORITY_TOKEN_DATA, MELT_AUTHORITY_VALUE)).toBe(false);
  });

  it('recognises an output granting both authorities at once', () => {
    const both = MINT_AUTHORITY_VALUE | MELT_AUTHORITY_VALUE;
    expect(isMintAuthority(AUTHORITY_TOKEN_DATA, both)).toBe(true);
    expect(isMeltAuthority(AUTHORITY_TOKEN_DATA, both)).toBe(true);
  });

  it('does not treat a plain output as an authority however large its value', () => {
    expect(isMintAuthority(1, MINT_AUTHORITY_VALUE)).toBe(false);
    expect(isMeltAuthority(1, 10n ** 20n)).toBe(false);
  });
});

describe('transactionEffect', () => {
  it('reports a mint as a positive balance', () => {
    const effect = transactionEffect({
      inputs: [mintAuthorityInput()],
      outputs: [output({ value: 500n })],
    });
    expect(balanceOf(effect, 'TOKEN')).toBe(500n);
    expect(effect.canMint.has('TOKEN')).toBe(true);
    expect(effect.canMelt.has('TOKEN')).toBe(false);
  });

  it('reports a melt as a negative balance', () => {
    const effect = transactionEffect({
      inputs: [meltAuthorityInput(), input({ value: 500n })],
      outputs: [],
    });
    expect(balanceOf(effect, 'TOKEN')).toBe(-500n);
    expect(effect.canMelt.has('TOKEN')).toBe(true);
  });

  it('reports a transfer as a zero balance', () => {
    const effect = transactionEffect({
      inputs: [input({ value: 500n })],
      outputs: [
        output({ value: 200n, decoded: { type: 'P2PKH', address: 'RECEIVER', timelock: null } }),
        output({ value: 300n }),
      ],
    });
    expect(balanceOf(effect, 'TOKEN')).toBe(0n);
  });

  it('excludes authority values from the balance', () => {
    // An authority output's value is a bit field, not an amount. Counting it would corrupt the
    // total - and the melt authority's value of 2 would look like two units of the token.
    const effect = transactionEffect({
      inputs: [meltAuthorityInput()],
      outputs: [output({ tokenData: AUTHORITY_TOKEN_DATA, value: MELT_AUTHORITY_VALUE })],
    });
    expect(balanceOf(effect, 'TOKEN')).toBe(0n);
  });

  it('keeps tokens separate', () => {
    const effect = transactionEffect({
      inputs: [input({ token: 'A', value: 10n })],
      outputs: [output({ token: 'B', value: 7n })],
    });
    expect(balanceOf(effect, 'A')).toBe(-10n);
    expect(balanceOf(effect, 'B')).toBe(7n);
    expect(balanceOf(effect, 'C')).toBe(0n);
  });

  it('stays exact for values beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 2n ** 70n;
    const effect = transactionEffect({ inputs: [], outputs: [output({ value: huge })] });
    expect(balanceOf(effect, 'TOKEN')).toBe(huge);
  });
});

describe('sumByAddressAndToken', () => {
  it('totals outputs per address and token', () => {
    const totals = sumByAddressAndToken([
      output({ value: 10n, decoded: { type: 'P2PKH', address: 'ALICE', timelock: null } }),
      output({ value: 5n, decoded: { type: 'P2PKH', address: 'ALICE', timelock: null } }),
      output({ value: 7n, decoded: { type: 'P2PKH', address: 'BOB', timelock: null } }),
      output({ value: 3n, token: 'OTHER', decoded: { type: 'P2PKH', address: 'ALICE', timelock: null } }),
    ]);
    expect(totals.get('ALICE:TOKEN')).toBe(15n);
    expect(totals.get('BOB:TOKEN')).toBe(7n);
    expect(totals.get('ALICE:OTHER')).toBe(3n);
  });

  it('skips outputs with no decoded address, such as data outputs', () => {
    const totals = sumByAddressAndToken([output({ value: 10n, decoded: { timelock: null } })]);
    expect(totals.size).toBe(0);
  });
});

describe('readBridgedToken', () => {
  const fundingInput = input({ token: 'TOKEN', decoded: { type: 'P2PKH', address: 'SENDER', timelock: null } });

  it('reads the token, sender, receiver and total moved into the multisig', () => {
    const result = readBridgedToken([fundingInput], [output({ value: 60n }), output({ value: 40n })]);
    expect(result).toEqual({
      tokenAddress: 'TOKEN',
      senderAddress: 'SENDER',
      receiverAddress: 'MULTISIG',
      amount: 100n,
    });
  });

  it('returns undefined when nothing goes to the multisig', () => {
    const result = readBridgedToken(
      [fundingInput],
      [output({ decoded: { type: 'P2PKH', address: 'SOMEONE', timelock: null } })],
    );
    expect(result).toBeUndefined();
  });

  it('ignores already-spent outputs by default', () => {
    expect(readBridgedToken([fundingInput], [output({ spentBy: 'sometx' })])).toBeUndefined();
  });

  it('ignores timelocked outputs by default', () => {
    expect(
      readBridgedToken([fundingInput], [output({ decoded: { type: 'MultiSig', address: 'MULTISIG', timelock: 123 } })]),
    ).toBeUndefined();
  });

  it('can include spent and timelocked outputs when asked', () => {
    // The history path reads a transaction after the fact, when its outputs may already be spent.
    const result = readBridgedToken([fundingInput], [output({ spentBy: 'sometx' })], { requireUnspent: false });
    expect(result?.amount).toBe(100n);
  });

  it('rejects a transaction moving two different tokens into the multisig', () => {
    expect(() => readBridgedToken([fundingInput], [output({ token: 'A' }), output({ token: 'B' })])).toThrow(
      InvalidTransactionError,
    );
  });

  it('rejects a transaction paying two different multisig addresses', () => {
    expect(() =>
      readBridgedToken(
        [fundingInput],
        [output(), output({ decoded: { type: 'MultiSig', address: 'OTHER_MULTISIG', timelock: null } })],
      ),
    ).toThrow(InvalidTransactionError);
  });

  it('rejects a MultiSig output that carries a token but no decoded address', () => {
    expect(() => readBridgedToken([fundingInput], [output({ decoded: { type: 'MultiSig', timelock: null } })])).toThrow(
      InvalidTransactionError,
    );
  });

  it('rejects a transaction with no input funding the token', () => {
    expect(() => readBridgedToken([input({ token: 'SOMETHING_ELSE' })], [output()])).toThrow(InvalidTransactionError);
  });
});

describe('assertNoForeignTokenOutputs', () => {
  it('accepts outputs of only the bridged token', () => {
    expect(() => assertNoForeignTokenOutputs([output({ token: 'TOKEN' })], 'TOKEN')).not.toThrow();
  });

  it('rejects an unspent output of another token that is not ours', () => {
    expect(() => assertNoForeignTokenOutputs([output({ token: 'OTHER', mine: false })], 'TOKEN')).toThrow(
      InvalidTransactionError,
    );
  });

  it('allows another token when the output is our own', () => {
    // Change returning to the multisig is not a foreign output.
    expect(() => assertNoForeignTokenOutputs([output({ token: 'OTHER', mine: true })], 'TOKEN')).not.toThrow();
  });

  it('ignores an already-spent output of another token', () => {
    expect(() =>
      assertNoForeignTokenOutputs([output({ token: 'OTHER', mine: false, spentBy: 'tx' })], 'TOKEN'),
    ).not.toThrow();
  });
});
