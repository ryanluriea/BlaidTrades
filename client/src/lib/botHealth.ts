/**
 * @deprecated Use canonicalStateEvaluator.ts and healthConstants.ts instead
 * 
 * This file is kept for backwards compatibility but should not be used directly.
 * All health computation should go through evaluateCanonicalState() which uses
 * the unified thresholds from healthConstants.ts
 */
import { parseISO, differenceInSeconds } from "date-fns";
import { HEALTH_THRESHOLDS, HEARTBEAT_THRESHOLDS } from "./healthConstants";

export interface HealthComputation {
  status: "OK" | "WARN" | "DEGRADED";
  reason: string | null;
  reasons: string[];
}

interface HealthInputs {
  activityState: string | null;
  lastHeartbeat: string | null;
  stallReason: string | null;
  instanceStatus: string | null;
  mode: string | null;
  recentErrorCount: number;
  hasRiskViolation?: boolean;
  executionBlocked?: boolean;
}

/**
 * Compute bot health status following strict rules:
 * 
 * DEGRADED ONLY when:
 * - Heartbeat is stale (STALLED state)
 * - Execution is blocked
 * - Repeated errors exceed threshold
 * - Risk engine has frozen the bot
 * - Activity state is ERROR or STALLED
 * 
 * NOT DEGRADED when:
 * - Bot is idle
 * - Bot has zero trades
 * - Bot is in LAB
 * - Bot is backtesting
 * - Bot is newly created
 * - Bot has no metrics yet
 */
export function computeBotHealth(inputs: HealthInputs): HealthComputation {
  const reasons: string[] = [];
  let status: "OK" | "WARN" | "DEGRADED" = "OK";

  const {
    activityState,
    lastHeartbeat,
    stallReason,
    instanceStatus,
    recentErrorCount,
    hasRiskViolation,
    executionBlocked,
  } = inputs;

  // DEGRADED: Activity state is STALLED
  if (activityState === "STALLED") {
    status = "DEGRADED";
    reasons.push(stallReason || "Bot stalled");
  }

  // DEGRADED: Activity state is ERROR (but only if persistent)
  if (activityState === "ERROR") {
    // Error state means the bot is broken, not just had a hiccup
    status = "DEGRADED";
    reasons.push(stallReason || "Bot in error state");
  }

  // DEGRADED: Instance status is error or stopped with issues
  if (instanceStatus === "error") {
    status = "DEGRADED";
    reasons.push("Instance execution error");
  }

  // DEGRADED: Heartbeat stale check (only if bot should be active)
  // Uses unified thresholds from healthConstants
  if (lastHeartbeat && activityState && !["IDLE", "STOPPED"].includes(activityState)) {
    const lastHB = parseISO(lastHeartbeat);
    const staleness = differenceInSeconds(new Date(), lastHB) * 1000; // convert to ms
    
    // Stale heartbeat for active bot = DEGRADED
    if (staleness > HEARTBEAT_THRESHOLDS.STALE_MS) {
      if (status !== "DEGRADED") {
        status = "DEGRADED";
      }
      reasons.push(`Heartbeat stale (${Math.round(staleness / 60000)}m)`);
    } else if (staleness > HEARTBEAT_THRESHOLDS.WARNING_MS && status === "OK") {
      status = "WARN";
      reasons.push("Heartbeat delayed");
    }
  }

  // DEGRADED: Risk violation
  if (hasRiskViolation) {
    status = "DEGRADED";
    reasons.push("Risk cap breached");
  }

  // DEGRADED: Execution blocked
  if (executionBlocked) {
    status = "DEGRADED";
    reasons.push("Execution adapter blocked");
  }

  // WARN: Recent errors (but not enough for DEGRADED)
  if (recentErrorCount >= 3 && status === "OK") {
    status = "WARN";
    reasons.push(`${recentErrorCount} recent errors`);
  } else if (recentErrorCount > 0 && recentErrorCount < 3 && status === "OK") {
    // Single errors are informational, not even WARN
    // Only if multiple we start warning
  }

  // EXPLICITLY NOT DEGRADED - these states are normal:
  // - IDLE: Bot is idle and waiting - this is fine
  // - STOPPED: Bot was intentionally stopped - this is fine
  // - BACKTESTING: Bot is running backtests - this is expected
  // - SCANNING: Bot is looking for signals - this is expected
  // - TRADING: Bot is executing - this is expected
  // - PAUSED: Bot was paused by user - this is fine
  // - No heartbeat at all: New bot, never started - this is fine

  // If no issues found, bot is OK
  if (reasons.length === 0) {
    return { status: "OK", reason: null, reasons: [] };
  }

  return {
    status,
    reason: reasons[0] || null,
    reasons,
  };
}

/**
 * Get health status display info
 * 
 * INVARIANT: Never return "Unknown" - always map to a valid state
 * with explicit reason. Undefined/null/empty states default to OK
 * since bots without health evaluation yet are assumed healthy.
 */
export function getHealthDisplay(status: "OK" | "WARN" | "DEGRADED" | string | undefined | null) {
  switch (status) {
    case "OK":
      return { label: "OK", colorClass: "text-emerald-400", reason: "Healthy" };
    case "WARN":
      return { label: "Warn", colorClass: "text-amber-400", reason: "Needs attention" };
    case "DEGRADED":
      return { label: "Degraded", colorClass: "text-red-400", reason: "Critical issue" };
    case "BLOCKED":
      return { label: "Blocked", colorClass: "text-orange-400", reason: "Operation blocked" };
    case "STARTING":
      return { label: "Starting", colorClass: "text-blue-400", reason: "Bot initializing" };
    case "HEALING":
      return { label: "Healing", colorClass: "text-cyan-400", reason: "Auto-recovery in progress" };
    default:
      // INVARIANT: No health state yet = assume OK (new bots)
      // This prevents "Unknown !" badges from appearing
      return { label: "OK", colorClass: "text-emerald-400", reason: "Not yet evaluated" };
  }
}
