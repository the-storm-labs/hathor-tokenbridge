import express from 'express';
import type { Server } from 'node:http';

import type { LoggerPort } from '../ports/LoggerPort';

/**
 * The HTTP surface the federator exposes: a liveness probe and the Prometheus scrape.
 *
 * `/isAlive` answers as long as the process is up. It deliberately does not report on the wallet:
 * a wallet that is still syncing is healthy - a cold start rebuilds the entire history - and a
 * probe that failed during it would have an orchestrator restart the process into another cold
 * start, forever.
 */
export interface HealthEndpointDeps {
  readonly port: number;
  readonly logger: LoggerPort;
  readonly renderMetrics: () => Promise<string>;
  /** Reported by /status, for a human rather than for a probe. */
  readonly status: () => Promise<Record<string, unknown>>;
}

export class HealthEndpoint {
  private readonly deps: HealthEndpointDeps;
  private server?: Server;

  constructor(deps: HealthEndpointDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    const app = express();

    app.get('/isAlive', (_request, response) => {
      response.status(200).json({ status: 'ok' });
    });

    app.get('/metrics', (_request, response) => {
      this.deps
        .renderMetrics()
        .then((metrics) => response.status(200).type('text/plain').send(metrics))
        .catch((error) => {
          this.deps.logger.error('Failed to render metrics.', error);
          response.status(500).send('');
        });
    });

    app.get('/status', (_request, response) => {
      this.deps
        .status()
        .then((status) => response.status(200).json(status))
        .catch((error) => {
          this.deps.logger.error('Failed to read status.', error);
          response.status(500).json({ error: 'unavailable' });
        });
    });

    await new Promise<void>((resolve, reject) => {
      this.server = app.listen(this.deps.port, resolve).on('error', reject);
    });

    this.deps.logger.info(`Health endpoint listening on port ${this.deps.port}.`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = undefined as unknown as Server;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
