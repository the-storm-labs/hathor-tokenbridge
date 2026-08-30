/**
 * Serialises operations that spend UTXOs.
 *
 * Two proposals built concurrently can select the same UTXO before either has marked it, and the
 * second one is then unspendable. The headless wallet guards this with a lock its own source
 * describes as an in-process memory mutex, explicitly not distributed. Since the federator runs
 * one wallet per process, in-process has exactly the same reach here - this is a reimplementation,
 * not a regression.
 *
 * A queue rather than a boolean flag: callers wait their turn instead of being rejected, which is
 * what the callers above expect.
 */
export class SendTxLock {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs `operation` once every previously acquired turn has finished. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    // The tail is always the catch-wrapped promise below, so it never rejects - one operation
    // failing must not poison everything queued behind it. That also makes a rejection handler
    // here unreachable, which is why there is only the one arm.
    const turn = this.tail.then(() => operation());
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}
