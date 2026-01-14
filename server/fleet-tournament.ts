/**
 * Fleet Tournament Service
 * 
 * Industry-standard bot cycling system that ranks all TRIALS bots
 * and cycles out underperformers to make room for better candidates.
 * 
 * Ranking Algorithm (Composite Score):
 * - 40% Sharpe Ratio (risk-adjusted returns)
 * - 30% Win Rate (consistency)
 * - 20% Profit Factor (edge magnitude)
 * - 10% Trade Count (activity/statistical significance)
 * 
 * Tier System:
 * - TOP_10: Top 10% performers - protected from cycling
 * - SAFE: Middle 60% - stable position
 * - AT_RISK: Bottom 30% - needs improvement
 * - CYCLE_OUT: Bottom 10% - scheduled for replacement
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export type TournamentTier = "TOP_10" | "SAFE" | "AT_RISK" | "CYCLE_OUT";

export interface TournamentRanking {
  botId: string;
  botName: string;
  stage: string;
  score: number;
  rank: number;
  tier: TournamentTier;
  metrics: {
    sharpe: number;
    winRate: number;
    profitFactor: number;
    tradeCount: number;
  };
}

export interface TournamentResult {
  timestamp: Date;
  totalBots: number;
  rankings: TournamentRanking[];
  tierCounts: {
    TOP_10: number;
    SAFE: number;
    AT_RISK: number;
    CYCLE_OUT: number;
  };
  cycledOut: string[];
  cycledIn: string[];
}

// Scoring weights
const WEIGHTS = {
  sharpe: 0.40,
  winRate: 0.30,
  profitFactor: 0.20,
  tradeCount: 0.10,
};

// Tier thresholds (percentile-based)
const TIER_THRESHOLDS = {
  TOP_10: 0.10,    // Top 10%
  SAFE: 0.70,       // Top 10-70%
  AT_RISK: 0.90,    // 70-90%
  CYCLE_OUT: 1.00,  // Bottom 10%
};

/**
 * Calculate composite tournament score for a bot
 */
function calculateTournamentScore(metrics: {
  sharpe: number | null;
  winRate: number | null;
  profitFactor: number | null;
  tradeCount: number | null;
}): number {
  // Normalize each metric to 0-100 scale
  const normalizedSharpe = normalizeValue(metrics.sharpe ?? 0, -1, 3, 0, 100);
  const normalizedWinRate = (metrics.winRate ?? 0) * 100;
  const normalizedPF = normalizeValue(metrics.profitFactor ?? 0, 0, 3, 0, 100);
  const normalizedTrades = normalizeValue(metrics.tradeCount ?? 0, 0, 100, 0, 100);
  
  // Calculate weighted score
  const score = 
    normalizedSharpe * WEIGHTS.sharpe +
    normalizedWinRate * WEIGHTS.winRate +
    normalizedPF * WEIGHTS.profitFactor +
    normalizedTrades * WEIGHTS.tradeCount;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Normalize a value from one range to another
 */
function normalizeValue(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

/**
 * Determine tier based on percentile rank
 */
function getTierFromPercentile(percentile: number): TournamentTier {
  if (percentile <= TIER_THRESHOLDS.TOP_10) return "TOP_10";
  if (percentile <= TIER_THRESHOLDS.SAFE) return "SAFE";
  if (percentile <= TIER_THRESHOLDS.AT_RISK) return "AT_RISK";
  return "CYCLE_OUT";
}

/**
 * Run tournament ranking for all active TRIALS bots
 */
export async function runTournament(traceId: string): Promise<TournamentResult> {
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Starting tournament ranking...`);
  const startTime = Date.now();
  
  // Fetch all active TRIALS bots with their latest backtest metrics
  const botsWithMetrics = await db.execute(sql`
    WITH latest_backtests AS (
      SELECT DISTINCT ON (bot_id)
        bot_id,
        sharpe_ratio,
        win_rate,
        profit_factor,
        total_trades
      FROM backtest_sessions
      WHERE status = 'COMPLETED'
      ORDER BY bot_id, created_at DESC
    )
    SELECT 
      b.id,
      b.name,
      b.stage,
      COALESCE(lb.sharpe_ratio, 0) as sharpe,
      COALESCE(lb.win_rate, 0) as win_rate,
      COALESCE(lb.profit_factor, 0) as profit_factor,
      COALESCE(lb.total_trades, 0) as trade_count
    FROM bots b
    LEFT JOIN latest_backtests lb ON lb.bot_id = b.id
    WHERE b.archived_at IS NULL 
      AND b.killed_at IS NULL
      AND UPPER(b.stage) = 'TRIALS'
    ORDER BY b.name
  `);
  
  const botRows = botsWithMetrics.rows as any[];
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Found ${botRows.length} TRIALS bots to rank`);
  
  // Calculate scores for all bots
  const scoredBots = botRows.map(row => ({
    botId: row.id,
    botName: row.name,
    stage: row.stage,
    metrics: {
      sharpe: parseFloat(row.sharpe) || 0,
      winRate: parseFloat(row.win_rate) || 0,
      profitFactor: parseFloat(row.profit_factor) || 0,
      tradeCount: parseInt(row.trade_count) || 0,
    },
    score: calculateTournamentScore({
      sharpe: parseFloat(row.sharpe),
      winRate: parseFloat(row.win_rate),
      profitFactor: parseFloat(row.profit_factor),
      tradeCount: parseInt(row.trade_count),
    }),
  }));
  
  // Sort by score descending
  scoredBots.sort((a, b) => b.score - a.score);
  
  // Assign ranks and tiers
  const rankings: TournamentRanking[] = scoredBots.map((bot, index) => {
    const rank = index + 1;
    const percentile = rank / scoredBots.length;
    const tier = getTierFromPercentile(percentile);
    
    return {
      ...bot,
      rank,
      tier,
    };
  });
  
  // Count bots per tier
  const tierCounts = {
    TOP_10: rankings.filter(r => r.tier === "TOP_10").length,
    SAFE: rankings.filter(r => r.tier === "SAFE").length,
    AT_RISK: rankings.filter(r => r.tier === "AT_RISK").length,
    CYCLE_OUT: rankings.filter(r => r.tier === "CYCLE_OUT").length,
  };
  
  // Update database with tournament results
  for (const ranking of rankings) {
    await db.execute(sql`
      UPDATE bots 
      SET 
        tournament_score = ${ranking.score},
        tournament_rank = ${ranking.rank},
        tournament_tier = ${ranking.tier},
        tournament_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = ${ranking.botId}::uuid
    `);
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Complete: ${rankings.length} bots ranked in ${elapsed}ms`);
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Tiers: TOP_10=${tierCounts.TOP_10} SAFE=${tierCounts.SAFE} AT_RISK=${tierCounts.AT_RISK} CYCLE_OUT=${tierCounts.CYCLE_OUT}`);
  
  return {
    timestamp: new Date(),
    totalBots: rankings.length,
    rankings,
    tierCounts,
    cycledOut: [],
    cycledIn: [],
  };
}

/**
 * Get current tournament standings from database
 */
export async function getTournamentStandings(): Promise<TournamentRanking[]> {
  const result = await db.execute(sql`
    SELECT 
      id,
      name,
      stage,
      tournament_score,
      tournament_rank,
      tournament_tier,
      tournament_updated_at
    FROM bots
    WHERE archived_at IS NULL 
      AND killed_at IS NULL
      AND UPPER(stage) = 'TRIALS'
      AND tournament_rank IS NOT NULL
    ORDER BY tournament_rank ASC
  `);
  
  return (result.rows as any[]).map(row => ({
    botId: row.id,
    botName: row.name,
    stage: row.stage,
    score: parseFloat(row.tournament_score) || 0,
    rank: parseInt(row.tournament_rank) || 0,
    tier: (row.tournament_tier || "SAFE") as TournamentTier,
    metrics: { sharpe: 0, winRate: 0, profitFactor: 0, tradeCount: 0 },
  }));
}

/**
 * Cycle out bottom performers and cycle in waitlisted candidates
 */
export async function cycleFleet(
  traceId: string, 
  maxCycleOut: number = 10
): Promise<{ cycledOut: string[]; cycledIn: string[] }> {
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Starting fleet cycling (max=${maxCycleOut})...`);
  
  // Get CYCLE_OUT tier bots
  const cycleOutBots = await db.execute(sql`
    SELECT id, name 
    FROM bots 
    WHERE tournament_tier = 'CYCLE_OUT'
      AND archived_at IS NULL
      AND killed_at IS NULL
    ORDER BY tournament_rank DESC
    LIMIT ${maxCycleOut}
  `);
  
  const cycledOut: string[] = [];
  const cycledIn: string[] = [];
  
  // Archive CYCLE_OUT bots
  for (const row of cycleOutBots.rows as any[]) {
    await db.execute(sql`
      UPDATE bots 
      SET 
        archived_at = NOW(),
        updated_at = NOW()
      WHERE id = ${row.id}::uuid
    `);
    cycledOut.push(row.id);
    console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Cycled out: ${row.name} (${row.id.slice(0, 8)})`);
  }
  
  // Get waitlisted candidates (READY + VERIFIED) to promote
  if (cycledOut.length > 0) {
    const waitlistCandidates = await db.execute(sql`
      SELECT sc.id, sc.strategy_name
      FROM strategy_candidates sc
      LEFT JOIN qc_verifications qv ON qv.candidate_id = sc.id
      WHERE sc.disposition = 'READY'
        AND qv.badge_state = 'VERIFIED'
        AND sc.created_bot_id IS NULL
      ORDER BY sc.adjusted_score DESC NULLS LAST
      LIMIT ${cycledOut.length}
    `);
    
    for (const candidate of waitlistCandidates.rows as any[]) {
      cycledIn.push(candidate.id);
      console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Ready to cycle in: ${candidate.strategy_name} (${candidate.id.slice(0, 8)})`);
    }
  }
  
  console.log(`[FLEET_TOURNAMENT] trace_id=${traceId} Cycling complete: ${cycledOut.length} out, ${cycledIn.length} ready to promote`);
  
  return { cycledOut, cycledIn };
}

/**
 * Get tournament tier counts for UI display
 */
export async function getTournamentTierCounts(): Promise<{
  TOP_10: number;
  SAFE: number;
  AT_RISK: number;
  CYCLE_OUT: number;
  total: number;
  lastUpdated: Date | null;
}> {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) FILTER (WHERE tournament_tier = 'TOP_10') as top_10,
      COUNT(*) FILTER (WHERE tournament_tier = 'SAFE') as safe,
      COUNT(*) FILTER (WHERE tournament_tier = 'AT_RISK') as at_risk,
      COUNT(*) FILTER (WHERE tournament_tier = 'CYCLE_OUT') as cycle_out,
      COUNT(*) as total,
      MAX(tournament_updated_at) as last_updated
    FROM bots
    WHERE archived_at IS NULL 
      AND killed_at IS NULL
      AND UPPER(stage) = 'TRIALS'
  `);
  
  const row = result.rows[0] as any;
  
  return {
    TOP_10: parseInt(row.top_10) || 0,
    SAFE: parseInt(row.safe) || 0,
    AT_RISK: parseInt(row.at_risk) || 0,
    CYCLE_OUT: parseInt(row.cycle_out) || 0,
    total: parseInt(row.total) || 0,
    lastUpdated: row.last_updated ? new Date(row.last_updated) : null,
  };
}
