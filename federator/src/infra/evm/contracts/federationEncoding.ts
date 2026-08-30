import { isAddress, padLeft, toChecksumAddress } from 'web3-utils';

import type { FederationEvent, FederationTransfer } from '../../../domain/federationEvents';
import { TransactionType } from '../../../domain/transactionTypes';

/**
 * How the HathorFederation contract's bytes32 fields are encoded and read back.
 *
 * Separated from the adapter and kept pure because this is the part that must not diverge: every
 * federator derives the transaction id from these encoded values, so a difference of one padding
 * character means two federators coordinating on different ids and never reaching quorum.
 */

/** Left-pads a hex string to bytes32, with the `0x` the contract expects. */
export function toBytes32(value: string): string {
  const prefixed = value.startsWith('0x') ? value : `0x${value}`;
  return padLeft(prefixed, 64);
}

/**
 * Recovers a 20-byte address from a left-padded bytes32.
 *
 * The previous implementation walked the string one character at a time until `isAddress` accepted
 * the remainder. Padding is deterministic, so the address is the last 40 hex characters - but the
 * result is still validated rather than assumed, since a value that is not a padded address must
 * be reported rather than silently truncated into a plausible-looking one.
 */
export function fromBytes32Address(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  const candidate = `0x${hex.slice(-40)}`;
  if (!isAddress(candidate)) {
    throw new Error(`${value} does not contain a 20-byte address.`);
  }
  return toChecksumAddress(candidate);
}

const stripPrefix = (value: unknown): string => String(value ?? '').replace(/^0x/, '');

export interface EncodingProblem {
  (message: string, error: unknown): void;
}

/**
 * Reads the transfer fields shared by every federation event.
 *
 * A MELT's `originalTokenAddress` is a Hathor token uid - genuinely 32 bytes - while a MINT or
 * TRANSFER carries a padded EVM address. Un-padding the wrong one would corrupt the token id.
 */
export function toTransfer(values: Record<string, unknown>, onProblem: EncodingProblem): FederationTransfer {
  const transactionType = Number(values.transactionType ?? 0) as TransactionType;
  const rawToken = String(values.originalTokenAddress ?? '');

  let originalTokenAddress: string;
  if (transactionType === TransactionType.MELT) {
    originalTokenAddress = stripPrefix(rawToken);
  } else {
    try {
      originalTokenAddress = fromBytes32Address(rawToken);
    } catch (error) {
      onProblem(`Could not read an address out of ${rawToken}; passing it through unchanged.`, error);
      originalTokenAddress = stripPrefix(rawToken);
    }
  }

  return {
    transactionId: String(values.transactionId ?? ''),
    originalTokenAddress,
    transactionHash: stripPrefix(values.transactionHash),
    value: BigInt(String(values.value ?? '0')),
    sender: String(values.sender ?? ''),
    receiver: String(values.receiver ?? ''),
    transactionType,
  };
}

/**
 * Maps one contract log onto a domain event.
 *
 * @returns undefined for events this bridge has no part in - MemberAddition, OwnershipTransferred
 *          and the like are real events, not anomalies.
 */
export function toFederationEvent(
  eventName: string | undefined,
  values: Record<string, unknown>,
  onProblem: EncodingProblem,
): FederationEvent | undefined {
  switch (eventName) {
    case 'LockTransactionHex':
      return { kind: 'lock', txHex: stripPrefix(values.txHex) };

    case 'TransactionProposed':
      return { kind: 'proposed', ...toTransfer(values, onProblem), txHex: stripPrefix(values.txHex) };

    case 'ProposalSigned':
      return {
        kind: 'signed',
        ...toTransfer(values, onProblem),
        member: String(values.member ?? ''),
        signed: Boolean(values.signed),
        signature: String(values.signature ?? ''),
      };

    case 'ProposalSent':
      return {
        kind: 'sent',
        ...toTransfer(values, onProblem),
        processed: Boolean(values.processed),
        hathorTxId: stripPrefix(values.hathorTxId),
      };

    case 'TransactionFailed':
      return { kind: 'failed', ...toTransfer(values, onProblem) };

    default:
      return undefined;
  }
}
