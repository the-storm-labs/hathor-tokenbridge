import type { ClockPort } from '../ClockPort';
import type { LoggerPort } from '../LoggerPort';
import type { MetricsPort } from '../MetricsPort';

/** A logger that records instead of printing, so tests can assert on what was reported. */
export class RecordingLogger implements LoggerPort {
  public readonly lines: Array<{ level: string; message: string; args: unknown[] }> = [];

  private record(level: string) {
    return (message: string, ...args: unknown[]) => {
      this.lines.push({ level, message, args });
    };
  }

  trace = this.record('trace');
  debug = this.record('debug');
  info = this.record('info');
  warn = this.record('warn');
  error = this.record('error');

  /** Every message at a level, joined - convenient for a single regex assertion. */
  at(level: string): string {
    return this.lines
      .filter((line) => line.level === level)
      .map((line) => line.message)
      .join('\n');
  }
}

/** Counts calls per metric name. */
export class RecordingMetrics implements MetricsPort {
  public readonly counts: Record<string, number> = {};
  /** The transaction hashes passed to proposalRejected. */
  public readonly rejectedProposals: string[] = [];

  private bump(name: string) {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  evmRunCompleted = () => this.bump('evmRunCompleted');
  hathorRunCompleted = () => this.bump('hathorRunCompleted');
  voteSucceeded = () => this.bump('voteSucceeded');
  voteFailed = () => this.bump('voteFailed');
  proposalSubmitted = () => this.bump('proposalSubmitted');
  proposalRejected = (transactionHash: string) => {
    this.rejectedProposals.push(transactionHash);
    this.bump('proposalRejected');
  };
  signatureSubmitted = () => this.bump('signatureSubmitted');
  signatureRejected = () => this.bump('signatureRejected');
  pushSubmitted = () => this.bump('pushSubmitted');
  pushRejected = () => this.bump('pushRejected');
}

/** A clock that never actually waits, but remembers what it was asked to wait for. */
export class InstantClock implements ClockPort {
  public readonly waits: number[] = [];
  private current = 1_700_000_000_000;

  now = () => this.current;

  sleep = async (ms: number) => {
    this.waits.push(ms);
    this.current += ms;
  };
}
