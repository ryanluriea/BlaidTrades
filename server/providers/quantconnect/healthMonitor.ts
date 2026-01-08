/**
 * QuantConnect Health Monitor
 * Tracks QC API health, detects persistent outages, and provides degraded mode bypass
 * 
 * QC_HEALTHY: API responding normally
 * QC_DEGRADED: >3 consecutive failures OR >50% failure rate in last hour
 * QC_OFFLINE: >5 consecutive failures AND last success >30 min ago
 */

export type QCHealthStatus = "QC_HEALTHY" | "QC_DEGRADED" | "QC_OFFLINE";

export interface QCHealthSnapshot {
  status: QCHealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastErrorMessage: string | null;
  failureRateLastHour: number;
  totalCallsLastHour: number;
  updatedAt: Date;
}

export interface QCHealthConfig {
  degradedAfterFailures: number;
  offlineAfterFailures: number;
  offlineAfterMinutesSinceSuccess: number;
  degradedFailureRateThreshold: number;
}

const DEFAULT_CONFIG: QCHealthConfig = {
  degradedAfterFailures: 3,
  offlineAfterFailures: 5,
  offlineAfterMinutesSinceSuccess: 30,
  degradedFailureRateThreshold: 0.5,
};

interface CallRecord {
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

const callHistory: CallRecord[] = [];
const ONE_HOUR_MS = 60 * 60 * 1000;

let currentState: QCHealthSnapshot = {
  status: "QC_HEALTHY",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastErrorMessage: null,
  failureRateLastHour: 0,
  totalCallsLastHour: 0,
  updatedAt: new Date(),
};

function pruneOldCalls(): void {
  const cutoff = new Date(Date.now() - ONE_HOUR_MS);
  while (callHistory.length > 0 && callHistory[0].timestamp < cutoff) {
    callHistory.shift();
  }
}

function calculateFailureRate(): { rate: number; total: number } {
  pruneOldCalls();
  if (callHistory.length === 0) {
    return { rate: 0, total: 0 };
  }
  const failures = callHistory.filter(c => !c.success).length;
  return { rate: failures / callHistory.length, total: callHistory.length };
}

function classifyStatus(config: QCHealthConfig = DEFAULT_CONFIG): QCHealthStatus {
  const { rate: failureRate } = calculateFailureRate();
  const now = Date.now();
  
  const minutesSinceSuccess = currentState.lastSuccessAt
    ? (now - currentState.lastSuccessAt.getTime()) / 60000
    : Infinity;
  
  if (
    currentState.consecutiveFailures >= config.offlineAfterFailures &&
    minutesSinceSuccess >= config.offlineAfterMinutesSinceSuccess
  ) {
    return "QC_OFFLINE";
  }
  
  if (
    currentState.consecutiveFailures >= config.degradedAfterFailures ||
    failureRate >= config.degradedFailureRateThreshold
  ) {
    return "QC_DEGRADED";
  }
  
  return "QC_HEALTHY";
}

export function recordQCSuccess(latencyMs?: number): QCHealthSnapshot {
  const now = new Date();
  
  callHistory.push({ timestamp: now, success: true });
  pruneOldCalls();
  
  const { rate, total } = calculateFailureRate();
  
  currentState = {
    status: "QC_HEALTHY",
    consecutiveFailures: 0,
    consecutiveSuccesses: currentState.consecutiveSuccesses + 1,
    lastSuccessAt: now,
    lastFailureAt: currentState.lastFailureAt,
    lastErrorMessage: null,
    failureRateLastHour: rate,
    totalCallsLastHour: total,
    updatedAt: now,
  };
  
  currentState.status = classifyStatus();
  
  if (currentState.consecutiveSuccesses === 1 && currentState.lastFailureAt) {
    console.log(`[QC_HEALTH] status=RECOVERED consecutive_successes=1 was_offline_minutes=${Math.round((now.getTime() - currentState.lastFailureAt.getTime()) / 60000)}`);
  }
  
  return currentState;
}

export function recordQCFailure(errorMessage: string): QCHealthSnapshot {
  const now = new Date();
  const previousStatus = currentState.status;
  
  callHistory.push({ timestamp: now, success: false, errorMessage });
  pruneOldCalls();
  
  const { rate, total } = calculateFailureRate();
  
  currentState = {
    status: "QC_DEGRADED",
    consecutiveFailures: currentState.consecutiveFailures + 1,
    consecutiveSuccesses: 0,
    lastSuccessAt: currentState.lastSuccessAt,
    lastFailureAt: now,
    lastErrorMessage: errorMessage,
    failureRateLastHour: rate,
    totalCallsLastHour: total,
    updatedAt: now,
  };
  
  currentState.status = classifyStatus();
  
  if (currentState.status !== previousStatus) {
    console.warn(
      `[QC_HEALTH] status=${currentState.status} consecutive_failures=${currentState.consecutiveFailures} failure_rate=${(rate * 100).toFixed(1)}% error="${errorMessage}"`
    );
  }
  
  return currentState;
}

export function getQCHealthStatus(): QCHealthSnapshot {
  currentState.status = classifyStatus();
  return { ...currentState };
}

export function isQCHealthy(): boolean {
  return classifyStatus() === "QC_HEALTHY";
}

export function isQCDegraded(): boolean {
  const status = classifyStatus();
  return status === "QC_DEGRADED" || status === "QC_OFFLINE";
}

export function isQCOffline(): boolean {
  return classifyStatus() === "QC_OFFLINE";
}

export interface DegradedBypassPolicy {
  allowBypass: boolean;
  reason: string;
  manualOverrideRequired: boolean;
}

export function getDegradedBypassPolicy(): DegradedBypassPolicy {
  const status = classifyStatus();
  
  if (status === "QC_HEALTHY") {
    return {
      allowBypass: false,
      reason: "QC API is healthy - normal verification flow required",
      manualOverrideRequired: false,
    };
  }
  
  if (status === "QC_OFFLINE") {
    return {
      allowBypass: true,
      reason: `QC API offline (${currentState.consecutiveFailures} consecutive failures). Trial promotion blocked until recovery. Manual override available.`,
      manualOverrideRequired: true,
    };
  }
  
  return {
    allowBypass: false,
    reason: `QC API degraded (${(currentState.failureRateLastHour * 100).toFixed(0)}% failure rate). Verification queued for retry.`,
    manualOverrideRequired: false,
  };
}

export function resetQCHealth(): void {
  callHistory.length = 0;
  currentState = {
    status: "QC_HEALTHY",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    failureRateLastHour: 0,
    totalCallsLastHour: 0,
    updatedAt: new Date(),
  };
  console.log("[QC_HEALTH] Health state reset");
}

export function simulateQCOutage(): void {
  for (let i = 0; i < 6; i++) {
    recordQCFailure("SIMULATED_OUTAGE: Manual test");
  }
  console.log("[QC_HEALTH] Simulated outage (6 consecutive failures)");
}

export function simulateQCRecovery(): void {
  for (let i = 0; i < 3; i++) {
    recordQCSuccess();
  }
  console.log("[QC_HEALTH] Simulated recovery (3 consecutive successes)");
}
