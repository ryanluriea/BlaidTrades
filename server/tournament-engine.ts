import { db, withTracedTransaction, DbTransaction } from "./db";
import { 
  bots, 
  evolutionTournaments, 
  tournamentEntries, 
  liveEligibilityTracking,
  type Bot,
  type EvolutionTournament,
  type TournamentEntry,
  type InsertEvolutionTournament,
  type InsertTournamentEntry,
} from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

type TournamentAction = "WINNER" | "BREED" | "MUTATE" | "KEEP" | "ROLLBACK" | "PAUSE" | "RETIRE" | "NONE";
type TournamentCadence = "INCREMENTAL" | "DAILY_MAJOR";

const FITNESS_WEIGHTS = {
  sharpe: 0.30,
  profitFactor: 0.25,
  winRate: 0.20,
  drawdown: 0.15,
  consistency: 0.10,
};

const FITNESS_THRESHOLDS = {
  INCREMENTAL: {
    sharpeMin: 0.5,
    profitFactorMin: 1.2,
    winRateMin: 0.45,
    maxDrawdownMax: 0.15,
  },
  DAILY_MAJOR: {
    sharpeMin: 0.8,
    profitFactorMin: 1.5,
    winRateMin: 0.50,
    maxDrawdownMax: 0.10,
  },
};

const LIVE_PROMOTION_PASS_STREAK_THRESHOLD = 3;

interface FitnessMetrics {
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  maxDrawdownPct: number;
  consistencyScore: number;
  fitnessV2: number;
}

interface BotWithMetrics extends Bot {
  fitnessMetrics: FitnessMetrics;
}

interface TournamentResult {
  tournamentId: string;
  status: "COMPLETED" | "FAILED";
  entrantsCount: number;
  winnerId: string | null;
  winnerFitness: number | null;
  entries: TournamentEntry[];
  summary: {
    cadence: TournamentCadence;
    actions: Record<TournamentAction, number>;
    durationMs: number;
  };
}

function extractMetricsFromBot(bot: Bot): Partial<FitnessMetrics> {
  const strategyConfig = (bot.strategyConfig || {}) as Record<string, unknown>;
  const metrics = (strategyConfig.metrics || {}) as Record<string, unknown>;
  
  return {
    sharpeRatio: typeof metrics.sharpeRatio === 'number' ? metrics.sharpeRatio : 
                 typeof bot.candidateScore === 'number' ? bot.candidateScore / 100 : 0,
    profitFactor: typeof metrics.profitFactor === 'number' ? metrics.profitFactor : 1.0,
    winRate: typeof metrics.winRate === 'number' ? metrics.winRate : 0.5,
    maxDrawdownPct: typeof metrics.maxDrawdown === 'number' ? metrics.maxDrawdown : 0.1,
    consistencyScore: typeof metrics.consistency === 'number' ? metrics.consistency : 0.5,
  };
}

export function calculateFitnessV2(metrics: Partial<FitnessMetrics>): number {
  const sharpe = Math.max(0, Math.min(3, metrics.sharpeRatio || 0));
  const profitFactor = Math.max(0, Math.min(5, metrics.profitFactor || 1));
  const winRate = Math.max(0, Math.min(1, metrics.winRate || 0.5));
  const maxDrawdown = Math.max(0, Math.min(1, metrics.maxDrawdownPct || 0.1));
  const consistency = Math.max(0, Math.min(1, metrics.consistencyScore || 0.5));
  
  const sharpeNorm = sharpe / 3;
  const pfNorm = Math.min(1, Math.max(0, (profitFactor - 1) / 4));
  const winRateNorm = winRate;
  const drawdownNorm = Math.max(0, Math.min(1, 1 - maxDrawdown));
  const consistencyNorm = consistency;
  
  const fitness = 
    (sharpeNorm * FITNESS_WEIGHTS.sharpe) +
    (pfNorm * FITNESS_WEIGHTS.profitFactor) +
    (winRateNorm * FITNESS_WEIGHTS.winRate) +
    (drawdownNorm * FITNESS_WEIGHTS.drawdown) +
    (consistencyNorm * FITNESS_WEIGHTS.consistency);
  
  return Math.max(0, Math.min(1, Math.round(fitness * 10000) / 10000));
}

function determineAction(
  rank: number,
  totalEntrants: number,
  passedThreshold: boolean,
  cadence: TournamentCadence,
): { action: TournamentAction; reason: string } {
  const topPercentile = rank / totalEntrants;
  
  if (rank === 1 && passedThreshold) {
    return { action: "WINNER", reason: "Top performer with passing fitness metrics" };
  }
  
  if (topPercentile <= 0.20 && passedThreshold) {
    if (cadence === "DAILY_MAJOR") {
      return { action: "BREED", reason: "Top 20% performer - eligible for breeding" };
    }
    return { action: "KEEP", reason: "Strong performer - maintaining position" };
  }
  
  if (topPercentile <= 0.40 && passedThreshold) {
    return { action: "KEEP", reason: "Above median performer with valid metrics" };
  }
  
  if (topPercentile <= 0.60) {
    if (!passedThreshold) {
      return { action: "MUTATE", reason: "Mid-tier bot below threshold - mutation candidate" };
    }
    return { action: "KEEP", reason: "Median performer - stable position" };
  }
  
  if (topPercentile <= 0.80) {
    if (cadence === "DAILY_MAJOR") {
      return { action: "MUTATE", reason: "Bottom 40% in major tournament - mutation required" };
    }
    return { action: "PAUSE", reason: "Underperformer - pausing for evaluation" };
  }
  
  if (cadence === "DAILY_MAJOR") {
    return { action: "RETIRE", reason: "Bottom 20% in major tournament - retirement" };
  }
  
  return { action: "ROLLBACK", reason: "Poor performance - rollback to previous generation" };
}

function meetsThreshold(metrics: FitnessMetrics, cadence: TournamentCadence): boolean {
  const thresholds = FITNESS_THRESHOLDS[cadence];
  
  return (
    metrics.sharpeRatio >= thresholds.sharpeMin &&
    metrics.profitFactor >= thresholds.profitFactorMin &&
    metrics.winRate >= thresholds.winRateMin &&
    metrics.maxDrawdownPct <= thresholds.maxDrawdownMax
  );
}

export async function getEligibleBots(userId: string): Promise<Bot[]> {
  const eligibleStages = ["PAPER", "SHADOW", "CANARY"];
  
  const results = await db
    .select()
    .from(bots)
    .where(
      and(
        eq(bots.userId, userId),
        inArray(bots.stage, eligibleStages),
        eq(bots.status, "running")
      )
    );
  
  if (results.length === 0) {
    const fallbackResults = await db
      .select()
      .from(bots)
      .where(
        and(
          eq(bots.userId, userId),
          inArray(bots.stage, eligibleStages)
        )
      );
    return fallbackResults;
  }
  
  return results;
}

export async function runTournament(
  userId: string,
  cadence: TournamentCadence,
  options: { dryRun?: boolean; triggeredBy?: string } = {}
): Promise<TournamentResult> {
  const startTime = Date.now();
  const traceId = `tour_${uuidv4().slice(0, 8)}`;
  
  const [tournament] = await db
    .insert(evolutionTournaments)
    .values({
      userId,
      cadenceType: cadence,
      status: "RUNNING",
      triggeredBy: options.triggeredBy || "manual",
      dryRun: options.dryRun || false,
      traceId,
      startedAt: new Date(),
    })
    .returning();
  
  try {
    const eligibleBots = await getEligibleBots(userId);
    
    if (eligibleBots.length === 0) {
      await db
        .update(evolutionTournaments)
        .set({
          status: "COMPLETED",
          endedAt: new Date(),
          entrantsCount: 0,
          summaryJson: { message: "No eligible bots found" },
        })
        .where(eq(evolutionTournaments.id, tournament.id));
      
      return {
        tournamentId: tournament.id,
        status: "COMPLETED",
        entrantsCount: 0,
        winnerId: null,
        winnerFitness: null,
        entries: [],
        summary: {
          cadence,
          actions: { WINNER: 0, BREED: 0, MUTATE: 0, KEEP: 0, ROLLBACK: 0, PAUSE: 0, RETIRE: 0, NONE: 0 },
          durationMs: Date.now() - startTime,
        },
      };
    }
    
    const botsWithMetrics: BotWithMetrics[] = eligibleBots.map(bot => {
      const rawMetrics = extractMetricsFromBot(bot);
      const fitnessV2 = calculateFitnessV2(rawMetrics);
      
      return {
        ...bot,
        fitnessMetrics: {
          sharpeRatio: rawMetrics.sharpeRatio || 0,
          profitFactor: rawMetrics.profitFactor || 1,
          winRate: rawMetrics.winRate || 0.5,
          maxDrawdownPct: rawMetrics.maxDrawdownPct || 0.1,
          consistencyScore: rawMetrics.consistencyScore || 0.5,
          fitnessV2,
        },
      };
    });
    
    botsWithMetrics.sort((a, b) => b.fitnessMetrics.fitnessV2 - a.fitnessMetrics.fitnessV2);
    
    const actionCounts: Record<TournamentAction, number> = {
      WINNER: 0,
      BREED: 0,
      MUTATE: 0,
      KEEP: 0,
      ROLLBACK: 0,
      PAUSE: 0,
      RETIRE: 0,
      NONE: 0,
    };
    
    const entryValues: InsertTournamentEntry[] = botsWithMetrics.map((bot, index) => {
      const rank = index + 1;
      const passedThreshold = meetsThreshold(bot.fitnessMetrics, cadence);
      const { action, reason } = determineAction(rank, botsWithMetrics.length, passedThreshold, cadence);
      
      actionCounts[action]++;
      
      return {
        tournamentId: tournament.id,
        botId: bot.id,
        rank,
        lane: "evolution",
        symbol: bot.symbol || "MES",
        stage: bot.stage || "PAPER",
        fitnessV2: bot.fitnessMetrics.fitnessV2,
        sharpeRatio: bot.fitnessMetrics.sharpeRatio,
        profitFactor: bot.fitnessMetrics.profitFactor,
        winRate: bot.fitnessMetrics.winRate,
        maxDrawdownPct: bot.fitnessMetrics.maxDrawdownPct,
        consistencyScore: bot.fitnessMetrics.consistencyScore,
        candidateScore: bot.candidateScore,
        actionTaken: action,
        actionReason: reason,
        passedThreshold,
      };
    });
    
    let entries: TournamentEntry[] = [];
    if (entryValues.length > 0) {
      entries = await db.insert(tournamentEntries).values(entryValues).returning();
    }
    
    const winner = botsWithMetrics[0];
    const winnerId = winner?.id || null;
    const winnerFitness = winner?.fitnessMetrics.fitnessV2 || null;
    
    if (!options.dryRun) {
      await updateLiveEligibility(entries, tournament.id, userId);
    }
    
    const summary = {
      cadence,
      actions: actionCounts,
      durationMs: Date.now() - startTime,
      topPerformers: botsWithMetrics.slice(0, 3).map(b => ({
        id: b.id,
        name: b.name,
        fitness: b.fitnessMetrics.fitnessV2,
      })),
    };
    
    await db
      .update(evolutionTournaments)
      .set({
        status: "COMPLETED",
        endedAt: new Date(),
        entrantsCount: botsWithMetrics.length,
        winnerId,
        winnerFitness,
        summaryJson: summary,
        actionsJson: actionCounts,
      })
      .where(eq(evolutionTournaments.id, tournament.id));
    
    return {
      tournamentId: tournament.id,
      status: "COMPLETED",
      entrantsCount: botsWithMetrics.length,
      winnerId,
      winnerFitness,
      entries,
      summary,
    };
    
  } catch (error) {
    await db
      .update(evolutionTournaments)
      .set({
        status: "FAILED",
        endedAt: new Date(),
        summaryJson: { error: error instanceof Error ? error.message : "Unknown error" },
      })
      .where(eq(evolutionTournaments.id, tournament.id));
    
    throw error;
  }
}

async function updateLiveEligibility(
  entries: TournamentEntry[],
  tournamentId: string,
  userId: string
): Promise<void> {
  for (const entry of entries) {
    const passed = entry.passedThreshold && entry.actionTaken !== "RETIRE";
    
    const existing = await db
      .select()
      .from(liveEligibilityTracking)
      .where(eq(liveEligibilityTracking.botId, entry.botId))
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(liveEligibilityTracking).values({
        botId: entry.botId,
        userId,
        candidatePassStreak: passed ? 1 : 0,
        totalPasses: passed ? 1 : 0,
        totalFails: passed ? 0 : 1,
        liveEligibilityScore: entry.fitnessV2 || 0,
        lastTournamentId: tournamentId,
        lastTournamentAt: new Date(),
        eligibleForLive: false,
      });
    } else {
      const current = existing[0];
      const newStreak = passed ? (current.candidatePassStreak || 0) + 1 : 0;
      const eligibleForLive = newStreak >= LIVE_PROMOTION_PASS_STREAK_THRESHOLD;
      
      await db
        .update(liveEligibilityTracking)
        .set({
          candidatePassStreak: newStreak,
          totalPasses: (current.totalPasses || 0) + (passed ? 1 : 0),
          totalFails: (current.totalFails || 0) + (passed ? 0 : 1),
          liveEligibilityScore: entry.fitnessV2 || 0,
          lastTournamentId: tournamentId,
          lastTournamentAt: new Date(),
          eligibleForLive,
          updatedAt: new Date(),
        })
        .where(eq(liveEligibilityTracking.botId, entry.botId));
    }
  }
}

export async function getTournaments(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<EvolutionTournament[]> {
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  
  return db
    .select()
    .from(evolutionTournaments)
    .where(eq(evolutionTournaments.userId, userId))
    .orderBy(desc(evolutionTournaments.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getTournamentById(id: string): Promise<EvolutionTournament | undefined> {
  const [tournament] = await db
    .select()
    .from(evolutionTournaments)
    .where(eq(evolutionTournaments.id, id))
    .limit(1);
  
  return tournament;
}

export async function getTournamentEntries(tournamentId: string): Promise<(TournamentEntry & { bots: { name: string } | null })[]> {
  const results = await db
    .select({
      ...tournamentEntries,
      bots: {
        name: bots.name,
      },
    })
    .from(tournamentEntries)
    .leftJoin(bots, eq(tournamentEntries.botId, bots.id))
    .where(eq(tournamentEntries.tournamentId, tournamentId))
    .orderBy(tournamentEntries.rank);
  
  return results as (TournamentEntry & { bots: { name: string } | null })[];
}

export async function getLiveEligibleBots(userId: string): Promise<{
  bot: Bot;
  eligibility: (typeof liveEligibilityTracking.$inferSelect);
}[]> {
  const results = await db
    .select({
      bot: bots,
      eligibility: liveEligibilityTracking,
    })
    .from(liveEligibilityTracking)
    .innerJoin(bots, eq(liveEligibilityTracking.botId, bots.id))
    .where(
      and(
        eq(liveEligibilityTracking.userId, userId),
        eq(liveEligibilityTracking.eligibleForLive, true)
      )
    )
    .orderBy(desc(liveEligibilityTracking.candidatePassStreak));
  
  return results;
}

export async function getTournamentStats(userId: string): Promise<{
  totalTournaments: number;
  completedToday: number;
  lastTournamentAt: Date | null;
  avgWinnerFitness: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tournaments = await db
    .select()
    .from(evolutionTournaments)
    .where(eq(evolutionTournaments.userId, userId));
  
  const completed = tournaments.filter(t => t.status === "COMPLETED");
  const completedToday = completed.filter(t => 
    t.createdAt && new Date(t.createdAt) >= today
  ).length;
  
  const sortedByDate = completed.sort((a, b) => 
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  
  const avgFitness = completed.reduce((sum, t) => sum + (t.winnerFitness || 0), 0) / 
    (completed.length || 1);
  
  return {
    totalTournaments: tournaments.length,
    completedToday,
    lastTournamentAt: sortedByDate[0]?.createdAt || null,
    avgWinnerFitness: Math.round(avgFitness * 10000) / 10000,
  };
}
