import { storage } from "./storage";
import type { InsertAlert } from "@shared/schema";

type AlertCategory = "PROMOTION_READY" | "LIVE_PROMOTION_RECOMMENDED" | "BOT_DEGRADED" | "BOT_STALLED" | 
  "DATA_HEALTH" | "EXECUTION_RISK" | "ACCOUNT_RISK_BREACH" | "ARBITER_DECISION_ANOMALY";
type AlertSeverity = "INFO" | "WARN" | "CRITICAL";
type AlertEntityType = "BOT" | "ACCOUNT" | "SYSTEM" | "TRADE";

interface NotificationPayload {
  userId: string;
  category: AlertCategory;
  severity: AlertSeverity;
  entityType: AlertEntityType;
  entityId?: string;
  title: string;
  message: string;
  payload?: Record<string, any>;
  actionHints?: Record<string, any>;
  dedupeKey?: string;
}

export async function routeNotification(params: NotificationPayload): Promise<string | null> {
  const {
    userId,
    category,
    severity,
    entityType,
    entityId,
    title,
    message,
    payload = {},
    actionHints = {},
    dedupeKey,
  } = params;

  try {
    const alertData: InsertAlert = {
      userId,
      category,
      severity,
      entityType,
      entityId: entityId || null,
      title,
      message,
      payloadJson: payload,
      actionHintsJson: actionHints,
      dedupeKey: dedupeKey || null,
    };

    const alert = await storage.createAlert(alertData);
    console.log(`[NOTIFICATION_ROUTER] Created ${category} alert: "${title}" for user ${userId.substring(0, 8)}`);
    return alert.id;
  } catch (error) {
    console.error(`[NOTIFICATION_ROUTER] Failed to create alert:`, error);
    return null;
  }
}

export async function notifyPromotion(params: {
  userId: string;
  botId: string;
  botName: string;
  fromStage: string;
  toStage: string;
  triggeredBy: "autonomous" | "manual";
}): Promise<string | null> {
  const { userId, botId, botName, fromStage, toStage, triggeredBy } = params;
  
  const severityMap: Record<string, AlertSeverity> = {
    PAPER: "INFO",
    SHADOW: "INFO", 
    CANARY: "WARN",
    LIVE: "CRITICAL",
  };

  return routeNotification({
    userId,
    category: "PROMOTION_READY",
    severity: severityMap[toStage] || "INFO",
    entityType: "BOT",
    entityId: botId,
    title: `${botName} promoted to ${toStage}`,
    message: `Bot ${triggeredBy === "autonomous" ? "autonomously" : "manually"} promoted from ${fromStage} to ${toStage}.`,
    payload: { fromStage, toStage, botName, triggeredBy },
    actionHints: { 
      actions: ["view_bot", "review_metrics"],
      primaryAction: toStage === "LIVE" ? "review_live_config" : "view_bot"
    },
    dedupeKey: `promotion:${botId}:${fromStage}:${toStage}`,
  });
}

export async function notifyDemotion(params: {
  userId: string;
  botId: string;
  botName: string;
  fromStage: string;
  toStage: string;
  reason: string;
  triggeredBy: "autonomous" | "manual" | "risk_breach" | "self_healing";
}): Promise<string | null> {
  const { userId, botId, botName, fromStage, toStage, reason, triggeredBy } = params;
  
  const severity: AlertSeverity = 
    triggeredBy === "risk_breach" ? "CRITICAL" : 
    triggeredBy === "self_healing" ? "WARN" : "INFO";

  return routeNotification({
    userId,
    category: "BOT_DEGRADED",
    severity,
    entityType: "BOT",
    entityId: botId,
    title: `${botName} demoted to ${toStage}`,
    message: `Bot demoted from ${fromStage} to ${toStage}: ${reason}`,
    payload: { fromStage, toStage, botName, reason, triggeredBy },
    actionHints: {
      actions: ["view_bot", "review_metrics", "investigate_cause"],
      primaryAction: "view_bot"
    },
    dedupeKey: `demotion:${botId}:${fromStage}:${toStage}`,
  });
}

export async function notifyDataHealthDegradation(params: {
  userId: string;
  botId?: string;
  symbol: string;
  previousSource: string;
  currentSource: string;
  isStale: boolean;
  staleDurationMs?: number;
}): Promise<string | null> {
  const { userId, botId, symbol, previousSource, currentSource, isStale, staleDurationMs } = params;
  
  const severity: AlertSeverity = isStale ? "CRITICAL" : 
    currentSource === "CACHE" ? "WARN" : "INFO";

  const title = isStale 
    ? `${symbol} data is STALE - trading frozen`
    : `${symbol} data degraded to ${currentSource}`;

  const message = isStale
    ? `No fresh market data available for ${symbol}. Trading operations are frozen until live data is restored. Stale for ${staleDurationMs ? Math.round(staleDurationMs / 1000) : '?'}s.`
    : `Market data for ${symbol} degraded from ${previousSource} to ${currentSource}. Monitor for further degradation.`;

  return routeNotification({
    userId,
    category: "DATA_HEALTH",
    severity,
    entityType: botId ? "BOT" : "SYSTEM",
    entityId: botId,
    title,
    message,
    payload: { symbol, previousSource, currentSource, isStale, staleDurationMs },
    actionHints: {
      actions: isStale ? ["check_data_sources", "monitor_recovery"] : ["monitor"],
      primaryAction: isStale ? "check_data_sources" : "monitor"
    },
    dedupeKey: `data_health:${symbol}:${isStale ? 'stale' : currentSource}`,
  });
}

export async function notifyExecutionRisk(params: {
  userId: string;
  botId: string;
  botName: string;
  riskType: "trading_frozen" | "position_limit_breach" | "drawdown_breach" | "exposure_breach";
  reason: string;
  currentValue?: number;
  threshold?: number;
}): Promise<string | null> {
  const { userId, botId, botName, riskType, reason, currentValue, threshold } = params;
  
  const titleMap: Record<string, string> = {
    trading_frozen: `${botName} trading FROZEN`,
    position_limit_breach: `${botName} position limit breach`,
    drawdown_breach: `${botName} drawdown limit breach`,
    exposure_breach: `${botName} exposure limit breach`,
  };

  return routeNotification({
    userId,
    category: "EXECUTION_RISK",
    severity: "CRITICAL",
    entityType: "BOT",
    entityId: botId,
    title: titleMap[riskType] || `${botName} execution risk`,
    message: reason,
    payload: { botName, riskType, currentValue, threshold },
    actionHints: {
      actions: ["view_bot", "review_risk_settings", "manual_override"],
      primaryAction: "view_bot"
    },
    dedupeKey: `execution_risk:${botId}:${riskType}`,
  });
}

export async function notifyAccountRiskBreach(params: {
  userId: string;
  accountId: string;
  accountName: string;
  riskType: "blown_account" | "margin_call" | "daily_loss_limit";
  currentValue?: number;
  threshold?: number;
  attemptNumber?: number;
}): Promise<string | null> {
  const { userId, accountId, accountName, riskType, currentValue, threshold, attemptNumber } = params;
  
  const messageMap: Record<string, string> = {
    blown_account: `Account ${accountName} has blown. ${attemptNumber ? `Attempt ${attemptNumber} initiated.` : ''} All positions closed.`,
    margin_call: `Account ${accountName} received margin call. Current: ${currentValue}, Required: ${threshold}.`,
    daily_loss_limit: `Account ${accountName} hit daily loss limit. Loss: ${currentValue}%.`,
  };

  return routeNotification({
    userId,
    category: "ACCOUNT_RISK_BREACH",
    severity: "CRITICAL",
    entityType: "ACCOUNT",
    entityId: accountId,
    title: `${accountName}: ${riskType.replace(/_/g, ' ').toUpperCase()}`,
    message: messageMap[riskType],
    payload: { accountName, riskType, currentValue, threshold, attemptNumber },
    actionHints: {
      actions: ["view_account", "review_positions", "contact_broker"],
      primaryAction: "view_account"
    },
    dedupeKey: `account_risk:${accountId}:${riskType}`,
  });
}

export async function notifyLivePromotionReady(params: {
  userId: string;
  botId: string;
  botName: string;
  currentStage: string;
  metricsSnapshot: Record<string, any>;
  gatesPassedCount: number;
  totalGates: number;
}): Promise<string | null> {
  const { userId, botId, botName, currentStage, metricsSnapshot, gatesPassedCount, totalGates } = params;

  return routeNotification({
    userId,
    category: "LIVE_PROMOTION_RECOMMENDED",
    severity: "CRITICAL",
    entityType: "BOT",
    entityId: botId,
    title: `${botName} ready for LIVE promotion`,
    message: `Bot has passed ${gatesPassedCount}/${totalGates} institutional gates in ${currentStage} stage. Review metrics and approve for live trading.`,
    payload: { botName, currentStage, metricsSnapshot, gatesPassedCount, totalGates },
    actionHints: {
      actions: ["promote_to_live", "review_metrics", "defer"],
      primaryAction: "promote_to_live"
    },
    dedupeKey: `live_ready:${botId}:${currentStage}`,
  });
}

export async function notifySystemHealth(params: {
  userId: string;
  subsystem: string;
  status: "degraded" | "recovered" | "critical";
  message: string;
  details?: Record<string, any>;
}): Promise<string | null> {
  const { userId, subsystem, status, message, details } = params;
  
  const severityMap: Record<string, AlertSeverity> = {
    degraded: "WARN",
    recovered: "INFO",
    critical: "CRITICAL",
  };

  return routeNotification({
    userId,
    category: "DATA_HEALTH",
    severity: severityMap[status] || "INFO",
    entityType: "SYSTEM",
    title: `${subsystem}: ${status.toUpperCase()}`,
    message,
    payload: { subsystem, status, ...details },
    actionHints: {
      actions: status === "recovered" ? ["acknowledge"] : ["investigate", "check_integrations"],
      primaryAction: status === "recovered" ? "acknowledge" : "investigate"
    },
    dedupeKey: `system_health:${subsystem}:${status}`,
  });
}
