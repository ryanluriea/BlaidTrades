/**
 * Cross-Entity Drift Detector
 * 
 * Industry-standard consistency checker for detecting state drift
 * across related entities (bots, runners, metrics, accounts).
 * 
 * Runs scheduled sweeps to identify and optionally self-heal
 * misalignments that could cause data integrity issues.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";

export interface DriftIssue {
  type: 
    | "STAGE_MISMATCH"
    | "ORPHAN_RUNNER"
    | "ORPHAN_JOB"
    | "STALE_HEARTBEAT"
    | "ACCOUNT_MISMATCH"
    | "GENERATION_MISMATCH";
  severity: "CRITICAL" | "WARNING" | "INFO";
  entityType: "bot" | "runner" | "job" | "account";
  entityId: string;
  entityName?: string;
  description: string;
  expectedValue?: string;
  actualValue?: string;
  recommendation: string;
  autoHealable: boolean;
}

export interface DriftReport {
  timestamp: Date;
  traceId: string;
  duration_ms: number;
  totalChecked: number;
  issuesFound: DriftIssue[];
  autoHealed: number;
  criticalCount: number;
  warningCount: number;
}

const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export async function runDriftDetection(autoHeal: boolean = false): Promise<DriftReport> {
  const traceId = `drift-${Date.now().toString(36)}`;
  const startTime = Date.now();
  const issues: DriftIssue[] = [];
  let autoHealed = 0;
  let totalChecked = 0;

  console.log(`[DRIFT_DETECTOR] trace_id=${traceId} Starting drift detection (autoHeal=${autoHeal})...`);

  try {
    const orphanRunnerResult = await db.execute(sql`
      SELECT 
        bi.id as runner_id,
        bi.bot_id,
        bi.status,
        bi.job_type,
        b.id as bot_exists
      FROM bot_instances bi
      LEFT JOIN bots b ON bi.bot_id = b.id
      WHERE bi.job_type = 'RUNNER'
        AND bi.status IN ('RUNNING', 'STARTING')
        AND (b.id IS NULL OR b.archived_at IS NOT NULL OR b.killed_at IS NOT NULL)
    `);

    totalChecked += orphanRunnerResult.rows.length;

    for (const row of orphanRunnerResult.rows as any[]) {
      issues.push({
        type: "ORPHAN_RUNNER",
        severity: "WARNING",
        entityType: "runner",
        entityId: row.runner_id,
        description: `Runner references non-existent or archived bot`,
        actualValue: row.bot_id,
        recommendation: "Stop orphaned runner",
        autoHealable: true,
      });

      if (autoHeal) {
        await db.execute(sql`
          UPDATE bot_instances 
          SET status = 'STOPPED', 
              is_primary_runner = false,
              updated_at = NOW()
          WHERE id = ${row.runner_id}
        `);
        autoHealed++;
        console.log(`[DRIFT_DETECTOR] trace_id=${traceId} AUTO_HEALED orphan_runner=${row.runner_id}`);
      }
    }

    const staleHeartbeatResult = await db.execute(sql`
      SELECT 
        bi.id as runner_id,
        bi.bot_id,
        b.name as bot_name,
        bi.status,
        bi.last_heartbeat_at,
        EXTRACT(EPOCH FROM (NOW() - bi.last_heartbeat_at)) * 1000 as ms_since_heartbeat
      FROM bot_instances bi
      JOIN bots b ON bi.bot_id = b.id
      WHERE bi.job_type = 'RUNNER'
        AND bi.is_primary_runner = true
        AND bi.status = 'RUNNING'
        AND bi.last_heartbeat_at < NOW() - INTERVAL '5 minutes'
        AND b.archived_at IS NULL
        AND b.killed_at IS NULL
    `);

    totalChecked += staleHeartbeatResult.rows.length;

    for (const row of staleHeartbeatResult.rows as any[]) {
      issues.push({
        type: "STALE_HEARTBEAT",
        severity: "WARNING",
        entityType: "runner",
        entityId: row.runner_id,
        entityName: row.bot_name,
        description: `Runner heartbeat stale for ${Math.round(row.ms_since_heartbeat / 1000 / 60)} minutes`,
        actualValue: row.last_heartbeat_at?.toISOString(),
        recommendation: "Investigate runner health or restart",
        autoHealable: false,
      });
    }

    const orphanJobResult = await db.execute(sql`
      SELECT 
        bj.id as job_id,
        bj.bot_id,
        bj.job_type,
        bj.status,
        b.id as bot_exists
      FROM bot_jobs bj
      LEFT JOIN bots b ON bj.bot_id = b.id
      WHERE bj.status IN ('PENDING', 'RUNNING')
        AND (b.id IS NULL OR b.archived_at IS NOT NULL)
      LIMIT 100
    `);

    totalChecked += orphanJobResult.rows.length;

    for (const row of orphanJobResult.rows as any[]) {
      issues.push({
        type: "ORPHAN_JOB",
        severity: "WARNING",
        entityType: "job",
        entityId: row.job_id,
        description: `Job references non-existent or archived bot`,
        actualValue: row.bot_id,
        recommendation: "Cancel orphaned job",
        autoHealable: true,
      });

      if (autoHeal) {
        await db.execute(sql`
          UPDATE bot_jobs 
          SET status = 'CANCELLED',
              error_message = 'Auto-cancelled: bot archived or deleted',
              completed_at = NOW()
          WHERE id = ${row.job_id}
        `);
        autoHealed++;
        console.log(`[DRIFT_DETECTOR] trace_id=${traceId} AUTO_HEALED orphan_job=${row.job_id}`);
      }
    }

  } catch (error) {
    console.error(`[DRIFT_DETECTOR] trace_id=${traceId} Error:`, error);
  }

  const duration_ms = Date.now() - startTime;
  const criticalCount = issues.filter(i => i.severity === "CRITICAL").length;
  const warningCount = issues.filter(i => i.severity === "WARNING").length;

  const report: DriftReport = {
    timestamp: new Date(),
    traceId,
    duration_ms,
    totalChecked,
    issuesFound: issues,
    autoHealed,
    criticalCount,
    warningCount,
  };

  console.log(
    `[DRIFT_DETECTOR] trace_id=${traceId} Complete: ` +
    `checked=${totalChecked} issues=${issues.length} ` +
    `critical=${criticalCount} warnings=${warningCount} ` +
    `autoHealed=${autoHealed} duration=${duration_ms}ms`
  );

  if (criticalCount > 0) {
    await logActivityEvent({
      eventType: "SYSTEM_AUDIT",
      severity: "ERROR",
      title: `Drift Detector: ${criticalCount} critical issues found`,
      traceId,
      payload: { report },
    });
  }

  return report;
}

let driftDetectionInterval: NodeJS.Timeout | null = null;

export function startScheduledDriftDetection(intervalMs: number = 60 * 60 * 1000): void {
  if (driftDetectionInterval) {
    clearInterval(driftDetectionInterval);
  }

  console.log(`[DRIFT_DETECTOR] Scheduled drift detection every ${intervalMs / 1000 / 60} minutes`);

  runDriftDetection(true).catch(console.error);

  driftDetectionInterval = setInterval(() => {
    runDriftDetection(true).catch(console.error);
  }, intervalMs);
}

export function stopScheduledDriftDetection(): void {
  if (driftDetectionInterval) {
    clearInterval(driftDetectionInterval);
    driftDetectionInterval = null;
    console.log("[DRIFT_DETECTOR] Scheduled drift detection stopped");
  }
}
