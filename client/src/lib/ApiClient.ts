export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchFn = typeof fetch;

/** Thin JSON client for the OpenClue API. Sends the session cookie with every request. */
export class ApiClient {
  constructor(
    private readonly baseUrl = '/api',
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Sends multipart form data; the browser sets the multipart boundary header. */
  upload<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>('POST', path, form);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const payload = (data ?? {}) as { error?: string; issues?: { path: string; message: string }[] };
      throw new ApiError(res.status, payload.error ?? `Request failed (${res.status})`, payload.issues);
    }
    return data as T;
  }
}

export const api = new ApiClient();
