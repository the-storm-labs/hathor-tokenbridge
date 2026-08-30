import type { HttpClient, HttpRequest, HttpResponse } from '../HttpClient';

type Responder = (request: HttpRequest) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>;

/**
 * A scriptable HttpClient. Routes are keyed by "METHOD path"; a route can be given a fixed
 * response or a queue of responses consumed in order, which is how the readiness sequence
 * (syncing -> processing -> ready) is expressed.
 */
export class StubHttpClient implements HttpClient {
  public readonly requests: HttpRequest[] = [];
  private readonly routes = new Map<string, Responder>();
  private readonly queues = new Map<string, Array<HttpResponse<unknown>>>();

  private static key(method: string, path: string): string {
    return `${method} ${path.replace(/^\//, '')}`;
  }

  on(method: HttpRequest['method'], path: string, response: HttpResponse<unknown> | Responder): this {
    const responder: Responder = typeof response === 'function' ? response : () => response;
    this.routes.set(StubHttpClient.key(method, path), responder);
    return this;
  }

  /** Queues responses for successive calls to the same route; the last one repeats. */
  onSequence(method: HttpRequest['method'], path: string, responses: Array<HttpResponse<unknown>>): this {
    this.queues.set(StubHttpClient.key(method, path), [...responses]);
    return this;
  }

  async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    this.requests.push(request);
    const key = StubHttpClient.key(request.method, request.path);

    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.length === 1 ? queue[0] : queue.shift();
      return next as HttpResponse<T>;
    }

    const responder = this.routes.get(key);
    if (!responder) {
      throw new Error(`StubHttpClient: no response configured for "${key}"`);
    }
    return (await responder(request)) as HttpResponse<T>;
  }

  /** Every request made against a route, for asserting on what was actually sent. */
  requestsTo(method: HttpRequest['method'], path: string): HttpRequest[] {
    const key = StubHttpClient.key(method, path);
    return this.requests.filter((request) => StubHttpClient.key(request.method, request.path) === key);
  }
}

export const ok = <T>(data: T): HttpResponse<T> => ({ status: 200, statusText: 'OK', data });
