import type { DecodedTx, TxInput, TxOutput } from '../types';

/**
 * Builders for domain test fixtures. Every field has a sane default so a test only states the
 * part it is actually about - which keeps the assertions legible and stops an unrelated field
 * change from rewriting every test.
 */

/** token_data with the authority bit set. */
export const AUTHORITY_TOKEN_DATA = 0b1000_0001;
export const MINT_AUTHORITY_VALUE = 0b0000_0001n;
export const MELT_AUTHORITY_VALUE = 0b0000_0010n;

export function output(overrides: Partial<TxOutput> = {}): TxOutput {
  return {
    value: 100n,
    tokenData: 1,
    script: '',
    token: 'TOKEN',
    decoded: { type: 'MultiSig', address: 'MULTISIG', timelock: null },
    spentBy: null,
    ...overrides,
  };
}

export function input(overrides: Partial<TxInput> = {}): TxInput {
  return {
    value: 100n,
    tokenData: 1,
    script: '',
    token: 'TOKEN',
    decoded: { type: 'MultiSig', address: 'MULTISIG', timelock: null },
    ...overrides,
  };
}

export function mintAuthorityInput(token = 'TOKEN'): TxInput {
  return input({ token, tokenData: AUTHORITY_TOKEN_DATA, value: MINT_AUTHORITY_VALUE });
}

export function meltAuthorityInput(token = 'TOKEN'): TxInput {
  return input({ token, tokenData: AUTHORITY_TOKEN_DATA, value: MELT_AUTHORITY_VALUE });
}

export function tx(overrides: Partial<DecodedTx> = {}): DecodedTx {
  return { version: 1, isVoided: false, inputs: [], outputs: [], ...overrides };
}
