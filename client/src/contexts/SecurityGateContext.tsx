import React, { createContext, useContext, useMemo, useRef, useState, useEffect, useCallback } from "react";

export type RestDegradeReason = {
  endpoint: string;
  status?: number;
  code?: string;
  message: string;
  at: string;
};

type SecurityGateState = {
  strict: boolean;
  limitedMode: boolean;
  /** consecutive REST failures counted for the circuit breaker */
  restFailCount: number;
  /** epoch ms until which REST calls should be considered disabled */
  restDisabledUntil: number | null;
  lastRestError: RestDegradeReason | null;
  /** Last successful REST check timestamp */
  lastHealthyAt: number | null;
  /** Is currently checking health */
  isCheckingHealth: boolean;
  markRestDegraded: (reason: Omit<RestDegradeReason, "at">) => void;
  clearLimitedMode: () => void;
  /** Force a health check now */
  checkHealth: () => Promise<boolean>;
  /** Debug info for display */
  getDebugInfo: () => Record<string, unknown>;
};

const SecurityGateContext = createContext<SecurityGateState | null>(null);

function parseStrictEnv(): boolean {
  const raw = String((import.meta as any).env?.VITE_SECURITY_GATE_STRICT ?? "false").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

// Circuit breaker config
const CIRCUIT_BREAKER_THRESHOLD = 2; // failures before circuit opens
const CIRCUIT_BREAKER_COOLDOWN_MS = 2 * 60_000; // 2 minutes (reduced from 5)
const HEALTH_CHECK_INTERVAL_MS = 30_000; // check every 30s when in limited mode
const FAILURE_WINDOW_MS = 15_000; // failures within this window are "consecutive"

export function SecurityGateProvider({ children }: { children: React.ReactNode }) {
  const strict = useMemo(() => parseStrictEnv(), []);

  // CRITICAL: Start clean on every page load - NO sticky degraded state
  const [limitedMode, setLimitedMode] = useState(false);
  const [restFailCount, setRestFailCount] = useState(0);
  const [restDisabledUntil, setRestDisabledUntil] = useState<number | null>(null);
  const [lastRestError, setLastRestError] = useState<RestDegradeReason | null>(null);
  const [lastHealthyAt, setLastHealthyAt] = useState<number | null>(() => Date.now()); // Assume healthy on mount
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const consecutiveRef = useRef(0);
  const lastFailureAtRef = useRef<number | null>(null);
  const healthCheckIntervalRef = useRef<number | null>(null);
  const mountTimeRef = useRef(Date.now());
  
  // AUTO-CLEAR: On mount, check health immediately if coming from a previous session
  useEffect(() => {
    // Clear any stale localStorage flags (legacy cleanup)
    try {
      localStorage.removeItem("security_gate_degraded");
      localStorage.removeItem("rest_disabled_until");
    } catch {}
    
    // Immediate health check on mount - don't wait
    const timeout = setTimeout(() => {
      console.log("[SecurityGate] Mount health check after 1s");
      // checkHealth will be defined later, use a ref
    }, 1000);
    
    return () => clearTimeout(timeout);
  }, []);

  // Health check function - tests if Express API is working (SINGLE CONTROL PLANE)
  const checkHealth = useCallback(async (): Promise<boolean> => {
    setIsCheckingHealth(true);
    try {
      // Use Express endpoint for health check - no Supabase Edge Functions
      const response = await fetch("/api/system/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!response.ok) {
        console.warn("[SecurityGate] Health check failed:", response.status);
        return false;
      }

      const data = await response.json();
      if (data?.success && data?.data?.system_status !== "BLOCKED") {
        // Express API is healthy!
        console.log("[SecurityGate] Health check passed");
        setLastHealthyAt(Date.now());
        
        // Auto-clear limited mode on recovery
        setLimitedMode(false);
        setRestDisabledUntil(null);
        setRestFailCount(0);
        setLastRestError(null);
        consecutiveRef.current = 0;
        lastFailureAtRef.current = null;
        
        return true;
      }
      
      return false;
    } catch (err) {
      console.warn("[SecurityGate] Health check error:", err);
      return false;
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  // Auto-check health when circuit breaker expires
  useEffect(() => {
    if (restDisabledUntil) {
      const now = Date.now();
      const delay = Math.max(0, restDisabledUntil - now);
      
      const timeout = setTimeout(() => {
        console.log("[SecurityGate] Circuit breaker cooldown expired, checking health...");
        checkHealth();
      }, delay);
      
      return () => clearTimeout(timeout);
    }
  }, [restDisabledUntil, checkHealth]);

  // Periodic health check when in limited mode
  useEffect(() => {
    if (limitedMode && !restDisabledUntil) {
      // Circuit is closed but we're degraded - check periodically
      healthCheckIntervalRef.current = window.setInterval(() => {
        checkHealth();
      }, HEALTH_CHECK_INTERVAL_MS);
      
      return () => {
        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current);
        }
      };
    }
  }, [limitedMode, restDisabledUntil, checkHealth]);

  const markRestDegraded: SecurityGateState["markRestDegraded"] = (reason) => {
    const now = Date.now();

    // If failures are spread out, don't count them as consecutive.
    if (!lastFailureAtRef.current || now - lastFailureAtRef.current > FAILURE_WINDOW_MS) {
      consecutiveRef.current = 0;
    }

    lastFailureAtRef.current = now;
    consecutiveRef.current += 1;

    setLimitedMode(true);
    setLastRestError({ ...reason, at: new Date().toISOString() });

    // Circuit breaker: after threshold failures, stop hitting PostgREST for cooldown period
    if (consecutiveRef.current >= CIRCUIT_BREAKER_THRESHOLD) {
      const until = now + CIRCUIT_BREAKER_COOLDOWN_MS;
      setRestDisabledUntil(until);
      setRestFailCount(consecutiveRef.current);
      console.warn(`[SecurityGate] Circuit breaker OPEN until ${new Date(until).toISOString()}`);
    } else {
      setRestFailCount(consecutiveRef.current);
    }
  };

  const clearLimitedMode = useCallback(() => {
    console.log("[SecurityGate] Manually clearing limited mode");
    setLastRestError(null);
    consecutiveRef.current = 0;
    lastFailureAtRef.current = null;
    setRestFailCount(0);
    setRestDisabledUntil(null);
    setLimitedMode(false);
    setLastHealthyAt(Date.now());
  }, []);

  const getDebugInfo = useCallback(() => ({
    limitedMode,
    restFailCount,
    restDisabledUntil: restDisabledUntil ? new Date(restDisabledUntil).toISOString() : null,
    restDisabledFor: restDisabledUntil ? `${Math.max(0, Math.round((restDisabledUntil - Date.now()) / 1000))}s` : null,
    lastRestError,
    lastHealthyAt: lastHealthyAt ? new Date(lastHealthyAt).toISOString() : null,
    strict,
    consecutiveFailures: consecutiveRef.current,
    buildTime: new Date().toISOString(),
    circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
    circuitBreakerCooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
  }), [limitedMode, restFailCount, restDisabledUntil, lastRestError, lastHealthyAt, strict]);

  const value: SecurityGateState = {
    strict,
    limitedMode,
    restFailCount,
    restDisabledUntil,
    lastRestError,
    lastHealthyAt,
    isCheckingHealth,
    markRestDegraded,
    clearLimitedMode,
    checkHealth,
    getDebugInfo,
  };

  return <SecurityGateContext.Provider value={value}>{children}</SecurityGateContext.Provider>;
}

/** Default state returned when hook is called outside provider (fail-open). */
const DEFAULT_GATE_STATE: SecurityGateState = {
  strict: false,
  limitedMode: false,
  restFailCount: 0,
  restDisabledUntil: null,
  lastRestError: null,
  lastHealthyAt: null,
  isCheckingHealth: false,
  markRestDegraded: () => {},
  clearLimitedMode: () => {},
  checkHealth: async () => true,
  getDebugInfo: () => ({}),
};

export function useSecurityGate(): SecurityGateState {
  const ctx = useContext(SecurityGateContext);
  // Fail open: return safe defaults if context is missing (e.g., during initial render).
  if (!ctx) {
    console.warn("[SecurityGate] Context not found, returning defaults (fail-open).");
    return DEFAULT_GATE_STATE;
  }
  return ctx;
}
