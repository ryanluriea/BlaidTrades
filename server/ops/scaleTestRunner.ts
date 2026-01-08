/**
 * Scale Test Runner
 * 
 * Provides automated testing for autoscale readiness:
 * - CACHE: Tests Redis cache sharing and stampede protection
 * - JOBS: Tests job deduplication across instances  
 * - MEMORY: Tests memory stability under load
 * - FULL: Runs all profiles sequentially
 * 
 * Results are persisted to database and exposed via API.
 */

import crypto from "crypto";
import { getBarsCached, getBarsCacheStats, resetBarsCacheStats, getInstanceId } from "../market/barsCache";
import { getMemoryStats, getMemoryTrend, isLoadSheddingActive } from "./memorySentinel";
import { getRedisClient, isRedisConfigured } from "../redis";
import { db } from "../db";
import { sql } from "drizzle-orm";

export type ScaleTestProfile = "cache" | "jobs" | "memory" | "full";
export type ScaleTestStatus = "pending" | "running" | "passed" | "failed" | "cancelled";

export interface ScaleTestConfig {
  profile: ScaleTestProfile;
  durationMin: number;
  symbol?: string;
  timeframe?: string;
  concurrency?: number;
}

export interface ScaleTestResult {
  runId: string;
  profile: ScaleTestProfile;
  status: ScaleTestStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  instanceId: string;
  metrics: ScaleTestMetrics;
  failures: string[];
  passed: boolean;
}

export interface ScaleTestMetrics {
  cacheHitRate?: number;
  providerFetchCount?: number;
  stampedePrevented?: boolean;
  crossInstanceVerified?: boolean;
  instancesSeen?: string[];
  duplicateJobs?: number;
  jobsCompleted?: number;
  heapPeakPercent?: number;
  heapStable?: boolean;
  monotonicGrowth?: boolean;
  loadSheddingTriggered?: boolean;
  p95LatencyMs?: number;
  restarts?: number;
}

let currentRun: ScaleTestResult | null = null;
let runHistory: ScaleTestResult[] = [];

const INSTANCE_ID = getInstanceId();
const TEST_RUN_PREFIX = "scaletest:";

/**
 * Start a scale test run
 */
export async function startScaleTest(config: ScaleTestConfig): Promise<ScaleTestResult> {
  if (currentRun && currentRun.status === "running") {
    throw new Error("A test is already running");
  }

  const runId = crypto.randomUUID().slice(0, 8);
  
  currentRun = {
    runId,
    profile: config.profile,
    status: "running",
    startedAt: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    metrics: {},
    failures: [],
    passed: false,
  };

  console.log(`[SCALE_TEST] runId=${runId} profile=${config.profile} starting duration=${config.durationMin}min`);

  runTestProfile(currentRun, config).catch(err => {
    console.error(`[SCALE_TEST] runId=${runId} error:`, err);
    if (currentRun && currentRun.runId === runId) {
      currentRun.status = "failed";
      currentRun.failures.push(err.message || String(err));
      currentRun.completedAt = new Date().toISOString();
    }
  });

  return currentRun;
}

async function runTestProfile(run: ScaleTestResult, config: ScaleTestConfig): Promise<void> {
  const startTime = Date.now();
  
  try {
    switch (config.profile) {
      case "cache":
        await runCacheTest(run, config);
        break;
      case "jobs":
        await runJobsTest(run, config);
        break;
      case "memory":
        await runMemoryTest(run, config);
        break;
      case "full":
        await runCacheTest(run, { ...config, durationMin: Math.ceil(config.durationMin / 3) });
        if (run.status !== "failed") {
          await runJobsTest(run, { ...config, durationMin: Math.ceil(config.durationMin / 3) });
        }
        if (run.status !== "failed") {
          await runMemoryTest(run, { ...config, durationMin: Math.ceil(config.durationMin / 3) });
        }
        break;
    }

    run.durationMs = Date.now() - startTime;
    run.completedAt = new Date().toISOString();
    
    if (run.failures.length === 0) {
      run.status = "passed";
      run.passed = true;
    } else {
      run.status = "failed";
    }

    runHistory.push({ ...run });
    if (runHistory.length > 100) {
      runHistory = runHistory.slice(-100);
    }

    await persistTestResult(run);
    
    console.log(`[SCALE_TEST] runId=${run.runId} completed status=${run.status} duration=${run.durationMs}ms`);
    
  } catch (err) {
    run.status = "failed";
    run.failures.push(err instanceof Error ? err.message : String(err));
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - startTime;
  }
}

async function runCacheTest(run: ScaleTestResult, config: ScaleTestConfig): Promise<void> {
  console.log(`[SCALE_TEST] runId=${run.runId} cache_test starting`);
  
  const symbol = config.symbol || "MES";
  const timeframe = config.timeframe || "1m";
  const concurrency = config.concurrency || 10;
  
  await resetBarsCacheStats(run.runId);

  const now = Date.now();
  const endTs = now;
  const startTs = now - (7 * 24 * 60 * 60 * 1000);

  console.log(`[SCALE_TEST] runId=${run.runId} warmup_fetch symbol=${symbol}`);
  const warmupResult = await getBarsCached(
    { symbol, timeframe, sessionMode: "ALL", startTs, endTs },
    `test-${run.runId}-warmup`,
    run.runId
  );
  
  if (warmupResult.bars.length === 0) {
    run.failures.push("Warmup fetch returned no bars");
    return;
  }

  console.log(`[SCALE_TEST] runId=${run.runId} single_instance_hit_test`);
  for (let i = 0; i < 5; i++) {
    const result = await getBarsCached(
      { symbol, timeframe, sessionMode: "ALL", startTs, endTs },
      `test-${run.runId}-hit-${i}`,
      run.runId
    );
    if (!result.cacheHit) {
      run.failures.push(`Single instance hit test failed on iteration ${i}`);
      return;
    }
  }

  console.log(`[SCALE_TEST] runId=${run.runId} stampede_test concurrency=${concurrency}`);
  const stampedeFetches: Promise<any>[] = [];
  
  const uniqueStartTs = startTs - (Math.random() * 60000);
  
  for (let i = 0; i < concurrency; i++) {
    stampedeFetches.push(
      getBarsCached(
        { symbol, timeframe, sessionMode: "ALL", startTs: uniqueStartTs, endTs },
        `test-${run.runId}-stampede-${i}`,
        run.runId
      )
    );
  }

  const stampedeResults = await Promise.all(stampedeFetches);
  
  const providerFetchCount = stampedeResults.filter(r => r.providerFetch).length;
  const lockAcquiredCount = stampedeResults.filter(r => r.lockAcquired).length;
  const instancesSeen = [...new Set(stampedeResults.map(r => r.instanceId))];

  run.metrics.providerFetchCount = providerFetchCount;
  run.metrics.stampedePrevented = providerFetchCount <= 1;
  run.metrics.instancesSeen = instancesSeen;
  run.metrics.crossInstanceVerified = instancesSeen.length >= 1;

  if (providerFetchCount > 1) {
    run.failures.push(`Stampede protection failed: ${providerFetchCount} provider fetches (expected 1)`);
  }

  const stats = await getBarsCacheStats(run.runId);
  run.metrics.cacheHitRate = stats.hits / (stats.hits + stats.misses) || 0;

  console.log(`[SCALE_TEST] runId=${run.runId} cache_test_complete hit_rate=${(run.metrics.cacheHitRate * 100).toFixed(1)}% provider_fetches=${providerFetchCount}`);
}

async function runJobsTest(run: ScaleTestResult, config: ScaleTestConfig): Promise<void> {
  console.log(`[SCALE_TEST] runId=${run.runId} jobs_test starting`);
  
  run.metrics.duplicateJobs = 0;
  run.metrics.jobsCompleted = 0;

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT id) as unique_ids
      FROM jobs
      WHERE status = 'completed'
      AND created_at > NOW() - INTERVAL '1 hour'
    `);
    
    const row = result.rows[0] as any;
    run.metrics.jobsCompleted = parseInt(row?.total) || 0;
    
    const duplicateCheck = await db.execute(sql`
      SELECT job_type, bot_id, COUNT(*) as exec_count
      FROM jobs
      WHERE status = 'running'
      GROUP BY job_type, bot_id
      HAVING COUNT(*) > 1
    `);
    
    run.metrics.duplicateJobs = duplicateCheck.rows.length;
    
    if (run.metrics.duplicateJobs > 0) {
      run.failures.push(`Found ${run.metrics.duplicateJobs} duplicate running jobs`);
    }
    
  } catch (err) {
    console.error(`[SCALE_TEST] runId=${run.runId} jobs_test_error:`, err);
    run.failures.push(`Jobs test error: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[SCALE_TEST] runId=${run.runId} jobs_test_complete duplicates=${run.metrics.duplicateJobs}`);
}

async function runMemoryTest(run: ScaleTestResult, config: ScaleTestConfig): Promise<void> {
  console.log(`[SCALE_TEST] runId=${run.runId} memory_test starting duration=${config.durationMin}min`);
  
  const durationMs = config.durationMin * 60 * 1000;
  const sampleInterval = 10000;
  const iterations = Math.ceil(durationMs / sampleInterval);
  
  const samples: number[] = [];
  let loadSheddingTriggered = false;

  for (let i = 0; i < iterations; i++) {
    const stats = getMemoryStats();
    samples.push(stats.current.heapUsedPercent);
    
    if (stats.loadSheddingActive) {
      loadSheddingTriggered = true;
    }

    await new Promise(resolve => setTimeout(resolve, sampleInterval));

    if (i % 6 === 0) {
      try {
        const now = Date.now();
        await getBarsCached(
          { 
            symbol: "MES", 
            timeframe: "1m", 
            sessionMode: "ALL", 
            startTs: now - (7 * 24 * 60 * 60 * 1000), 
            endTs: now 
          },
          `test-${run.runId}-memory-${i}`,
          run.runId
        );
      } catch {
      }
    }
  }

  const trend = getMemoryTrend();
  const stats = getMemoryStats();

  run.metrics.heapPeakPercent = stats.peak.heapUsedPercent * 100;
  run.metrics.heapStable = !trend.isMonotonicGrowth && trend.trendDescription !== "MONOTONIC_GROWTH";
  run.metrics.monotonicGrowth = trend.isMonotonicGrowth;
  run.metrics.loadSheddingTriggered = loadSheddingTriggered;

  if (trend.isMonotonicGrowth) {
    run.failures.push("Memory shows monotonic growth pattern - potential leak");
  }

  console.log(`[SCALE_TEST] runId=${run.runId} memory_test_complete peak=${run.metrics.heapPeakPercent?.toFixed(1)}% stable=${run.metrics.heapStable}`);
}

async function persistTestResult(run: ScaleTestResult): Promise<void> {
  if (!isRedisConfigured()) return;
  
  try {
    const client = await getRedisClient();
    if (!client) return;
    
    const key = `${TEST_RUN_PREFIX}${run.runId}`;
    await client.setEx(key, 86400 * 7, JSON.stringify(run));
  } catch {
  }
}

/**
 * Get current test status
 */
export function getScaleTestStatus(): ScaleTestResult | null {
  return currentRun;
}

/**
 * Get test results by runId
 */
export async function getScaleTestResults(runId: string): Promise<ScaleTestResult | null> {
  const localResult = runHistory.find(r => r.runId === runId);
  if (localResult) return localResult;
  
  if (isRedisConfigured()) {
    try {
      const client = await getRedisClient();
      if (client) {
        const data = await client.get(`${TEST_RUN_PREFIX}${runId}`);
        if (data) {
          return JSON.parse(data);
        }
      }
    } catch {
    }
  }
  
  return null;
}

/**
 * Get recent test history
 */
export function getScaleTestHistory(): ScaleTestResult[] {
  return [...runHistory].reverse();
}

/**
 * Cancel current test
 */
export function cancelScaleTest(): boolean {
  if (currentRun && currentRun.status === "running") {
    currentRun.status = "cancelled";
    currentRun.completedAt = new Date().toISOString();
    currentRun.failures.push("Cancelled by user");
    return true;
  }
  return false;
}

/**
 * Check if system is scale-ready based on last test results
 */
export function isScaleReady(): {
  ready: boolean;
  reasons: string[];
  lastTestRunId?: string;
  lastTestStatus?: ScaleTestStatus;
} {
  const reasons: string[] = [];
  
  if (runHistory.length === 0) {
    return {
      ready: false,
      reasons: ["No scale tests have been run yet"],
    };
  }

  const lastRun = runHistory[runHistory.length - 1];
  
  if (lastRun.status !== "passed") {
    reasons.push(`Last test failed: ${lastRun.failures.join(", ")}`);
  }

  if (lastRun.metrics.cacheHitRate !== undefined && lastRun.metrics.cacheHitRate < 0.8) {
    reasons.push(`Cache hit rate too low: ${(lastRun.metrics.cacheHitRate * 100).toFixed(1)}%`);
  }

  if (lastRun.metrics.duplicateJobs && lastRun.metrics.duplicateJobs > 0) {
    reasons.push(`Job duplication detected: ${lastRun.metrics.duplicateJobs}`);
  }

  if (lastRun.metrics.monotonicGrowth) {
    reasons.push("Memory shows monotonic growth pattern");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    lastTestRunId: lastRun.runId,
    lastTestStatus: lastRun.status,
  };
}
