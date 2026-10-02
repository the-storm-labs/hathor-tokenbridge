/**
 * @hathor/wallet-lib starts a background task the moment it is imported: `sync/gll.js` builds a
 * module-level PromiseQueue (the global load lock) and its constructor schedules a self-renewing
 * 1s timer. Nothing in the library's public surface clears it implicitly, so any Jest worker that
 * imports wallet-lib - directly or transitively - never exits on its own.
 *
 * The library exports `stopGLLBackgroundTask()` for exactly this. Calling it after every test file
 * keeps the suite exiting cleanly WITHOUT resorting to `forceExit`, so a handle genuinely leaked
 * by our own code still shows up as a hang instead of being swallowed.
 *
 * The require is deliberately lazy rather than a top-level import. Importing it here would create
 * the timer in EVERY test file, including ones that never touch wallet-lib - and in a file whose
 * tests are all skipped, Jest does not run afterAll, so nothing would ever stop it. Loading it
 * only from inside the hook means a file that never used the library never creates a timer at all.
 */
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose - see the comment above
  const { stopGLLBackgroundTask } = require('@hathor/wallet-lib/lib/sync/gll') as {
    stopGLLBackgroundTask: () => void;
  };
  stopGLLBackgroundTask();
});
