import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

import type { MetricsPort } from '../../ports/MetricsPort';

/**
 * MetricsPort over prom-client, keeping the metric names the existing dashboards and alerts use.
 *
 * Counters are registered against an explicit Registry rather than the global default one. The
 * previous MetricRegister declared its counters as class fields, which registered them on the
 * global registry at construction regardless of which Registry was passed in - so building it
 * twice in one process threw "metric already registered", and its own tests had to work around
 * that by sharing a single instance.
 */
export class PrometheusMetrics implements MetricsPort {
  public readonly registry: Registry;
  private readonly counters: Record<string, Counter<string>>;

  constructor(registry: Registry = new Registry(), labels: Record<string, string> = {}) {
    this.registry = registry;
    this.registry.setDefaultLabels(labels);
    collectDefaultMetrics({ register: this.registry });

    const counter = (name: string, help: string) => new Counter({ name, help, registers: [this.registry] });

    this.counters = {
      evmRun: counter('evm_run_count', 'Counter of EVM federation runs.'),
      hathorRun: counter('htr_run_count', 'Counter of Hathor federation runs.'),
      voteOk: counter('success_vote_count', 'Counter of successful votes'),
      voteFail: counter('failed_vote_count', 'Counter of failed votes'),
      proposalOk: counter('successful_proposal_count', 'Counter of proposals'),
      proposalFail: counter('invalid_proposal_count', 'Counter of invalid proposals'),
      signOk: counter('signing_count', 'Counter of signatures'),
      signFail: counter('invalid_signing_count', 'Counter of invalid signatures'),
      pushOk: counter('push_proposal_count', 'Counter of pushed proposals'),
      pushFail: counter('invalid_push_proposal_count', 'Counter of invalid pushed proposals'),
    };
  }

  private bump(key: keyof typeof this.counters): void {
    this.counters[key]?.inc();
  }

  evmRunCompleted = () => this.bump('evmRun');
  hathorRunCompleted = () => this.bump('hathorRun');
  voteSucceeded = () => this.bump('voteOk');
  voteFailed = () => this.bump('voteFail');
  proposalSubmitted = () => this.bump('proposalOk');
  proposalRejected = (_transactionHash: string) => this.bump('proposalFail');
  signatureSubmitted = () => this.bump('signOk');
  signatureRejected = () => this.bump('signFail');
  pushSubmitted = () => this.bump('pushOk');
  pushRejected = () => this.bump('pushFail');

  /** The scrape payload for the /metrics endpoint. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
