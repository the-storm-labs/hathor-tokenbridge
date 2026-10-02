import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AxiosHttpClient } from './AxiosHttpClient';

/**
 * Driven against a real local HTTP server rather than a mocked axios. Mocking axios here would
 * only assert that axios was called the way this file calls it, which proves nothing about the
 * request that actually goes out - and the request shape is the entire job of this class.
 */
interface Received {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe('AxiosHttpClient', () => {
  let server: Server;
  let baseUrl: string;
  let received: Received[];
  let respond: (path: string) => { status: number; body: unknown };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const { status, body } = respond(request.url ?? '');
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    received = [];
    respond = () => ({ status: 200, body: { success: true } });
  });

  it('sends a GET with query parameters and default headers', async () => {
    const client = new AxiosHttpClient(baseUrl, { 'x-api-key': 'secret' });

    const response = await client.send({
      method: 'GET',
      path: 'wallet/address',
      query: { index: 0 },
      headers: { 'x-wallet-id': 'multi' },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true });
    expect(received[0]?.method).toBe('GET');
    expect(received[0]?.url).toBe('/wallet/address?index=0');
    expect(received[0]?.headers['x-api-key']).toBe('secret');
    expect(received[0]?.headers['x-wallet-id']).toBe('multi');
  });

  it('sends a POST body as JSON', async () => {
    const client = new AxiosHttpClient(baseUrl);
    await client.send({ method: 'POST', path: 'wallet/decode', body: { txHex: 'beef' } });

    expect(received[0]?.method).toBe('POST');
    expect(JSON.parse(received[0]?.body ?? '{}')).toEqual({ txHex: 'beef' });
    expect(received[0]?.headers['content-type']).toMatch(/application\/json/);
  });

  it('sends a PUT', async () => {
    const client = new AxiosHttpClient(baseUrl);
    await client.send({ method: 'PUT', path: 'wallet/utxos-selected-as-input', body: { ttl: 1000 } });
    expect(received[0]?.method).toBe('PUT');
  });

  it('returns non-2xx responses instead of throwing', async () => {
    // The headless signals real, actionable outcomes through non-2xx responses. Letting axios
    // throw would lose the body, and the body is where the reason is.
    respond = () => ({ status: 400, body: { success: false, error: 'inputs already spent' } });
    const client = new AxiosHttpClient(baseUrl);

    const response = await client.send<{ error: string }>({ method: 'POST', path: 'x' });
    expect(response.status).toBe(400);
    expect(response.data.error).toBe('inputs already spent');
  });

  it('normalises the base URL and the path so the join never doubles or drops a slash', async () => {
    const client = new AxiosHttpClient(`${baseUrl}/`);
    await client.send({ method: 'GET', path: '/wallet/status' });
    expect(received[0]?.url).toBe('/wallet/status');
  });

  it('gives up rather than hanging when the server does not answer', async () => {
    // A wallet that stops responding must not stall the federator indefinitely.
    respond = () => ({ status: 200, body: {} });
    const stalling = createServer(() => {
      /* accept the connection and never answer */
    });
    await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve));
    const port = (stalling.address() as AddressInfo).port;

    try {
      const client = new AxiosHttpClient(`http://127.0.0.1:${port}`, {}, 50);
      await expect(client.send({ method: 'GET', path: 'wallet/status' })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => stalling.close(() => resolve()));
    }
  });
});
