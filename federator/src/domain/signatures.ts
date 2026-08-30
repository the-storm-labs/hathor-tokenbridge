/**
 * A signer's contribution to a P2SH multisig proposal, as produced by
 * `p2sh/tx-proposal/get-my-signatures`:
 *
 *     <pubkey>|<inputIndex>:<derSignature>|<inputIndex>:<derSignature>|...
 *
 * A signer whose wallet had not yet recognised every referenced UTXO as spendable at signing time
 * produces fewer `<inputIndex>:<derSignature>` segments than the transaction has inputs.
 */
export interface SignatureEntry {
  readonly pubkey: string;
  /** Input indices this entry actually signs for. */
  readonly indices: readonly number[];
}

export function parseSignatureEntry(entry: string): SignatureEntry {
  const [pubkey = '', ...parts] = entry.split('|');
  const indices = parts.map((part) => Number(part.split(':')[0])).filter((index) => Number.isInteger(index));
  return { pubkey, indices };
}

/** Whether an entry signs every input index in [0, inputCount). */
export function coversAllInputs(entry: string, inputCount: number): boolean {
  const { indices } = parseSignatureEntry(entry);
  const seen = new Set(indices);
  for (let index = 0; index < inputCount; index++) {
    if (!seen.has(index)) {
      return false;
    }
  }
  return true;
}

/**
 * Filters signatures down to those covering every input of the transaction.
 *
 * A partial signature can never complete a valid P2SH redeem script on its own. Including one in a
 * push - however the rest of the set is chosen - fails the whole `sign-and-push` with "Signatures
 * are incompatible with redeemScript". Selection for a push must therefore only ever consider
 * entries from this filtered set, never raw array position.
 */
export function selectCompleteSignatures(signatures: readonly string[], inputCount: number): string[] {
  return signatures.filter((entry) => coversAllInputs(entry, inputCount));
}
