/**
 * Live Readiness - Single Source of Truth
 * Used by both UI and backend to determine if live trading is allowed
 */

export type BlockerCode =
  | "2FA_REQUIRED"
  | "2FA_STALE"
  | "NO_REDIS"
  | "REDIS_LATENCY_HIGH"
  | "NO_LIVE_MARKET_DATA"
  | "MARKET_DATA_STALE"
  | "NO_HISTORICAL_DATA"
  | "BROKER_NOT_VALIDATED"
  | "BROKER_AUTH_FAILED"
  | "QUEUE_BACKLOG_CRITICAL"
  | "UNRESOLVED_CRITICAL_ALERT"
  | "AUDIT_MISSING"
  | "AUDIT_STALE"
  | "AUDIT_FAILED"
  | "BOT_FLEET_STALLED"
  | "BOT_FLEET_DEGRADED"
  | "RISK_ENGINE_MISSING"
  | "MOCK_DATA_DETECTED"
  | "EMERGENCY_MODE_ACTIVE";

export interface Blocker {
  code: BlockerCode;
  message: string;
  severity: "CRITICAL" | "ERROR" | "WARNING";
  component: string;
  since?: string;
  cta?: string;
  deepLink?: string;
}

export interface ComponentHealth {
  name: string;
  status: "OK" | "DEGRADED" | "FAIL" | "UNKNOWN";
  lastSuccessAt?: string;
  latencyMs?: number;
  latencyP95Ms?: number;
  lastLiveTickAt?: string;
  lastHistoricalFetchAt?: string;
  stalenessSeconds?: number;
  errorCode?: string;
  lastErrorAt?: string;
  proofJson?: Record<string, unknown>;
}

export interface LiveReadinessInput {
  // User security
  require2FA: boolean;
  last2FAAt?: string | null;
  
  // App settings
  noMockData: boolean;
  mockDataDetected?: boolean;
  emergencyModeActive?: boolean;
  
  // Component health
  redisHealthy: boolean;
  redisLatencyMs?: number;
  
  marketDataLiveHealthy: boolean;
  marketDataLiveStalenessSeconds?: number;
  marketDataLiveThresholdSeconds: number;
  
  marketDataHistoricalAvailable: boolean;
  
  brokerValidated: boolean;
  brokerAuthOk?: boolean;
  
  queueBacklogCount?: number;
  queueBacklogThreshold: number;
  oldestJobAgeSeconds?: number;
  oldestJobAgeThreshold: number;
  
  criticalAlertCount: number;
  
  lastAuditStatus?: "PASS" | "FAIL" | null;
  lastAuditAt?: string | null;
  auditMaxAgeHours: number;
  
  stalledBotCount: number;
  degradedBotCount: number;
  liveBotCount: number;
  
  riskEngineLoaded: boolean;
  
  // Context: are we checking for SIM/PAPER or LIVE?
  // If not provided, assume checking for LIVE (strictest)
  targetMode?: "SIM" | "PAPER" | "SHADOW" | "CANARY" | "LIVE";
}

export interface LiveReadinessResult {
  liveReady: boolean;
  canaryReady: boolean;
  overallStatus: "OK" | "WARN" | "BLOCKED";
  blockers: Blocker[];
  componentHealth: ComponentHealth[];
  timestamp: string;
}

/**
 * Compute live readiness - the SINGLE truth function
 */
export function computeLiveReadiness(input: LiveReadinessInput): LiveReadinessResult {
  const blockers: Blocker[] = [];
  const componentHealth: ComponentHealth[] = [];
  const now = new Date();
  
  // Determine strictness based on target mode
  const isLiveMode = !input.targetMode || input.targetMode === "LIVE" || input.targetMode === "CANARY";

  // 1. Emergency mode check (highest priority) - blocks all modes
  if (input.emergencyModeActive) {
    blockers.push({
      code: "EMERGENCY_MODE_ACTIVE",
      message: "Emergency mode is active - all live trading suspended",
      severity: "CRITICAL",
      component: "Emergency Controls",
      cta: "Deactivate Emergency Mode",
      deepLink: "/settings",
    });
  }

  // 2. Mock data check - blocks all modes
  if (input.noMockData && input.mockDataDetected) {
    blockers.push({
      code: "MOCK_DATA_DETECTED",
      message: "Mock data detected in production environment",
      severity: "CRITICAL",
      component: "Data Integrity",
      cta: "Run Audit",
      deepLink: "/system-status",
    });
  }

  // 3. 2FA check - ONLY required for LIVE/CANARY modes
  if (input.require2FA && isLiveMode) {
    if (!input.last2FAAt) {
      blockers.push({
        code: "2FA_REQUIRED",
        message: "Two-factor authentication required for live trading",
        severity: "CRITICAL",
        component: "Authentication",
        cta: "Complete 2FA",
        deepLink: "/settings",
      });
    } else {
      const last2FADate = new Date(input.last2FAAt);
      const hoursSince2FA = (now.getTime() - last2FADate.getTime()) / (1000 * 60 * 60);
      if (hoursSince2FA > 24) {
        blockers.push({
          code: "2FA_STALE",
          message: "2FA verification expired (>24h). Re-verify to enable live trading.",
          severity: "ERROR",
          component: "Authentication",
          since: input.last2FAAt,
          cta: "Re-verify 2FA",
          deepLink: "/settings",
        });
      }
    }
  }

  // 4. Redis check - ONLY required for LIVE/CANARY modes
  componentHealth.push({
    name: "Redis",
    status: input.redisHealthy ? "OK" : (isLiveMode ? "FAIL" : "DEGRADED"),
    latencyMs: input.redisLatencyMs,
  });
  
  if (!input.redisHealthy && isLiveMode) {
    blockers.push({
      code: "NO_REDIS",
      message: "Redis connection failed - critical for order state management",
      severity: "CRITICAL",
      component: "Redis",
      cta: "Check Connections",
      deepLink: "/system-status",
    });
  } else if (input.redisLatencyMs && input.redisLatencyMs > 50 && isLiveMode) {
    blockers.push({
      code: "REDIS_LATENCY_HIGH",
      message: `Redis latency critically high: ${input.redisLatencyMs}ms (>50ms threshold)`,
      severity: "ERROR",
      component: "Redis",
      cta: "Check Infrastructure",
      deepLink: "/system-status",
    });
  }

  // 5. Market Data Live check - ONLY critical for LIVE/CANARY modes
  componentHealth.push({
    name: "Market Data Live",
    status: input.marketDataLiveHealthy ? "OK" : (isLiveMode ? "FAIL" : "DEGRADED"),
    stalenessSeconds: input.marketDataLiveStalenessSeconds,
  });

  if (!input.marketDataLiveHealthy && isLiveMode) {
    blockers.push({
      code: "NO_LIVE_MARKET_DATA",
      message: "No live market data available - cannot execute trades safely",
      severity: "CRITICAL",
      component: "Market Data Live",
      cta: "Configure Market Data",
      deepLink: "/system-status",
    });
  } else if (
    input.marketDataLiveStalenessSeconds !== undefined &&
    input.marketDataLiveStalenessSeconds > input.marketDataLiveThresholdSeconds &&
    isLiveMode
  ) {
    blockers.push({
      code: "MARKET_DATA_STALE",
      message: `Market data stale: ${input.marketDataLiveStalenessSeconds}s (threshold: ${input.marketDataLiveThresholdSeconds}s)`,
      severity: "CRITICAL",
      component: "Market Data Live",
      cta: "Run Smoke Test",
      deepLink: "/system-status",
    });
  }

  // 6. Historical data check - warning only, not blocking
  componentHealth.push({
    name: "Market Data Historical",
    status: input.marketDataHistoricalAvailable ? "OK" : "DEGRADED",
  });

  if (!input.marketDataHistoricalAvailable) {
    blockers.push({
      code: "NO_HISTORICAL_DATA",
      message: "Historical data unavailable - backtests and evaluations blocked",
      severity: "WARNING",
      component: "Market Data Historical",
      cta: "Check Data Providers",
      deepLink: "/system-status",
    });
  }

  // 7. Broker check - ONLY required for LIVE/CANARY modes
  componentHealth.push({
    name: "Brokers",
    status: input.brokerValidated ? "OK" : (isLiveMode ? "FAIL" : "UNKNOWN"),
  });

  if (!input.brokerValidated && isLiveMode) {
    blockers.push({
      code: "BROKER_NOT_VALIDATED",
      message: "No broker validated - live order execution not possible",
      severity: "CRITICAL",
      component: "Brokers",
      cta: "Validate Broker",
      deepLink: "/system-status",
    });
  } else if (input.brokerAuthOk === false && isLiveMode) {
    blockers.push({
      code: "BROKER_AUTH_FAILED",
      message: "Broker authentication failed - check credentials",
      severity: "CRITICAL",
      component: "Brokers",
      cta: "Update Credentials",
      deepLink: "/system-status",
    });
  }

  // 8. Queue check
  componentHealth.push({
    name: "Queues",
    status:
      input.queueBacklogCount !== undefined &&
      input.queueBacklogCount < input.queueBacklogThreshold
        ? "OK"
        : "DEGRADED",
  });

  if (
    (input.queueBacklogCount !== undefined && input.queueBacklogCount > input.queueBacklogThreshold) ||
    (input.oldestJobAgeSeconds !== undefined && input.oldestJobAgeSeconds > input.oldestJobAgeThreshold)
  ) {
    blockers.push({
      code: "QUEUE_BACKLOG_CRITICAL",
      message: `Queue backlog critical: ${input.queueBacklogCount} jobs pending`,
      severity: "ERROR",
      component: "Queues",
      cta: "Check Queues",
      deepLink: "/system-status",
    });
  }

  // 9. Critical alerts check
  if (input.criticalAlertCount > 0) {
    blockers.push({
      code: "UNRESOLVED_CRITICAL_ALERT",
      message: `${input.criticalAlertCount} unresolved critical alert(s) require attention`,
      severity: "CRITICAL",
      component: "Alerts",
      cta: "View Alerts",
      deepLink: "/bots",
    });
  }

  // 10. Audit check - only blocking for LIVE/CANARY
  componentHealth.push({
    name: "Audit",
    status: input.lastAuditStatus === "PASS" ? "OK" : input.lastAuditStatus === "FAIL" ? "FAIL" : "UNKNOWN",
    lastSuccessAt: input.lastAuditAt || undefined,
  });

  if (!input.lastAuditStatus && isLiveMode) {
    blockers.push({
      code: "AUDIT_MISSING",
      message: "No audit has been run - required for live trading approval",
      severity: "ERROR",
      component: "Audit",
      cta: "Run Full Audit",
      deepLink: "/system-status",
    });
  } else if (input.lastAuditStatus === "FAIL" && isLiveMode) {
    blockers.push({
      code: "AUDIT_FAILED",
      message: "Last audit FAILED - address issues before live trading",
      severity: "CRITICAL",
      component: "Audit",
      cta: "View Audit Report",
      deepLink: "/system-status",
    });
  } else if (input.lastAuditAt && isLiveMode) {
    const auditAge = (now.getTime() - new Date(input.lastAuditAt).getTime()) / (1000 * 60 * 60);
    if (auditAge > input.auditMaxAgeHours) {
      blockers.push({
        code: "AUDIT_STALE",
        message: `Audit is stale: ${Math.round(auditAge)}h old (max: ${input.auditMaxAgeHours}h)`,
        severity: "WARNING",
        component: "Audit",
        since: input.lastAuditAt,
        cta: "Run Full Audit",
        deepLink: "/system-status",
      });
    }
  }

  // 11. Bot fleet check
  componentHealth.push({
    name: "Bot Fleet",
    status:
      input.stalledBotCount === 0 && input.degradedBotCount === 0
        ? "OK"
        : input.degradedBotCount > 0
        ? "DEGRADED"
        : "FAIL",
  });

  if (input.stalledBotCount > 0 && input.liveBotCount > 0) {
    blockers.push({
      code: "BOT_FLEET_STALLED",
      message: `${input.stalledBotCount} LIVE/CANARY bot(s) have stalled heartbeats`,
      severity: "CRITICAL",
      component: "Bot Fleet",
      cta: "View Bots",
      deepLink: "/bots",
    });
  }

  if (input.degradedBotCount > 0 && input.liveBotCount > 0) {
    blockers.push({
      code: "BOT_FLEET_DEGRADED",
      message: `${input.degradedBotCount} LIVE/CANARY bot(s) are in DEGRADED health`,
      severity: "ERROR",
      component: "Bot Fleet",
      cta: "View Bots",
      deepLink: "/bots",
    });
  }

  // 12. Risk engine check
  componentHealth.push({
    name: "Risk Engine",
    status: input.riskEngineLoaded ? "OK" : "FAIL",
  });

  if (!input.riskEngineLoaded) {
    blockers.push({
      code: "RISK_ENGINE_MISSING",
      message: "Risk engine failed to load - cannot enforce trading limits",
      severity: "CRITICAL",
      component: "Risk Engine",
      cta: "Check Configuration",
      deepLink: "/settings",
    });
  }

  // Determine overall status
  const criticalBlockers = blockers.filter((b) => b.severity === "CRITICAL");
  const errorBlockers = blockers.filter((b) => b.severity === "ERROR");
  
  const liveReady = criticalBlockers.length === 0 && errorBlockers.length === 0;
  const canaryReady = criticalBlockers.length === 0;
  
  let overallStatus: "OK" | "WARN" | "BLOCKED";
  if (criticalBlockers.length > 0 || errorBlockers.length > 0) {
    overallStatus = "BLOCKED";
  } else if (blockers.length > 0) {
    overallStatus = "WARN";
  } else {
    overallStatus = "OK";
  }

  return {
    liveReady,
    canaryReady,
    overallStatus,
    blockers,
    componentHealth,
    timestamp: now.toISOString(),
  };
}

/**
 * Check if execution should be blocked
 * This is the invariant check for broker execution path
 */
export function shouldBlockLiveExecution(
  readiness: LiveReadinessResult,
  runMode: string,
  accountType: string
): { blocked: boolean; reason?: string; blockerCode?: BlockerCode } {
  // Only check for LIVE mode on LIVE accounts
  if (runMode !== "LIVE" || accountType !== "LIVE") {
    return { blocked: false };
  }

  if (!readiness.liveReady) {
    const topBlocker = readiness.blockers.find((b) => b.severity === "CRITICAL") || readiness.blockers[0];
    return {
      blocked: true,
      reason: topBlocker?.message || "Live trading not ready",
      blockerCode: topBlocker?.code,
    };
  }

  return { blocked: false };
}

/**
 * Default thresholds for live readiness checks
 */
export const DEFAULT_THRESHOLDS = {
  marketDataLiveThresholdSeconds: 5, // 5 seconds for ticks
  queueBacklogThreshold: 100,
  oldestJobAgeThreshold: 300, // 5 minutes
  auditMaxAgeHours: 6,
};
