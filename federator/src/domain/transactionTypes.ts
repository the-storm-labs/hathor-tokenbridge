/**
 * The kind of Hathor-side operation a cross-chain transfer resolves to. The numeric values are
 * the on-chain enum in the HathorFederation contract and must not be reordered.
 */
export enum TransactionType {
  MELT = 0,
  MINT = 1,
  TRANSFER = 2,
  RETURN = 3,
}
