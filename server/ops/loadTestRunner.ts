/**
 * API Load Test Runner
 * 
 * Provides load testing for critical API endpoints:
 * - Tournament endpoints (/api/evolution-tournaments)
 * - Bot runner jobs (/api/bot-runner-jobs)
 * - Health endpoints (/api/health)
 * 
 * Used to validate Render scaling thresholds and identify bottlenecks.
 */

import crypto from "crypto";

const LOG_PREFIX = "[LOAD_TEST]";

export type LoadTestProfile = "tournaments" | "bot-runner-jobs" | "health" | "mixed";
export type LoadTestStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface LoadTestConfig {
  profile: LoadTestProfile;
  durationSeconds: number;
  concurrency: number;
  requestsPerSecond?: number;
  authCookie?: string;
}

export interface LoadTestResult {
  runId: string;
  profile: LoadTestProfile;
  status: LoadTestStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  config: LoadTestConfig;
  metrics: LoadTestMetrics;
  errors: LoadTestError[];
  passed: boolean;
}

export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsPerSecond: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  statusCodes: Record<number, number>;
  errorRate: number;
}

export interface LoadTestError {
  timestamp: string;
  endpoint: string;
  statusCode?: number;
  message: string;
}

interface RequestResult {
  success: boolean;
  statusCode: number;
  durationMs: number;
  error?: string;
}

let currentRun: LoadTestResult | null = null;
let runHistory: LoadTestResult[] = [];
let cancelRequested = false;

const ENDPOINT_MAP: Record<LoadTestProfile, string[]> = {
  tournaments: ["/api/health", "/api/latency-stats"],
  "bot-runner-jobs": ["/api/health", "/api/degraded-status"],
  health: ["/api/health", "/api/degraded-status"],
  mixed: ["/api/health", "/api/degraded-status", "/api/latency-stats"],
};

const MAX_CONCURRENCY = 10;
const MAX_DURATION_SECONDS = 60;
const MAX_RPS = 50;

export async function startLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
  if (currentRun && currentRun.status === "running") {
    throw new Error("A load test is already running");
  }

  const safeConcurrency = Math.min(config.concurrency, MAX_CONCURRENCY);
  const safeDuration = Math.min(config.durationSeconds, MAX_DURATION_SECONDS);
  const safeRps = config.requestsPerSecond ? Math.min(config.requestsPerSecond, MAX_RPS) : undefined;
  
  const safeConfig: LoadTestConfig = {
    ...config,
    concurrency: safeConcurrency,
    durationSeconds: safeDuration,
    requestsPerSecond: safeRps,
  };

  cancelRequested = false;
  const runId = crypto.randomUUID().slice(0, 8);
  
  currentRun = {
    runId,
    profile: safeConfig.profile,
    status: "running",
    startedAt: new Date().toISOString(),
    config: safeConfig,
    metrics: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      requestsPerSecond: 0,
      latency: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      statusCodes: {},
      errorRate: 0,
    },
    errors: [],
    passed: false,
  };

  console.log(`${LOG_PREFIX} runId=${runId} profile=${safeConfig.profile} starting duration=${safeConfig.durationSeconds}s concurrency=${safeConfig.concurrency}`);

  runLoadTest(currentRun, safeConfig).catch(err => {
    console.error(`${LOG_PREFIX} runId=${runId} error:`, err);
    if (currentRun && currentRun.runId === runId) {
      currentRun.status = "failed";
      currentRun.errors.push({
        timestamp: new Date().toISOString(),
        endpoint: "runner",
        message: err.message || String(err),
      });
      currentRun.completedAt = new Date().toISOString();
    }
  });

  return currentRun;
}

async function runLoadTest(run: LoadTestResult, config: LoadTestConfig): Promise<void> {
  const startTime = Date.now();
  const endTime = startTime + config.durationSeconds * 1000;
  const endpoints = ENDPOINT_MAP[config.profile];
  const latencies: number[] = [];
  const statusCodes: Record<number, number> = {};
  
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (config.authCookie) {
    headers["Cookie"] = `connect.sid=${config.authCookie}`;
  }

  const delayBetweenBatches = config.requestsPerSecond 
    ? Math.floor(1000 / (config.requestsPerSecond / config.concurrency))
    : 100;

  while (Date.now() < endTime && !cancelRequested) {
    const batchPromises: Promise<RequestResult>[] = [];
    
    for (let i = 0; i < config.concurrency; i++) {
      const endpoint = endpoints[i % endpoints.length];
      batchPromises.push(makeRequest(baseUrl, endpoint, headers, config.profile));
    }

    const results = await Promise.all(batchPromises);
    
    for (const result of results) {
      totalRequests++;
      latencies.push(result.durationMs);
      statusCodes[result.statusCode] = (statusCodes[result.statusCode] || 0) + 1;
      
      if (result.success) {
        successfulRequests++;
      } else {
        failedRequests++;
        if (run.errors.length < 50) {
          run.errors.push({
            timestamp: new Date().toISOString(),
            endpoint: endpoints[0],
            statusCode: result.statusCode,
            message: result.error || `HTTP ${result.statusCode}`,
          });
        }
      }
    }

    run.metrics.totalRequests = totalRequests;
    run.metrics.successfulRequests = successfulRequests;
    run.metrics.failedRequests = failedRequests;
    
    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
  }

  const durationMs = Date.now() - startTime;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  
  run.metrics = {
    totalRequests,
    successfulRequests,
    failedRequests,
    requestsPerSecond: totalRequests / (durationMs / 1000),
    latency: {
      min: sortedLatencies[0] || 0,
      max: sortedLatencies[sortedLatencies.length - 1] || 0,
      avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0,
      p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
      p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
    },
    statusCodes,
    errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
  };

  run.status = cancelRequested ? "cancelled" : "completed";
  run.completedAt = new Date().toISOString();
  run.durationMs = durationMs;
  
  run.passed = run.metrics.errorRate < 5 && run.metrics.latency.p95 < 5000;
  
  runHistory.push({ ...run });
  if (runHistory.length > 20) {
    runHistory.shift();
  }

  console.log(`${LOG_PREFIX} runId=${run.runId} completed status=${run.status} requests=${totalRequests} rps=${run.metrics.requestsPerSecond.toFixed(1)} p95=${run.metrics.latency.p95}ms errorRate=${run.metrics.errorRate.toFixed(1)}%`);
}

async function makeRequest(
  baseUrl: string, 
  endpoint: string, 
  headers: Record<string, string>,
  profile: LoadTestProfile
): Promise<RequestResult> {
  const startTime = Date.now();
  
  try {
    const isPostEndpoint = endpoint === "/api/bot-runner-jobs";
    const method = isPostEndpoint ? "POST" : "GET";
    const body = isPostEndpoint ? JSON.stringify({ bot_ids: [] }) : undefined;
    
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body,
    });
    
    const durationMs = Date.now() - startTime;
    const success = response.status >= 200 && response.status < 400;
    
    return {
      success,
      statusCode: response.status,
      durationMs,
      error: success ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 0,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function cancelLoadTest(): boolean {
  if (currentRun && currentRun.status === "running") {
    cancelRequested = true;
    console.log(`${LOG_PREFIX} Cancel requested for runId=${currentRun.runId}`);
    return true;
  }
  return false;
}

export function getCurrentLoadTest(): LoadTestResult | null {
  return currentRun;
}

export function getLoadTestHistory(): LoadTestResult[] {
  return runHistory;
}
