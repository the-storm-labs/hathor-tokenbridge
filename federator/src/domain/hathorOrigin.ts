import { keccak256, toChecksumAddress } from 'web3-utils';

/**
 * A transfer that starts on Hathor has to be voted for on the EVM side, and the Federation
 * contract derives its transaction id from EVM-shaped fields: a sender address, a block hash, a
 * transaction hash and a log index. Hathor supplies none of those, so they are derived from what
 * it does supply.
 *
 * Every federator must derive them identically or they vote on different ids and the transfer
 * never reaches quorum. That is the entire reason this is a pure, fixed function rather than
 * anything situational.
 */

/**
 * Hathor transactions have no log index. A fixed value stands in so the derivation is
 * deterministic across federators. The specific number carries no meaning beyond being agreed on;
 * changing it changes every derived transaction id, which would orphan every in-flight transfer.
 */
export const HATHOR_SYNTHETIC_LOG_INDEX = 129;

export interface EvmOriginIdentity {
  /** The Hathor sender, folded into something address-shaped. */
  readonly sender: string;
  /** Stands in for both the block hash and the transaction hash. */
  readonly idHash: string;
  readonly logIndex: number;
}

/**
 * Derives the EVM-shaped identity of a transfer that originated on Hathor.
 *
 * The sender is the first 20 bytes of the hash of the Hathor address - Hathor addresses are not
 * 20 bytes, so they cannot be used directly, and hashing keeps the mapping deterministic and
 * collision-resistant enough for an identifier.
 */
export function deriveEvmOriginIdentity(hathorSenderAddress: string, hathorTxId: string): EvmOriginIdentity {
  const hashedSender = keccak256(hathorSenderAddress);
  return {
    sender: toChecksumAddress(hashedSender.substring(0, 42)),
    idHash: keccak256(hathorTxId),
    logIndex: HATHOR_SYNTHETIC_LOG_INDEX,
  };
}
