import type { HathorToEvmFlow } from '../application/HathorToEvmFlow';
import type { CursorStorePort } from '../ports/CursorStorePort';
import type { HathorWalletPort, HistoryEntry } from '../ports/HathorWalletPort';
import type { LoggerPort } from '../ports/LoggerPort';

/**
 * Owns the Hathor wallet and everything that arrives on it.
 *
 * This is the service that must not go down. Storage is MemoryStore - the only implementation the
 * library ships - so the entire transaction history is rebuilt on every process start. A restart
 * is therefore expensive rather than free, which is why nothing else in the process is allowed to
 * end it, and why the scheduler swallows reader failures instead of exiting.
 *
 * It replaces two things at once: HathorHistorySinc, and the RabbitMQ/PubSub consumer that existed
 * solely to carry `wallet:new-tx` from the wallet container into the federator. With the library
 * embedded, that event is delivered in process and the whole queue layer disappears.
 */
export interface HathorServiceDeps {
  readonly wallet: HathorWalletPort;
  readonly flow: HathorToEvmFlow;
  readonly cursors: CursorStorePort;
  readonly logger: LoggerPort;
  /** Unix seconds to replay from when no cursor has been recorded yet. */
  readonly fromTimestamp: number;
  /** Blocks back each run() looks for transactions not finished with (HATHOR_LOOKBACK_BLOCKS). */
  readonly lookbackBlocks: number;
  /** Unix seconds now; injectable for tests. */
  readonly now?: () => number;
}

/**
 * Hathor's target block time. Only used to bound which transactions are worth a confirmation lookup
 * at all - the window itself is measured in blocks - so it is applied with a 2x margin.
 */
const BLOCK_SECONDS = 30;

export class HathorService {
  /** As the scheduler names it in its logs. */
  readonly name = 'Hathor lookback window';
  private readonly deps: HathorServiceDeps;
  private started = false;
  /** Transactions not done with yet, by id - retried by run() until done, however old. */
  private readonly pending = new Map<string, HistoryEntry>();
  /** Transactions done with in this process, by id -> timestamp; trimmed to the window. */
  private readonly done = new Map<string, number>();
  /** The newest timestamp of a transaction that is done with. */
  private latestDone = 0;
  /**
   * The furthest point the cursor has been moved to in this process. A live transaction can arrive
   * while older ones are still being replayed, and persisting each timestamp blindly would drag
   * the cursor backwards and replay work that was already done.
   */
  private highWaterMark = 0;

  constructor(deps: HathorServiceDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Math.floor(Date.now() / 1000);
  }

  /**
   * Brings the wallet up, replays whatever arrived while the federator was down, and then keeps
   * handling transactions as they arrive.
   *
   * The order matters: the live subscription is registered BEFORE the replay runs, so a
   * transaction arriving during the replay is not lost in the gap between the two. Handling is
   * idempotent - every step re-reads the contract state before acting - so seeing one twice is
   * harmless, while missing one is not.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const { wallet, logger } = this.deps;

    wallet.onNewTransaction((tx) => this.handle(tx, 'live'));

    logger.info('Starting the Hathor wallet. A cold start rebuilds the whole history.');
    await wallet.start();
    logger.info('Hathor wallet is ready.');

    await this.replayHistory();
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.deps.wallet.stop();
  }

  /**
   * Replays everything at or after the recorded cursor.
   *
   * The cursor is a timestamp rather than a block, because Hathor sync is address-based and has no
   * block to advance past. It sits on top of the wallet's history rather than inside it, which is
   * why it survives this migration untouched.
   */
  async replayHistory(): Promise<void> {
    const { wallet, cursors, logger, fromTimestamp } = this.deps;

    const cursor = await cursors.getTimestampCursor(fromTimestamp);
    this.highWaterMark = Math.max(this.highWaterMark, cursor);
    const history = await wallet.getHistory();

    // getHistory returns newest first; replay oldest first so the cursor only ever moves forward.
    const pending = history.filter((tx) => tx.timestamp >= cursor).sort((a, b) => a.timestamp - b.timestamp);

    logger.info(`Replaying ${pending.length} transaction(s) recorded at or after ${cursor}.`);

    for (const tx of pending) {
      await this.handle(tx, 'replay');
    }
  }

  /**
   * One round of the Hathor side, on the scheduler's cadence: every multisig transaction confirmed
   * within the last `lookbackBlocks` blocks (or not confirmed yet) that this process has not
   * finished with, plus anything still pending however old.
   *
   * The window is what makes a lost wallet event harmless: a deposit is found here whether or not
   * `new-tx` ever reached us, and it stays eligible while it climbs to the confirmations the flow
   * waits for. Pending transactions are kept past the window - a federator that cannot reach a node
   * for an hour must still finish the deposit afterwards - and dropped only once the wallet reports
   * them voided or no longer knows them.
   */
  async run(): Promise<void> {
    if (!this.started) {
      return;
    }
    const { wallet, logger, lookbackBlocks } = this.deps;
    const horizon = this.now() - lookbackBlocks * BLOCK_SECONDS * 2;

    for (const [txId, timestamp] of this.done) {
      if (timestamp < horizon) {
        this.done.delete(txId);
      }
    }

    const work = new Map<string, HistoryEntry>();
    for (const tx of await wallet.getHistory()) {
      if (tx.isVoided === true || tx.timestamp < horizon || this.done.has(tx.txId) || this.pending.has(tx.txId)) {
        continue;
      }
      if ((await wallet.getConfirmationCount(tx.txId)) > lookbackBlocks) {
        continue;
      }
      logger.info(`Transaction ${tx.txId} was found by the lookback window, not by its event.`);
      work.set(tx.txId, tx);
    }

    for (const tx of this.pending.values()) {
      if (await wallet.getTransaction(tx.txId)) {
        work.set(tx.txId, tx);
      } else {
        logger.warn(`Transaction ${tx.txId} is voided or gone; no longer waiting on it.`);
        this.pending.delete(tx.txId);
      }
    }

    for (const tx of [...work.values()].sort((a, b) => a.timestamp - b.timestamp)) {
      await this.handle(tx, 'lookback');
    }
    await this.advanceCursor();
  }

  /** How many transactions are waiting to be handled again. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Handles one transaction. One that is not done with - waiting on confirmations, or failed - is
   * kept for run() to retry, and the cursor never moves past it.
   *
   * A failure here is logged rather than thrown. The live path is an event handler - throwing
   * would reach an EventEmitter with no error listener and take the process down along with the
   * synced wallet - and the replay path must not let one bad transaction block the rest of the
   * history behind it.
   */
  private async handle(tx: HistoryEntry, source: 'live' | 'replay' | 'lookback'): Promise<void> {
    const { flow, logger } = this.deps;

    let done = false;
    try {
      done = await flow.handleIncoming(tx);
      if (!done) {
        logger.debug(`Transaction ${tx.txId} is not ready yet; it will be checked again.`);
      }
    } catch (error) {
      logger.error(`Failed to handle ${source} transaction ${tx.txId}. It will be retried.`, error);
    }

    if (done) {
      this.pending.delete(tx.txId);
      this.done.set(tx.txId, tx.timestamp);
      this.latestDone = Math.max(this.latestDone, tx.timestamp);
    } else {
      this.pending.set(tx.txId, tx);
    }
    await this.advanceCursor();
  }

  /**
   * Moves the persisted cursor to the newest transaction done with, but never past the oldest one
   * still waiting: replay starts "at or after" the cursor, so a restart picks the waiting one up.
   * A later transaction finishing first (the federator's own melts and mints arrive all the time)
   * must not carry the cursor over an earlier deposit that is still waiting.
   */
  private async advanceCursor(): Promise<void> {
    let target = this.latestDone;
    for (const waiting of this.pending.values()) {
      target = Math.min(target, waiting.timestamp);
    }
    if (target > this.highWaterMark) {
      this.highWaterMark = target;
      await this.deps.cursors.setTimestampCursor(target);
    }
  }
}
