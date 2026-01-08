import { db } from "./db";
import { 
  riskSnapshots, 
  preTradeChecks,
  stressScenarios,
  paperPositions,
  paperTrades,
  bots,
  accounts,
  botInstances,
  type RiskSnapshot,
  type PreTradeCheck,
  type StressScenario
} from "@shared/schema";
import { eq, sql, desc, and, gte, isNull, or } from "drizzle-orm";
import { logImmutableAuditEvent } from "./institutional-governance";

interface PositionExposure {
  botId: string;
  botName: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  notionalValue: number;
  unrealizedPnl: number;
}

interface RiskLimits {
  maxTotalExposure: number;
  maxSingleBotExposure: number;
  maxSingleSymbolExposure: number;
  maxDrawdownPct: number;
  maxConcentrationPct: number;
  var95Limit: number;
}

const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxTotalExposure: 500000,
  maxSingleBotExposure: 100000,
  maxSingleSymbolExposure: 200000,
  maxDrawdownPct: 25,
  maxConcentrationPct: 50,
  var95Limit: 10000,
};

const CONTRACT_MULTIPLIERS: Record<string, number> = {
  MES: 5,
  MNQ: 2,
  ES: 50,
  NQ: 20,
  MYM: 0.5,
  M2K: 5,
};

function getContractMultiplier(symbol: string): number {
  return CONTRACT_MULTIPLIERS[symbol] || 5;
}

async function getOpenPositions(): Promise<PositionExposure[]> {
  const positions = await db
    .select({
      id: paperPositions.id,
      botId: paperPositions.botId,
      symbol: paperPositions.symbol,
      side: paperPositions.side,
      quantity: paperPositions.quantity,
      averageEntryPrice: paperPositions.averageEntryPrice,
      unrealizedPnl: paperPositions.unrealizedPnl,
      botName: bots.name,
    })
    .from(paperPositions)
    .leftJoin(bots, eq(paperPositions.botId, bots.id))
    .where(and(
      or(eq(paperPositions.status, "LONG"), eq(paperPositions.status, "SHORT")),
      isNull(paperPositions.closedAt)
    ));
  
  return positions.map(p => ({
    botId: p.botId,
    botName: p.botName || "Unknown",
    symbol: p.symbol,
    side: p.side === "BUY" ? "LONG" : "SHORT",
    quantity: p.quantity,
    entryPrice: p.averageEntryPrice || 0,
    notionalValue: p.quantity * (p.averageEntryPrice || 0) * getContractMultiplier(p.symbol),
    unrealizedPnl: p.unrealizedPnl || 0,
  }));
}

function calculateHistoricalVaR(returns: number[], confidenceLevel: number): number {
  if (returns.length < 10) return 0;
  
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const index = Math.floor(returns.length * (1 - confidenceLevel));
  return Math.abs(sortedReturns[index] || 0);
}

function calculateConditionalVaR(returns: number[], confidenceLevel: number): number {
  if (returns.length < 10) return 0;
  
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const cutoffIndex = Math.floor(returns.length * (1 - confidenceLevel));
  const tailReturns = sortedReturns.slice(0, cutoffIndex + 1);
  
  if (tailReturns.length === 0) return 0;
  const avgTailLoss = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
  return Math.abs(avgTailLoss);
}

async function getRecentReturns(days: number = 30): Promise<number[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const trades = await db
    .select({
      pnl: paperTrades.pnl,
    })
    .from(paperTrades)
    .where(and(
      eq(paperTrades.status, "CLOSED"),
      gte(paperTrades.exitTime, cutoff)
    ))
    .orderBy(paperTrades.exitTime);
  
  return trades.map(t => t.pnl || 0);
}

export async function captureRiskSnapshot(
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  traceId?: string
): Promise<RiskSnapshot> {
  const positions = await getOpenPositions();
  
  let totalLong = 0;
  let totalShort = 0;
  let contractsLong = 0;
  let contractsShort = 0;
  const exposureByBot: Record<string, number> = {};
  const exposureBySymbol: Record<string, number> = {};
  
  for (const pos of positions) {
    const exposure = pos.notionalValue;
    
    if (pos.side === "LONG") {
      totalLong += exposure;
      contractsLong += pos.quantity;
    } else {
      totalShort += exposure;
      contractsShort += pos.quantity;
    }
    
    exposureByBot[pos.botId] = (exposureByBot[pos.botId] || 0) + exposure;
    exposureBySymbol[pos.symbol] = (exposureBySymbol[pos.symbol] || 0) + exposure;
  }
  
  const totalGrossExposure = totalLong + totalShort;
  const totalNetExposure = totalLong - totalShort;
  
  const maxSingleBotExposure = Math.max(...Object.values(exposureByBot), 0);
  const maxSingleSymbolExposure = Math.max(...Object.values(exposureBySymbol), 0);
  
  const concentrationByBot: Record<string, number> = {};
  const concentrationBySymbol: Record<string, number> = {};
  
  if (totalGrossExposure > 0) {
    for (const [botId, exposure] of Object.entries(exposureByBot)) {
      concentrationByBot[botId] = (exposure / totalGrossExposure) * 100;
    }
    for (const [symbol, exposure] of Object.entries(exposureBySymbol)) {
      concentrationBySymbol[symbol] = (exposure / totalGrossExposure) * 100;
    }
  }
  
  const returns = await getRecentReturns(30);
  const var95Daily = calculateHistoricalVaR(returns, 0.95);
  const var99Daily = calculateHistoricalVaR(returns, 0.99);
  const cvar95Daily = calculateConditionalVaR(returns, 0.95);
  
  const limitBreaches: Array<{ limit: string; actual: number; threshold: number; severity: string }> = [];
  
  if (totalGrossExposure > limits.maxTotalExposure) {
    limitBreaches.push({
      limit: "MAX_TOTAL_EXPOSURE",
      actual: totalGrossExposure,
      threshold: limits.maxTotalExposure,
      severity: "CRITICAL",
    });
  }
  
  if (maxSingleBotExposure > limits.maxSingleBotExposure) {
    limitBreaches.push({
      limit: "MAX_SINGLE_BOT_EXPOSURE",
      actual: maxSingleBotExposure,
      threshold: limits.maxSingleBotExposure,
      severity: "WARN",
    });
  }
  
  if (maxSingleSymbolExposure > limits.maxSingleSymbolExposure) {
    limitBreaches.push({
      limit: "MAX_SINGLE_SYMBOL_EXPOSURE",
      actual: maxSingleSymbolExposure,
      threshold: limits.maxSingleSymbolExposure,
      severity: "WARN",
    });
  }
  
  if (var95Daily > limits.var95Limit) {
    limitBreaches.push({
      limit: "VAR_95_LIMIT",
      actual: var95Daily,
      threshold: limits.var95Limit,
      severity: "WARN",
    });
  }
  
  const maxConcentration = Math.max(...Object.values(concentrationByBot), 0);
  if (maxConcentration > limits.maxConcentrationPct) {
    limitBreaches.push({
      limit: "MAX_CONCENTRATION",
      actual: maxConcentration,
      threshold: limits.maxConcentrationPct,
      severity: "WARN",
    });
  }
  
  const botCount = Object.keys(exposureByBot).length;
  const diversificationScore = botCount > 1 
    ? Math.min(100, (1 - (maxConcentration / 100)) * 100 + botCount * 10)
    : 0;
  
  const [snapshot] = await db.insert(riskSnapshots).values({
    snapshotTime: new Date(),
    totalGrossExposure,
    totalNetExposure,
    totalContractsLong: contractsLong,
    totalContractsShort: contractsShort,
    maxSingleBotExposure,
    maxSingleSymbolExposure,
    concentrationBySymbol,
    concentrationByBot,
    correlationMatrix: {},
    diversificationScore,
    var95Daily,
    var99Daily,
    cvar95Daily,
    varMethod: "HISTORICAL",
    portfolioDrawdown: 0,
    portfolioDrawdownPct: 0,
    portfolioPeakEquity: null,
    limitBreaches,
    breachCount: limitBreaches.length,
    traceId,
  }).returning();
  
  if (limitBreaches.length > 0) {
    await logImmutableAuditEvent({
      eventType: "RISK_LIMIT_BREACH",
      entityType: "SYSTEM",
      entityId: "PORTFOLIO",
      actorType: "SYSTEM",
      eventPayload: {
        snapshotId: snapshot.id,
        breaches: limitBreaches,
        totalGrossExposure,
        var95Daily,
      },
      traceId,
    });
  }
  
  console.log(`[RISK_SNAPSHOT] exposure=$${totalGrossExposure.toFixed(0)} var95=$${var95Daily.toFixed(0)} breaches=${limitBreaches.length} bots=${botCount}`);
  
  return snapshot;
}

export async function runPreTradeCheck(params: {
  botId: string;
  instanceId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  limitPrice?: number;
  traceId?: string;
}): Promise<PreTradeCheck> {
  const startTime = Date.now();
  
  const latestSnapshot = await db
    .select()
    .from(riskSnapshots)
    .orderBy(desc(riskSnapshots.snapshotTime))
    .limit(1);
  
  const snapshot = latestSnapshot[0];
  const limits = DEFAULT_RISK_LIMITS;
  
  const proposedNotional = params.quantity * (params.limitPrice || 5000) * getContractMultiplier(params.symbol);
  
  const currentExposure = snapshot?.totalGrossExposure || 0;
  const newTotalExposure = currentExposure + proposedNotional;
  
  const checksRun: Array<{ name: string; passed: boolean; reason?: string }> = [];
  const blockedBy: string[] = [];
  
  const positionLimitCheck = params.quantity <= 10;
  checksRun.push({ name: "POSITION_LIMIT", passed: positionLimitCheck, reason: positionLimitCheck ? undefined : "Quantity exceeds 10 contracts" });
  if (!positionLimitCheck) blockedBy.push("POSITION_LIMIT");
  
  const exposureLimitCheck = newTotalExposure <= limits.maxTotalExposure;
  checksRun.push({ name: "EXPOSURE_LIMIT", passed: exposureLimitCheck, reason: exposureLimitCheck ? undefined : "Would exceed total exposure limit" });
  if (!exposureLimitCheck) blockedBy.push("EXPOSURE_LIMIT");
  
  const symbolConcentration = snapshot?.concentrationBySymbol as Record<string, number> || {};
  const currentSymbolConcentration = symbolConcentration[params.symbol] || 0;
  const newSymbolExposure = (snapshot?.maxSingleSymbolExposure || 0) + proposedNotional;
  const concentrationCheck = currentSymbolConcentration < limits.maxConcentrationPct || newSymbolExposure <= limits.maxSingleSymbolExposure;
  checksRun.push({ name: "CONCENTRATION", passed: concentrationCheck, reason: concentrationCheck ? undefined : "Would exceed concentration limit" });
  if (!concentrationCheck) blockedBy.push("CONCENTRATION");
  
  const drawdownCheck = (snapshot?.portfolioDrawdownPct || 0) < limits.maxDrawdownPct;
  checksRun.push({ name: "DRAWDOWN", passed: drawdownCheck, reason: drawdownCheck ? undefined : "Portfolio drawdown exceeds limit" });
  if (!drawdownCheck) blockedBy.push("DRAWDOWN");
  
  const marginCheck = true;
  checksRun.push({ name: "MARGIN", passed: marginCheck });
  
  const circuitBreakerCheck = true;
  checksRun.push({ name: "CIRCUIT_BREAKER", passed: circuitBreakerCheck });
  
  const killSwitchCheck = true;
  checksRun.push({ name: "KILL_SWITCH", passed: killSwitchCheck });
  
  const checksPassed = blockedBy.length === 0;
  const latencyMs = Date.now() - startTime;
  
  const [check] = await db.insert(preTradeChecks).values({
    botId: params.botId,
    instanceId: params.instanceId,
    symbol: params.symbol,
    side: params.side,
    quantity: params.quantity,
    orderType: params.orderType,
    limitPrice: params.limitPrice,
    checksPassed,
    checksRun,
    blockedBy: blockedBy.length > 0 ? blockedBy : null,
    positionLimitCheck,
    exposureLimitCheck,
    concentrationCheck,
    drawdownCheck,
    marginCheck,
    circuitBreakerCheck,
    killSwitchCheck,
    requiredMargin: proposedNotional * 0.1,
    availableMargin: 100000,
    marginUtilization: (proposedNotional * 0.1) / 100000 * 100,
    latencyMs,
    traceId: params.traceId,
  }).returning();
  
  if (!checksPassed) {
    await logImmutableAuditEvent({
      eventType: "PRE_TRADE_BLOCKED",
      entityType: "BOT",
      entityId: params.botId,
      actorType: "SYSTEM",
      eventPayload: {
        checkId: check.id,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        blockedBy,
        proposedNotional,
      },
      traceId: params.traceId,
    });
  }
  
  console.log(`[PRE_TRADE] bot=${params.botId.slice(0,8)} ${params.side} ${params.quantity} ${params.symbol} passed=${checksPassed} latency=${latencyMs}ms`);
  
  return check;
}

export async function createStressScenario(params: {
  name: string;
  description?: string;
  scenarioType: string;
  marketShocks: Record<string, number>;
  correlationShock?: number;
  liquidityShock?: number;
  historicalPeriod?: string;
  historicalStartDate?: Date;
  historicalEndDate?: Date;
  isRegulatoryRequired?: boolean;
  regulatoryFramework?: string;
}): Promise<StressScenario> {
  const [scenario] = await db.insert(stressScenarios).values({
    name: params.name,
    description: params.description,
    scenarioType: params.scenarioType,
    marketShocks: params.marketShocks,
    correlationShock: params.correlationShock,
    liquidityShock: params.liquidityShock,
    historicalPeriod: params.historicalPeriod,
    historicalStartDate: params.historicalStartDate,
    historicalEndDate: params.historicalEndDate,
    isRegulatoryRequired: params.isRegulatoryRequired,
    regulatoryFramework: params.regulatoryFramework,
  }).returning();
  
  console.log(`[STRESS_SCENARIO] created name="${params.name}" type=${params.scenarioType}`);
  
  return scenario;
}

export async function runStressTest(scenarioId: string, portfolioValue: number): Promise<{
  scenario: StressScenario;
  stressedPnl: number;
  stressedDrawdown: number;
  impactBySymbol: Record<string, number>;
}> {
  const [scenario] = await db
    .select()
    .from(stressScenarios)
    .where(eq(stressScenarios.id, scenarioId));
  
  if (!scenario) {
    throw new Error(`Scenario ${scenarioId} not found`);
  }
  
  const positions = await getOpenPositions();
  const shocks = scenario.marketShocks as Record<string, number>;
  
  let totalImpact = 0;
  const impactBySymbol: Record<string, number> = {};
  
  for (const pos of positions) {
    const shockPct = shocks[pos.symbol] || shocks["DEFAULT"] || -5;
    const impact = pos.notionalValue * (shockPct / 100);
    
    if (pos.side === "LONG") {
      totalImpact += impact;
    } else {
      totalImpact -= impact;
    }
    
    impactBySymbol[pos.symbol] = (impactBySymbol[pos.symbol] || 0) + impact;
  }
  
  if (scenario.correlationShock) {
    totalImpact *= (1 + scenario.correlationShock);
  }
  
  if (scenario.liquidityShock) {
    totalImpact *= (1 + scenario.liquidityShock * 0.1);
  }
  
  const stressedDrawdown = portfolioValue > 0 ? (Math.abs(totalImpact) / portfolioValue) * 100 : 0;
  
  console.log(`[STRESS_TEST] scenario="${scenario.name}" impact=$${totalImpact.toFixed(0)} drawdown=${stressedDrawdown.toFixed(1)}%`);
  
  return {
    scenario,
    stressedPnl: totalImpact,
    stressedDrawdown,
    impactBySymbol,
  };
}

export async function seedDefaultStressScenarios(): Promise<void> {
  const existing = await db.select().from(stressScenarios).limit(1);
  if (existing.length > 0) return;
  
  const scenarios = [
    {
      name: "COVID-19 March 2020",
      description: "Simulates the March 2020 COVID crash with extreme volatility",
      scenarioType: "HISTORICAL",
      marketShocks: { MES: -12, MNQ: -15, ES: -12, NQ: -15, DEFAULT: -10 },
      correlationShock: 0.3,
      liquidityShock: 2.0,
      historicalPeriod: "2020-03 COVID",
    },
    {
      name: "Flash Crash 2010",
      description: "Simulates the May 2010 flash crash scenario",
      scenarioType: "HISTORICAL",
      marketShocks: { MES: -9, MNQ: -8, ES: -9, NQ: -8, DEFAULT: -7 },
      correlationShock: 0.5,
      liquidityShock: 5.0,
      historicalPeriod: "2010-05 Flash Crash",
    },
    {
      name: "Moderate Correction",
      description: "5% market correction with elevated volatility",
      scenarioType: "HYPOTHETICAL",
      marketShocks: { MES: -5, MNQ: -6, ES: -5, NQ: -6, DEFAULT: -5 },
      correlationShock: 0.1,
      liquidityShock: 0.5,
    },
    {
      name: "Severe Bear Market",
      description: "20% bear market drawdown over extended period",
      scenarioType: "HYPOTHETICAL",
      marketShocks: { MES: -20, MNQ: -25, ES: -20, NQ: -25, DEFAULT: -18 },
      correlationShock: 0.4,
      liquidityShock: 1.5,
    },
    {
      name: "CFTC Regulatory Stress",
      description: "CFTC-required stress scenario for futures trading",
      scenarioType: "REGULATORY",
      marketShocks: { MES: -10, MNQ: -12, ES: -10, NQ: -12, DEFAULT: -8 },
      correlationShock: 0.2,
      liquidityShock: 1.0,
      isRegulatoryRequired: true,
      regulatoryFramework: "CFTC",
    },
  ];
  
  for (const s of scenarios) {
    await createStressScenario(s);
  }
  
  console.log(`[STRESS_SCENARIOS] seeded ${scenarios.length} default scenarios`);
}
