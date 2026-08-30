import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RevertedTransfer } from '../../ports/RevertedTransferStorePort';
import { RecordingLogger } from '../../ports/testSupport/fakes';
import { FileRevertedTransferStore } from './FileRevertedTransferStore';

const DETAILS: RevertedTransfer = {
  originalTokenAddress: '0xTOKEN',
  sender: '0xSENDER',
  receiver: '0xRECEIVER',
  amount: '1500000000000000000',
  blockHash: '0xBLOCK',
  transactionHash: '0xTX',
  logIndex: 129,
  error: 'execution reverted',
};

async function build() {
  const directory = await mkdtemp(join(tmpdir(), 'reverted-store-'));
  const logger = new RecordingLogger();
  return { store: new FileRevertedTransferStore(directory, logger), directory, logger };
}

describe('FileRevertedTransferStore', () => {
  it('reports nothing recorded on a fresh volume', async () => {
    const { store } = await build();
    expect(await store.has('0xabc')).toBe(false);
  });

  it('remembers a reverted transfer across instances', async () => {
    const { store, directory, logger } = await build();
    await store.record('0xabc', DETAILS);

    const reopened = new FileRevertedTransferStore(directory, logger);
    expect(await reopened.has('0xabc')).toBe(true);
    expect(await reopened.has('0xdef')).toBe(false);
  });

  it('keeps entries from earlier failures when recording a new one', async () => {
    const { store, directory } = await build();
    await store.record('0xone', DETAILS);
    await store.record('0xtwo', DETAILS);

    const written = JSON.parse(await readFile(join(directory, 'revertedTransfers.json'), 'utf8'));
    expect(Object.keys(written)).toEqual(['0xone', '0xtwo']);
  });

  it('writes something a human can actually read', async () => {
    // Somebody has to go and look at why a transfer is stuck.
    const { store, directory } = await build();
    await store.record('0xabc', DETAILS);

    const raw = await readFile(join(directory, 'revertedTransfers.json'), 'utf8');
    expect(raw).toContain('\n');
    expect(JSON.parse(raw)['0xabc']).toEqual(DETAILS);
  });

  it('starts fresh rather than crashing on a corrupt file', async () => {
    // Losing this costs retried votes the contract rejects anyway; crashing at boot costs more.
    const { store, directory, logger } = await build();
    await writeFile(join(directory, 'revertedTransfers.json'), '{ not json', 'utf8');

    expect(await store.has('0xabc')).toBe(false);
    expect(logger.at('error')).toMatch(/Could not parse/);

    await expect(store.record('0xabc', DETAILS)).resolves.toBeUndefined();
    expect(await store.has('0xabc')).toBe(true);
  });
});
