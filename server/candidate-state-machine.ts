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
  | "WAITLIST"  // QC passed but fleet at capacity
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
  QUEUED_FOR_QC: ["SENT_TO_LAB", "READY", "WAITLIST", "REJECTED", "EXPIRED"],
  READY: ["SENT_TO_LAB", "WAITLIST", "QUEUED_FOR_QC", "REJECTED", "EXPIRED", "MERGED"],
  WAITLIST: ["SENT_TO_LAB", "REJECTED", "EXPIRED"], // Can promote when capacity opens
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

/**
 * Auto-promote QC-passed candidates when fleet has capacity
 * Moves READY/WAITLIST candidates to SENT_TO_LAB when there's room
 * Moves to WAITLIST when fleet is at capacity
 */
export interface PromotionCapacityResult {
  activeBotsCount: number;
  globalCap: number;
  trialsBotsCount: number;
  trialsCap: number;
  hasCapacity: boolean;
  availableSlots: number;
}

export async function getFleetCapacity(): Promise<PromotionCapacityResult> {
  // Get actual active bot count
  const activeBotsResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM bots 
    WHERE archived_at IS NULL AND killed_at IS NULL
  `);
  const activeBotsCount = Number((activeBotsResult.rows[0] as any)?.count || 0);
  
  // Get TRIALS-specific count
  const trialsBotsResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM bots 
    WHERE stage = 'TRIALS' AND archived_at IS NULL AND killed_at IS NULL
  `);
  const trialsBotsCount = Number((trialsBotsResult.rows[0] as any)?.count || 0);
  
  // Get fleet governor settings from strategy_lab_engine (import dynamically to avoid circular deps)
  const { getStrategyLabState } = await import("./strategy-lab-engine");
  const state = getStrategyLabState();
  
  const globalCap = state.fleetGovernorGlobalCap;
  const trialsCap = state.fleetGovernorTrialsCap;
  
  // Check capacity against BOTH global and trials caps
  const globalHasRoom = activeBotsCount < globalCap;
  const trialsHasRoom = trialsBotsCount < trialsCap;
  const hasCapacity = globalHasRoom && trialsHasRoom;
  
  // Available slots is the minimum of global and trials remaining
  const globalRemaining = Math.max(0, globalCap - activeBotsCount);
  const trialsRemaining = Math.max(0, trialsCap - trialsBotsCount);
  const availableSlots = Math.min(globalRemaining, trialsRemaining);
  
  return {
    activeBotsCount,
    globalCap,
    trialsBotsCount,
    trialsCap,
    hasCapacity,
    availableSlots,
  };
}

export interface QCPassedPromotionResult {
  promoted: number;
  waitlisted: number;
  errors: string[];
  capacityInfo: PromotionCapacityResult;
}

/**
 * Extended safe transition with metadata for QC promotion
 */
export async function safeTransitionWithMetadata(
  candidateId: string,
  fromDispositions: CandidateDisposition[],
  toDisposition: CandidateDisposition,
  reason: string,
  metadata: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  // Validate that at least one from->to transition is valid
  const anyValid = fromDispositions.some(from => validateTransition(from, toDisposition).allowed);
  
  if (!anyValid) {
    console.error(`[STATE_MACHINE] BLOCKED_TRANSITION candidate=${candidateId} ${fromDispositions.join("|")}->${toDisposition}: No valid transition path`);
    return { success: false, error: `No valid transition from ${fromDispositions.join("|")} to ${toDisposition}` };
  }
  
  try {
    const placeholders = fromDispositions.map(d => `'${d}'`).join(", ");
    const result = await db.execute(sql`
      UPDATE strategy_candidates
      SET 
        disposition = ${toDisposition},
        updated_at = NOW(),
        disposition_reason_json = ${JSON.stringify({ reason, ...metadata })}::jsonb
      WHERE id = ${candidateId}
        AND disposition IN (${sql.raw(placeholders)})
      RETURNING id
    `);
    
    if (result.rows.length === 0) {
      return { 
        success: false, 
        error: `Candidate ${candidateId} not found or disposition changed` 
      };
    }
    
    console.log(`[STATE_MACHINE] TRANSITION candidate=${candidateId} to ${toDisposition} reason="${reason}"`);
    return { success: true };
    
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[STATE_MACHINE] TRANSITION_FAILED candidate=${candidateId}: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// Advisory lock ID for QC promotion serialization
const QC_PROMOTION_LOCK_ID = 987654321;

/**
 * Promotes QC-passed candidates to SENT_TO_LAB when fleet has capacity
 * Moves candidates to WAITLIST when fleet is full
 * 
 * INSTITUTIONAL: Uses PostgreSQL advisory lock to serialize access
 * Prevents race conditions by ensuring only one worker can promote at a time
 * All transitions go through safeTransitionWithMetadata for audit trail
 */
export async function promoteQCPassedCandidates(dryRun: boolean = false): Promise<QCPassedPromotionResult> {
  const traceId = `qc-promo-${Date.now().toString(36)}`;
  const initialCapacity = await getFleetCapacity();
  const result: QCPassedPromotionResult = {
    promoted: 0,
    waitlisted: 0,
    errors: [],
    capacityInfo: initialCapacity,
  };
  
  console.log(`[QC_PROMOTION] trace_id=${traceId} Starting (dryRun=${dryRun}) active=${initialCapacity.activeBotsCount}/${initialCapacity.globalCap} trials=${initialCapacity.trialsBotsCount}/${initialCapacity.trialsCap}`);
  
  if (dryRun) {
    // Dry run doesn't need lock - just count what would happen
    return await runDryRunPromotion(traceId, initialCapacity, result);
  }
  
  // SERIALIZATION: Acquire advisory lock to prevent concurrent promotions
  try {
    const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(${QC_PROMOTION_LOCK_ID}) as acquired`);
    const lockAcquired = (lockResult.rows[0] as any)?.acquired === true;
    
    if (!lockAcquired) {
      console.log(`[QC_PROMOTION] trace_id=${traceId} SKIPPED - another promotion worker is running`);
      return result;
    }
    
    console.log(`[QC_PROMOTION] trace_id=${traceId} Advisory lock acquired - serialized promotion starting`);
    
    try {
      // Find all QC-passed candidates that need promotion
      const qcPassedCandidates = await db.execute(sql`
        SELECT c.id, c.strategy_name, c.disposition, c.confidence_score,
               q.badge_state as qc_badge_state, q.verified_at as qc_verified_at
        FROM strategy_candidates c
        JOIN qc_verifications q ON c.id = q.candidate_id
        WHERE q.status = 'COMPLETED'
          AND q.badge_state = 'VERIFIED'
          AND c.disposition IN ('READY', 'QUEUED_FOR_QC', 'WAITLIST')
          AND c.created_bot_id IS NULL
        ORDER BY c.confidence_score DESC NULLS LAST, c.created_at ASC
        LIMIT 50
      `);
      
      const candidates = qcPassedCandidates.rows as Array<{
        id: string;
        strategy_name: string;
        disposition: CandidateDisposition;
        confidence_score: number | null;
        qc_badge_state: string;
        qc_verified_at: Date | null;
      }>;
      
      console.log(`[QC_PROMOTION] trace_id=${traceId} found ${candidates.length} QC-passed candidates awaiting promotion`);
      
      // Get initial capacity - track locally to prevent over-promotion
      // Since bots aren't created until later, we must decrement locally
      const startCapacity = await getFleetCapacity();
      let slotsRemaining = startCapacity.availableSlots;
      
      console.log(`[QC_PROMOTION] trace_id=${traceId} Initial capacity: slots_remaining=${slotsRemaining} (active=${startCapacity.activeBotsCount}/${startCapacity.globalCap} trials=${startCapacity.trialsBotsCount}/${startCapacity.trialsCap})`);
      
      for (const candidate of candidates) {
        const metadata = {
          traceId,
          timestamp: new Date().toISOString(),
          source: 'promoteQCPassedCandidates',
          qcBadgeState: candidate.qc_badge_state,
          qcVerifiedAt: candidate.qc_verified_at?.toISOString() || null,
          activeBotsAtPromotion: startCapacity.activeBotsCount,
          trialsBotsAtPromotion: startCapacity.trialsBotsCount,
          globalCap: startCapacity.globalCap,
          trialsCap: startCapacity.trialsCap,
          slotsRemainingAtDecision: slotsRemaining,
        };
        
        if (slotsRemaining > 0) {
          // Capacity available - promote to SENT_TO_LAB
          const transitionResult = await safeTransitionWithMetadata(
            candidate.id,
            ["READY", "QUEUED_FOR_QC", "WAITLIST"],
            "SENT_TO_LAB",
            "QC_AUTO_PROMOTE",
            metadata
          );
          
          if (transitionResult.success) {
            result.promoted++;
            slotsRemaining--; // Decrement local counter to prevent over-promotion
            console.log(`[QC_PROMOTION] trace_id=${traceId} PROMOTED "${candidate.strategy_name}" to SENT_TO_LAB (slots_remaining=${slotsRemaining})`);
          } else {
            result.errors.push(`Transition failed for ${candidate.id}: ${transitionResult.error}`);
          }
        } else {
          // Fleet at capacity - move to WAITLIST (if not already)
          if (candidate.disposition !== "WAITLIST") {
            const transitionResult = await safeTransitionWithMetadata(
              candidate.id,
              ["READY", "QUEUED_FOR_QC"],
              "WAITLIST",
              "FLEET_AT_CAPACITY",
              metadata
            );
            
            if (transitionResult.success) {
              result.waitlisted++;
              console.log(`[QC_PROMOTION] trace_id=${traceId} WAITLISTED "${candidate.strategy_name}" (slots_remaining=${slotsRemaining})`);
            } else {
              result.errors.push(`Waitlist transition failed for ${candidate.id}: ${transitionResult.error}`);
            }
          }
        }
      }
      
      result.capacityInfo = await getFleetCapacity();
      console.log(`[QC_PROMOTION] trace_id=${traceId} Complete: promoted=${result.promoted} waitlisted=${result.waitlisted} errors=${result.errors.length}`);
      
    } finally {
      // Always release the advisory lock
      await db.execute(sql`SELECT pg_advisory_unlock(${QC_PROMOTION_LOCK_ID})`);
      console.log(`[QC_PROMOTION] trace_id=${traceId} Advisory lock released`);
    }
    
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`QC promotion failed: ${errMsg}`);
    console.error(`[QC_PROMOTION] trace_id=${traceId} FAILED: ${errMsg}`);
  }
  
  return result;
}

async function runDryRunPromotion(
  traceId: string,
  initialCapacity: PromotionCapacityResult,
  result: QCPassedPromotionResult
): Promise<QCPassedPromotionResult> {
  const qcPassedCandidates = await db.execute(sql`
    SELECT c.id, c.strategy_name, c.disposition
    FROM strategy_candidates c
    JOIN qc_verifications q ON c.id = q.candidate_id
    WHERE q.status = 'COMPLETED'
      AND q.badge_state = 'VERIFIED'
      AND c.disposition IN ('READY', 'QUEUED_FOR_QC', 'WAITLIST')
      AND c.created_bot_id IS NULL
    ORDER BY c.confidence_score DESC NULLS LAST
    LIMIT 50
  `);
  
  let simulatedSlots = initialCapacity.availableSlots;
  
  for (const row of qcPassedCandidates.rows as any[]) {
    if (simulatedSlots > 0) {
      result.promoted++;
      simulatedSlots--;
      console.log(`[QC_PROMOTION] trace_id=${traceId} WOULD_PROMOTE "${row.strategy_name}" (dryRun)`);
    } else if (row.disposition !== "WAITLIST") {
      result.waitlisted++;
      console.log(`[QC_PROMOTION] trace_id=${traceId} WOULD_WAITLIST "${row.strategy_name}" (dryRun)`);
    }
  }
  
  console.log(`[QC_PROMOTION] trace_id=${traceId} DRY_RUN Complete: would_promote=${result.promoted} would_waitlist=${result.waitlisted}`);
  return result;
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
