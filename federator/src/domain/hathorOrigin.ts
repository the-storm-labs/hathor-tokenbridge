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

/**
 * How the Hathor transaction id is fed to the hash. The two directions have always disagreed, and
 * the ids already on chain pin both, so neither can change:
 *
 * - `bytes`: a melt is voted from the ProposalSent event, whose `transactionHash` is a bytes32 the
 *   pre-rearchitecture federator read with its `0x`, so web3's keccak256 hashed the decoded bytes.
 *   hathor-functions derives the same id that way to join a melt's Hathor events to its votes.
 * - `text`: a Hathor-native transfer is voted straight from the wallet's tx, whose id carries no
 *   `0x`, so keccak256 hashed the UTF-8 of the hex string.
 *
 * Hashing a melt as text votes on an id no pre-rearchitecture federator would, so a mixed-version
 * federation never reaches quorum on it.
 */
export type HathorTxIdEncoding = 'bytes' | 'text';

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
export function deriveEvmOriginIdentity(
  hathorSenderAddress: string,
  hathorTxId: string,
  txIdEncoding: HathorTxIdEncoding,
): EvmOriginIdentity {
  const hashedSender = keccak256(hathorSenderAddress);
  const bareTxId = hathorTxId.startsWith('0x') ? hathorTxId.substring(2) : hathorTxId;
  return {
    sender: toChecksumAddress(hashedSender.substring(0, 42)),
    // web3's keccak256 hashes a 0x-prefixed hex string as bytes and anything else as UTF-8.
    idHash: keccak256(txIdEncoding === 'bytes' ? `0x${bareTxId}` : bareTxId),
    logIndex: HATHOR_SYNTHETIC_LOG_INDEX,
  };
}
