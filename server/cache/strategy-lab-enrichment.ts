/**
 * Strategy Lab Candidate Enrichment
 * INSTITUTIONAL: Reusable enrichment logic for cache warming and live responses
 * Ensures cached data matches live responses with QC badges and regime adjustments
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Helper to validate UUID format (RFC 4122 compliant - matches routes.ts exactly)
 */
function isValidUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
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
 * IMPORTANT: Always fetches currentRegime even for empty lists (matches route behavior)
 */
export async function enrichCandidatesWithQCAndRegime(
  candidates: any[]
): Promise<{ candidates: EnrichedCandidate[]; currentRegime: string | null }> {
  // CRITICAL: Use dynamic import to avoid circular dependencies
  // This matches the pattern used in routes.ts
  const { calculateRegimeAdjustedScore, getCachedRegime } = await import("../ai-strategy-evolution");
  
  // Always get cached regime (5 min TTL) - even for empty arrays
  // This ensures cache shape matches live responses exactly
  const currentRegime = await getCachedRegime();
  
  if (candidates.length === 0) {
    return { candidates: [], currentRegime };
  }
  
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
      WHERE UPPER(stage) = 'TRIALS' AND archived_at IS NULL AND killed_at IS NULL
    `);
    return parseInt((result.rows[0] as any)?.count || "0");
  } catch (err) {
    console.warn("[STRATEGY_LAB_ENRICHMENT] Failed to fetch trials bots count:", err);
    return 0;
  }
}
