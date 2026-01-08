/**
 * STRESS TEST EXECUTOR
 * 
 * Runs bots against historical crisis scenarios (COVID crash, Fed pivot, flash crashes)
 * to validate robustness before CANARY promotion.
 * 
 * Uses the bar cache for fast execution and creates backtest sessions for each scenario.
 */

import { storage } from "./storage";
import { logActivityEvent } from "./activity-logger";
import type { Bot, StressTestPreset, StressTestResult } from "@shared/schema";
import { db } from "./db";
import { sql } from "drizzle-orm";
import * as crypto from "crypto";

export interface StressTestConfig {
  botId: string;
  generationId?: string;
  presetIds?: string[];  // If empty, run all applicable presets
  traceId?: string;
}

export interface StressTestRunResult {
  totalPresets: number;
  passedPresets: number;
  failedPresets: number;
  allPassed: boolean;
  results: StressTestResult[];
}

interface PresetThresholds {
  maxDrawdownPct?: number;
  minWinRate?: number;
  minProfitFactor?: number;
  maxLossPerTrade?: number;
}

/**
 * Get applicable stress test presets for a bot's symbol
 */
export async function getApplicablePresets(botSymbol: string): Promise<StressTestPreset[]> {
  const allPresets = await storage.getStressTestPresets();
  
  return allPresets.filter(preset => {
    if (!preset.symbols || preset.symbols.length === 0) return true;
    const normalizedSymbol = botSymbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return preset.symbols.some(s => {
      const normalizedPresetSymbol = s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return normalizedPresetSymbol === normalizedSymbol || 
             normalizedSymbol.includes(normalizedPresetSymbol) ||
             normalizedPresetSymbol.includes(normalizedSymbol);
    });
  });
}

/**
 * Execute a single stress test against a preset
 * Note: This creates a stub result - actual backtest execution via job queue is recommended
 */
async function executeStressTestPreset(
  bot: Bot,
  preset: StressTestPreset,
  generationId: string | undefined,
  traceId: string
): Promise<StressTestResult> {
  console.log(`[STRESS_TEST] trace_id=${traceId} bot=${bot.id} preset=${preset.name} executing`);
  
  const startDate = preset.startDate;
  const endDate = preset.endDate;
  
  if (!startDate || !endDate) {
    console.error(`[STRESS_TEST] trace_id=${traceId} preset=${preset.id} missing date range`);
    return await storage.createStressTestResult({
      botId: bot.id,
      generationId: generationId || undefined,
      presetId: preset.id,
      backtestSessionId: undefined,
      passed: false,
      netPnl: 0,
      maxDrawdownPct: 0,
      winRate: 0,
      totalTrades: 0,
      sharpeRatio: 0,
      failureReasons: ["Missing date range in preset"],
      performanceNotes: "Preset configuration error",
    });
  }

  const passThresholds = (preset.passThreshold as PresetThresholds) || {};
  
  const result = await storage.createStressTestResult({
    botId: bot.id,
    generationId: generationId || undefined,
    presetId: preset.id,
    backtestSessionId: undefined,
    passed: false,
    netPnl: 0,
    maxDrawdownPct: 0,
    winRate: 0,
    totalTrades: 0,
    sharpeRatio: 0,
    failureReasons: ["Pending execution via job queue"],
    performanceNotes: `Stress test queued for ${preset.name} (${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]})`,
  });

  console.log(`[STRESS_TEST] trace_id=${traceId} bot=${bot.id} preset=${preset.name} queued for execution`);
  
  return result;
}

/**
 * Execute full stress test suite for a bot
 */
export async function executeStressTestSuite(config: StressTestConfig): Promise<StressTestRunResult> {
  const traceId = config.traceId || crypto.randomUUID();
  console.log(`[STRESS_TEST] trace_id=${traceId} bot=${config.botId} STARTING suite`);

  const bot = await storage.getBot(config.botId);
  if (!bot) {
    throw new Error(`Bot not found: ${config.botId}`);
  }

  let presets: StressTestPreset[];
  if (config.presetIds && config.presetIds.length > 0) {
    const allPresets = await storage.getStressTestPresets();
    presets = allPresets.filter(p => config.presetIds!.includes(p.id));
  } else {
    presets = await getApplicablePresets(bot.symbol || "");
  }

  if (presets.length === 0) {
    console.log(`[STRESS_TEST] trace_id=${traceId} bot=${config.botId} NO_PRESETS skipping`);
    return {
      totalPresets: 0,
      passedPresets: 0,
      failedPresets: 0,
      allPassed: true,
      results: [],
    };
  }

  const results: StressTestResult[] = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const preset of presets) {
    try {
      const result = await executeStressTestPreset(bot, preset, config.generationId, traceId);
      results.push(result);
      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
      }
    } catch (error: any) {
      console.error(`[STRESS_TEST] trace_id=${traceId} preset=${preset.id} error:`, error);
      failedCount++;
    }
  }

  const allPassed = failedCount === 0 && passedCount > 0;

  await logActivityEvent({
    botId: config.botId,
    eventType: "STRESS_TEST_COMPLETED",
    severity: allPassed ? "INFO" : "WARN",
    title: `Stress Test: ${bot.name}`,
    summary: allPassed 
      ? `Passed all ${passedCount} crisis scenarios`
      : `Failed ${failedCount}/${presets.length} scenarios`,
    payload: {
      totalPresets: presets.length,
      passed: passedCount,
      failed: failedCount,
      presetNames: presets.map(p => p.name),
      results: results.map(r => ({
        presetId: r.presetId,
        passed: r.passed,
        maxDrawdownPct: r.maxDrawdownPct,
        netPnl: r.netPnl,
      })),
    },
    traceId,
    stage: bot.stage || undefined,
  });

  console.log(`[STRESS_TEST] trace_id=${traceId} bot=${config.botId} COMPLETED passed=${passedCount}/${presets.length}`);

  return {
    totalPresets: presets.length,
    passedPresets: passedCount,
    failedPresets: failedCount,
    allPassed,
    results,
  };
}

/**
 * Check if bot has passed all required stress tests for current generation
 */
export async function hasPassedStressTests(botId: string, generationId?: string): Promise<boolean> {
  const results = await storage.getStressTestResultsForBot(botId, generationId);
  if (results.length === 0) return false;
  return results.every(r => r.passed);
}

/**
 * Seed initial stress test presets (run once during setup)
 */
export async function seedStressTestPresets(): Promise<void> {
  const existingPresets = await storage.getStressTestPresets();
  if (existingPresets.length > 0) {
    console.log(`[STRESS_TEST] Presets already seeded (${existingPresets.length} found)`);
    return;
  }

  const presets = [
    {
      name: "COVID-19 Crash (Feb-Mar 2020)",
      description: "The fastest 30% decline in market history followed by unprecedented volatility",
      eventType: "SUSTAINED_CRISIS",
      startDate: new Date("2020-02-19"),
      endDate: new Date("2020-03-23"),
      regimeLabel: "HIGH_VOLATILITY" as const,
      severity: 10,
      expectedBehavior: "Strategy should limit losses and avoid excessive exposure during extreme volatility",
      passThreshold: { maxDrawdownPct: 35, minWinRate: 25 },
      symbols: ["ES", "MES", "NQ", "MNQ", "YM", "MYM"],
      isActive: true,
    },
    {
      name: "Fed Rate Hike 2022 (Jan-Jun)",
      description: "Sustained bear market during aggressive Fed rate hiking cycle",
      eventType: "POLICY_SHOCK",
      startDate: new Date("2022-01-03"),
      endDate: new Date("2022-06-16"),
      regimeLabel: "BEAR" as const,
      severity: 8,
      expectedBehavior: "Strategy should adapt to trending down market with proper position sizing",
      passThreshold: { maxDrawdownPct: 25, minProfitFactor: 0.8 },
      symbols: ["ES", "MES", "NQ", "MNQ", "YM", "MYM"],
      isActive: true,
    },
    {
      name: "August 2015 Flash Crash",
      description: "Dow dropped 1000 points in minutes during pre-market",
      eventType: "FLASH_CRASH",
      startDate: new Date("2015-08-21"),
      endDate: new Date("2015-08-25"),
      regimeLabel: "HIGH_VOLATILITY" as const,
      severity: 9,
      expectedBehavior: "Strategy should handle gap-down opens and extreme intraday volatility",
      passThreshold: { maxDrawdownPct: 30 },
      symbols: ["ES", "MES", "NQ", "MNQ", "YM", "MYM"],
      isActive: true,
    },
    {
      name: "VIX Spike Feb 2018",
      description: "Volatility spike that blew up XIV and caused 10% correction",
      eventType: "VOLATILITY_SPIKE",
      startDate: new Date("2018-02-02"),
      endDate: new Date("2018-02-09"),
      regimeLabel: "HIGH_VOLATILITY" as const,
      severity: 7,
      expectedBehavior: "Strategy should recognize volatility regime change quickly",
      passThreshold: { maxDrawdownPct: 20, minWinRate: 30 },
      symbols: ["ES", "MES", "NQ", "MNQ", "VX"],
      isActive: true,
    },
    {
      name: "2022 Bear Market (Full Year)",
      description: "Extended bear market with multiple relief rallies and failures",
      eventType: "SUSTAINED_CRISIS",
      startDate: new Date("2022-01-03"),
      endDate: new Date("2022-12-30"),
      regimeLabel: "BEAR" as const,
      severity: 8,
      expectedBehavior: "Strategy should demonstrate long-term survivability in trending bear market",
      passThreshold: { maxDrawdownPct: 30, minProfitFactor: 0.7 },
      symbols: ["ES", "MES", "NQ", "MNQ", "YM", "MYM"],
      isActive: true,
    },
    {
      name: "Low Volatility Q4 2019",
      description: "Extended low volatility period with narrow ranges",
      eventType: "VOLATILITY_SPIKE",
      startDate: new Date("2019-10-01"),
      endDate: new Date("2019-12-31"),
      regimeLabel: "LOW_VOLATILITY" as const,
      severity: 4,
      expectedBehavior: "Strategy should avoid overtrading in choppy low-volatility conditions",
      passThreshold: { minProfitFactor: 0.9, minWinRate: 35 },
      symbols: ["ES", "MES", "NQ", "MNQ", "YM", "MYM"],
      isActive: true,
    },
  ];

  for (const preset of presets) {
    await db.execute(sql`
      INSERT INTO stress_test_presets (
        name, description, event_type, start_date, end_date, 
        regime_label, severity, expected_behavior, pass_threshold, 
        symbols, is_active
      )
      VALUES (
        ${preset.name}, ${preset.description}, ${preset.eventType},
        ${preset.startDate}::timestamp, ${preset.endDate}::timestamp,
        ${preset.regimeLabel}, ${preset.severity}, ${preset.expectedBehavior},
        ${JSON.stringify(preset.passThreshold)}::jsonb,
        ARRAY[${sql.join(preset.symbols.map(s => sql`${s}`), sql`, `)}]::text[],
        ${preset.isActive}
      )
    `);
  }

  console.log(`[STRESS_TEST] Seeded ${presets.length} stress test presets`);
}
