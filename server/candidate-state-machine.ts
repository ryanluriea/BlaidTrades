/**
 * Candidate Disposition State Machine
 * 
 * Industry-standard finite state machine for Strategy Lab candidates.
 * Enforces valid transitions and provides reconciliation utilities.
 * 
 * State Flow:
 * 
 *   PENDING_REVIEW ──┬──> QUEUED ──> QUEUED_FOR_QC ──┬──> SENT_TO_LAB ──> MERGED
 *                    │                               │
 *                    │                               └──> READY ──> SENT_TO_LAB
 *                    │
 *                    └──> REJECTED
 *                    └──> EXPIRED
 * 
 * All states can transition to REJECTED (manual rejection)
 * QUEUED_FOR_QC can transition to READY (QC completed but not auto-promoted)
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export type CandidateDisposition = 
  | "PENDING_REVIEW"
  | "QUEUED_FOR_QC"
  | "SENT_TO_LAB"
  | "QUEUED"
  | "READY"
  | "REJECTED"
  | "MERGED"
  | "EXPIRED"
  | "RECYCLED";

interface TransitionResult {
  allowed: boolean;
  reason?: string;
}

const VALID_TRANSITIONS: Record<CandidateDisposition, CandidateDisposition[]> = {
  PENDING_REVIEW: ["QUEUED", "QUEUED_FOR_QC", "SENT_TO_LAB", "REJECTED", "EXPIRED"],
  QUEUED: ["QUEUED_FOR_QC", "SENT_TO_LAB", "REJECTED", "EXPIRED", "READY"],
  QUEUED_FOR_QC: ["SENT_TO_LAB", "READY", "REJECTED", "EXPIRED"],
  READY: ["SENT_TO_LAB", "QUEUED_FOR_QC", "REJECTED", "EXPIRED", "MERGED"],
  SENT_TO_LAB: ["MERGED", "REJECTED", "RECYCLED"],
  REJECTED: [], // Terminal state
  MERGED: [],   // Terminal state
  EXPIRED: ["RECYCLED"], // Can be recycled
  RECYCLED: ["PENDING_REVIEW", "QUEUED"] // Can re-enter pipeline
};

const STUCK_STATE_TIMEOUTS_MS: Partial<Record<CandidateDisposition, number>> = {
  QUEUED_FOR_QC: 24 * 60 * 60 * 1000,  // 24 hours - QC should complete within a day
  QUEUED: 7 * 24 * 60 * 60 * 1000,      // 7 days - should be processed within a week
  PENDING_REVIEW: 30 * 24 * 60 * 60 * 1000 // 30 days - manual review timeout
};

export function validateTransition(
  from: CandidateDisposition,
  to: CandidateDisposition
): TransitionResult {
  if (from === to) {
    return { allowed: true, reason: "Same state (no-op)" };
  }
  
  const validTargets = VALID_TRANSITIONS[from];
  if (!validTargets) {
    return { 
      allowed: false, 
      reason: `Unknown source state: ${from}` 
    };
  }
  
  if (validTargets.includes(to)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: `Invalid transition: ${from} -> ${to}. Valid targets: [${validTargets.join(", ")}]`
  };
}

export function isTerminalState(disposition: CandidateDisposition): boolean {
  return VALID_TRANSITIONS[disposition]?.length === 0;
}

export function isStuckCandidate(
  disposition: CandidateDisposition,
  updatedAt: Date
): boolean {
  const timeout = STUCK_STATE_TIMEOUTS_MS[disposition];
  if (!timeout) return false;
  
  const age = Date.now() - updatedAt.getTime();
  return age > timeout;
}

export interface StuckCandidate {
  id: string;
  name: string;
  disposition: CandidateDisposition;
  updatedAt: Date;
  stuckDurationHours: number;
  recommendedAction: string;
}

export interface ReconciliationReport {
  timestamp: Date;
  stuckCandidates: StuckCandidate[];
  autoRepairedCount: number;
  manualReviewRequired: StuckCandidate[];
  errors: string[];
}

export async function runReconciliation(dryRun: boolean = true): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    timestamp: new Date(),
    stuckCandidates: [],
    autoRepairedCount: 0,
    manualReviewRequired: [],
    errors: []
  };
  
  const traceId = `recon-${Date.now().toString(36)}`;
  console.log(`[RECONCILIATION] trace_id=${traceId} Starting candidate reconciliation (dryRun=${dryRun})...`);
  
  try {
    const stuckCandidatesResult = await db.execute(sql`
      SELECT 
        id,
        strategy_name,
        disposition,
        updated_at
      FROM strategy_candidates
      WHERE disposition IN ('QUEUED_FOR_QC', 'QUEUED', 'PENDING_REVIEW')
        AND updated_at < NOW() - INTERVAL '24 hours'
      ORDER BY updated_at ASC
      LIMIT 100
    `);
    
    const candidates = stuckCandidatesResult.rows as Array<{
      id: string;
      strategy_name: string;
      disposition: CandidateDisposition;
      updated_at: Date;
    }>;
    
    for (const candidate of candidates) {
      const stuckDurationMs = Date.now() - new Date(candidate.updated_at).getTime();
      const stuckDurationHours = Math.round(stuckDurationMs / (1000 * 60 * 60));
      
      let recommendedAction = "MANUAL_REVIEW";
      
      if (candidate.disposition === "QUEUED_FOR_QC" && stuckDurationHours > 24) {
        recommendedAction = "MOVE_TO_READY";
      } else if (candidate.disposition === "QUEUED" && stuckDurationHours > 168) {
        recommendedAction = "MOVE_TO_EXPIRED";
      }
      
      const stuckCandidate: StuckCandidate = {
        id: candidate.id,
        name: candidate.strategy_name || "Unknown",
        disposition: candidate.disposition,
        updatedAt: new Date(candidate.updated_at),
        stuckDurationHours,
        recommendedAction
      };
      
      report.stuckCandidates.push(stuckCandidate);
      
      if (recommendedAction === "MOVE_TO_READY" && !dryRun) {
        try {
          await db.execute(sql`
            UPDATE strategy_candidates
            SET disposition = 'READY',
                updated_at = NOW()
            WHERE id = ${candidate.id}
              AND disposition = 'QUEUED_FOR_QC'
          `);
          
          console.log(`[RECONCILIATION] trace_id=${traceId} AUTO_REPAIRED candidate=${candidate.id} from=QUEUED_FOR_QC to=READY after=${stuckDurationHours}h`);
          report.autoRepairedCount++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          report.errors.push(`Failed to repair ${candidate.id}: ${errMsg}`);
        }
      } else if (recommendedAction !== "MOVE_TO_READY") {
        report.manualReviewRequired.push(stuckCandidate);
      }
    }
    
    console.log(`[RECONCILIATION] trace_id=${traceId} Complete: stuck=${report.stuckCandidates.length} autoRepaired=${report.autoRepairedCount} manualReview=${report.manualReviewRequired.length} errors=${report.errors.length}`);
    
    // QC-PASSED REPAIR: Find candidates with VERIFIED badge but not SENT_TO_LAB
    // These got stuck because auto-promotion failed after QC completion
    // Note: strategy_candidates table does not have user_id column, so we count only for observability
    // Valid badge_state enum values: DIVERGENT, VERIFIED, FAILED, INCONCLUSIVE
    try {
      const qcPassedStuckResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM strategy_candidates c
        JOIN qc_verifications q ON c.id = q.candidate_id
        WHERE q.status = 'COMPLETED'
          AND q.badge_state = 'VERIFIED'
          AND c.disposition NOT IN ('SENT_TO_LAB', 'REJECTED', 'MERGED')
          AND c.created_bot_id IS NULL
      `);
      
      const qcStuckCount = Number((qcPassedStuckResult.rows[0] as any)?.count || 0);
      if (qcStuckCount > 0) {
        console.log(`[RECONCILIATION] trace_id=${traceId} Found ${qcStuckCount} QC-passed candidates stuck (requires manual promotion via UI)`);
      }
    } catch (qcErr) {
      // Non-fatal: log but don't fail the entire reconciliation
      console.warn(`[RECONCILIATION] trace_id=${traceId} QC_PASSED_CHECK skipped: ${qcErr instanceof Error ? qcErr.message : String(qcErr)}`);
    }
    
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    report.errors.push(`Reconciliation query failed: ${errMsg}`);
    console.error(`[RECONCILIATION] trace_id=${traceId} FAILED: ${errMsg}`);
  }
  
  return report;
}

export async function runInvariantChecks(): Promise<{
  passed: boolean;
  violations: string[];
}> {
  const violations: string[] = [];
  const traceId = `invariant-${Date.now().toString(36)}`;
  
  console.log(`[INVARIANT_CHECK] trace_id=${traceId} Running state invariant checks...`);
  
  try {
    const terminalWithQcResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM strategy_candidates c
      JOIN qc_verifications q ON c.id = q.candidate_id
      WHERE c.disposition IN ('REJECTED', 'MERGED')
        AND q.status = 'QUEUED'
    `);
    
    const terminalWithQc = Number((terminalWithQcResult.rows[0] as any)?.count || 0);
    if (terminalWithQc > 0) {
      violations.push(`${terminalWithQc} candidates in terminal state with QUEUED QC jobs`);
    }
    
    const stuckQcResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM strategy_candidates
      WHERE disposition = 'QUEUED_FOR_QC'
        AND updated_at < NOW() - INTERVAL '48 hours'
    `);
    
    const stuckQc = Number((stuckQcResult.rows[0] as any)?.count || 0);
    if (stuckQc > 0) {
      violations.push(`${stuckQc} candidates stuck in QUEUED_FOR_QC for >48 hours`);
    }
    
    const orphanedLabResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM strategy_candidates
      WHERE disposition = 'SENT_TO_LAB'
        AND created_bot_id IS NULL
        AND updated_at < NOW() - INTERVAL '1 hour'
    `);
    
    const orphanedLab = Number((orphanedLabResult.rows[0] as any)?.count || 0);
    if (orphanedLab > 0) {
      violations.push(`${orphanedLab} SENT_TO_LAB candidates without created bot after 1 hour`);
    }
    
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    violations.push(`Invariant check query failed: ${errMsg}`);
  }
  
  const passed = violations.length === 0;
  
  if (passed) {
    console.log(`[INVARIANT_CHECK] trace_id=${traceId} All checks PASSED`);
  } else {
    console.warn(`[INVARIANT_CHECK] trace_id=${traceId} VIOLATIONS: ${violations.join("; ")}`);
  }
  
  return { passed, violations };
}

export async function safeTransition(
  candidateId: string,
  fromDisposition: CandidateDisposition,
  toDisposition: CandidateDisposition,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const validation = validateTransition(fromDisposition, toDisposition);
  
  if (!validation.allowed) {
    console.error(`[STATE_MACHINE] BLOCKED_TRANSITION candidate=${candidateId} ${fromDisposition}->${toDisposition}: ${validation.reason}`);
    return { success: false, error: validation.reason };
  }
  
  try {
    const result = await db.execute(sql`
      UPDATE strategy_candidates
      SET 
        disposition = ${toDisposition},
        updated_at = NOW()
      WHERE id = ${candidateId}
        AND disposition = ${fromDisposition}
      RETURNING id
    `);
    
    if (result.rows.length === 0) {
      return { 
        success: false, 
        error: `Candidate ${candidateId} not found or disposition changed` 
      };
    }
    
    console.log(`[STATE_MACHINE] TRANSITION candidate=${candidateId} ${fromDisposition}->${toDisposition} reason="${reason}"`);
    return { success: true };
    
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[STATE_MACHINE] TRANSITION_FAILED candidate=${candidateId}: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}
