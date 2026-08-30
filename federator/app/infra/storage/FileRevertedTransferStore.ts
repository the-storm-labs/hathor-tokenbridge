import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LoggerPort } from '../../ports/LoggerPort';
import type { RevertedTransfer, RevertedTransferStorePort } from '../../ports/RevertedTransferStorePort';

/**
 * Remembers votes that reverted, in one JSON file on the data volume.
 *
 * The whole file is read and rewritten per entry. That is fine for what this holds - a reverting
 * vote is an incident, not a routine event - and it keeps the file a single readable artefact for
 * whoever has to go and look at why a transfer is stuck.
 */
const FILE = 'revertedTransfers.json';

export class FileRevertedTransferStore implements RevertedTransferStorePort {
  private readonly path: string;
  private readonly logger: LoggerPort;

  constructor(directory: string, logger: LoggerPort) {
    this.path = join(directory, FILE);
    this.logger = logger;
  }

  private async readAll(): Promise<Record<string, RevertedTransfer>> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch {
      return {};
    }

    try {
      return JSON.parse(raw) as Record<string, RevertedTransfer>;
    } catch (error) {
      // Losing this file means retrying votes that are known to revert - wasteful, but not
      // dangerous, since the contract rejects them anyway. Starting fresh beats crashing at boot.
      this.logger.error(`Could not parse ${this.path}; starting from an empty set.`, error);
      return {};
    }
  }

  async has(transactionId: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(await this.readAll(), transactionId);
  }

  async record(transactionId: string, details: RevertedTransfer): Promise<void> {
    const all = await this.readAll();
    all[transactionId] = details;

    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(all, null, 2), 'utf8');
    await rename(temporary, this.path);
  }
}
