import { Registry } from 'prom-client';

import { PrometheusMetrics } from './PrometheusMetrics';

describe('PrometheusMetrics', () => {
  it('can be built more than once in a process', async () => {
    // The previous MetricRegister declared its counters as class fields, which registered them on
    // prom-client's global registry regardless of the Registry passed in - so a second instance
    // threw "metric already registered" and its own tests had to share one instance to cope.
    expect(() => {
      new PrometheusMetrics(new Registry());
      new PrometheusMetrics(new Registry());
    }).not.toThrow();
  });

  it('keeps the metric names the existing dashboards use', async () => {
    const metrics = new PrometheusMetrics(new Registry());
    metrics.evmRunCompleted();
    metrics.voteSucceeded();

    const rendered = await metrics.render();
    for (const name of ['evm_run_count', 'htr_run_count', 'success_vote_count', 'failed_vote_count']) {
      expect(rendered).toContain(name);
    }
  });

  it('counts each event against its own metric', async () => {
    const metrics = new PrometheusMetrics(new Registry());
    metrics.proposalSubmitted();
    metrics.proposalSubmitted();
    metrics.proposalRejected('0xTX');

    const rendered = await metrics.render();
    expect(rendered).toMatch(/successful_proposal_count(\{[^}]*\})? 2/);
    expect(rendered).toMatch(/invalid_proposal_count(\{[^}]*\})? 1/);
  });

  it('exposes a counter for every event the application reports', async () => {
    // A MetricsPort method wired to nothing is invisible until a dashboard is silently empty.
    const metrics = new PrometheusMetrics(new Registry());
    metrics.evmRunCompleted();
    metrics.hathorRunCompleted();
    metrics.voteSucceeded();
    metrics.voteFailed();
    metrics.proposalSubmitted();
    metrics.proposalRejected('0xTX');
    metrics.signatureSubmitted();
    metrics.signatureRejected();
    metrics.pushSubmitted();
    metrics.pushRejected();

    const rendered = await metrics.render();
    for (const name of [
      'evm_run_count',
      'htr_run_count',
      'success_vote_count',
      'failed_vote_count',
      'successful_proposal_count',
      'invalid_proposal_count',
      'signing_count',
      'invalid_signing_count',
      'push_proposal_count',
      'invalid_push_proposal_count',
    ]) {
      expect(rendered).toMatch(new RegExp(`${name}(\\{[^}]*\\})? 1`));
    }
  });

  it('stamps the labels it is given onto every metric', async () => {
    const metrics = new PrometheusMetrics(new Registry(), { instance_address: '0xFED' });
    metrics.hathorRunCompleted();

    expect(await metrics.render()).toContain('instance_address="0xFED"');
  });
});
