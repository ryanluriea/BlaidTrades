import { db } from "./db";
import { botDegradationEvents } from "@shared/schema";
import { eq, isNull, and, desc } from "drizzle-orm";
import crypto from "crypto";

type DegradationReason = 
  | "EDGE_DECAY"
  | "DRAWDOWN_BREACH"
  | "WIN_RATE_COLLAPSE"
  | "PROFIT_FACTOR_BREACH"
  | "VOLATILITY_SPIKE"
  | "SIGNAL_INSTABILITY"
  | "DATA_QUALITY_ISSUE"
  | "MANUAL_DEMOTION";

type DegradationSeverity = "WARN" | "ERROR" | "CRITICAL";

interface MetricsSnapshot {
  pnl?: number | null;
  winRate?: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  trades?: number | null;
  sharpeRatio?: number | null;
}

interface DegradationEventParams {
  botId: string;
  generationId?: string | null;
  accountAttemptId?: string | null;
  reason: DegradationReason;
  severity?: DegradationSeverity;
  stage: string;
  previousStage?: string | null;
  metricsSnapshot: MetricsSnapshot;
  baselineMetrics?: MetricsSnapshot | null;
  thresholdBreached?: string | null;
  thresholdValue?: number | null;
  actualValue?: number | null;
  actionTaken?: string | null;
  recoveryPlan?: string | null;
  traceId?: string | null;
}

export async function logDegradationEvent(params: DegradationEventParams): Promise<string | null> {
  const traceId = params.traceId || crypto.randomUUID().substring(0, 8);
  
  try {
    const [result] = await db.insert(botDegradationEvents).values({
      botId: params.botId,
      generationId: params.generationId ?? null,
      accountAttemptId: params.accountAttemptId ?? null,
      reason: params.reason,
      severity: params.severity ?? "WARN",
      stage: params.stage,
      previousStage: params.previousStage ?? null,
      metricsSnapshot: params.metricsSnapshot,
      baselineMetrics: params.baselineMetrics ?? {},
      thresholdBreached: params.thresholdBreached ?? null,
      thresholdValue: params.thresholdValue ?? null,
      actualValue: params.actualValue ?? null,
      actionTaken: params.actionTaken ?? null,
      recoveryPlan: params.recoveryPlan ?? null,
      traceId,
    }).returning({ id: botDegradationEvents.id });
    
    console.log(`[DEGRADATION_EVENT] trace_id=${traceId} bot=${params.botId} reason=${params.reason} severity=${params.severity ?? "WARN"} action=${params.actionTaken ?? "NONE"}`);
    
    return result?.id || null;
  } catch (error) {
    console.error(`[DEGRADATION_EVENT] trace_id=${traceId} FAILED:`, error);
    return null;
  }
}

export async function resolveDegradationEvent(
  eventId: string,
  resolvedBy: "AUTO_RECOVERY" | "OPERATOR" | "EVOLUTION"
): Promise<boolean> {
  const traceId = crypto.randomUUID().substring(0, 8);
  
  try {
    const result = await db.update(botDegradationEvents)
      .set({ 
        resolvedAt: new Date(),
        resolvedBy,
      })
      .where(eq(botDegradationEvents.id, eventId))
      .returning({ id: botDegradationEvents.id });
    
    if (result.length > 0) {
      console.log(`[DEGRADATION_EVENT] trace_id=${traceId} resolved=${eventId} by=${resolvedBy}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[DEGRADATION_EVENT] trace_id=${traceId} resolve_failed:`, error);
    return false;
  }
}

export async function getUnresolvedDegradationEvents(botId: string): Promise<any[]> {
  const events = await db.select()
    .from(botDegradationEvents)
    .where(and(
      eq(botDegradationEvents.botId, botId),
      isNull(botDegradationEvents.resolvedAt)
    ))
    .orderBy(desc(botDegradationEvents.createdAt));
  
  return events;
}
