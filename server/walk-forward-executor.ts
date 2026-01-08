import { db } from "./db";
import { storage } from "./storage";
import { 
  walkForwardRuns, 
  backtestSessions, 
  botGenerations,
  type WalkForwardRun,
  type BacktestSession 
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { executeBacktest } from "./backtest-executor";
import { logActivityEvent } from "./activity-logger";
import { detectMarketRegime, type RegimeResult } from "./regime-detector";
import * as crypto from "crypto";

interface WalkForwardConfig {
  botId: string;
  generationId?: string;
  symbol: string;
  timeframe: string;
  initialCapital: number;
  archetype?: string;
  fullRangeStart: Date;
  fullRangeEnd: Date;
  trainingWindowDays?: number;
  testingWindowDays?: number;
  validationWindowDays?: number;
  stepForwardDays?: number;
  totalSegments?: number;
}

interface SegmentWindow {
  type: "TRAINING" | "TESTING" | "VALIDATION";
  index: number;
  start: Date;
  end: Date;
}

interface WalkForwardResult {
  success: boolean;
  runId: string;
  trainingAvgSharpe?: number;
  testingAvgSharpe?: number;
  validationSharpe?: number;
  consistencyScore?: number;
  overfitRatio?: number;
  passedValidation?: boolean;
  error?: string;
}

const DEFAULT_TRAINING_DAYS = 365;
const DEFAULT_TESTING_DAYS = 90;
const DEFAULT_VALIDATION_DAYS = 90;
const DEFAULT_STEP_DAYS = 90;
const DEFAULT_SEGMENTS = 4;

export async function createWalkForwardRun(
  config: WalkForwardConfig
): Promise<string> {
  const trainingWindowDays = config.trainingWindowDays ?? DEFAULT_TRAINING_DAYS;
  const testingWindowDays = config.testingWindowDays ?? DEFAULT_TESTING_DAYS;
  const validationWindowDays = config.validationWindowDays ?? DEFAULT_VALIDATION_DAYS;
  const stepForwardDays = config.stepForwardDays ?? DEFAULT_STEP_DAYS;
  const totalSegments = config.totalSegments ?? DEFAULT_SEGMENTS;

  const [run] = await db.insert(walkForwardRuns).values({
    botId: config.botId,
    generationId: config.generationId ?? null,
    status: "PENDING",
    totalSegments,
    trainingWindowDays,
    testingWindowDays,
    validationWindowDays,
    stepForwardDays,
    fullRangeStart: config.fullRangeStart,
    fullRangeEnd: config.fullRangeEnd,
  }).returning();

  return run.id;
}

function generateSegmentWindows(
  fullRangeStart: Date,
  fullRangeEnd: Date,
  trainingDays: number,
  testingDays: number,
  validationDays: number,
  stepDays: number,
  totalSegments: number
): SegmentWindow[] {
  const windows: SegmentWindow[] = [];
  const msPerDay = 24 * 60 * 60 * 1000;
  
  const validationEnd = fullRangeEnd;
  const validationStart = new Date(validationEnd.getTime() - validationDays * msPerDay);
  
  let currentSegmentEnd = validationStart;
  
  for (let i = 0; i < totalSegments; i++) {
    const testEnd = currentSegmentEnd;
    const testStart = new Date(testEnd.getTime() - testingDays * msPerDay);
    const trainEnd = testStart;
    const trainStart = new Date(trainEnd.getTime() - trainingDays * msPerDay);

    if (trainStart.getTime() < fullRangeStart.getTime()) {
      console.log(`[WALK_FORWARD] Segment ${i} training window exceeds data range, stopping at ${i} segments`);
      break;
    }

    windows.push({
      type: "TRAINING",
      index: i,
      start: trainStart,
      end: trainEnd,
    });

    windows.push({
      type: "TESTING",
      index: i,
      start: testStart,
      end: testEnd,
    });

    currentSegmentEnd = new Date(testStart.getTime() - stepDays * msPerDay + testingDays * msPerDay);
    if (currentSegmentEnd.getTime() >= testStart.getTime()) {
      currentSegmentEnd = testStart;
    }
  }

  windows.push({
    type: "VALIDATION",
    index: 0,
    start: validationStart,
    end: validationEnd,
  });

  return windows;
}

export async function executeWalkForwardRun(
  runId: string,
  config: WalkForwardConfig,
  traceId?: string
): Promise<WalkForwardResult> {
  const effectiveTraceId = traceId ?? crypto.randomUUID();
  
  console.log(`[WALK_FORWARD] trace_id=${effectiveTraceId} run_id=${runId} starting walk-forward optimization`);

  try {
    await db.update(walkForwardRuns)
      .set({ status: "IN_PROGRESS", startedAt: new Date() })
      .where(eq(walkForwardRuns.id, runId));

    const trainingDays = config.trainingWindowDays ?? DEFAULT_TRAINING_DAYS;
    const testingDays = config.testingWindowDays ?? DEFAULT_TESTING_DAYS;
    const validationDays = config.validationWindowDays ?? DEFAULT_VALIDATION_DAYS;
    const stepDays = config.stepForwardDays ?? DEFAULT_STEP_DAYS;
    const totalSegments = config.totalSegments ?? DEFAULT_SEGMENTS;

    const windows = generateSegmentWindows(
      config.fullRangeStart,
      config.fullRangeEnd,
      trainingDays,
      testingDays,
      validationDays,
      stepDays,
      totalSegments
    );

    console.log(`[WALK_FORWARD] trace_id=${effectiveTraceId} generated ${windows.length} segment windows`);

    const trainingSharpes: number[] = [];
    const testingSharpes: number[] = [];
    let validationSharpe: number | null = null;
    let completedSegments = 0;

    for (const window of windows) {
      console.log(`[WALK_FORWARD] trace_id=${effectiveTraceId} executing ${window.type} segment ${window.index}`);

      const regimeResult = await detectMarketRegime(
        config.symbol,
        window.start,
        window.end,
        effectiveTraceId
      );

      const [session] = await db.insert(backtestSessions).values({
        botId: config.botId,
        generationId: config.generationId ?? null,
        status: "pending",
        symbol: config.symbol,
        startDate: window.start,
        endDate: window.end,
        initialCapital: config.initialCapital,
        walkForwardRunId: runId,
        segmentType: window.type,
        segmentIndex: window.index,
        segmentStart: window.start,
        segmentEnd: window.end,
        regimeLabel: regimeResult.regime,
        regimeConfidence: regimeResult.confidence,
        regimeMetrics: regimeResult.metrics,
      }).returning();

      const result = await executeBacktest(
        session.id,
        {
          botId: config.botId,
          symbol: config.symbol,
          timeframe: config.timeframe,
          startDate: window.start,
          endDate: window.end,
          initialCapital: config.initialCapital,
          archetype: config.archetype,
        },
        effectiveTraceId
      );

      if (!result.success) {
        console.error(`[WALK_FORWARD] trace_id=${effectiveTraceId} segment ${window.type} ${window.index} failed: ${result.error}`);
        continue;
      }

      const updatedSession = await db.query.backtestSessions.findFirst({
        where: eq(backtestSessions.id, session.id),
      });

      if (updatedSession?.sharpeRatio !== null && updatedSession?.sharpeRatio !== undefined) {
        if (window.type === "TRAINING") {
          trainingSharpes.push(updatedSession.sharpeRatio);
        } else if (window.type === "TESTING") {
          testingSharpes.push(updatedSession.sharpeRatio);
        } else if (window.type === "VALIDATION") {
          validationSharpe = updatedSession.sharpeRatio;
        }
      }

      completedSegments++;

      await db.update(walkForwardRuns)
        .set({ completedSegments })
        .where(eq(walkForwardRuns.id, runId));
    }

    const trainingAvgSharpe = trainingSharpes.length > 0
      ? trainingSharpes.reduce((a, b) => a + b, 0) / trainingSharpes.length
      : null;
    
    const testingAvgSharpe = testingSharpes.length > 0
      ? testingSharpes.reduce((a, b) => a + b, 0) / testingSharpes.length
      : null;

    const overfitRatio = (trainingAvgSharpe && testingAvgSharpe && testingAvgSharpe !== 0)
      ? trainingAvgSharpe / testingAvgSharpe
      : null;

    const consistencyScore = calculateConsistencyScore(trainingSharpes, testingSharpes);

    const passedValidation = (
      validationSharpe !== null &&
      validationSharpe >= 0.5 &&
      testingAvgSharpe !== null &&
      testingAvgSharpe >= 0.5 &&
      overfitRatio !== null &&
      overfitRatio < 2.0 &&
      consistencyScore !== null &&
      consistencyScore >= 0.6
    );

    await db.update(walkForwardRuns)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        trainingAvgSharpe,
        testingAvgSharpe,
        validationSharpe,
        consistencyScore,
        overfitRatio,
        passedValidation,
      })
      .where(eq(walkForwardRuns.id, runId));

    await logActivityEvent({
      botId: config.botId,
      eventType: "WALK_FORWARD_COMPLETED",
      severity: passedValidation ? "INFO" : "WARN",
      title: `Walk-Forward ${passedValidation ? "Passed" : "Failed"} Validation`,
      summary: `Training Sharpe: ${trainingAvgSharpe?.toFixed(2) ?? "N/A"}, Testing Sharpe: ${testingAvgSharpe?.toFixed(2) ?? "N/A"}, Validation Sharpe: ${validationSharpe?.toFixed(2) ?? "N/A"}, Overfit Ratio: ${overfitRatio?.toFixed(2) ?? "N/A"}`,
      payload: {
        runId,
        trainingAvgSharpe,
        testingAvgSharpe,
        validationSharpe,
        consistencyScore,
        overfitRatio,
        passedValidation,
        completedSegments,
      },
      traceId: effectiveTraceId,
      symbol: config.symbol,
    });

    console.log(`[WALK_FORWARD] trace_id=${effectiveTraceId} run_id=${runId} completed. passed=${passedValidation}`);

    return {
      success: true,
      runId,
      trainingAvgSharpe: trainingAvgSharpe ?? undefined,
      testingAvgSharpe: testingAvgSharpe ?? undefined,
      validationSharpe: validationSharpe ?? undefined,
      consistencyScore: consistencyScore ?? undefined,
      overfitRatio: overfitRatio ?? undefined,
      passedValidation,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    console.error(`[WALK_FORWARD] trace_id=${effectiveTraceId} run_id=${runId} failed:`, error);

    await db.update(walkForwardRuns)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        errorMessage,
      })
      .where(eq(walkForwardRuns.id, runId));

    return {
      success: false,
      runId,
      error: errorMessage,
    };
  }
}

function calculateConsistencyScore(
  trainingSharpes: number[],
  testingSharpes: number[]
): number | null {
  if (trainingSharpes.length === 0 || testingSharpes.length === 0) {
    return null;
  }

  const positiveTraining = trainingSharpes.filter(s => s > 0).length / trainingSharpes.length;
  const positiveTesting = testingSharpes.filter(s => s > 0).length / testingSharpes.length;

  const allSharpes = [...trainingSharpes, ...testingSharpes];
  const mean = allSharpes.reduce((a, b) => a + b, 0) / allSharpes.length;
  const variance = allSharpes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / allSharpes.length;
  const stdDev = Math.sqrt(variance);
  
  const coefficientOfVariation = mean !== 0 ? stdDev / Math.abs(mean) : Infinity;
  const cvScore = Math.max(0, 1 - coefficientOfVariation / 2);

  const trainingTestingGap = Math.abs(positiveTraining - positiveTesting);
  const gapScore = 1 - trainingTestingGap;

  return (positiveTraining * 0.3 + positiveTesting * 0.3 + cvScore * 0.2 + gapScore * 0.2);
}

export async function getWalkForwardRun(runId: string): Promise<WalkForwardRun | null> {
  const run = await db.query.walkForwardRuns.findFirst({
    where: eq(walkForwardRuns.id, runId),
  });
  return run ?? null;
}

export async function getWalkForwardSegments(runId: string): Promise<BacktestSession[]> {
  const sessions = await db.query.backtestSessions.findMany({
    where: eq(backtestSessions.walkForwardRunId, runId),
    orderBy: [desc(backtestSessions.segmentType), desc(backtestSessions.segmentIndex)],
  });
  return sessions;
}

export async function getLatestWalkForwardForBot(
  botId: string,
  generationId?: string
): Promise<WalkForwardRun | null> {
  const conditions = [eq(walkForwardRuns.botId, botId)];
  if (generationId) {
    conditions.push(eq(walkForwardRuns.generationId, generationId));
  }

  const run = await db.query.walkForwardRuns.findFirst({
    where: and(...conditions),
    orderBy: [desc(walkForwardRuns.createdAt)],
  });

  return run ?? null;
}
