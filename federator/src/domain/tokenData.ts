import { InvalidTransactionError } from './errors';
import type { BridgedToken, DecodedTx, TransactionEffect, TxInput, TxOutput } from './types';

/**
 * Bit masks on an output's `token_data` / `value`. An authority output does not carry a balance:
 * its value is a bit field saying which authorities it grants.
 */
const TOKEN_AUTHORITY_MASK = 0b1000_0000;
const TOKEN_MINT_MASK = 0b0000_0001n;
const TOKEN_MELT_MASK = 0b0000_0010n;

export function isAuthority(tokenData: number): boolean {
  return (tokenData & TOKEN_AUTHORITY_MASK) > 0;
}

export function isMintAuthority(tokenData: number, value: bigint): boolean {
  return isAuthority(tokenData) && (value & TOKEN_MINT_MASK) > 0n;
}

export function isMeltAuthority(tokenData: number, value: bigint): boolean {
  return isAuthority(tokenData) && (value & TOKEN_MELT_MASK) > 0n;
}

/**
 * The net effect of a transaction: how much of each token it creates or destroys, and which
 * authorities it spends.
 *
 * Authority outputs are excluded from the balances - their `value` is a bit field, not an amount,
 * so counting it would corrupt the total. Reading the balance sign is how a proposal is classified:
 * positive means a mint, negative a melt, zero a transfer.
 */
export function transactionEffect(tx: Pick<DecodedTx, 'inputs' | 'outputs'>): TransactionEffect {
  const balances = new Map<string, bigint>();
  const canMint = new Set<string>();
  const canMelt = new Set<string>();

  const add = (token: string, delta: bigint) => {
    balances.set(token, (balances.get(token) ?? 0n) + delta);
  };

  for (const output of tx.outputs) {
    if (isAuthority(output.tokenData)) {
      continue;
    }
    add(output.token, output.value);
  }

  for (const input of tx.inputs) {
    if (isAuthority(input.tokenData)) {
      if (isMintAuthority(input.tokenData, input.value)) {
        canMint.add(input.token);
      } else if (isMeltAuthority(input.tokenData, input.value)) {
        canMelt.add(input.token);
      }
      continue;
    }
    add(input.token, -input.value);
  }

  return { balances, canMint, canMelt };
}

/** Convenience reader: the net balance for one token, zero when the token does not appear. */
export function balanceOf(effect: TransactionEffect, token: string): bigint {
  return effect.balances.get(token) ?? 0n;
}

/**
 * Sums output values per `address:token` pair.
 *
 * Used to check that a transfer proposal pays the intended receiver the intended amount, rather
 * than merely moving the right total somewhere.
 */
export function sumByAddressAndToken(outputs: readonly TxOutput[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const output of outputs) {
    const address = output.decoded.address;
    if (address === undefined) {
      continue;
    }
    const key = `${address}:${output.token}`;
    totals.set(key, (totals.get(key) ?? 0n) + output.value);
  }
  return totals;
}

/**
 * Reads the single custom token a transaction moves into the bridge's multisig.
 *
 * Only unspent, non-timelocked MultiSig outputs count: those are the funds the bridge actually
 * controls. A transaction carrying more than one token, or paying more than one destination, is
 * rejected outright rather than partially honoured - the bridge has no way to represent that on
 * the other side.
 *
 * @returns the token, or undefined when the transaction moves no custom token into the multisig.
 * @throws InvalidTransactionError when more than one token or destination is present.
 */
export function readBridgedToken(
  inputs: readonly TxInput[],
  outputs: readonly TxOutput[],
  options: { readonly requireUnspent?: boolean } = {},
): BridgedToken | undefined {
  const requireUnspent = options.requireUnspent ?? true;

  const candidates = outputs.filter(
    (output) =>
      Boolean(output.token) &&
      output.decoded.type === 'MultiSig' &&
      (!requireUnspent || output.spentBy === null || output.spentBy === undefined) &&
      (!requireUnspent || output.decoded.timelock === null || output.decoded.timelock === undefined),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  const first = candidates[0] as TxOutput;
  const receiverAddress = first.decoded.address;
  if (receiverAddress === undefined) {
    throw new InvalidTransactionError('A MultiSig output carrying a custom token has no decoded address.');
  }

  let amount = 0n;
  for (const candidate of candidates) {
    if (candidate.token !== first.token || candidate.decoded.address !== receiverAddress) {
      throw new InvalidTransactionError(
        'Invalid transaction: it moves more than one token, or pays more than one destination address.',
      );
    }
    amount += candidate.value;
  }

  const fundingInput = inputs.find((input) => input.token === first.token);
  const senderAddress = fundingInput?.decoded.address;
  if (senderAddress === undefined) {
    throw new InvalidTransactionError(
      `Invalid transaction: no input funds token ${first.token}, so it has no identifiable sender.`,
    );
  }

  return { tokenAddress: first.token, senderAddress, receiverAddress, amount };
}

/**
 * Rejects a proposal whose outputs move any token other than the one being bridged to someone
 * else's address. Guards against a proposal that looks correct for the bridged token while
 * quietly sweeping an unrelated token out of the multisig.
 */
export function assertNoForeignTokenOutputs(outputs: readonly TxOutput[], bridgedToken: string): void {
  const foreign = outputs.filter(
    (output) =>
      output.token !== bridgedToken &&
      (output.spentBy === null || output.spentBy === undefined) &&
      output.mine === false,
  );

  if (foreign.length > 0) {
    throw new InvalidTransactionError(
      `Invalid transaction: it moves ${foreign.length} output(s) of a token other than ${bridgedToken}.`,
    );
  }
}
