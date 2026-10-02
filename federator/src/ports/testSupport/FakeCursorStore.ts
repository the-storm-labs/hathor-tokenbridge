import type { CursorStorePort } from '../CursorStorePort';

/** In-memory cursors, recording every write so ordering can be asserted on. */
export class FakeCursorStore implements CursorStorePort {
  public readonly blocks = new Map<string, number>();
  public timestamp?: number;
  public readonly timestampWrites: number[] = [];

  async getBlockCursor(reader: string, fallback: number): Promise<number> {
    return this.blocks.get(reader) ?? fallback;
  }

  async setBlockCursor(reader: string, block: number): Promise<void> {
    this.blocks.set(reader, block);
  }

  async getTimestampCursor(fallback: number): Promise<number> {
    return this.timestamp ?? fallback;
  }

  async setTimestampCursor(timestamp: number): Promise<void> {
    this.timestamp = timestamp;
    this.timestampWrites.push(timestamp);
  }
}
