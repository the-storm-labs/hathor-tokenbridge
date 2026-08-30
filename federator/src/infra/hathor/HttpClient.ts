/**
 * The slice of HTTP the headless adapter needs, as an interface it can be handed.
 *
 * The previous code called `axios` directly from inside the wallet class, which is why the only
 * way to test anything above it was to reach in and overwrite `requestWallet` on the live
 * singleton instance.
 */
export interface HttpResponse<T> {
  readonly status: number;
  readonly statusText?: string | undefined;
  readonly data: T;
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly body?: unknown;
  readonly query?: Record<string, string | number> | undefined;
  readonly headers?: Record<string, string> | undefined;
}

export interface HttpClient {
  send<T>(request: HttpRequest): Promise<HttpResponse<T>>;
}
