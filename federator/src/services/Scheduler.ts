import type { LoggerPort } from '../ports/LoggerPort';

/**
 * Runs a job on an interval, one run at a time.
 *
 * Two properties matter here, and neither held before.
 *
 * A run never overlaps the previous one. The old scheduler chained a setTimeout after each run,
 * which is the same idea, but nothing stopped `start()` being called twice or a caller triggering
 * a run while one was in flight - and two concurrent reads of the same block range propose the
 * same transfer twice.
 *
 * A failing job never ends the process. The federator used to `process.exit(1)` on any unhandled
 * error from a scheduled run. That was survivable when Hathor history lived in a separate wallet
 * container; now the process owns a MemoryStore that is rebuilt from scratch on every start, so
 * exiting over a transient RPC error would cost a full resync. Failures are logged and the next
 * tick happens anyway, with a consecutive-failure count so a job that is broken rather than
 * unlucky is visible.
 */
export interface SchedulerJob {
  readonly name: string;
  run(): Promise<void>;
}

export interface SchedulerOptions {
  readonly intervalMs: number;
  /** Consecutive failures after which the job is reported as broken rather than unlucky. */
  readonly alertAfterFailures?: number;
}

export class Scheduler {
  private readonly job: SchedulerJob;
  private readonly logger: LoggerPort;
  private readonly intervalMs: number;
  private readonly alertAfterFailures: number;

  private running = false;
  /** The run currently in flight, if any. Held rather than polled, so stop() can simply await it. */
  private inFlight?: Promise<void>;
  private consecutiveFailures = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(job: SchedulerJob, options: SchedulerOptions, logger: LoggerPort) {
    this.job = job;
    this.logger = logger;
    this.intervalMs = options.intervalMs;
    this.alertAfterFailures = options.alertAfterFailures ?? 5;
  }

  start(): void {
    if (this.running) {
      this.logger.warn(`Scheduler for ${this.job.name} is already running.`);
      return;
    }
    this.running = true;
    this.logger.info(`Scheduling ${this.job.name} every ${this.intervalMs}ms.`);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined as unknown as ReturnType<typeof setTimeout>;
    }
    // Let an in-flight run finish rather than tearing down underneath it: it may be halfway
    // through a proposal, and the cursor is only advanced once a run completes.
    await this.inFlight;
    this.logger.info(`Stopped scheduling ${this.job.name}.`);
  }

  /**
   * Runs the job once, now. Exposed so a caller can drive it directly - which is what turns these
   * jobs into cron-able units later, without a scheduler in the picture at all.
   */
  async runOnce(): Promise<void> {
    if (this.inFlight) {
      this.logger.debug(`Skipping ${this.job.name}: the previous run has not finished.`);
      return;
    }

    const run = this.execute();
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = undefined as unknown as Promise<void>;
    }
  }

  private async execute(): Promise<void> {
    try {
      await this.job.run();
      if (this.consecutiveFailures > 0) {
        this.logger.info(`${this.job.name} recovered after ${this.consecutiveFailures} failure(s).`);
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      this.logger.error(
        `${this.job.name} failed (${this.consecutiveFailures} in a row). The process stays up; ` +
          `the next run will retry.`,
        error,
      );
      if (this.consecutiveFailures >= this.alertAfterFailures) {
        this.logger.error(
          `${this.job.name} has failed ${this.consecutiveFailures} times in a row and looks broken ` +
            `rather than unlucky. It is still being retried.`,
        );
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }

    await this.runOnce();

    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    // Do not let a pending tick hold the event loop open on its own.
    this.timer.unref?.();
  }

  /** Consecutive failures so far, for tests and health reporting. */
  get failureStreak(): number {
    return this.consecutiveFailures;
  }
}
