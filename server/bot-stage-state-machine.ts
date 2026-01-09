/**
 * Bot Stage State Machine
 * 
 * Industry-standard finite state machine for bot lifecycle stages.
 * Enforces valid transitions and provides reconciliation utilities.
 * 
 * State Flow (Promotions):
 * 
 *   TRIALS ──> PAPER ──> SHADOW ──> CANARY ──> LIVE
 * 
 * Demotion paths (performance-based):
 * 
 *   LIVE ──> CANARY ──> SHADOW ──> PAPER ──> TRIALS
 * 
 * Special transitions:
 *   - Any stage can demote directly to TRIALS (blown account, critical failure)
 *   - KILLED is a terminal state (permanently deactivated)
 * 
 * Gate Requirements:
 *   - TRIALS→PAPER: 3 consecutive backtest sessions meeting thresholds
 *   - PAPER→SHADOW: Minimum paper trade duration + profit requirements
 *   - SHADOW→CANARY: Shadow validation period complete
 *   - CANARY→LIVE: Maker-checker governance approval required
 */

import { db } from "./db";
import { bots } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export type BotStage = "TRIALS" | "PAPER" | "SHADOW" | "CANARY" | "LIVE" | "KILLED";

interface StageTransitionResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  gateRequirements?: string[];
}

interface StageTransitionAudit {
  botId: string;
  fromStage: BotStage;
  toStage: BotStage;
  timestamp: Date;
  allowed: boolean;
  reason?: string;
  triggeredBy: "AUTO_PROMOTION" | "AUTO_DEMOTION" | "MANUAL" | "BLOWN_ACCOUNT" | "GOVERNANCE";
  governanceApprover?: string;
}

const STAGE_ORDER: BotStage[] = ["TRIALS", "PAPER", "SHADOW", "CANARY", "LIVE"];

const VALID_PROMOTIONS: Record<BotStage, BotStage[]> = {
  TRIALS: ["PAPER"],
  PAPER: ["SHADOW"],
  SHADOW: ["CANARY"],
  CANARY: ["LIVE"],
  LIVE: [],
  KILLED: [],
};

const VALID_DEMOTIONS: Record<BotStage, BotStage[]> = {
  TRIALS: [],
  PAPER: ["TRIALS"],
  SHADOW: ["PAPER", "TRIALS"],
  CANARY: ["SHADOW", "PAPER", "TRIALS"],
  LIVE: ["CANARY", "SHADOW", "PAPER", "TRIALS"],
  KILLED: [],
};

const EMERGENCY_DEMOTIONS: BotStage[] = ["TRIALS", "KILLED"];

const GATE_REQUIREMENTS: Record<string, string[]> = {
  "TRIALS→PAPER": [
    "rolling_metrics_consistency: 3 consecutive backtest sessions meeting thresholds",
    "sharpe_ratio ≥ 1.0",
    "max_drawdown ≤ 15%",
    "profit_factor ≥ 1.3",
    "win_rate ≥ 40%",
  ],
  "PAPER→SHADOW": [
    "Minimum 24 hours paper trading",
    "Positive cumulative P&L",
    "No excessive drawdown events",
    "Signal consistency verified",
  ],
  "SHADOW→CANARY": [
    "Shadow validation period complete (48 hours)",
    "Shadow vs Paper P&L correlation > 0.8",
    "No execution discrepancies detected",
  ],
  "CANARY→LIVE": [
    "Maker-checker governance approval",
    "Risk limits verified",
    "Account funding confirmed",
    "Broker connection validated",
  ],
};

export function getStageIndex(stage: BotStage): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : -1;
}

export function isPromotion(from: BotStage, to: BotStage): boolean {
  return getStageIndex(to) > getStageIndex(from);
}

export function isDemotion(from: BotStage, to: BotStage): boolean {
  return getStageIndex(to) < getStageIndex(from);
}

export function validateStageTransition(
  from: BotStage,
  to: BotStage,
  options?: {
    isEmergency?: boolean;
    hasGovernanceApproval?: boolean;
  }
): StageTransitionResult {
  if (from === to) {
    return { allowed: true, reason: "Same stage (no-op)" };
  }

  if (from === "KILLED") {
    return {
      allowed: false,
      reason: "KILLED is a terminal state - bot cannot be reactivated",
    };
  }

  if (to === "KILLED") {
    return {
      allowed: true,
      reason: "Emergency kill - bot permanently deactivated",
    };
  }

  if (options?.isEmergency && EMERGENCY_DEMOTIONS.includes(to)) {
    return {
      allowed: true,
      reason: `Emergency demotion to ${to} (blown account or critical failure)`,
    };
  }

  if (isPromotion(from, to)) {
    const validPromotions = VALID_PROMOTIONS[from];
    
    if (!validPromotions.includes(to)) {
      const skipCount = getStageIndex(to) - getStageIndex(from);
      if (skipCount > 1) {
        return {
          allowed: false,
          reason: `Cannot skip stages: ${from} → ${to}. Must promote through: ${STAGE_ORDER.slice(
            getStageIndex(from),
            getStageIndex(to) + 1
          ).join(" → ")}`,
        };
      }
      return {
        allowed: false,
        reason: `Invalid promotion: ${from} → ${to}. Valid promotions: [${validPromotions.join(", ")}]`,
      };
    }

    const transitionKey = `${from}→${to}`;
    const requirements = GATE_REQUIREMENTS[transitionKey] || [];

    if (to === "LIVE" && !options?.hasGovernanceApproval) {
      return {
        allowed: false,
        reason: "CANARY→LIVE requires maker-checker governance approval",
        requiresApproval: true,
        gateRequirements: requirements,
      };
    }

    return {
      allowed: true,
      gateRequirements: requirements,
    };
  }

  if (isDemotion(from, to)) {
    const validDemotions = VALID_DEMOTIONS[from];
    
    if (!validDemotions.includes(to)) {
      return {
        allowed: false,
        reason: `Invalid demotion: ${from} → ${to}. Valid demotions: [${validDemotions.join(", ")}]`,
      };
    }

    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Unknown transition: ${from} → ${to}`,
  };
}

export function getNextPromotionStage(current: BotStage): BotStage | null {
  const promotions = VALID_PROMOTIONS[current];
  return promotions.length > 0 ? promotions[0] : null;
}

export function getPromotionGates(from: BotStage, to: BotStage): string[] {
  const transitionKey = `${from}→${to}`;
  return GATE_REQUIREMENTS[transitionKey] || [];
}

export function isTerminalStage(stage: BotStage): boolean {
  return stage === "KILLED";
}

export function isLiveStage(stage: BotStage): boolean {
  return stage === "LIVE";
}

export function requiresGovernanceApproval(from: BotStage, to: BotStage): boolean {
  return from === "CANARY" && to === "LIVE";
}

const transitionAuditLog: StageTransitionAudit[] = [];
const MAX_AUDIT_LOG_SIZE = 1000;

export function logStageTransition(audit: StageTransitionAudit): void {
  transitionAuditLog.unshift(audit);
  
  if (transitionAuditLog.length > MAX_AUDIT_LOG_SIZE) {
    transitionAuditLog.pop();
  }

  const logPrefix = audit.allowed ? "[STAGE_TRANSITION]" : "[STAGE_TRANSITION_BLOCKED]";
  console.log(
    `${logPrefix} bot=${audit.botId} ${audit.fromStage}→${audit.toStage} ` +
    `trigger=${audit.triggeredBy} allowed=${audit.allowed} reason=${audit.reason || "OK"}`
  );
}

export function getRecentTransitions(botId?: string, limit: number = 50): StageTransitionAudit[] {
  let filtered = transitionAuditLog;
  
  if (botId) {
    filtered = transitionAuditLog.filter(t => t.botId === botId);
  }
  
  return filtered.slice(0, limit);
}

export async function transitionBotStage(
  botId: string,
  toStage: BotStage,
  triggeredBy: StageTransitionAudit["triggeredBy"],
  options?: {
    isEmergency?: boolean;
    hasGovernanceApproval?: boolean;
    governanceApprover?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const botResult = await db
      .select({ stage: bots.stage })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1);

    if (botResult.length === 0) {
      return { success: false, error: `Bot not found: ${botId}` };
    }

    const currentStage = (botResult[0].stage || "TRIALS") as BotStage;
    
    const validation = validateStageTransition(currentStage, toStage, {
      isEmergency: options?.isEmergency,
      hasGovernanceApproval: options?.hasGovernanceApproval,
    });

    const audit: StageTransitionAudit = {
      botId,
      fromStage: currentStage,
      toStage,
      timestamp: new Date(),
      allowed: validation.allowed,
      reason: validation.reason,
      triggeredBy,
      governanceApprover: options?.governanceApprover,
    };

    logStageTransition(audit);

    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    await db
      .update(bots)
      .set({
        stage: toStage,
        stageUpdatedAt: new Date(),
      })
      .where(eq(bots.id, botId));

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[STAGE_TRANSITION_ERROR] bot=${botId} error=${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

export interface StageConsistencyCheck {
  botId: string;
  botName: string;
  currentStage: BotStage;
  issues: string[];
  recommendation: string;
}

export async function runStageConsistencyCheck(): Promise<StageConsistencyCheck[]> {
  const issues: StageConsistencyCheck[] = [];
  
  try {
    const botsWithRunners = await db.execute(sql`
      SELECT 
        b.id,
        b.name,
        b.stage as bot_stage,
        bi.stage as runner_stage,
        bi.status as runner_status,
        bi.is_primary_runner
      FROM bots b
      LEFT JOIN bot_instances bi ON bi.bot_id = b.id 
        AND bi.job_type = 'RUNNER'
        AND bi.is_primary_runner = true
      WHERE b.stage IS NOT NULL
    `);

    for (const row of botsWithRunners.rows as any[]) {
      const botIssues: string[] = [];
      
      if (row.runner_stage && row.bot_stage !== row.runner_stage) {
        botIssues.push(
          `Stage mismatch: bot.stage=${row.bot_stage} vs runner.stage=${row.runner_stage}`
        );
      }

      if (row.bot_stage !== "TRIALS" && row.bot_stage !== "KILLED" && !row.runner_stage) {
        botIssues.push(
          `Non-TRIALS bot without active runner: stage=${row.bot_stage}`
        );
      }

      if (botIssues.length > 0) {
        issues.push({
          botId: row.id,
          botName: row.name || "Unknown",
          currentStage: row.bot_stage,
          issues: botIssues,
          recommendation: row.bot_stage !== row.runner_stage 
            ? "Restart runner to sync stage" 
            : "Investigate missing runner",
        });
      }
    }

    console.log(`[STAGE_CONSISTENCY] Checked ${botsWithRunners.rows.length} bots, found ${issues.length} with issues`);
    
  } catch (error) {
    console.error("[STAGE_CONSISTENCY] Error running check:", error);
  }

  return issues;
}
