import axios from 'axios';
import type { AxiosInstance } from 'axios';

import type { HttpClient, HttpRequest, HttpResponse } from './HttpClient';

/** The production HttpClient: axios against a fixed base URL. */
export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}, timeoutMs = 60_000) {
    this.client = axios.create({
      baseURL: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-type': 'application/json', ...defaultHeaders },
      // Statuses are inspected rather than thrown on: the headless signals real, actionable
      // outcomes through non-2xx responses, and losing the body to an exception loses the reason.
      validateStatus: () => true,
    });
  }

  async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    const response = await this.client.request<T>({
      method: request.method,
      url: `/${request.path.replace(/^\//, '')}`,
      data: request.body,
      // Spread rather than assign: under exactOptionalPropertyTypes an explicit `undefined` is
      // not the same as an absent key, and axios's config types reject the former.
      ...(request.query ? { params: request.query } : {}),
      ...(request.headers ? { headers: request.headers } : {}),
    });

    return { status: response.status, statusText: response.statusText, data: response.data };
  }
}
