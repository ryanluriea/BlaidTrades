import { QueryClient } from "@tanstack/react-query";

/**
 * Institutional-grade Query Client Configuration
 * 
 * Core principle: INSTANT cache reads, silent background refresh
 * - 5-minute stale time: Show cached data immediately, refresh in background
 * - 30-minute GC time: Keep data in cache for instant access on navigation
 * - No window focus refetch: Prevents disruptive data flashing
 * - Placeholder data: Use stale data while fetching fresh
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: (failureCount, error: any) => {
        const status = error?.status ?? error?.response?.status;
        const code = error?.code ?? error?.error?.code;
        const message = String(error?.message ?? error?.error?.message ?? "");

        const isRestDegraded =
          status === 503 ||
          status === 504 ||
          code === "PGRST002" ||
          message.toLowerCase().includes("schema cache");

        if (isRestDegraded) return failureCount < 2;
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => {
        const base = 500;
        const max = 5_000;
        return Math.min(max, base * 2 ** attemptIndex);
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: false,
    },
  },
});

type RequestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function apiRequest<T = unknown>(
  url: string,
  method: RequestMethod = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}
