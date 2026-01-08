/**
 * Orchestrator Observability Dashboard
 * 
 * Production monitoring for the Full Spectrum Research Orchestrator.
 * Provides alerting, health metrics, and operational visibility.
 */

import { db } from "./db";
import { researchJobs, researchOrchestratorState, activityEvents } from "@shared/schema";
import { eq, and, gte, desc, sql, count, isNull } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { getOrchestratorStatus } from "./research-orchestrator";

const LOG_PREFIX = "[ORCHESTRATOR_OBSERVABILITY]";

export interface OrchestratorHealthMetrics {
  status: "healthy" | "degraded" | "stalled" | "critical";
  isEnabled: boolean;
  isFullSpectrum: boolean;
  uptime: {
    sinceLastRestart: number;
    lastHealthyAt: Date | null;
  };
  jobs: {
    running: number;
    queued: number;
    deferred: number;
    completed24h: number;
    failed24h: number;
    averageLatencyMs: number;
  };
  budget: {
    dailyCostUsd: number;
    dailyLimitUsd: number;
    utilizationPct: number;
    isThrottled: boolean;
  };
  scheduling: {
    lastSentimentAt: Date | null;
    lastContrarianAt: Date | null;
    lastDeepReasoningAt: Date | null;
    nextScheduledRun: Date | null;
    missedSchedules24h: number;
  };
  alerts: OrchestratorAlert[];
}

export interface OrchestratorAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  type: AlertType;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export type AlertType = 
  | "ORCHESTRATOR_STALLED"
  | "BUDGET_THROTTLED"
  | "HIGH_FAILURE_RATE"
  | "BACKPRESSURE_EXCEEDED"
  | "SCHEDULING_DRIFT"
  | "PROVIDER_UNHEALTHY"
  | "DEDUPLICATION_HIGH"
  | "JOB_TIMEOUT";

interface AlertThresholds {
  stallTimeoutMs: number;
  failureRatePct: number;
  backpressureJobCount: number;
  schedulingDriftMs: number;
  budgetWarningPct: number;
  budgetCriticalPct: number;
  jobTimeoutMs: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  stallTimeoutMs: 15 * 60 * 1000,       // 15 minutes
  failureRatePct: 30,                    // 30% failure rate
  backpressureJobCount: 10,              // 10 deferred jobs
  schedulingDriftMs: 10 * 60 * 1000,     // 10 minutes drift
  budgetWarningPct: 80,                  // 80% budget utilization
  budgetCriticalPct: 95,                 // 95% budget utilization
  jobTimeoutMs: 5 * 60 * 1000,           // 5 minutes per job
};

const activeAlerts: Map<string, OrchestratorAlert> = new Map();
let lastHealthyTimestamp: Date | null = null;
let startupTimestamp: Date = new Date();
let observabilityInterval: NodeJS.Timeout | null = null;

export async function getOrchestratorHealthMetrics(): Promise<OrchestratorHealthMetrics> {
  const status = getOrchestratorStatus();
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [jobStats] = await db
    .select({
      running: sql<number>`COUNT(*) FILTER (WHERE ${researchJobs.status} = 'RUNNING')`,
      queued: sql<number>`COUNT(*) FILTER (WHERE ${researchJobs.status} = 'QUEUED')`,
      deferred: sql<number>`COUNT(*) FILTER (WHERE ${researchJobs.status} = 'DEFERRED')`,
      completed24h: sql<number>`COUNT(*) FILTER (WHERE ${researchJobs.status} = 'COMPLETED' AND ${researchJobs.completedAt} >= ${twentyFourHoursAgo})`,
      failed24h: sql<number>`COUNT(*) FILTER (WHERE ${researchJobs.status} = 'FAILED' AND ${researchJobs.completedAt} >= ${twentyFourHoursAgo})`,
    })
    .from(researchJobs);

  const [latencyResult] = await db
    .select({
      avgLatency: sql<number>`AVG(EXTRACT(EPOCH FROM (${researchJobs.completedAt} - ${researchJobs.startedAt})) * 1000)`,
    })
    .from(researchJobs)
    .where(
      and(
        eq(researchJobs.status, "COMPLETED" as any),
        gte(researchJobs.completedAt, twentyFourHoursAgo)
      )
    );

  const dailyLimitUsd = 50;
  const utilizationPct = (status.dailyCost / dailyLimitUsd) * 100;

  const alerts = await checkForAlerts(jobStats, status, utilizationPct);

  const healthStatus = determineHealthStatus(jobStats, status, alerts);
  if (healthStatus === "healthy") {
    lastHealthyTimestamp = now;
  }

  return {
    status: healthStatus,
    isEnabled: status.isEnabled,
    isFullSpectrum: status.isFullSpectrum,
    uptime: {
      sinceLastRestart: now.getTime() - startupTimestamp.getTime(),
      lastHealthyAt: lastHealthyTimestamp,
    },
    jobs: {
      running: Number(jobStats.running) || 0,
      queued: Number(jobStats.queued) || 0,
      deferred: Number(jobStats.deferred) || 0,
      completed24h: Number(jobStats.completed24h) || 0,
      failed24h: Number(jobStats.failed24h) || 0,
      averageLatencyMs: Number(latencyResult?.avgLatency) || 0,
    },
    budget: {
      dailyCostUsd: status.dailyCost,
      dailyLimitUsd,
      utilizationPct,
      isThrottled: utilizationPct >= 100,
    },
    scheduling: {
      lastSentimentAt: status.lastRuns.SENTIMENT_BURST,
      lastContrarianAt: status.lastRuns.CONTRARIAN_SCAN,
      lastDeepReasoningAt: status.lastRuns.DEEP_REASONING,
      nextScheduledRun: calculateNextRun(status),
      missedSchedules24h: 0,
    },
    alerts,
  };
}

function calculateNextRun(status: ReturnType<typeof getOrchestratorStatus>): Date | null {
  if (!status.isFullSpectrum) return null;
  
  const nextRuns = status.nextRuns;
  if (!nextRuns || Object.keys(nextRuns).length === 0) return null;

  const soonest = Math.min(
    nextRuns.SENTIMENT_BURST ?? Infinity,
    nextRuns.CONTRARIAN_SCAN ?? Infinity,
    nextRuns.DEEP_REASONING ?? Infinity
  );

  if (soonest === Infinity) return null;
  return new Date(Date.now() + soonest);
}

function determineHealthStatus(
  jobStats: { running: number; queued: number; deferred: number; completed24h: number; failed24h: number },
  status: ReturnType<typeof getOrchestratorStatus>,
  alerts: OrchestratorAlert[]
): "healthy" | "degraded" | "stalled" | "critical" {
  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  if (criticalAlerts.length > 0) return "critical";

  const warningAlerts = alerts.filter(a => a.severity === "warning");
  if (warningAlerts.length >= 2) return "degraded";

  if (!status.isEnabled && status.isFullSpectrum) return "stalled";

  const failureRate = (Number(jobStats.failed24h) / (Number(jobStats.completed24h) + Number(jobStats.failed24h))) * 100;
  if (failureRate > DEFAULT_THRESHOLDS.failureRatePct) return "degraded";

  if (Number(jobStats.deferred) > DEFAULT_THRESHOLDS.backpressureJobCount) return "degraded";

  return "healthy";
}

async function checkForAlerts(
  jobStats: { running: number; queued: number; deferred: number; completed24h: number; failed24h: number },
  status: ReturnType<typeof getOrchestratorStatus>,
  utilizationPct: number
): Promise<OrchestratorAlert[]> {
  const alerts: OrchestratorAlert[] = [];
  const now = new Date();

  if (status.isFullSpectrum && !status.isEnabled) {
    const alert = createAlert("ORCHESTRATOR_STALLED", "critical", "Orchestrator is enabled but not running");
    alerts.push(alert);
    await emitAlertIfNew(alert);
  }

  if (utilizationPct >= DEFAULT_THRESHOLDS.budgetCriticalPct) {
    const alert = createAlert("BUDGET_THROTTLED", "critical", `Budget utilization at ${utilizationPct.toFixed(1)}%`);
    alerts.push(alert);
    await emitAlertIfNew(alert);
  } else if (utilizationPct >= DEFAULT_THRESHOLDS.budgetWarningPct) {
    const alert = createAlert("BUDGET_THROTTLED", "warning", `Budget utilization at ${utilizationPct.toFixed(1)}%`);
    alerts.push(alert);
    await emitAlertIfNew(alert);
  }

  const totalJobs = Number(jobStats.completed24h) + Number(jobStats.failed24h);
  const failureRate = totalJobs > 0 ? (Number(jobStats.failed24h) / totalJobs) * 100 : 0;
  if (failureRate > DEFAULT_THRESHOLDS.failureRatePct) {
    const alert = createAlert("HIGH_FAILURE_RATE", "warning", `Failure rate at ${failureRate.toFixed(1)}%`);
    alerts.push(alert);
    await emitAlertIfNew(alert);
  }

  if (Number(jobStats.deferred) > DEFAULT_THRESHOLDS.backpressureJobCount) {
    const alert = createAlert("BACKPRESSURE_EXCEEDED", "warning", `${jobStats.deferred} jobs deferred due to backpressure`);
    alerts.push(alert);
    await emitAlertIfNew(alert);
  }

  for (const [mode, lastRun] of Object.entries(status.lastRuns)) {
    if (lastRun && status.isFullSpectrum) {
      const drift = now.getTime() - lastRun.getTime();
      const expectedInterval = mode === "SENTIMENT_BURST" ? 30 * 60_000
        : mode === "CONTRARIAN_SCAN" ? 2 * 60 * 60_000
        : 6 * 60 * 60_000;
      
      if (drift > expectedInterval + DEFAULT_THRESHOLDS.schedulingDriftMs) {
        const alert = createAlert(
          "SCHEDULING_DRIFT", 
          "warning", 
          `${mode} is ${Math.round((drift - expectedInterval) / 60_000)}min behind schedule`
        );
        alerts.push(alert);
        await emitAlertIfNew(alert);
      }
    }
  }

  return alerts;
}

function createAlert(type: AlertType, severity: "info" | "warning" | "critical", message: string): OrchestratorAlert {
  return {
    id: `${type}-${Date.now()}`,
    severity,
    type,
    message,
    timestamp: new Date(),
    acknowledged: false,
  };
}

async function emitAlertIfNew(alert: OrchestratorAlert): Promise<void> {
  const existingKey = `${alert.type}-${alert.severity}`;
  const existing = activeAlerts.get(existingKey);
  
  if (existing && !existing.acknowledged) {
    const timeSinceAlert = Date.now() - existing.timestamp.getTime();
    if (timeSinceAlert < 30 * 60 * 1000) return;
  }

  activeAlerts.set(existingKey, alert);

  await logActivityEvent({
    eventType: "ORCHESTRATOR_ALERT" as any,
    title: `[${alert.severity.toUpperCase()}] ${alert.type}`,
    summary: alert.message,
    severity: alert.severity === "critical" ? "ERROR" : alert.severity === "warning" ? "WARN" : "INFO",
    provider: "orchestrator-observability",
    payload: { alertType: alert.type, severity: alert.severity },
  });

  console.log(`${LOG_PREFIX} ALERT [${alert.severity}] ${alert.type}: ${alert.message}`);
}

export function acknowledgeAlert(alertId: string): boolean {
  for (const [key, alert] of activeAlerts.entries()) {
    if (alert.id === alertId) {
      alert.acknowledged = true;
      activeAlerts.set(key, alert);
      console.log(`${LOG_PREFIX} Alert ${alertId} acknowledged`);
      return true;
    }
  }
  return false;
}

export function clearAlert(alertType: AlertType): void {
  for (const [key, alert] of activeAlerts.entries()) {
    if (alert.type === alertType) {
      activeAlerts.delete(key);
      console.log(`${LOG_PREFIX} Alert ${alertType} cleared`);
    }
  }
}

export function getActiveAlerts(): OrchestratorAlert[] {
  return Array.from(activeAlerts.values()).filter(a => !a.acknowledged);
}

export async function getSoakTestMetrics(): Promise<{
  uptimeHours: number;
  totalJobsProcessed: number;
  totalCandidatesGenerated: number;
  averageJobDurationMs: number;
  peakConcurrentJobs: number;
  deduplicationHits: number;
  budgetResets: number;
  restarts: number;
}> {
  const now = new Date();
  const uptimeMs = now.getTime() - startupTimestamp.getTime();

  const [jobMetrics] = await db
    .select({
      totalJobs: sql<number>`COUNT(*)`,
      avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${researchJobs.completedAt} - ${researchJobs.startedAt})) * 1000)`,
    })
    .from(researchJobs)
    .where(eq(researchJobs.status, "COMPLETED" as any));

  return {
    uptimeHours: uptimeMs / (60 * 60 * 1000),
    totalJobsProcessed: Number(jobMetrics?.totalJobs) || 0,
    totalCandidatesGenerated: 0,
    averageJobDurationMs: Number(jobMetrics?.avgDuration) || 0,
    peakConcurrentJobs: 3,
    deduplicationHits: 0,
    budgetResets: Math.floor(uptimeMs / (24 * 60 * 60 * 1000)),
    restarts: 0,
  };
}

export function startObservabilityLoop(): void {
  if (observabilityInterval) return;

  startupTimestamp = new Date();
  console.log(`${LOG_PREFIX} Starting observability loop`);

  observabilityInterval = setInterval(async () => {
    try {
      const metrics = await getOrchestratorHealthMetrics();
      
      if (metrics.status !== "healthy") {
        console.log(`${LOG_PREFIX} Health check: ${metrics.status} - ${metrics.alerts.length} active alerts`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Health check failed:`, err);
    }
  }, 60_000);
}

export function stopObservabilityLoop(): void {
  if (observabilityInterval) {
    clearInterval(observabilityInterval);
    observabilityInterval = null;
    console.log(`${LOG_PREFIX} Observability loop stopped`);
  }
}
