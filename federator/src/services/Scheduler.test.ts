import { RecordingLogger } from '../ports/testSupport/fakes';
import { Scheduler, type SchedulerJob } from './Scheduler';

/** A job whose runs can be held open, so overlap is observable rather than raced. */
function controllableJob(name = 'test-job') {
  const calls: number[] = [];
  let release: (() => void) | undefined;
  let failWith: Error | undefined;

  const job: SchedulerJob = {
    name,
    run: async () => {
      calls.push(calls.length);
      if (release) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (failWith) {
        throw failWith;
      }
    },
  };

  return {
    job,
    calls,
    hold() {
      release = () => undefined;
    },
    letGo() {
      const pending = release;
      release = undefined;
      pending?.();
    },
    failNext(error: Error) {
      failWith = error;
    },
    succeedNext() {
      failWith = undefined;
    },
  };
}

function build(job: SchedulerJob, alertAfterFailures = 5) {
  const logger = new RecordingLogger();
  const scheduler = new Scheduler(job, { intervalMs: 1_000, alertAfterFailures }, logger);
  return { scheduler, logger };
}

describe('Scheduler', () => {
  it('runs the job when driven directly', async () => {
    const { job, calls } = controllableJob();
    const { scheduler } = build(job);

    await scheduler.runOnce();
    expect(calls).toHaveLength(1);
  });

  it('does not start a run while the previous one is still going', async () => {
    // Two concurrent reads of the same block range would propose the same transfer twice.
    const controllable = controllableJob();
    const { scheduler, logger } = build(controllable.job);
    controllable.hold();

    const first = scheduler.runOnce();
    await scheduler.runOnce(); // returns immediately, does not queue

    expect(controllable.calls).toHaveLength(1);
    expect(logger.at('debug')).toMatch(/previous run has not finished/);

    controllable.letGo();
    await first;
  });

  it('keeps the process alive when the job throws', async () => {
    // The old federator called process.exit(1) here. That now costs a full wallet resync.
    const { job } = controllableJob();
    const failing: SchedulerJob = {
      name: 'failing',
      run: async () => {
        throw new Error('RPC timed out');
      },
    };
    const { scheduler, logger } = build(failing);
    void job;

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.at('error')).toMatch(/The process stays up/);
  });

  it('counts consecutive failures and resets on recovery', async () => {
    let shouldFail = true;
    const flaky: SchedulerJob = {
      name: 'flaky',
      run: async () => {
        if (shouldFail) {
          throw new Error('still down');
        }
      },
    };
    const { scheduler, logger } = build(flaky);

    await scheduler.runOnce();
    await scheduler.runOnce();
    expect(scheduler.failureStreak).toBe(2);

    shouldFail = false;
    await scheduler.runOnce();
    expect(scheduler.failureStreak).toBe(0);
    expect(logger.at('info')).toMatch(/recovered after 2 failure/);
  });

  it('reports a job that looks broken rather than unlucky', async () => {
    const failing: SchedulerJob = {
      name: 'broken',
      run: async () => {
        throw new Error('nope');
      },
    };
    const { scheduler, logger } = build(failing, 3);

    await scheduler.runOnce();
    await scheduler.runOnce();
    expect(logger.at('error')).not.toMatch(/looks broken/);

    await scheduler.runOnce();
    expect(logger.at('error')).toMatch(/failed 3 times in a row and looks broken/);
    // Still retried - a broken job is reported, not abandoned.
    await scheduler.runOnce();
    expect(scheduler.failureStreak).toBe(4);
  });

  it('runs on an interval once started, and stops when stopped', async () => {
    jest.useFakeTimers();
    try {
      const { job, calls } = controllableJob();
      const { scheduler } = build(job);

      scheduler.start();
      // advanceTimersByTimeAsync flushes the microtasks each tick queues; the synchronous
      // variant leaves the run's promise chain pending and the assertion races it.
      await jest.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(calls).toHaveLength(2);

      await scheduler.stop();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not schedule another tick after being stopped mid-run', async () => {
    jest.useFakeTimers();
    try {
      const controllable = controllableJob();
      const { scheduler } = build(controllable.job);
      controllable.hold();

      scheduler.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(controllable.calls).toHaveLength(1);

      // Stop lands while the run is still in flight; the tick that follows must not requeue.
      const stopping = scheduler.stop();
      controllable.letGo();
      await stopping;

      await jest.advanceTimersByTimeAsync(10_000);
      expect(controllable.calls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses to start twice', async () => {
    jest.useFakeTimers();
    try {
      const { job } = controllableJob();
      const { scheduler, logger } = build(job);

      scheduler.start();
      scheduler.start();
      expect(logger.at('warn')).toMatch(/already running/);

      await scheduler.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for an in-flight run before reporting itself stopped', async () => {
    // The cursor only advances once a run completes; tearing down underneath one loses that.
    const controllable = controllableJob();
    const { scheduler } = build(controllable.job);
    controllable.hold();

    const running = scheduler.runOnce();
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    controllable.letGo();
    await running;
    await stopping;
    expect(stopped).toBe(true);
  });
});
