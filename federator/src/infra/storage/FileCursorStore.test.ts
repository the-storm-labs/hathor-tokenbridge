import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RecordingLogger } from '../../ports/testSupport/fakes';
import { FileCursorStore } from './FileCursorStore';

async function build() {
  const directory = await mkdtemp(join(tmpdir(), 'cursor-store-'));
  const logger = new RecordingLogger();
  return { store: new FileCursorStore(directory, logger), directory, logger };
}

describe('FileCursorStore block cursors', () => {
  it('falls back when nothing has been recorded', async () => {
    const { store } = await build();
    expect(await store.getBlockCursor('evm-bridge', 500)).toBe(500);
  });

  it('round-trips a cursor', async () => {
    const { store } = await build();
    await store.setBlockCursor('evm-bridge', 1_234);
    expect(await store.getBlockCursor('evm-bridge', 0)).toBe(1_234);
  });

  it('keeps readers apart', async () => {
    const { store } = await build();
    await store.setBlockCursor('evm-bridge', 100);
    await store.setBlockCursor('hathor-federation', 200);

    expect(await store.getBlockCursor('evm-bridge', 0)).toBe(100);
    expect(await store.getBlockCursor('hathor-federation', 0)).toBe(200);
  });

  it('honours a configured start that has moved ahead of the stored cursor', async () => {
    // Raising fromBlock is how an operator says "do not go back before here".
    const { store } = await build();
    await store.setBlockCursor('evm-bridge', 100);
    expect(await store.getBlockCursor('evm-bridge', 500)).toBe(500);
  });

  it('ignores a corrupt cursor rather than reading it as zero', async () => {
    // Number.parseInt of a truncated file can yield NaN, and treating that as 0 would replay the
    // chain from genesis.
    const { store, directory, logger } = await build();
    await writeFile(join(directory, 'cursor_evm-bridge.txt'), 'not-a-number', 'utf8');

    expect(await store.getBlockCursor('evm-bridge', 500)).toBe(500);
    expect(logger.at('error')).toMatch(/does not contain a number/);
  });

  it('leaves no temporary file behind', async () => {
    // The write goes through a temp file and a rename, so a crash mid-write cannot truncate the
    // real cursor - but the temp must not linger.
    const { store, directory } = await build();
    await store.setBlockCursor('evm-bridge', 42);

    expect(await readdir(directory)).toEqual(['cursor_evm-bridge.txt']);
  });

  it('writes the number as plain text, the way the file has always looked', async () => {
    const { store, directory } = await build();
    await store.setBlockCursor('evm-bridge', 987);
    expect(await readFile(join(directory, 'cursor_evm-bridge.txt'), 'utf8')).toBe('987');
  });
});

describe('FileCursorStore timestamp cursor', () => {
  it('uses the file name the running federators already have', async () => {
    // The timestamp cursor sat on top of the wallet's history rather than inside it, so it carries
    // over untouched - renaming it would silently replay history on every deployed federator.
    const { store, directory } = await build();
    await store.setTimestampCursor(1_700_000_000);

    expect(await readdir(directory)).toEqual(['lastHathorTimestamp.txt']);
  });

  it('round-trips and respects the configured fallback', async () => {
    const { store } = await build();
    expect(await store.getTimestampCursor(100)).toBe(100);

    await store.setTimestampCursor(500);
    expect(await store.getTimestampCursor(100)).toBe(500);
    expect(await store.getTimestampCursor(900)).toBe(900);
  });

  it('reads a cursor written by the previous federator', async () => {
    const { store, directory } = await build();
    await writeFile(join(directory, 'lastHathorTimestamp.txt'), '1733509177', 'utf8');
    expect(await store.getTimestampCursor(0)).toBe(1_733_509_177);
  });
});
