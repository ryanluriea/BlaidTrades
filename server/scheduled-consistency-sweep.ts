/**
 * Scheduled Consistency Sweep System
 * 
 * Industry-standard scheduled integrity checks for production systems.
 * Runs hourly drift detection, trade integrity checks, and audit chain verification.
 * 
 * Features:
 * - Hourly drift detection with auto-healing
 * - Trade data integrity verification
 * - Audit chain tamper detection
 * - Dead letter queue cleanup
 * - Comprehensive sweep reports
 */

import { db } from "./db";
import { consistencySweeps } from "@shared/schema";
import { sql } from "drizzle-orm";
import { runDriftDetection, DriftReport } from "./drift-detector";
import { runTradeIntegrityCheck, backfillTradeChecksums } from "./trade-integrity";
import { verifyAuditChain, getChainStats } from "./cryptographic-audit";
import { getDLQStats, cleanupOldDiscarded } from "./dead-letter-queue";
import { logActivityEvent } from "./activity-logger";

export interface SweepResult {
  sweepId: string;
  traceId: string;
  status: "COMPLETED" | "FAILED";
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  summary: {
    totalChecked: number;
    issuesFound: number;
    autoHealed: number;
    criticalCount: number;
    warningCount: number;
  };
  details: {
    driftDetection: any;
    tradeIntegrity: any;
    auditChain: any;
    deadLetterQueue: any;
  };
}

export async function runConsistencySweep(): Promise<SweepResult> {
  const traceId = `sweep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const startedAt = new Date();
  
  console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Starting scheduled sweep...`);

  const summary = {
    totalChecked: 0,
    issuesFound: 0,
    autoHealed: 0,
    criticalCount: 0,
    warningCount: 0,
  };

  const details: any = {
    driftDetection: null,
    tradeIntegrity: null,
    auditChain: null,
    deadLetterQueue: null,
  };

  let sweepId: string | null = null;
  let status: "COMPLETED" | "FAILED" = "COMPLETED";

  try {
    const [sweep] = await db.insert(consistencySweeps).values({
      traceId,
      status: "RUNNING",
    }).returning();
    sweepId = sweep.id;

    console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Running drift detection...`);
    try {
      const driftResult: DriftReport = await runDriftDetection(true);
      details.driftDetection = driftResult;
      summary.totalChecked += driftResult.totalChecked || 0;
      summary.issuesFound += driftResult.issuesFound?.length || 0;
      summary.autoHealed += driftResult.autoHealed || 0;
      summary.criticalCount += driftResult.criticalCount || 0;
      summary.warningCount += driftResult.warningCount || 0;
    } catch (error) {
      console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} Drift detection error:`, error);
      details.driftDetection = { error: String(error) };
    }

    console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Running trade integrity check...`);
    try {
      const tradeResult = await runTradeIntegrityCheck(undefined, 500);
      details.tradeIntegrity = tradeResult;
      summary.totalChecked += tradeResult.checked;
      
      if (tradeResult.corrupted > 0) {
        summary.issuesFound += tradeResult.corrupted;
        summary.criticalCount += tradeResult.corrupted;
      }
    } catch (error) {
      console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} Trade integrity error:`, error);
      details.tradeIntegrity = { error: String(error) };
    }

    console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Verifying audit chain...`);
    try {
      const chainVerification = await verifyAuditChain();
      const chainStats = await getChainStats();
      
      details.auditChain = {
        verification: chainVerification,
        stats: chainStats,
      };
      
      summary.totalChecked += chainVerification.checkedRecords;
      
      if (!chainVerification.valid) {
        summary.issuesFound++;
        summary.criticalCount++;
      }
    } catch (error) {
      console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} Audit chain error:`, error);
      details.auditChain = { error: String(error) };
    }

    console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Checking DLQ status...`);
    try {
      const dlqStats = await getDLQStats();
      details.deadLetterQueue = dlqStats;
      
      if (dlqStats.pending > 10) {
        summary.warningCount++;
      }
      
      if (dlqStats.pending > 50) {
        summary.criticalCount++;
      }

      await cleanupOldDiscarded(30);
    } catch (error) {
      console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} DLQ check error:`, error);
      details.deadLetterQueue = { error: String(error) };
    }

    console.log(`[CONSISTENCY_SWEEP] trace_id=${traceId} Backfilling missing checksums...`);
    try {
      const backfillResult = await backfillTradeChecksums(100);
      details.checksumBackfill = backfillResult;
    } catch (error) {
      console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} Checksum backfill error:`, error);
    }

  } catch (error) {
    console.error(`[CONSISTENCY_SWEEP] trace_id=${traceId} Sweep failed:`, error);
    status = "FAILED";
    summary.criticalCount++;
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  if (sweepId) {
    await db.update(consistencySweeps)
      .set({
        status,
        completedAt,
        totalChecked: summary.totalChecked,
        issuesFound: summary.issuesFound,
        autoHealed: summary.autoHealed,
        criticalCount: summary.criticalCount,
        warningCount: summary.warningCount,
        report: { details, durationMs },
      })
      .where(sql`id = ${sweepId}`);
  }

  const severity = summary.criticalCount > 0 ? "ERROR" :
                   summary.warningCount > 0 ? "WARN" : "INFO";

  await logActivityEvent({
    eventType: "SYSTEM_AUDIT",
    severity,
    title: `Consistency sweep ${status.toLowerCase()}`,
    traceId,
    payload: {
      ...summary,
      durationMs,
    },
  });

  console.log(
    `[CONSISTENCY_SWEEP] trace_id=${traceId} Completed in ${durationMs}ms: ` +
    `checked=${summary.totalChecked} issues=${summary.issuesFound} healed=${summary.autoHealed} ` +
    `critical=${summary.criticalCount} warning=${summary.warningCount}`
  );

  return {
    sweepId: sweepId || "unknown",
    traceId,
    status,
    startedAt,
    completedAt,
    durationMs,
    summary,
    details,
  };
}

export async function getRecentSweeps(limit: number = 10): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT *
    FROM consistency_sweeps
    ORDER BY started_at DESC
    LIMIT ${limit}
  `);
  
  return result.rows;
}

export async function getSweepById(sweepId: string): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT *
    FROM consistency_sweeps
    WHERE id = ${sweepId}
    LIMIT 1
  `);
  
  return result.rows[0] || null;
}
