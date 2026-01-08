/**
 * Simple REST availability check - no longer depends on SecurityGateContext
 * Uses local state with circuit breaker pattern
 */
import { useState, useEffect, useCallback } from "react";

// Circuit breaker: track last REST failure
let lastRestFailure: number | null = null;
const CIRCUIT_BREAKER_DURATION = 2 * 60 * 1000; // 2 minutes

export function markRestFailure() {
  lastRestFailure = Date.now();
}

export function clearRestFailure() {
  lastRestFailure = null;
}

export function isRestCircuitOpen(): boolean {
  if (!lastRestFailure) return false;
  return Date.now() - lastRestFailure < CIRCUIT_BREAKER_DURATION;
}

/**
 * Hook that returns whether REST API should be considered available
 * Returns true by default - only returns false if recent failure detected
 */
export function useRestOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => !isRestCircuitOpen());

  useEffect(() => {
    // Check circuit breaker state periodically
    const interval = setInterval(() => {
      setIsOnline(!isRestCircuitOpen());
    }, 10_000); // Check every 10s

    return () => clearInterval(interval);
  }, []);

  return isOnline;
}

/**
 * Use this to wrap REST calls and automatically handle failures
 */
export async function withRestFallback<T>(
  restCall: () => Promise<T>,
  fallbackValue: T
): Promise<T> {
  if (isRestCircuitOpen()) {
    return fallbackValue;
  }

  try {
    const result = await restCall();
    clearRestFailure();
    return result;
  } catch (err: any) {
    // Check for PGRST002 or 503/504 errors
    const message = String(err?.message || "");
    const status = err?.status || err?.code;
    
    if (
      message.includes("PGRST002") ||
      message.includes("schema cache") ||
      status === 503 ||
      status === 504
    ) {
      markRestFailure();
    }
    
    return fallbackValue;
  }
}
