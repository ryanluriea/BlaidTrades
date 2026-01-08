/**
 * Universal HTTP wrapper with timeout, requestId, and typed responses.
 * NEVER allows promises to hang indefinitely.
 */

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  requestId: string;
  durationMs: number;
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 1000;

// Store recent failures for debug bundle
const recentFailures: Array<{
  timestamp: string;
  url: string;
  method: string;
  status: number;
  error: string;
  requestId: string;
}> = [];

const MAX_FAILURES = 25;

export function getRecentFailures() {
  return [...recentFailures];
}

function addFailure(failure: typeof recentFailures[0]) {
  recentFailures.unshift(failure);
  if (recentFailures.length > MAX_FAILURES) {
    recentFailures.pop();
  }
}

// Generate a simple requestId without crypto dependency
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

export class HttpTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
    public readonly requestId: string
  ) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly requestId: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function fetchWithTimeout<T>(
  url: string,
  method: string,
  body: unknown | undefined,
  options: HttpOptions
): Promise<HttpResponse<T>> {
  const requestId = generateRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        ...options.headers,
      },
      signal: controller.signal,
      credentials: 'include', // Required for session cookie auth
    };
    
    if (body !== undefined && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    
    const durationMs = Date.now() - startTime;
    let data: T | null = null;
    let error: string | null = null;
    
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        const json = await response.json();
        if (response.ok) {
          data = json;
        } else {
          error = json.message || json.error || JSON.stringify(json);
          data = json;
        }
      } catch {
        error = 'Failed to parse JSON response';
      }
    } else {
      const text = await response.text();
      if (!response.ok) {
        error = text || `HTTP ${response.status}`;
      }
    }
    
    if (!response.ok) {
      addFailure({
        timestamp: new Date().toISOString(),
        url,
        method,
        status: response.status,
        error: error || 'Unknown error',
        requestId,
      });
    }
    
    return {
      ok: response.ok,
      status: response.status,
      data,
      error,
      requestId,
      durationMs,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    
    let errorMessage: string;
    let status = 0;
    
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        errorMessage = `TIMEOUT: Request timed out after ${timeoutMs}ms`;
        status = 408;
      } else {
        errorMessage = err.message;
      }
    } else {
      errorMessage = String(err);
    }
    
    addFailure({
      timestamp: new Date().toISOString(),
      url,
      method,
      status,
      error: errorMessage,
      requestId,
    });
    
    return {
      ok: false,
      status,
      data: null,
      error: errorMessage,
      requestId,
      durationMs,
    };
  }
}

async function fetchWithRetry<T>(
  url: string,
  method: string,
  body: unknown | undefined,
  options: HttpOptions
): Promise<HttpResponse<T>> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  
  let lastResponse: HttpResponse<T>;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResponse = await fetchWithTimeout<T>(url, method, body, options);
    
    // Don't retry on client errors (4xx) or success
    if (lastResponse.ok || (lastResponse.status >= 400 && lastResponse.status < 500)) {
      return lastResponse;
    }
    
    // Wait before retry (with exponential backoff)
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt)));
    }
  }
  
  return lastResponse!;
}

export const http = {
  async get<T>(url: string, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return fetchWithRetry<T>(url, 'GET', undefined, options);
  },
  
  async post<T>(url: string, body?: unknown, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return fetchWithRetry<T>(url, 'POST', body, options);
  },
  
  async put<T>(url: string, body?: unknown, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return fetchWithRetry<T>(url, 'PUT', body, options);
  },
  
  async patch<T>(url: string, body?: unknown, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return fetchWithRetry<T>(url, 'PATCH', body, options);
  },
  
  async delete<T>(url: string, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return fetchWithRetry<T>(url, 'DELETE', undefined, options);
  },
};

export default http;
