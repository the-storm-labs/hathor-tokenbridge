/**
 * @hathor/wallet-lib starts a background task the moment it is imported: `sync/gll.js` builds a
 * module-level PromiseQueue (the global load lock) and its constructor schedules a self-renewing
 * 1s timer. Nothing in the library's public surface clears it implicitly, so any Jest worker that
 * imports wallet-lib - directly or transitively - never exits on its own.
 *
 * The library exports `stopGLLBackgroundTask()` for exactly this. Calling it after every test file
 * keeps the suite exiting cleanly WITHOUT resorting to `forceExit`, so a handle genuinely leaked by
 * our own code still shows up as a hang instead of being swallowed.
 *
 * Requiring `sync/gll` directly costs ~2ms and does not pull the rest of the library in, so this is
 * safe to run even for pure-domain test files that never touch wallet-lib.
 */
import { stopGLLBackgroundTask } from '@hathor/wallet-lib/lib/sync/gll';

afterAll(() => {
  stopGLLBackgroundTask();
});
