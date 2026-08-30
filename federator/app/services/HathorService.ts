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
}

export class HathorService {
  private readonly deps: HathorServiceDeps;
  private started = false;
  /**
   * The furthest point the cursor has been moved to in this process. A live transaction can arrive
   * while older ones are still being replayed, and persisting each timestamp blindly would drag
   * the cursor backwards and replay work that was already done.
   */
  private highWaterMark = 0;

  constructor(deps: HathorServiceDeps) {
    this.deps = deps;
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
   * Handles one transaction, advancing the cursor only when it is genuinely done with.
   *
   * A failure here is logged rather than thrown. The live path is an event handler - throwing
   * would reach an EventEmitter with no error listener and take the process down along with the
   * synced wallet - and the replay path must not let one bad transaction block the rest of the
   * history behind it.
   */
  private async handle(tx: HistoryEntry, source: 'live' | 'replay'): Promise<void> {
    const { flow, cursors, logger } = this.deps;

    try {
      const done = await flow.handleIncoming(tx);
      if (done) {
        if (tx.timestamp > this.highWaterMark) {
          this.highWaterMark = tx.timestamp;
          await cursors.setTimestampCursor(tx.timestamp);
        }
      } else {
        logger.debug(`Transaction ${tx.txId} is not ready yet; leaving the cursor where it is.`);
      }
    } catch (error) {
      logger.error(`Failed to handle ${source} transaction ${tx.txId}. It will be retried.`, error);
    }
  }
}
