import { InvalidTransactionError } from '../errors';
import { assertNoForeignTokenOutputs, balanceOf, sumByAddressAndToken, transactionEffect } from '../tokenData';
import type { DecodedTx } from '../types';

/**
 * Whether a proposed Hathor transaction faithfully represents the cross-chain transfer it claims
 * to. These are the checks that stand between a federator and signing away the multisig's funds,
 * so they are pure functions over an already-decoded proposal: no network, no contracts, fully
 * enumerable from tests.
 *
 * A result is returned rather than thrown. The previous implementations threw bare `Error`s from
 * the middle of a mixed I/O-and-logic method, which made "invalid proposal" indistinguishable
 * from "the RPC call failed" at the call site - and those two must lead to opposite decisions.
 */
export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

const ok: ValidationResult = { valid: true };
const fail = (reason: string): ValidationResult => ({ valid: false, reason });

export interface MintExpectation {
  /** The token as it is known on Hathor. */
  readonly token: string;
  /** The amount, already converted to Hathor's precision. */
  readonly amount: bigint;
}

export interface MeltExpectation {
  readonly token: string;
  readonly amount: bigint;
}

export interface TransferExpectation {
  readonly token: string;
  readonly amount: bigint;
  /** The Hathor address that must receive the funds. */
  readonly receiver: string;
}

/**
 * A mint proposal must hold the mint authority, create tokens rather than move or destroy them,
 * and create exactly the amount that was locked on the EVM side.
 */
export function validateMintProposal(proposal: DecodedTx, expected: MintExpectation): ValidationResult {
  try {
    assertNoForeignTokenOutputs(proposal.outputs, expected.token);
  } catch (error) {
    return fail((error as InvalidTransactionError).message);
  }

  const effect = transactionEffect(proposal);

  if (!effect.canMint.has(expected.token)) {
    return fail(`The multisig does not hold the mint authority for token ${expected.token}.`);
  }

  const balance = balanceOf(effect, expected.token);
  if (balance <= 0n) {
    return fail(`Not a mint operation: the proposal's net balance for ${expected.token} is ${balance}.`);
  }
  if (balance !== expected.amount) {
    return fail(
      `Proposal mints ${balance} of ${expected.token} but the original transaction locked ${expected.amount}.`,
    );
  }

  return ok;
}

/**
 * A melt proposal must hold the melt authority and destroy exactly the amount that arrived at the
 * multisig on Hathor.
 *
 * Note the asymmetry with mint and transfer: no foreign-token-output check runs here, because the
 * melt path never had one. Preserved deliberately during extraction rather than quietly widened;
 * whether it should be added belongs with the melt flow itself, where the consequences are visible.
 */
export function validateMeltProposal(proposal: DecodedTx, expected: MeltExpectation): ValidationResult {
  const effect = transactionEffect(proposal);

  if (!effect.canMelt.has(expected.token)) {
    return fail(`The multisig does not hold the melt authority for token ${expected.token}.`);
  }

  const balance = balanceOf(effect, expected.token);
  if (balance >= 0n) {
    return fail(`Not a melt operation: the proposal's net balance for ${expected.token} is ${balance}.`);
  }

  const melted = -balance;
  if (melted !== expected.amount) {
    return fail(`Proposal melts ${melted} of ${expected.token} but the original transaction moved ${expected.amount}.`);
  }

  return ok;
}

/**
 * A transfer proposal must not change the total supply, and must pay the intended receiver the
 * intended amount.
 *
 * Checking the net balance alone is not enough: a proposal can net to zero while paying the wrong
 * address, so the receiver's own total is checked explicitly.
 */
export function validateTransferProposal(proposal: DecodedTx, expected: TransferExpectation): ValidationResult {
  try {
    assertNoForeignTokenOutputs(proposal.outputs, expected.token);
  } catch (error) {
    return fail((error as InvalidTransactionError).message);
  }

  const effect = transactionEffect(proposal);
  const balance = balanceOf(effect, expected.token);

  if (balance !== 0n) {
    return fail(`Not a transfer operation: the proposal's net balance for ${expected.token} is ${balance}, not zero.`);
  }

  const paidToReceiver = sumByAddressAndToken(proposal.outputs).get(`${expected.receiver}:${expected.token}`) ?? 0n;
  if (paidToReceiver !== expected.amount) {
    return fail(
      `Proposal pays ${paidToReceiver} of ${expected.token} to ${expected.receiver} but the original ` +
        `transaction locked ${expected.amount}.`,
    );
  }

  return ok;
}

/**
 * Structural checks on the Hathor transaction a melt proposal is meant to be settling. Separate
 * from the proposal itself: this is about the transaction that arrived, not the one being built.
 */
export function validateOriginTransaction(origin: DecodedTx): ValidationResult {
  if (origin.version !== 1) {
    return fail(`Origin transaction ${origin.txId ?? '<unknown>'} has version ${origin.version}, expected 1.`);
  }
  if (origin.isVoided === true) {
    return fail(`Origin transaction ${origin.txId ?? '<unknown>'} is voided.`);
  }
  return ok;
}
