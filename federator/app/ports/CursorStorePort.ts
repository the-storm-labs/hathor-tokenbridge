/**
 * Where the federator remembers how far it has read.
 *
 * Two shapes, because the two chains advance differently: EVM chains have block numbers, while
 * Hathor's history is walked by transaction timestamp - it has no block cursor to advance, since
 * the wallet syncs by address rather than by block.
 */
export interface CursorStorePort {
  /**
   * The last block fully processed for a reader, or the configured starting block when nothing
   * has been recorded yet.
   */
  getBlockCursor(reader: string, fallback: number): Promise<number>;
  setBlockCursor(reader: string, block: number): Promise<void>;

  /** The timestamp up to which Hathor history has been replayed. */
  getTimestampCursor(fallback: number): Promise<number>;
  setTimestampCursor(timestamp: number): Promise<void>;
}
