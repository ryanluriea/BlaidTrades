/**
 * Strategy Lab Candidate Enrichment
 * INSTITUTIONAL: Reusable enrichment logic for cache warming and live responses
 * Ensures cached data matches live responses with QC badges and regime adjustments
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getCachedRegime } from "../ai-strategy-evolution";

/**
 * Helper to validate UUID format
 */
function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * QC Verification data structure
 */
interface QCVerificationData {
  status: string;
  badgeState: string | null;
  qcScore: number | null;
  finishedAt: Date | null;
}

/**
 * Regime adjustment data structure
 */
interface RegimeAdjustment {
  original_score: number;
  adjusted_score: number;
  regime_bonus: number;
  regime_match: boolean;
  reason: string;
  current_regime: string | null;
}

/**
 * Enriched candidate with QC and regime data
 */
export interface EnrichedCandidate {
  id: string;
  regime_adjustment: RegimeAdjustment;
  qcVerification: QCVerificationData | null;
  [key: string]: any;
}

/**
 * Enrich candidates with QC verification status and regime adjustments
 * INSTITUTIONAL: Ensures cache-warmed data matches live response shape exactly
 */
export async function enrichCandidatesWithQCAndRegime(
  candidates: any[]
): Promise<{ candidates: EnrichedCandidate[]; currentRegime: string | null }> {
  if (candidates.length === 0) {
    return { candidates: [], currentRegime: null };
  }

  const { calculateRegimeAdjustedScore } = await import("../ai-strategy-evolution");
  
  // Get cached regime (5 min TTL)
  const currentRegime = await getCachedRegime();
  
  // Batch fetch QC verifications for all candidates
  const candidateIds = candidates.map((c: any) => c.id);
  const qcVerificationMap = new Map<string, QCVerificationData>();
  
  try {
    const validCandidateIds = candidateIds.filter((id: string) => isValidUuid(id));
    if (validCandidateIds.length > 0) {
      const candidateIdArraySql = sql.raw(`ARRAY[${validCandidateIds.map((id: string) => `'${id}'::uuid`).join(',')}]`);
      const qcResult = await db.execute(sql`
        SELECT DISTINCT ON (candidate_id) 
          candidate_id, status, badge_state, qc_score, finished_at
        FROM qc_verifications
        WHERE candidate_id = ANY(${candidateIdArraySql})
        ORDER BY candidate_id, queued_at DESC
      `);
    
      for (const row of qcResult.rows as any[]) {
        qcVerificationMap.set(row.candidate_id, {
          status: row.status,
          badgeState: row.badge_state,
          qcScore: row.qc_score,
          finishedAt: row.finished_at,
        });
      }
    }
  } catch (qcError) {
    console.warn("[STRATEGY_LAB_ENRICHMENT] QC verification fetch warning:", qcError);
  }
  
  // Build enriched candidates with regime adjustment and QC data
  const enrichedCandidates = candidates.map((c: any) => {
    const archetypeName = c.archetype_name || c.archetypeName || "";
    const originalScore = c.confidence_score ?? c.confidenceScore ?? 50;
    
    // Calculate fresh adjustment based on current market regime
    const freshAdjustment = calculateRegimeAdjustedScore(archetypeName, originalScore, currentRegime);
    
    // Hydrate QC verification status
    const qcData = qcVerificationMap.get(c.id);
    
    return {
      ...c,
      regime_adjustment: {
        original_score: originalScore,
        adjusted_score: freshAdjustment.adjustedScore,
        regime_bonus: freshAdjustment.regimeBonus,
        regime_match: freshAdjustment.regimeMatch,
        reason: freshAdjustment.reason,
        current_regime: currentRegime,
      },
      qcVerification: qcData ? {
        status: qcData.status,
        badgeState: qcData.badgeState,
        qcScore: qcData.qcScore,
        finishedAt: qcData.finishedAt,
      } : null,
    };
  });
  
  return { candidates: enrichedCandidates, currentRegime };
}

/**
 * Get trials bots count for cache warming
 */
export async function getTrialsBotsCount(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM bots 
      WHERE stage = 'TRIALS' AND archived_at IS NULL AND killed_at IS NULL
    `);
    return parseInt((result.rows[0] as any)?.count || "0");
  } catch (err) {
    console.warn("[STRATEGY_LAB_ENRICHMENT] Failed to fetch trials bots count:", err);
    return 0;
  }
}
