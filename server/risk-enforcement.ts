/**
 * Risk Enforcement Gates - Trading Halt System
 * 
 * Implements institutional-grade risk gates that halt trading when limits are breached.
 * Integrates with RiskManager for VaR calculations and bot stage management.
 */

import { db } from "./db";
import { bots, accounts, accountAttempts, activityEvents } from "@shared/schema";
import type { Bot } from "@shared/schema";
import { eq, and, inArray, gte, sql } from "drizzle-orm";
import { RiskManager, type PositionRisk, type RiskViolation } from "./portfolio/risk-manager";
import { logActivityEvent } from "./activity-logger";

export enum EnforcementLevel {
  WARNING = "WARNING",
  SOFT_BLOCK = "SOFT_BLOCK",
  HARD_BLOCK = "HARD_BLOCK",
}

export interface RiskGateConfig {
  drawdown: {
    warningPct: number;
    softBlockPct: number;
    hardBlockPct: number;
  };
  dailyLoss: {
    warningPct: number;
    softBlockPct: number;
    hardBlockPct: number;
  };
  blownAccount: {
    drawdownThresholdPct: number;
    minCapitalPct: number;
  };
  varLimit95Pct: number;
}

const DEFAULT_RISK_GATE_CONFIG: RiskGateConfig = {
  drawdown: {
    warningPct: 10,
    softBlockPct: 15,
    hardBlockPct: 20,
  },
  dailyLoss: {
    warningPct: 2,
    softBlockPct: 3,
    hardBlockPct: 5,
  },
  blownAccount: {
    drawdownThresholdPct: 30,
    minCapitalPct: 10,
  },
  varLimit95Pct: 5,
};

export interface EnforcementAction {
  level: EnforcementLevel;
  reason: string;
  metric: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
}

export interface PositionCheckResult {
  allowed: boolean;
  reason?: string;
  blockLevel?: EnforcementLevel;
  violations?: RiskViolation[];
}

export interface DrawdownGateResult {
  level: EnforcementLevel | null;
  currentDrawdownPct: number;
  action: EnforcementAction | null;
}

export interface DailyLossGateResult {
  level: EnforcementLevel | null;
  dailyLossPct: number;
  action: EnforcementAction | null;
}

export interface BlownAccountResult {
  isBlown: boolean;
  reason?: string;
  drawdownPct: number;
  capitalRemainingPct: number;
  recoveryLogged: boolean;
}

export interface RiskEnforcementSummary {
  botsChecked: number;
  warnings: number;
  softBlocks: number;
  hardBlocks: number;
  blownAccounts: number;
  details: Array<{
    botId: string;
    botName: string;
    stage: string;
    actions: EnforcementAction[];
  }>;
}

class RiskEnforcement {
  private config: RiskGateConfig;
  private riskManager: RiskManager;

  constructor(config: Partial<RiskGateConfig> = {}) {
    this.config = { ...DEFAULT_RISK_GATE_CONFIG, ...config };
    this.riskManager = new RiskManager({
      maxVaR95Pct: this.config.varLimit95Pct,
      maxDrawdownPct: this.config.drawdown.softBlockPct,
      maxDailyLossPct: this.config.dailyLoss.softBlockPct,
    });
  }

  async canOpenPosition(
    botId: string,
    symbol: string,
    contracts: number
  ): Promise<PositionCheckResult> {
    try {
      const [bot] = await db
        .select()
        .from(bots)
        .where(eq(bots.id, botId))
        .limit(1);

      if (!bot) {
        return {
          allowed: false,
          reason: "Bot not found",
          blockLevel: EnforcementLevel.HARD_BLOCK,
        };
      }

      if (bot.stage === "KILLED") {
        return {
          allowed: false,
          reason: "Bot is in KILLED stage - trading suspended",
          blockLevel: EnforcementLevel.HARD_BLOCK,
        };
      }

      const drawdownGate = await this.checkDrawdownGate(botId);
      if (drawdownGate.level === EnforcementLevel.HARD_BLOCK) {
        return {
          allowed: false,
          reason: `Drawdown limit breached: ${drawdownGate.currentDrawdownPct.toFixed(2)}% > ${this.config.drawdown.hardBlockPct}%`,
          blockLevel: EnforcementLevel.HARD_BLOCK,
        };
      }
      if (drawdownGate.level === EnforcementLevel.SOFT_BLOCK) {
        return {
          allowed: false,
          reason: `Drawdown soft limit breached: ${drawdownGate.currentDrawdownPct.toFixed(2)}% > ${this.config.drawdown.softBlockPct}% - only exits allowed`,
          blockLevel: EnforcementLevel.SOFT_BLOCK,
        };
      }

      const dailyLossGate = await this.checkDailyLossGate(botId);
      if (dailyLossGate.level === EnforcementLevel.HARD_BLOCK) {
        return {
          allowed: false,
          reason: `Daily loss limit breached: ${dailyLossGate.dailyLossPct.toFixed(2)}% > ${this.config.dailyLoss.hardBlockPct}%`,
          blockLevel: EnforcementLevel.HARD_BLOCK,
        };
      }
      if (dailyLossGate.level === EnforcementLevel.SOFT_BLOCK) {
        return {
          allowed: false,
          reason: `Daily loss soft limit breached: ${dailyLossGate.dailyLossPct.toFixed(2)}% > ${this.config.dailyLoss.softBlockPct}% - only exits allowed`,
          blockLevel: EnforcementLevel.SOFT_BLOCK,
        };
      }

      const accountId = (bot as any).accountId;
      if (accountId) {
        const positions = await this.getBotPositions(botId);
        const dailyReturns = this.riskManager.getHistoricalReturns();
        const violations = this.riskManager.checkRiskLimits(
          positions,
          dailyReturns,
          drawdownGate.currentDrawdownPct,
          -dailyLossGate.dailyLossPct
        );

        const criticalViolations = violations.filter(v => v.severity === "CRITICAL");
        if (criticalViolations.length > 0) {
          return {
            allowed: false,
            reason: criticalViolations.map(v => v.message).join("; "),
            blockLevel: EnforcementLevel.HARD_BLOCK,
            violations: criticalViolations,
          };
        }

        if (violations.length > 0) {
          await this.logEnforcementEvent(
            botId,
            EnforcementLevel.WARNING,
            violations.map(v => v.message).join("; "),
            "VaR_CHECK"
          );
        }
      }

      if (drawdownGate.level === EnforcementLevel.WARNING) {
        await this.logEnforcementEvent(
          botId,
          EnforcementLevel.WARNING,
          `Drawdown warning: ${drawdownGate.currentDrawdownPct.toFixed(2)}%`,
          "DRAWDOWN"
        );
      }

      if (dailyLossGate.level === EnforcementLevel.WARNING) {
        await this.logEnforcementEvent(
          botId,
          EnforcementLevel.WARNING,
          `Daily loss warning: ${dailyLossGate.dailyLossPct.toFixed(2)}%`,
          "DAILY_LOSS"
        );
      }

      return { allowed: true };
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error checking position for bot ${botId}:`, error);
      return {
        allowed: false,
        reason: `Risk check failed: ${(error as Error).message}`,
        blockLevel: EnforcementLevel.HARD_BLOCK,
      };
    }
  }

  async checkDrawdownGate(botId: string): Promise<DrawdownGateResult> {
    try {
      const [bot] = await db
        .select()
        .from(bots)
        .where(eq(bots.id, botId))
        .limit(1);

      if (!bot) {
        return { level: null, currentDrawdownPct: 0, action: null };
      }

      const accountId = (bot as any).accountId;
      let currentDrawdownPct = 0;

      if (accountId) {
        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);

        if (account && account.peakBalance && account.peakBalance > 0) {
          const currentBalance = account.currentBalance || 0;
          currentDrawdownPct = ((account.peakBalance - currentBalance) / account.peakBalance) * 100;
        }
      } else {
        const healthJson = bot.healthJson as Record<string, any> | null;
        currentDrawdownPct = healthJson?.maxDrawdown || healthJson?.drawdown || 0;
      }

      let level: EnforcementLevel | null = null;
      let action: EnforcementAction | null = null;

      if (currentDrawdownPct >= this.config.drawdown.hardBlockPct) {
        level = EnforcementLevel.HARD_BLOCK;
        action = {
          level,
          reason: `Drawdown ${currentDrawdownPct.toFixed(2)}% exceeds hard limit ${this.config.drawdown.hardBlockPct}%`,
          metric: "DRAWDOWN",
          currentValue: currentDrawdownPct,
          threshold: this.config.drawdown.hardBlockPct,
          timestamp: new Date(),
        };
      } else if (currentDrawdownPct >= this.config.drawdown.softBlockPct) {
        level = EnforcementLevel.SOFT_BLOCK;
        action = {
          level,
          reason: `Drawdown ${currentDrawdownPct.toFixed(2)}% exceeds soft limit ${this.config.drawdown.softBlockPct}%`,
          metric: "DRAWDOWN",
          currentValue: currentDrawdownPct,
          threshold: this.config.drawdown.softBlockPct,
          timestamp: new Date(),
        };
      } else if (currentDrawdownPct >= this.config.drawdown.warningPct) {
        level = EnforcementLevel.WARNING;
        action = {
          level,
          reason: `Drawdown ${currentDrawdownPct.toFixed(2)}% approaching limit`,
          metric: "DRAWDOWN",
          currentValue: currentDrawdownPct,
          threshold: this.config.drawdown.warningPct,
          timestamp: new Date(),
        };
      }

      return { level, currentDrawdownPct, action };
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error checking drawdown gate for bot ${botId}:`, error);
      return { level: null, currentDrawdownPct: 0, action: null };
    }
  }

  async checkDailyLossGate(botId: string): Promise<DailyLossGateResult> {
    try {
      const [bot] = await db
        .select()
        .from(bots)
        .where(eq(bots.id, botId))
        .limit(1);

      if (!bot) {
        return { level: null, dailyLossPct: 0, action: null };
      }

      const accountId = (bot as any).accountId;
      let dailyLossPct = 0;
      let startOfDayBalance = 0;
      let currentBalance = 0;

      if (accountId) {
        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);

        if (account) {
          currentBalance = account.currentBalance || 0;
          startOfDayBalance = (account as any).startOfDayBalance || account.initialBalance || currentBalance;
          
          if (startOfDayBalance > 0) {
            const dailyPnL = currentBalance - startOfDayBalance;
            if (dailyPnL < 0) {
              dailyLossPct = (Math.abs(dailyPnL) / startOfDayBalance) * 100;
            }
          }
        }
      } else {
        const healthJson = bot.healthJson as Record<string, any> | null;
        dailyLossPct = Math.abs(healthJson?.dailyPnLPct || 0);
        if ((healthJson?.dailyPnLPct || 0) > 0) {
          dailyLossPct = 0;
        }
      }

      let level: EnforcementLevel | null = null;
      let action: EnforcementAction | null = null;

      if (dailyLossPct >= this.config.dailyLoss.hardBlockPct) {
        level = EnforcementLevel.HARD_BLOCK;
        action = {
          level,
          reason: `Daily loss ${dailyLossPct.toFixed(2)}% exceeds hard limit ${this.config.dailyLoss.hardBlockPct}%`,
          metric: "DAILY_LOSS",
          currentValue: dailyLossPct,
          threshold: this.config.dailyLoss.hardBlockPct,
          timestamp: new Date(),
        };
      } else if (dailyLossPct >= this.config.dailyLoss.softBlockPct) {
        level = EnforcementLevel.SOFT_BLOCK;
        action = {
          level,
          reason: `Daily loss ${dailyLossPct.toFixed(2)}% exceeds soft limit ${this.config.dailyLoss.softBlockPct}%`,
          metric: "DAILY_LOSS",
          currentValue: dailyLossPct,
          threshold: this.config.dailyLoss.softBlockPct,
          timestamp: new Date(),
        };
      } else if (dailyLossPct >= this.config.dailyLoss.warningPct) {
        level = EnforcementLevel.WARNING;
        action = {
          level,
          reason: `Daily loss ${dailyLossPct.toFixed(2)}% approaching limit`,
          metric: "DAILY_LOSS",
          currentValue: dailyLossPct,
          threshold: this.config.dailyLoss.warningPct,
          timestamp: new Date(),
        };
      }

      return { level, dailyLossPct, action };
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error checking daily loss gate for bot ${botId}:`, error);
      return { level: null, dailyLossPct: 0, action: null };
    }
  }

  async handleBlownAccount(botId: string): Promise<BlownAccountResult> {
    try {
      const [bot] = await db
        .select()
        .from(bots)
        .where(eq(bots.id, botId))
        .limit(1);

      if (!bot) {
        return {
          isBlown: false,
          reason: "Bot not found",
          drawdownPct: 0,
          capitalRemainingPct: 100,
          recoveryLogged: false,
        };
      }

      const accountId = (bot as any).accountId;
      let drawdownPct = 0;
      let capitalRemainingPct = 100;

      if (accountId) {
        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);

        if (account) {
          const currentBalance = account.currentBalance || 0;
          const initialBalance = account.initialBalance || 0;
          const peakBalance = account.peakBalance || initialBalance;

          if (peakBalance > 0) {
            drawdownPct = ((peakBalance - currentBalance) / peakBalance) * 100;
          }
          if (initialBalance > 0) {
            capitalRemainingPct = (currentBalance / initialBalance) * 100;
          }
        }
      } else {
        const healthJson = bot.healthJson as Record<string, any> | null;
        drawdownPct = healthJson?.maxDrawdown || 0;
        capitalRemainingPct = 100 - drawdownPct;
      }

      const isDrawdownBlown = drawdownPct >= this.config.blownAccount.drawdownThresholdPct;
      const isCapitalBlown = capitalRemainingPct < this.config.blownAccount.minCapitalPct;
      const isBlown = isDrawdownBlown || isCapitalBlown;

      let reason: string | undefined;
      let recoveryLogged = false;

      if (isBlown) {
        reason = isDrawdownBlown
          ? `Drawdown ${drawdownPct.toFixed(2)}% exceeds blown threshold ${this.config.blownAccount.drawdownThresholdPct}%`
          : `Capital remaining ${capitalRemainingPct.toFixed(2)}% below minimum ${this.config.blownAccount.minCapitalPct}%`;

        await db
          .update(bots)
          .set({
            stage: "KILLED",
            status: "stopped",
            stageUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(bots.id, botId));

        await this.logEnforcementEvent(
          botId,
          EnforcementLevel.HARD_BLOCK,
          `Account blown: ${reason}. Bot moved to KILLED stage.`,
          "BLOWN_ACCOUNT"
        );

        if (accountId) {
          try {
            const [account] = await db
              .select()
              .from(accounts)
              .where(eq(accounts.id, accountId))
              .limit(1);

            if (account) {
              await db.insert(accountAttempts).values({
                accountId,
                attemptNumber: 1,
                status: "BLOWN",
                startingBalance: account.initialBalance || 0,
                endingBalance: account.currentBalance || 0,
                peakBalance: account.peakBalance,
                blownAt: new Date(),
                blownReason: reason,
                blownReasonCode: isDrawdownBlown ? "MAX_DRAWDOWN_BREACH" : "CAPITAL_DEPLETED",
                botStageAtBlow: bot.stage || "UNKNOWN",
                metricsSnapshot: {
                  drawdownPct,
                  capitalRemainingPct,
                  timestamp: new Date().toISOString(),
                },
              });
              recoveryLogged = true;
            }
          } catch (attemptError) {
            console.warn(`[RISK_ENFORCEMENT] Failed to record account attempt:`, attemptError);
          }
        }

        console.log(`[RISK_ENFORCEMENT] Account blown for bot ${botId}: ${reason}`);
      }

      return {
        isBlown,
        reason,
        drawdownPct,
        capitalRemainingPct,
        recoveryLogged,
      };
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error handling blown account for bot ${botId}:`, error);
      return {
        isBlown: false,
        reason: `Error checking: ${(error as Error).message}`,
        drawdownPct: 0,
        capitalRemainingPct: 100,
        recoveryLogged: false,
      };
    }
  }

  async runRiskEnforcementCheck(): Promise<RiskEnforcementSummary> {
    const summary: RiskEnforcementSummary = {
      botsChecked: 0,
      warnings: 0,
      softBlocks: 0,
      hardBlocks: 0,
      blownAccounts: 0,
      details: [],
    };

    try {
      const activeBots = await db
        .select()
        .from(bots)
        .where(
          and(
            inArray(bots.stage, ["PAPER", "SHADOW", "CANARY", "LIVE"]),
            eq(bots.status, "running")
          )
        );

      console.log(`[RISK_ENFORCEMENT] Running enforcement check on ${activeBots.length} active bots`);

      for (const bot of activeBots) {
        summary.botsChecked++;
        const actions: EnforcementAction[] = [];

        const blownResult = await this.handleBlownAccount(bot.id);
        if (blownResult.isBlown) {
          summary.blownAccounts++;
          summary.hardBlocks++;
          actions.push({
            level: EnforcementLevel.HARD_BLOCK,
            reason: blownResult.reason || "Account blown",
            metric: "BLOWN_ACCOUNT",
            currentValue: blownResult.drawdownPct,
            threshold: this.config.blownAccount.drawdownThresholdPct,
            timestamp: new Date(),
          });
          summary.details.push({
            botId: bot.id,
            botName: bot.name,
            stage: bot.stage || "UNKNOWN",
            actions,
          });
          continue;
        }

        const drawdownGate = await this.checkDrawdownGate(bot.id);
        if (drawdownGate.action) {
          actions.push(drawdownGate.action);
          
          if (drawdownGate.level === EnforcementLevel.HARD_BLOCK) {
            summary.hardBlocks++;
            await this.applyHardBlock(bot.id, drawdownGate.action.reason);
          } else if (drawdownGate.level === EnforcementLevel.SOFT_BLOCK) {
            summary.softBlocks++;
            await this.applySoftBlock(bot.id, drawdownGate.action.reason);
          } else if (drawdownGate.level === EnforcementLevel.WARNING) {
            summary.warnings++;
          }
        }

        const dailyLossGate = await this.checkDailyLossGate(bot.id);
        if (dailyLossGate.action) {
          actions.push(dailyLossGate.action);

          if (dailyLossGate.level === EnforcementLevel.HARD_BLOCK && drawdownGate.level !== EnforcementLevel.HARD_BLOCK) {
            summary.hardBlocks++;
            await this.applyHardBlock(bot.id, dailyLossGate.action.reason);
          } else if (dailyLossGate.level === EnforcementLevel.SOFT_BLOCK && drawdownGate.level !== EnforcementLevel.HARD_BLOCK && drawdownGate.level !== EnforcementLevel.SOFT_BLOCK) {
            summary.softBlocks++;
            await this.applySoftBlock(bot.id, dailyLossGate.action.reason);
          } else if (dailyLossGate.level === EnforcementLevel.WARNING && !drawdownGate.level) {
            summary.warnings++;
          }
        }

        if (actions.length > 0) {
          summary.details.push({
            botId: bot.id,
            botName: bot.name,
            stage: bot.stage || "UNKNOWN",
            actions,
          });
        }
      }

      console.log(
        `[RISK_ENFORCEMENT] Check complete: ${summary.botsChecked} bots, ` +
        `${summary.warnings} warnings, ${summary.softBlocks} soft blocks, ` +
        `${summary.hardBlocks} hard blocks, ${summary.blownAccounts} blown accounts`
      );

      return summary;
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error running enforcement check:`, error);
      return summary;
    }
  }

  private async applyHardBlock(botId: string, reason: string): Promise<void> {
    try {
      await db
        .update(bots)
        .set({
          status: "paused",
          updatedAt: new Date(),
        })
        .where(eq(bots.id, botId));

      await this.logEnforcementEvent(
        botId,
        EnforcementLevel.HARD_BLOCK,
        `Bot paused: ${reason}. Positions should be liquidated.`,
        "HARD_BLOCK_APPLIED"
      );

      console.log(`[RISK_ENFORCEMENT] HARD_BLOCK applied to bot ${botId}: ${reason}`);
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error applying hard block to bot ${botId}:`, error);
    }
  }

  private async applySoftBlock(botId: string, reason: string): Promise<void> {
    try {
      await this.logEnforcementEvent(
        botId,
        EnforcementLevel.SOFT_BLOCK,
        `New positions blocked: ${reason}. Only exits allowed.`,
        "SOFT_BLOCK_APPLIED"
      );

      console.log(`[RISK_ENFORCEMENT] SOFT_BLOCK applied to bot ${botId}: ${reason}`);
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error applying soft block to bot ${botId}:`, error);
    }
  }

  private async getBotPositions(botId: string): Promise<PositionRisk[]> {
    return [];
  }

  private async logEnforcementEvent(
    botId: string,
    level: EnforcementLevel,
    message: string,
    metric: string
  ): Promise<void> {
    try {
      const severity = level === EnforcementLevel.HARD_BLOCK
        ? "CRITICAL"
        : level === EnforcementLevel.SOFT_BLOCK
          ? "WARN"
          : "INFO";

      await logActivityEvent({
        botId,
        eventType: "ORDER_BLOCKED_RISK",
        severity: severity as any,
        title: `Risk Gate: ${level}`,
        summary: message,
        payload: {
          enforcementLevel: level,
          metric,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`[RISK_ENFORCEMENT] Error logging enforcement event:`, error);
    }
  }

  updateConfig(config: Partial<RiskGateConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      drawdown: { ...this.config.drawdown, ...(config.drawdown || {}) },
      dailyLoss: { ...this.config.dailyLoss, ...(config.dailyLoss || {}) },
      blownAccount: { ...this.config.blownAccount, ...(config.blownAccount || {}) },
    };

    this.riskManager.setLimits({
      maxVaR95Pct: this.config.varLimit95Pct,
      maxDrawdownPct: this.config.drawdown.softBlockPct,
      maxDailyLossPct: this.config.dailyLoss.softBlockPct,
    });
  }

  getConfig(): RiskGateConfig {
    return { ...this.config };
  }
}

export const riskEnforcement = new RiskEnforcement();

export const canOpenPosition = riskEnforcement.canOpenPosition.bind(riskEnforcement);
export const checkDrawdownGate = riskEnforcement.checkDrawdownGate.bind(riskEnforcement);
export const checkDailyLossGate = riskEnforcement.checkDailyLossGate.bind(riskEnforcement);
export const handleBlownAccount = riskEnforcement.handleBlownAccount.bind(riskEnforcement);
export const runRiskEnforcementCheck = riskEnforcement.runRiskEnforcementCheck.bind(riskEnforcement);
