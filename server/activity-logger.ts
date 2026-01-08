import { db } from "./db";
import { activityEvents, bots } from "@shared/schema";
import type { InsertActivityEvent } from "@shared/schema";
import { notifyPromotion, notifyDemotion } from "./notification-router";
import { logGrokFeedback, type GrokPerformanceSnapshot } from "./grok-feedback-collector";
import { eq } from "drizzle-orm";

type ActivityEventType = 
  | "TRADE_EXECUTED" | "TRADE_EXITED" | "ORDER_BLOCKED_RISK"
  | "PROMOTED" | "DEMOTED" | "GRADUATED"
  | "BACKTEST_STARTED" | "BACKTEST_COMPLETED" | "BACKTEST_FAILED"
  | "RUNNER_STARTED" | "RUNNER_RESTARTED" | "RUNNER_STOPPED"
  | "JOB_TIMEOUT" | "KILL_TRIGGERED" | "KILL_SWITCH"
  | "AUTONOMY_TIER_CHANGED" | "AUTONOMY_GATE_BLOCKED"
  | "INTEGRATION_VERIFIED" | "INTEGRATION_USAGE_PROOF"
  | "INTEGRATION_ERROR" | "INTEGRATION_PROOF"
  | "NOTIFY_DISCORD_SENT" | "NOTIFY_DISCORD_FAILED"
  | "SYSTEM_STATUS_CHANGED" | "BOT_CREATED" | "BOT_ARCHIVED" | "BOT_AUTO_REVERTED"
  | "EVOLUTION_COMPLETED" | "EVOLUTION_CONVERGED" | "EVOLUTION_RESUMED" | "STRATEGY_MUTATED"
  | "SOURCE_GOVERNOR_DECISION" | "SOURCE_GOVERNOR_BLOCKED"
  | "ADAPTIVE_WEIGHTS_RESET" | "SOURCE_STATE_RESET"
  | "WALK_FORWARD_COMPLETED" | "STRESS_TEST_COMPLETED"
  | "SELF_HEALING_RECOVERY" | "SELF_HEALING_DEMOTION" | "SELF_HEALING_SKIPPED" | "SELF_HEALING_FAILED"
  | "PAPER_TRADE_STALL" | "PAPER_TRADE_ENTRY" | "PAPER_TRADE_EXIT"
  | "BOT_STAGNANT" | "BOT_NO_ACTIVITY"
  | "READY_FOR_LIVE"
  | "STRATEGY_LAB_RESEARCH" | "STRATEGY_LAB_CYCLE" | "STRATEGY_LAB_CANDIDATE_CREATED"
  | "LAB_FAILURE_DETECTED" | "LAB_FEEDBACK_TRIGGERED"
  | "LAB_RESEARCH_CYCLE" | "LAB_RESEARCH_FAILED"
  | "GROK_RESEARCH_COMPLETED" | "GROK_CYCLE_COMPLETED"
  | "RESEARCH_ORCHESTRATOR_TOGGLE" | "RESEARCH_JOB_COMPLETED" | "RESEARCH_ORCHESTRATOR_STARTED"
  | "ORCHESTRATOR_ALERT"
  | "SECURITY_AUDIT" | "CREDENTIAL_ROTATION";

type ActivitySeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL" | "SUCCESS";

export interface LogActivityEventParams {
  userId?: string;
  botId?: string;
  eventType: ActivityEventType;
  severity?: ActivitySeverity;
  title: string;
  summary?: string;
  payload?: Record<string, any>;
  traceId?: string;
  stage?: string;
  symbol?: string;
  provider?: string;
  accountId?: string;
  dedupeKey?: string;
}

export async function logActivityEvent(params: LogActivityEventParams): Promise<string | null> {
  const {
    userId,
    botId,
    eventType,
    severity = "INFO",
    title,
    summary,
    payload = {},
    traceId,
    stage,
    symbol,
    provider,
    accountId,
    dedupeKey,
  } = params;

  try {
    const insertData: InsertActivityEvent = {
      userId: userId || undefined,
      botId: botId || undefined,
      eventType,
      severity,
      title,
      summary: summary || undefined,
      payload,
      traceId: traceId || undefined,
      stage: stage || undefined,
      symbol: symbol || undefined,
      provider: provider || undefined,
      accountId: accountId || undefined,
      dedupeKey: dedupeKey || undefined,
    };

    const [result] = await db.insert(activityEvents).values(insertData).returning({ id: activityEvents.id });
    
    console.log(`[ACTIVITY_EVENT] type=${eventType} severity=${severity} title="${title.substring(0, 50)}" trace_id=${traceId || 'none'}`);
    
    return result?.id || null;
  } catch (error) {
    console.error(`[ACTIVITY_EVENT] Failed to log event type=${eventType}:`, error);
    return null;
  }
}

export async function logBotPromotion(
  userId: string,
  botId: string,
  botName: string,
  fromStage: string,
  toStage: string,
  traceId?: string,
  triggeredBy: "autonomous" | "manual" = "manual",
  performanceSnapshot?: GrokPerformanceSnapshot
): Promise<string | null> {
  // Log to activity events (audit trail)
  const eventId = await logActivityEvent({
    userId,
    botId,
    eventType: "PROMOTED",
    severity: "INFO",
    title: `${botName} promoted to ${toStage}`,
    summary: `Bot promoted from ${fromStage} to ${toStage}`,
    payload: { fromStage, toStage, botName, triggeredBy },
    traceId,
    stage: toStage,
  });
  
  // Log AI feedback for learning loop (works for both Grok and Perplexity strategies)
  try {
    const feedbackId = await logGrokFeedback({
      botId,
      eventType: "PROMOTION",
      previousStage: fromStage,
      currentStage: toStage,
      performance: performanceSnapshot || {},
      traceId,
    });
    if (feedbackId) {
      console.log(`[ACTIVITY_LOGGER] AI feedback logged for promotion: ${feedbackId}`);
    }
  } catch (err) {
    console.warn(`[ACTIVITY_LOGGER] Failed to log AI feedback for promotion:`, err);
  }
  
  // Also create user-facing notification in AlertsDrawer
  await notifyPromotion({
    userId,
    botId,
    botName,
    fromStage,
    toStage,
    triggeredBy,
  }).catch(err => console.error(`[ACTIVITY_LOGGER] Failed to route promotion notification:`, err));
  
  return eventId;
}

export async function logBotDemotion(
  userId: string,
  botId: string,
  botName: string,
  fromStage: string,
  toStage: string,
  reason: string,
  traceId?: string,
  triggeredBy: "autonomous" | "manual" | "risk_breach" | "self_healing" = "manual",
  performanceSnapshot?: GrokPerformanceSnapshot
): Promise<string | null> {
  // Log to activity events (audit trail)
  const eventId = await logActivityEvent({
    userId,
    botId,
    eventType: "DEMOTED",
    severity: "WARN",
    title: `${botName} demoted to ${toStage}`,
    summary: `Bot demoted from ${fromStage} to ${toStage}: ${reason}`,
    payload: { fromStage, toStage, botName, reason, triggeredBy },
    traceId,
    stage: toStage,
  });
  
  // Log AI feedback for learning loop (works for both Grok and Perplexity strategies)
  try {
    const feedbackId = await logGrokFeedback({
      botId,
      eventType: "DEMOTION",
      previousStage: fromStage,
      currentStage: toStage,
      performance: performanceSnapshot || {},
      failureReason: reason,
      traceId,
    });
    if (feedbackId) {
      console.log(`[ACTIVITY_LOGGER] AI feedback logged for demotion: ${feedbackId}`);
    }
  } catch (err) {
    console.warn(`[ACTIVITY_LOGGER] Failed to log AI feedback for demotion:`, err);
  }
  
  // Also create user-facing notification in AlertsDrawer
  await notifyDemotion({
    userId,
    botId,
    botName,
    fromStage,
    toStage,
    reason,
    triggeredBy,
  }).catch(err => console.error(`[ACTIVITY_LOGGER] Failed to route demotion notification:`, err));
  
  return eventId;
}

export async function logRunnerStarted(
  userId: string,
  botId: string,
  botName: string,
  stage: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "RUNNER_STARTED",
    severity: "INFO",
    title: `Runner started for ${botName}`,
    summary: `Bot runner started in ${stage} stage`,
    payload: { botName, stage },
    traceId,
    stage,
  });
}

export async function logRunnerRestarted(
  userId: string,
  botId: string,
  botName: string,
  stage: string,
  reason: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "RUNNER_RESTARTED",
    severity: "WARN",
    title: `Runner restarted for ${botName}`,
    summary: `Bot runner restarted: ${reason}`,
    payload: { botName, stage, reason },
    traceId,
    stage,
  });
}

export async function logRunnerStopped(
  userId: string,
  botId: string,
  botName: string,
  stage: string,
  reason: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "RUNNER_STOPPED",
    severity: "INFO",
    title: `Runner stopped for ${botName}`,
    summary: `Bot runner stopped: ${reason}`,
    payload: { botName, stage, reason },
    traceId,
    stage,
  });
}

export async function logJobTimeout(
  userId: string | undefined,
  botId: string,
  botName: string,
  jobId: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "JOB_TIMEOUT",
    severity: "ERROR",
    title: `Job timeout for ${botName}`,
    summary: `Job ${jobId} timed out and was terminated`,
    payload: { botName, jobId },
    traceId,
  });
}

export async function logKillTriggered(
  userId: string | undefined,
  botId: string,
  botName: string,
  reason: string,
  killedBy: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "KILL_TRIGGERED",
    severity: "CRITICAL",
    title: `Kill triggered for ${botName}`,
    summary: `Bot killed by ${killedBy}: ${reason}`,
    payload: { botName, reason, killedBy },
    traceId,
  });
}

export async function logDiscordNotification(
  userId: string | undefined,
  channel: string,
  success: boolean,
  title: string,
  traceId?: string,
  errorMessage?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    eventType: success ? "NOTIFY_DISCORD_SENT" : "NOTIFY_DISCORD_FAILED",
    severity: success ? "INFO" : "ERROR",
    title: success ? `Discord notification sent to ${channel}` : `Discord notification failed for ${channel}`,
    summary: success ? title : (errorMessage || "Unknown error"),
    payload: { channel, originalTitle: title, success, error: errorMessage },
    traceId,
    provider: "discord",
  });
}

export async function logBacktestStarted(
  userId: string,
  botId: string,
  botName: string,
  symbol: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "BACKTEST_STARTED",
    severity: "INFO",
    title: `Backtest started for ${botName}`,
    summary: `Backtest initiated on ${symbol}`,
    payload: { botName, symbol },
    traceId,
    stage: "TRIALS",
    symbol,
  });
}

export async function logBacktestCompleted(
  userId: string,
  botId: string,
  botName: string,
  symbol: string,
  pnl: number,
  winRate: number,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "BACKTEST_COMPLETED",
    severity: pnl >= 0 ? "INFO" : "WARN",
    title: `Backtest completed for ${botName}`,
    summary: `Result: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} PnL, ${(winRate * 100).toFixed(1)}% win rate`,
    payload: { botName, symbol, pnl, winRate },
    traceId,
    stage: "TRIALS",
    symbol,
  });
}

export async function logBacktestFailed(
  userId: string,
  botId: string,
  botName: string,
  reason: string,
  traceId?: string
): Promise<string | null> {
  return logActivityEvent({
    userId,
    botId,
    eventType: "BACKTEST_FAILED",
    severity: "ERROR",
    title: `Backtest failed for ${botName}`,
    summary: reason,
    payload: { botName, reason },
    traceId,
    stage: "TRIALS",
  });
}
