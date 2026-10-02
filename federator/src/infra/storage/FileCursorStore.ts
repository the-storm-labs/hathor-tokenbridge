import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { CursorStorePort } from '../../ports/CursorStorePort';
import type { LoggerPort } from '../../ports/LoggerPort';

/**
 * Cursors as plain files on the federator's data volume, which is how they have always been kept.
 *
 * Writes go through a temporary file and a rename, so a process killed mid-write leaves the
 * previous cursor intact rather than a truncated one. A truncated cursor parses as NaN and would
 * send the reader back to its configured starting block - a full re-scan of the chain.
 *
 * FILE NAMES ARE PART OF THE DEPLOYMENT CONTRACT. A running federator has these files on its
 * volume, and a name this code does not recognise reads as "never ran", which means re-scanning
 * from `fromBlock`. The mapping from the old names is:
 *
 *   lastBlock_fhtr_<mainChainId>_31.txt  ->  cursor_evm-bridge.txt
 *   lastBlock_hmm_<mainChainId>_31.txt   ->  cursor_hathor-federation.txt
 *   lastHathorTimestamp.txt              ->  unchanged
 *
 * The first two have to be renamed when a federator is switched over; the timestamp cursor always
 * sat on top of the wallet's history rather than inside it, so it carries over untouched.
 */
const TIMESTAMP_FILE = 'lastHathorTimestamp.txt';

export class FileCursorStore implements CursorStorePort {
  private readonly directory: string;
  private readonly logger: LoggerPort;

  constructor(directory: string, logger: LoggerPort) {
    this.directory = directory;
    this.logger = logger;
  }

  private blockFile(reader: string): string {
    return join(this.directory, `cursor_${reader}.txt`);
  }

  private async readNumber(path: string): Promise<number | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      // Never recorded. The caller's fallback is the right answer.
      return undefined;
    }

    const value = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(value)) {
      // A corrupt cursor is worse than a missing one: silently treating it as zero would replay
      // the chain from genesis. Say so, and let the caller's fallback apply.
      this.logger.error(`Cursor file ${path} does not contain a number (${JSON.stringify(raw)}); ignoring it.`);
      return undefined;
    }
    return value;
  }

  private async writeNumber(path: string, value: number): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${value}`, 'utf8');
    // Rename is atomic within a filesystem, so a reader never sees a half-written cursor.
    await rename(temporary, path);
  }

  async getBlockCursor(reader: string, fallback: number): Promise<number> {
    const stored = await this.readNumber(this.blockFile(reader));
    // A stored cursor behind the configured start means the configuration moved forward
    // deliberately - honour the later of the two rather than re-reading skipped history.
    return stored === undefined ? fallback : Math.max(stored, fallback);
  }

  async setBlockCursor(reader: string, block: number): Promise<void> {
    await this.writeNumber(this.blockFile(reader), block);
  }

  async getTimestampCursor(fallback: number): Promise<number> {
    const stored = await this.readNumber(join(this.directory, TIMESTAMP_FILE));
    return stored === undefined ? fallback : Math.max(stored, fallback);
  }

  async setTimestampCursor(timestamp: number): Promise<void> {
    await this.writeNumber(join(this.directory, TIMESTAMP_FILE), timestamp);
  }
}
