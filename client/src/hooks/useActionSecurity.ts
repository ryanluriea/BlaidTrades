/**
 * Action Security hook
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns allowed=false on any error or missing data
 * CONTRACT: { data: ActionSecurityData | null, degraded, error_code, message, trace_id }
 * 
 * INVARIANTS:
 * - If degraded=true, data MUST be null, error_code and message MUST be set
 * - If degraded=false and data.allowed=false, data contains denial reason
 * - If degraded=false and data.allowed=true, action is permitted
 */
import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type ActionType =
  | "START_RUNNER"
  | "STOP_RUNNER"
  | "PROMOTE_STAGE"
  | "DEMOTE_STAGE"
  | "ENABLE_LIVE_TRADING"
  | "DISABLE_LIVE_TRADING"
  | "KILL"
  | "RESURRECT"
  | "DELETE_BOT"
  | "CREATE_BOT"
  | string;

export interface ActionSecurityData {
  allowed: boolean;
  reason_code: string;
  reason_human: string;
  requires2FA?: boolean;
}

export interface ActionSecurityResult {
  data: ActionSecurityData | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

interface ActionSecurityCache {
  [key: string]: {
    result: ActionSecurityResult;
    timestamp: number;
  };
}

const CACHE_TTL_MS = 30_000;

/**
 * Create a canonical DENIED result (not degraded, but not allowed)
 */
function createDeniedResult(
  reason_code: string,
  reason_human: string,
  traceId: string
): ActionSecurityResult {
  return {
    data: {
      allowed: false,
      reason_code,
      reason_human,
    },
    degraded: false,
    error_code: null,
    message: null,
    trace_id: traceId,
  };
}

/**
 * Create a canonical DEGRADED result (system error, fail-closed)
 */
function createDegradedResult(
  error_code: string,
  message: string,
  traceId: string
): ActionSecurityResult {
  return {
    data: null,
    degraded: true,
    error_code,
    message,
    trace_id: traceId,
  };
}

/**
 * Create a canonical ALLOWED result
 */
function createAllowedResult(traceId: string): ActionSecurityResult {
  return {
    data: {
      allowed: true,
      reason_code: "ALLOWED",
      reason_human: "Action permitted",
    },
    degraded: false,
    error_code: null,
    message: null,
    trace_id: traceId,
  };
}

export function useActionSecurity() {
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(false);
  const cacheRef = useRef<ActionSecurityCache>({});

  const checkActionSecurity = useCallback(
    async (
      actionType: ActionType,
      options?: { botId?: string; accountId?: string; skipCache?: boolean }
    ): Promise<ActionSecurityResult> => {
      const { botId, accountId, skipCache } = options || {};
      const traceId = `as-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // FAIL-CLOSED: No user = denied (not degraded, just not allowed)
      if (!user?.id) {
        return createDeniedResult("NO_USER", "User authentication required", traceId);
      }

      const cacheKey = `${actionType}:${botId || ""}:${accountId || ""}`;
      const now = Date.now();

      // Check cache unless skipped - return deep clone to ensure immutability
      if (!skipCache && cacheRef.current[cacheKey]) {
        const cached = cacheRef.current[cacheKey];
        if (now - cached.timestamp < CACHE_TTL_MS) {
          // Return a fresh copy with same canonical structure
          const cachedResult = cached.result;
          return {
            data: cachedResult.data ? { ...cachedResult.data } : null,
            degraded: cachedResult.degraded,
            error_code: cachedResult.error_code,
            message: cachedResult.message,
            trace_id: cachedResult.trace_id,
          };
        }
      }

      setIsChecking(true);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/api/action-security', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: actionType,
            userId: user.id,
            botId,
            accountId,
          }),
          signal: controller.signal,
        }).catch((e) => {
          if (e.name === 'AbortError') {
            throw new Error('timeout');
          }
          throw e;
        }).finally(() => clearTimeout(timeoutId));

        // Handle 501 Not Implemented - this is DENIED, not DEGRADED
        // The server is working, it just doesn't support this action yet
        if (response.status === 501) {
          const data = await response.json();
          const result = createDeniedResult(
            "NOT_IMPLEMENTED",
            data.message || `Security check for '${actionType}' not implemented`,
            data.trace_id || traceId
          );
          cacheRef.current[cacheKey] = { result, timestamp: now };
          return result;
        }

        // FAIL-CLOSED: Non-OK response = DEGRADED (system error)
        if (!response.ok) {
          return createDegradedResult(
            `HTTP_${response.status}`,
            `Security service error (HTTP ${response.status})`,
            traceId
          );
        }

        const responseData = await response.json();

        // API-level failure = DEGRADED
        if (!responseData.success) {
          return createDegradedResult(
            responseData.error || "API_ERROR",
            responseData.message || "Security check failed",
            responseData.trace_id || traceId
          );
        }

        const securityData = responseData.data;
        const serverTraceId = securityData.trace_id || traceId;

        // If server reports degraded state, propagate it
        if (securityData.degraded) {
          return createDegradedResult(
            securityData.reason_code || "SERVER_DEGRADED",
            securityData.reason_human || "Security service in degraded state",
            serverTraceId
          );
        }

        // Normal response - either ALLOWED or DENIED
        let result: ActionSecurityResult;
        if (securityData.allowed) {
          result = createAllowedResult(serverTraceId);
        } else {
          result = createDeniedResult(
            securityData.reason_code,
            securityData.reason_human,
            serverTraceId
          );
        }

        // Cache successful responses
        cacheRef.current[cacheKey] = { result, timestamp: now };
        return result;
      } catch (error) {
        // FAIL-CLOSED: Any exception = DEGRADED
        console.error("[useActionSecurity] Check failed:", error);
        return createDegradedResult(
          error instanceof Error && error.message === 'timeout' ? "TIMEOUT" : "NETWORK_ERROR",
          error instanceof Error && error.message === 'timeout'
            ? "Security check timed out"
            : "Security check failed due to network error",
          traceId
        );
      } finally {
        setIsChecking(false);
      }
    },
    [user?.id]
  );

  const clearCache = useCallback(() => {
    cacheRef.current = {};
  }, []);

  return {
    checkActionSecurity,
    isChecking,
    clearCache,
  };
}

/**
 * Helper to check if action security result is degraded
 * Returns true if result is undefined, degraded, or data is null
 */
export function isActionSecurityDegraded(result: ActionSecurityResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

/**
 * Helper to safely check if action is allowed
 * Returns false if degraded (fail-closed), forcing explicit error handling
 */
export function isActionAllowed(result: ActionSecurityResult | undefined): boolean {
  if (isActionSecurityDegraded(result)) {
    return false;
  }
  return result!.data!.allowed;
}

/**
 * Helper to get denial reason
 * Returns appropriate message whether from normal denial or degraded state
 */
export function getActionDenialReason(result: ActionSecurityResult | undefined): string {
  if (!result) {
    return "Security check not performed";
  }
  if (result.degraded) {
    return result.message || "Security check failed - action blocked for safety";
  }
  if (result.data && !result.data.allowed) {
    return result.data.reason_human;
  }
  return "";
}
