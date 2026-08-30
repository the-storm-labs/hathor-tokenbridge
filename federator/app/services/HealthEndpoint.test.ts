import { RecordingLogger } from '../ports/testSupport/fakes';
import { HealthEndpoint } from './HealthEndpoint';

/** Driven over real HTTP: the routes are the whole surface, and a stubbed express proves nothing. */
async function build(
  overrides: { metrics?: () => Promise<string>; status?: () => Promise<Record<string, unknown>> } = {},
) {
  const logger = new RecordingLogger();
  const endpoint = new HealthEndpoint({
    // Port 0 asks the OS for a free one; a fixed port makes the suite fail when something else has it.
    port: 0,
    logger,
    renderMetrics: overrides.metrics ?? (async () => 'evm_run_count 1'),
    status: overrides.status ?? (async () => ({ federator: '0xFED' })),
  });
  await endpoint.start();
  // The listener knows the port the OS chose.
  const address = (endpoint as unknown as { server: { address(): { port: number } } }).server.address();
  return { endpoint, logger, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('HealthEndpoint', () => {
  it('answers the liveness probe', async () => {
    const { endpoint, baseUrl } = await build();
    try {
      const response = await fetch(`${baseUrl}/isAlive`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      await endpoint.stop();
    }
  });

  it('serves metrics as plain text', async () => {
    const { endpoint, baseUrl } = await build();
    try {
      const response = await fetch(`${baseUrl}/metrics`);
      expect(response.headers.get('content-type')).toMatch(/text\/plain/);
      expect(await response.text()).toContain('evm_run_count');
    } finally {
      await endpoint.stop();
    }
  });

  it('reports status for a human', async () => {
    const { endpoint, baseUrl } = await build({ status: async () => ({ wallet: { state: 'ready' } }) });
    try {
      expect(await (await fetch(`${baseUrl}/status`)).json()).toEqual({ wallet: { state: 'ready' } });
    } finally {
      await endpoint.stop();
    }
  });

  it('answers 500 rather than hanging when metrics fail', async () => {
    const { endpoint, baseUrl, logger } = await build({
      metrics: async () => {
        throw new Error('registry exploded');
      },
    });
    try {
      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(500);
      expect(logger.at('error')).toMatch(/Failed to render metrics/);
    } finally {
      await endpoint.stop();
    }
  });

  it('tolerates stop being called twice', async () => {
    const { endpoint } = await build();
    await endpoint.stop();
    await expect(endpoint.stop()).resolves.toBeUndefined();
  });
});
