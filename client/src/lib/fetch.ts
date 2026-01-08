/**
 * Authenticated fetch helper that always includes credentials
 * Use this for all API calls to ensure session cookies are sent
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...options.headers,
    },
  });
}

/**
 * Authenticated JSON fetch helper - includes credentials and parses JSON response
 */
export async function fetchJSON<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Authenticated POST/PUT/PATCH/DELETE with JSON body
 */
export async function fetchMutate<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...options,
    method,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
