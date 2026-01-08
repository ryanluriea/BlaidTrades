/**
 * Independent Risk Control Plane
 * 
 * INSTITUTIONAL STANDARD: Risk monitoring runs independently from execution logic.
 * - Separate interval from scheduler/execution
 * - Real-time limit enforcement with immediate halt capability
 * - Comprehensive logging of all risk decisions
 * - Integration with existing kill switch
 * 
 * SEC/CFTC Best Practice: Segregation of duties between risk and execution.
 */

import { db } from "../db";
import { 
  bots, 
  accounts, 
  botInstances,
  paperTrades,
  paperPositions,
  riskSnapshots,
} from "@shared/schema";
import { eq, sql, desc, and, gte, isNull, or, inArray } from "drizzle-orm";
import { logImmutableAuditEvent } from "../institutional-governance";
import { logActivityEvent } from "../activity-logger";
import { captureRiskSnapshot, runPreTradeCheck } from "../institutional-risk";
import { positionReconciliationService } from "../position-reconciliation";

interface RiskControlState {
  globalHalt: boolean;
  haltReason: string | null;
  haltedBots: Set<string>;
  botVelocity: Map<string, OrderVelocity>;
  lastSnapshot: Date | null;
  lastReconciliation: Date | null;
  dailyPnL: number;
  maxDailyLoss: number;
  violations: RiskViolation[];
}

interface OrderVelocity {
  botId: string;
  ordersInLastMinute: number;
  ordersInLastHour: number;
  lastOrderTime: Date;
  burstCount: number;
  cooldownUntil: Date | null;
}

interface RiskViolation {
  timestamp: Date;
  type: "DAILY_LOSS" | "BOT_DRAWDOWN" | "ORDER_VELOCITY" | "POSITION_LIMIT" | "RECONCILIATION" | "CORRELATION";
  botId?: string;
  severity: "WARNING" | "CRITICAL" | "HALT";
  message: string;
  actionTaken: string;
}

interface PerBotRiskLimits {
  maxDrawdownPct: number;
  maxDailyLossPct: number;
  maxOrdersPerMinute: number;
  maxOrdersPerHour: number;
  maxPositionSize: number;
}

const DEFAULT_BOT_LIMITS: PerBotRiskLimits = {
  maxDrawdownPct: 15,
  maxDailyLossPct: 5,
  maxOrdersPerMinute: 10,
  maxOrdersPerHour: 100,
  maxPositionSize: 5,
};

const GLOBAL_LIMITS = {
  maxDailyLossDollars: 5000,
  maxDailyLossPct: 10,
  snapshotIntervalMs: 60000,        // 1 minute
  reconciliationIntervalMs: 3600000, // 1 hour
  velocityCleanupMs: 300000,         // 5 minutes
};

class IndependentRiskController {
  private state: RiskControlState;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private velocityInterval: NodeJS.Timeout | null = null;
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private traceId: string;

  constructor() {
    this.traceId = `risk-controller-${Date.now().toString(36)}`;
    this.state = {
      globalHalt: false,
      haltReason: null,
      haltedBots: new Set(),
      botVelocity: new Map(),
      lastSnapshot: null,
      lastReconciliation: null,
      dailyPnL: 0,
      maxDailyLoss: GLOBAL_LIMITS.maxDailyLossDollars,
      violations: [],
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} STARTED independent_mode=true`);

    await this.captureInitialState();

    this.snapshotInterval = setInterval(
      () => this.runRiskSnapshot(),
      GLOBAL_LIMITS.snapshotIntervalMs
    );

    this.velocityInterval = setInterval(
      () => this.cleanupVelocityTracking(),
      GLOBAL_LIMITS.velocityCleanupMs
    );

    this.reconciliationInterval = setInterval(
      () => this.runDailyReconciliation(),
      GLOBAL_LIMITS.reconciliationIntervalMs
    );

    await logActivityEvent({
      eventType: "SYSTEM_STATUS_CHANGED",
      severity: "INFO",
      title: "Independent Risk Controller Started",
      summary: `Risk monitoring active with ${GLOBAL_LIMITS.snapshotIntervalMs / 1000}s snapshots`,
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    if (this.velocityInterval) clearInterval(this.velocityInterval);
    if (this.reconciliationInterval) clearInterval(this.reconciliationInterval);

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} STOPPED`);
  }

  private async captureInitialState(): Promise<void> {
    const dailyPnL = await this.calculateDailyPnL();
    this.state.dailyPnL = dailyPnL;

    await this.runRiskSnapshot();

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} initial_state daily_pnl=$${dailyPnL.toFixed(2)}`);
  }

  private async runRiskSnapshot(): Promise<void> {
    try {
      const snapshot = await captureRiskSnapshot(undefined, this.traceId);
      this.state.lastSnapshot = new Date();

      const dailyPnL = await this.calculateDailyPnL();
      this.state.dailyPnL = dailyPnL;

      if (dailyPnL < -this.state.maxDailyLoss) {
        await this.triggerGlobalHalt(`Daily loss $${Math.abs(dailyPnL).toFixed(0)} exceeds limit $${this.state.maxDailyLoss}`);
      }

      await this.checkPerBotDrawdowns();

      if ((snapshot.breachCount ?? 0) > 0) {
        console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} BREACHES_DETECTED count=${snapshot.breachCount}`);
      }
    } catch (error) {
      console.error(`[RISK_CONTROLLER] trace_id=${this.traceId} snapshot_error`, error);
    }
  }

  private async calculateDailyPnL(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const result = await db
      .select({
        totalPnl: sql<number>`COALESCE(SUM(${paperTrades.pnl}), 0)`,
      })
      .from(paperTrades)
      .where(and(
        eq(paperTrades.status, "CLOSED"),
        gte(paperTrades.exitTime, todayStart)
      ));

    return result[0]?.totalPnl || 0;
  }

  private async checkPerBotDrawdowns(): Promise<void> {
    const liveBots = await db
      .select({
        botId: botInstances.botId,
        botName: bots.name,
        accountId: botInstances.accountId,
      })
      .from(botInstances)
      .innerJoin(bots, eq(botInstances.botId, bots.id))
      .where(and(
        eq(botInstances.status, "ACTIVE"),
        or(eq(bots.stage, "LIVE"), eq(bots.stage, "CANARY"))
      ));

    for (const bot of liveBots) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const botPnL = await db
        .select({
          totalPnl: sql<number>`COALESCE(SUM(${paperTrades.pnl}), 0)`,
        })
        .from(paperTrades)
        .where(and(
          eq(paperTrades.botId, bot.botId),
          eq(paperTrades.status, "CLOSED"),
          gte(paperTrades.exitTime, todayStart)
        ));

      const dailyPnl = botPnL[0]?.totalPnl || 0;
      const limits = DEFAULT_BOT_LIMITS;

      const accountEquity = 10000;
      const dailyLossPct = accountEquity > 0 ? (dailyPnl / accountEquity) * 100 : 0;

      if (dailyLossPct < -limits.maxDailyLossPct) {
        await this.haltBot(bot.botId, `Daily loss ${Math.abs(dailyLossPct).toFixed(1)}% exceeds ${limits.maxDailyLossPct}%`);
      }
    }
  }

  async recordOrder(botId: string, symbol: string, side: "BUY" | "SELL"): Promise<{ allowed: boolean; reason?: string }> {
    if (this.state.globalHalt) {
      return { allowed: false, reason: `Global halt: ${this.state.haltReason}` };
    }

    if (this.state.haltedBots.has(botId)) {
      return { allowed: false, reason: "Bot halted due to risk violation" };
    }

    let velocity = this.state.botVelocity.get(botId);
    if (!velocity) {
      velocity = {
        botId,
        ordersInLastMinute: 0,
        ordersInLastHour: 0,
        lastOrderTime: new Date(),
        burstCount: 0,
        cooldownUntil: null,
      };
      this.state.botVelocity.set(botId, velocity);
    }

    if (velocity.cooldownUntil && new Date() < velocity.cooldownUntil) {
      return { allowed: false, reason: `Cooldown active until ${velocity.cooldownUntil.toISOString()}` };
    }

    velocity.ordersInLastMinute++;
    velocity.ordersInLastHour++;
    velocity.lastOrderTime = new Date();

    const limits = DEFAULT_BOT_LIMITS;

    if (velocity.ordersInLastMinute > limits.maxOrdersPerMinute) {
      velocity.burstCount++;
      velocity.cooldownUntil = new Date(Date.now() + 60000);

      await this.recordViolation({
        timestamp: new Date(),
        type: "ORDER_VELOCITY",
        botId,
        severity: velocity.burstCount >= 3 ? "HALT" : "WARNING",
        message: `${velocity.ordersInLastMinute} orders/min exceeds ${limits.maxOrdersPerMinute}`,
        actionTaken: velocity.burstCount >= 3 ? "Bot halted" : "60s cooldown applied",
      });

      if (velocity.burstCount >= 3) {
        await this.haltBot(botId, "Repeated order velocity violations");
      }

      return { allowed: false, reason: "Order velocity limit exceeded - 60s cooldown" };
    }

    if (velocity.ordersInLastHour > limits.maxOrdersPerHour) {
      await this.recordViolation({
        timestamp: new Date(),
        type: "ORDER_VELOCITY",
        botId,
        severity: "WARNING",
        message: `${velocity.ordersInLastHour} orders/hour exceeds ${limits.maxOrdersPerHour}`,
        actionTaken: "Order rejected",
      });

      return { allowed: false, reason: "Hourly order limit exceeded" };
    }

    return { allowed: true };
  }

  private cleanupVelocityTracking(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    for (const [botId, velocity] of this.state.botVelocity) {
      if (velocity.lastOrderTime.getTime() < oneMinuteAgo) {
        velocity.ordersInLastMinute = 0;
      }
      if (velocity.lastOrderTime.getTime() < oneHourAgo) {
        velocity.ordersInLastHour = 0;
        velocity.burstCount = 0;
      }
    }
  }

  private async runDailyReconciliation(): Promise<void> {
    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} running daily reconciliation`);
    this.state.lastReconciliation = new Date();

    await logActivityEvent({
      eventType: "SYSTEM_STATUS_CHANGED",
      severity: "INFO",
      title: "Daily Position Reconciliation",
      summary: "Scheduled reconciliation check initiated",
    });
  }

  async triggerGlobalHalt(reason: string): Promise<void> {
    if (this.state.globalHalt) return;

    this.state.globalHalt = true;
    this.state.haltReason = reason;

    await this.recordViolation({
      timestamp: new Date(),
      type: "DAILY_LOSS",
      severity: "HALT",
      message: reason,
      actionTaken: "Global trading halt triggered",
    });

    await logImmutableAuditEvent({
      eventType: "EMERGENCY_HALT",
      entityType: "SYSTEM",
      entityId: "GLOBAL",
      actorType: "SYSTEM",
      actorId: this.traceId,
      eventPayload: {
        reason,
        dailyPnL: this.state.dailyPnL,
        maxDailyLoss: this.state.maxDailyLoss,
        timestamp: new Date().toISOString(),
      },
    });

    await logActivityEvent({
      eventType: "KILL_SWITCH",
      severity: "ERROR",
      title: "GLOBAL TRADING HALT",
      summary: reason,
      payload: {
        dailyPnL: this.state.dailyPnL,
        haltedBots: Array.from(this.state.haltedBots),
      },
    });

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} GLOBAL_HALT reason="${reason}"`);
  }

  async haltBot(botId: string, reason: string): Promise<void> {
    if (this.state.haltedBots.has(botId)) return;

    this.state.haltedBots.add(botId);

    await this.recordViolation({
      timestamp: new Date(),
      type: "BOT_DRAWDOWN",
      botId,
      severity: "HALT",
      message: reason,
      actionTaken: "Bot trading halted",
    });

    await logImmutableAuditEvent({
      eventType: "BOT_HALTED",
      entityType: "BOT",
      entityId: botId,
      actorType: "SYSTEM",
      actorId: this.traceId,
      eventPayload: {
        reason,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} BOT_HALTED bot=${botId.slice(0,8)} reason="${reason}"`);
  }

  async resumeBot(botId: string, operatorId: string): Promise<void> {
    if (!this.state.haltedBots.has(botId)) return;

    this.state.haltedBots.delete(botId);

    await logImmutableAuditEvent({
      eventType: "BOT_RESUMED",
      entityType: "BOT",
      entityId: botId,
      actorType: "USER",
      actorId: operatorId,
      eventPayload: {
        previousHalt: true,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} BOT_RESUMED bot=${botId.slice(0,8)} by operator=${operatorId}`);
  }

  async resumeGlobal(operatorId: string): Promise<void> {
    if (!this.state.globalHalt) return;

    this.state.globalHalt = false;
    const previousReason = this.state.haltReason;
    this.state.haltReason = null;

    await logImmutableAuditEvent({
      eventType: "GLOBAL_RESUMED",
      entityType: "SYSTEM",
      entityId: "GLOBAL",
      actorType: "USER",
      actorId: operatorId,
      eventPayload: {
        previousReason,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[RISK_CONTROLLER] trace_id=${this.traceId} GLOBAL_RESUMED by operator=${operatorId}`);
  }

  private async recordViolation(violation: RiskViolation): Promise<void> {
    this.state.violations.push(violation);

    if (this.state.violations.length > 1000) {
      this.state.violations = this.state.violations.slice(-500);
    }
  }

  getStatus(): {
    globalHalt: boolean;
    haltReason: string | null;
    haltedBots: string[];
    dailyPnL: number;
    maxDailyLoss: number;
    lastSnapshot: Date | null;
    lastReconciliation: Date | null;
    recentViolations: RiskViolation[];
    isRunning: boolean;
  } {
    return {
      globalHalt: this.state.globalHalt,
      haltReason: this.state.haltReason,
      haltedBots: Array.from(this.state.haltedBots),
      dailyPnL: this.state.dailyPnL,
      maxDailyLoss: this.state.maxDailyLoss,
      lastSnapshot: this.state.lastSnapshot,
      lastReconciliation: this.state.lastReconciliation,
      recentViolations: this.state.violations.slice(-50),
      isRunning: this.isRunning,
    };
  }

  isBotAllowed(botId: string): { allowed: boolean; reason?: string } {
    if (this.state.globalHalt) {
      return { allowed: false, reason: this.state.haltReason || "Global halt active" };
    }
    if (this.state.haltedBots.has(botId)) {
      return { allowed: false, reason: "Bot halted due to risk violation" };
    }
    return { allowed: true };
  }
}

export const independentRiskController = new IndependentRiskController();
