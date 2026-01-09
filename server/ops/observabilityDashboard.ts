/**
 * Observability Dashboard
 * 
 * Aggregates metrics from all monitoring subsystems:
 * - Database query latency
 * - WebSocket connections
 * - Evolution tournaments/KPIs
 * - Request latency stats
 * - System health
 * 
 * Provides a single endpoint for production monitoring dashboards.
 */

import { getDbMonitorMetrics, type DbMonitorMetrics } from "./dbQueryMonitor";
import { getCurrentLoadTest, getLoadTestHistory, type LoadTestResult } from "./loadTestRunner";
import { getLatencyStats, getTopSlowEndpoints } from "../middleware/request-instrumentation";
import { getMemoryStats } from "./memorySentinel";
import { db } from "../db";
import { sql } from "drizzle-orm";

const LOG_PREFIX = "[OBSERVABILITY]";

export interface WebSocketMetrics {
  connectedClients: number;
  authenticatedClients: number;
  subscriptionsTotal: number;
  messagesSent24h: number;
  lastBroadcastAt: string | null;
}

export interface EvolutionKPIs {
  tournamentsCompleted24h: number;
  tournamentsTotal: number;
  botsEvaluated24h: number;
  actionsExecuted24h: {
    breed: number;
    mutate: number;
    retire: number;
    rollback: number;
  };
  averageFitnessScore: number;
  topPerformingBot: {
    id: string;
    name: string;
    fitness: number;
  } | null;
}

export interface SystemHealthMetrics {
  status: "healthy" | "degraded" | "critical";
  uptime: number;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    heapUsedPercent: number;
  };
  database: {
    circuitOpen: boolean;
    warmedUp: boolean;
    poolSize: number;
  };
  redis: {
    connected: boolean;
  };
}

export interface ObservabilityDashboard {
  timestamp: string;
  system: SystemHealthMetrics;
  database: DbMonitorMetrics;
  webSocket: WebSocketMetrics;
  evolution: EvolutionKPIs;
  requests: {
    topSlowEndpoints: Array<{ path: string; p95: number; count: number }>;
    endpointStats: Record<string, { p50: number; p95: number; p99: number; count: number }>;
  };
  loadTests: {
    current: LoadTestResult | null;
    recent: LoadTestResult[];
  };
}

let wsMetricsCallback: (() => WebSocketMetrics) | null = null;

export function registerWebSocketMetricsProvider(callback: () => WebSocketMetrics): void {
  wsMetricsCallback = callback;
}

async function getEvolutionKPIs(): Promise<EvolutionKPIs> {
  const emptyKPIs: EvolutionKPIs = {
    tournamentsCompleted24h: 0,
    tournamentsTotal: 0,
    botsEvaluated24h: 0,
    actionsExecuted24h: { breed: 0, mutate: 0, retire: 0, rollback: 0 },
    averageFitnessScore: 0,
    topPerformingBot: null,
  };
  
  try {
    const { isCircuitOpen, isDatabaseWarmedUp } = await import("../db");
    if (isCircuitOpen() || !isDatabaseWarmedUp()) {
      console.log(`${LOG_PREFIX} Database unavailable, returning empty evolution KPIs`);
      return emptyKPIs;
    }
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const [tournamentStats] = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= ${twentyFourHoursAgo}) as completed_24h,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as total_completed,
        COALESCE(SUM(entrants_count) FILTER (WHERE completed_at >= ${twentyFourHoursAgo}), 0) as bots_evaluated_24h,
        COALESCE(SUM(COALESCE((actions_json->>'BREED')::int, 0)) FILTER (WHERE completed_at >= ${twentyFourHoursAgo}), 0) as breed_24h,
        COALESCE(SUM(COALESCE((actions_json->>'MUTATE')::int, 0)) FILTER (WHERE completed_at >= ${twentyFourHoursAgo}), 0) as mutate_24h,
        COALESCE(SUM(COALESCE((actions_json->>'RETIRE')::int, 0)) FILTER (WHERE completed_at >= ${twentyFourHoursAgo}), 0) as retire_24h,
        COALESCE(SUM(COALESCE((actions_json->>'ROLLBACK')::int, 0)) FILTER (WHERE completed_at >= ${twentyFourHoursAgo}), 0) as rollback_24h,
        COALESCE(AVG(winner_fitness) FILTER (WHERE winner_fitness IS NOT NULL), 0) as avg_fitness
      FROM evolution_tournaments
    `);

    const [topBot] = await db.execute(sql`
      SELECT 
        b.id,
        b.name,
        COALESCE(
          (b.stage_metrics->>'fitnessScore')::numeric,
          b.fitness_score,
          0
        ) as fitness
      FROM bots b
      WHERE b.status = 'running'
      ORDER BY fitness DESC
      LIMIT 1
    `);

    const stats = tournamentStats as any;
    const top = topBot as any;

    return {
      tournamentsCompleted24h: Number(stats?.completed_24h) || 0,
      tournamentsTotal: Number(stats?.total_completed) || 0,
      botsEvaluated24h: Number(stats?.bots_evaluated_24h) || 0,
      actionsExecuted24h: {
        breed: Number(stats?.breed_24h) || 0,
        mutate: Number(stats?.mutate_24h) || 0,
        retire: Number(stats?.retire_24h) || 0,
        rollback: Number(stats?.rollback_24h) || 0,
      },
      averageFitnessScore: Number(stats?.avg_fitness) || 0,
      topPerformingBot: top ? {
        id: top.id,
        name: top.name,
        fitness: Number(top.fitness) || 0,
      } : null,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to get evolution KPIs:`, error);
    return {
      tournamentsCompleted24h: 0,
      tournamentsTotal: 0,
      botsEvaluated24h: 0,
      actionsExecuted24h: { breed: 0, mutate: 0, retire: 0, rollback: 0 },
      averageFitnessScore: 0,
      topPerformingBot: null,
    };
  }
}

async function getSystemHealth(): Promise<SystemHealthMetrics> {
  const { isCircuitOpen, isDatabaseWarmedUp } = await import("../db");
  const { isRedisConfigured, getRedisClient } = await import("../redis");
  
  const memStats = getMemoryStats();
  const circuitOpen = isCircuitOpen();
  const dbWarmedUp = isDatabaseWarmedUp();
  
  let redisConnected = false;
  if (isRedisConfigured()) {
    try {
      const redis = getRedisClient();
      await redis.ping();
      redisConnected = true;
    } catch {
      redisConnected = false;
    }
  }

  const status = circuitOpen || !dbWarmedUp 
    ? "critical" 
    : (!redisConnected && isRedisConfigured()) 
      ? "degraded" 
      : "healthy";

  return {
    status,
    uptime: process.uptime() * 1000,
    memory: {
      heapUsedMB: memStats.heapUsedMB,
      heapTotalMB: memStats.heapTotalMB,
      rssMB: memStats.rssMB,
      heapUsedPercent: memStats.heapUsedPercent,
    },
    database: {
      circuitOpen,
      warmedUp: dbWarmedUp,
      poolSize: 12,
    },
    redis: {
      connected: redisConnected,
    },
  };
}

export async function getObservabilityDashboard(): Promise<ObservabilityDashboard> {
  const [system, evolution] = await Promise.all([
    getSystemHealth(),
    getEvolutionKPIs(),
  ]);

  const wsMetrics: WebSocketMetrics = wsMetricsCallback 
    ? wsMetricsCallback()
    : {
        connectedClients: 0,
        authenticatedClients: 0,
        subscriptionsTotal: 0,
        messagesSent24h: 0,
        lastBroadcastAt: null,
      };

  return {
    timestamp: new Date().toISOString(),
    system,
    database: getDbMonitorMetrics(),
    webSocket: wsMetrics,
    evolution,
    requests: {
      topSlowEndpoints: getTopSlowEndpoints(10),
      endpointStats: getLatencyStats(),
    },
    loadTests: {
      current: getCurrentLoadTest(),
      recent: getLoadTestHistory().slice(-5),
    },
  };
}
