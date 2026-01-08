import { 
  detectUnifiedRegime, 
  shouldBotTrade, 
  getRegimeOverride,
  getRegimeSummary,
  clearRegimeCache,
  type UnifiedRegime,
  type RegimeState 
} from "../autonomous-regime-engine";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, any>;
  error?: string;
}

async function testUnifiedRegimeDetection(): Promise<TestResult> {
  const start = Date.now();
  try {
    clearRegimeCache();
    
    const regimeState = await detectUnifiedRegime("MES", { 
      includeMacro: false,
      traceId: "test-unified-regime"
    });
    
    if (!regimeState.unifiedRegime) {
      throw new Error("Unified regime should be detected");
    }
    
    const validRegimes: UnifiedRegime[] = [
      "BULL_EXPANSION", "BULL_CONTRACTION", "BEAR_EXPANSION", "BEAR_RECESSION",
      "SIDEWAYS_STABLE", "HIGH_VOL_CRISIS", "LOW_VOL_COMPRESSION", "TRANSITION", "UNKNOWN"
    ];
    
    if (!validRegimes.includes(regimeState.unifiedRegime)) {
      throw new Error(`Invalid unified regime: ${regimeState.unifiedRegime}`);
    }
    
    if (typeof regimeState.confidence !== "number" || regimeState.confidence < 0 || regimeState.confidence > 1) {
      throw new Error(`Invalid confidence: ${regimeState.confidence}`);
    }
    
    if (typeof regimeState.positionSizeMultiplier !== "number") {
      throw new Error("Position size multiplier should be a number");
    }
    
    if (!regimeState.marketRegime || !regimeState.marketRegime.regime) {
      throw new Error("Market regime should be present");
    }

    return {
      name: "Unified Regime Detection",
      passed: true,
      duration: Date.now() - start,
      details: {
        unifiedRegime: regimeState.unifiedRegime,
        marketRegime: regimeState.marketRegime.regime,
        confidence: regimeState.confidence,
        positionMultiplier: regimeState.positionSizeMultiplier,
      },
    };
  } catch (error) {
    return {
      name: "Unified Regime Detection",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testStrategyRecommendations(): Promise<TestResult> {
  const start = Date.now();
  try {
    const regimeState = await detectUnifiedRegime("MES", {
      includeMacro: false,
      traceId: "test-strategy-recs"
    });
    
    if (!Array.isArray(regimeState.strategyRecommendations)) {
      throw new Error("Strategy recommendations should be an array");
    }
    
    if (regimeState.strategyRecommendations.length === 0) {
      throw new Error("Should have at least one strategy recommendation");
    }
    
    const validSuitabilities = ["OPTIMAL", "ACCEPTABLE", "AVOID"];
    for (const rec of regimeState.strategyRecommendations) {
      if (!rec.archetype || typeof rec.archetype !== "string") {
        throw new Error("Recommendation should have archetype");
      }
      if (!validSuitabilities.includes(rec.suitability)) {
        throw new Error(`Invalid suitability: ${rec.suitability}`);
      }
      if (!rec.reason || typeof rec.reason !== "string") {
        throw new Error("Recommendation should have reason");
      }
    }
    
    const optimalCount = regimeState.strategyRecommendations.filter(r => r.suitability === "OPTIMAL").length;
    const avoidCount = regimeState.strategyRecommendations.filter(r => r.suitability === "AVOID").length;

    return {
      name: "Strategy Recommendations",
      passed: true,
      duration: Date.now() - start,
      details: {
        regime: regimeState.unifiedRegime,
        totalRecommendations: regimeState.strategyRecommendations.length,
        optimalStrategies: optimalCount,
        avoidStrategies: avoidCount,
      },
    };
  } catch (error) {
    return {
      name: "Strategy Recommendations",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testRiskAdjustments(): Promise<TestResult> {
  const start = Date.now();
  try {
    const regimeState = await detectUnifiedRegime("MES", {
      includeMacro: false,
      traceId: "test-risk-adjustments"
    });
    
    if (!Array.isArray(regimeState.riskAdjustments)) {
      throw new Error("Risk adjustments should be an array");
    }
    
    const requiredParams = ["positionSize", "stopLoss", "takeProfit"];
    const foundParams = regimeState.riskAdjustments.map(a => a.parameter);
    
    for (const param of requiredParams) {
      if (!foundParams.includes(param)) {
        throw new Error(`Missing required adjustment: ${param}`);
      }
    }
    
    for (const adj of regimeState.riskAdjustments) {
      if (typeof adj.adjustment !== "number" || adj.adjustment <= 0) {
        throw new Error(`Invalid adjustment value for ${adj.parameter}: ${adj.adjustment}`);
      }
      if (!adj.reason || typeof adj.reason !== "string") {
        throw new Error(`Missing reason for ${adj.parameter}`);
      }
    }

    return {
      name: "Risk Adjustments",
      passed: true,
      duration: Date.now() - start,
      details: {
        regime: regimeState.unifiedRegime,
        adjustmentsCount: regimeState.riskAdjustments.length,
        adjustments: regimeState.riskAdjustments.map(a => ({ param: a.parameter, value: a.adjustment })),
      },
    };
  } catch (error) {
    return {
      name: "Risk Adjustments",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testBotTradingDecision(): Promise<TestResult> {
  const start = Date.now();
  try {
    const regimeState = await detectUnifiedRegime("MES", {
      includeMacro: false,
      traceId: "test-bot-decision"
    });
    
    const momentumDecision = shouldBotTrade("momentum", regimeState);
    const meanReversionDecision = shouldBotTrade("mean_reversion", regimeState);
    const defensiveDecision = shouldBotTrade("defensive", regimeState);
    
    for (const decision of [momentumDecision, meanReversionDecision, defensiveDecision]) {
      if (typeof decision.allowed !== "boolean") {
        throw new Error("Decision should have boolean allowed field");
      }
      if (typeof decision.reason !== "string" || !decision.reason) {
        throw new Error("Decision should have reason string");
      }
      if (typeof decision.confidence !== "number") {
        throw new Error("Decision should have confidence number");
      }
    }

    return {
      name: "Bot Trading Decision",
      passed: true,
      duration: Date.now() - start,
      details: {
        regime: regimeState.unifiedRegime,
        momentum: { allowed: momentumDecision.allowed, reason: momentumDecision.reason.slice(0, 50) },
        meanReversion: { allowed: meanReversionDecision.allowed, reason: meanReversionDecision.reason.slice(0, 50) },
        defensive: { allowed: defensiveDecision.allowed, reason: defensiveDecision.reason.slice(0, 50) },
      },
    };
  } catch (error) {
    return {
      name: "Bot Trading Decision",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testRegimeOverride(): Promise<TestResult> {
  const start = Date.now();
  try {
    const regimeState = await detectUnifiedRegime("MES", {
      includeMacro: false,
      traceId: "test-override"
    });
    
    const baseConfig = {
      maxPositions: 5,
      stopLossTicks: 20,
      takeProfitTicks: 40,
    };
    
    const override = getRegimeOverride(regimeState, baseConfig);
    
    if (typeof override.positionSizeMultiplier !== "number") {
      throw new Error("Override should have position size multiplier");
    }
    if (typeof override.maxPositions !== "number" || override.maxPositions < 1) {
      throw new Error("Override should have valid max positions");
    }
    if (!Array.isArray(override.allowedArchetypes)) {
      throw new Error("Override should have allowed archetypes array");
    }
    if (!Array.isArray(override.blockedArchetypes)) {
      throw new Error("Override should have blocked archetypes array");
    }

    return {
      name: "Regime Override",
      passed: true,
      duration: Date.now() - start,
      details: {
        regime: regimeState.unifiedRegime,
        positionMultiplier: override.positionSizeMultiplier,
        adjustedMaxPositions: override.maxPositions,
        allowedCount: override.allowedArchetypes.length,
        blockedCount: override.blockedArchetypes.length,
      },
    };
  } catch (error) {
    return {
      name: "Regime Override",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testCacheManagement(): Promise<TestResult> {
  const start = Date.now();
  try {
    clearRegimeCache();
    
    let summary = getRegimeSummary();
    if (summary.cacheSize !== 0) {
      throw new Error("Cache should be empty after clear");
    }
    
    await detectUnifiedRegime("MES", { includeMacro: false, traceId: "test-cache-1" });
    
    summary = getRegimeSummary();
    if (summary.cacheSize !== 1) {
      throw new Error(`Cache should have 1 entry, got ${summary.cacheSize}`);
    }
    
    const cached1 = await detectUnifiedRegime("MES", { includeMacro: false, traceId: "test-cache-2" });
    const cached2 = await detectUnifiedRegime("MES", { includeMacro: false, traceId: "test-cache-3" });
    
    if (cached1.traceId !== cached2.traceId) {
      throw new Error("Cached regime should have same trace ID (not refetched)");
    }
    
    clearRegimeCache("MES");
    summary = getRegimeSummary();
    if (summary.cacheSize !== 0) {
      throw new Error("Cache should be empty after symbol-specific clear");
    }

    return {
      name: "Cache Management",
      passed: true,
      duration: Date.now() - start,
      details: {
        cacheOperationsVerified: true,
      },
    };
  } catch (error) {
    return {
      name: "Cache Management",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testCrisisRegimeHandling(): Promise<TestResult> {
  const start = Date.now();
  try {
    const mockCrisisState: RegimeState = {
      unifiedRegime: "HIGH_VOL_CRISIS",
      marketRegime: {
        regime: "HIGH_VOLATILITY",
        confidence: 0.9,
        metrics: { volatility: 0.05, avgReturn: -0.03, trendStrength: 0.3, priceRange: 0.15, volumeProfile: 1.5 }
      },
      macroSnapshot: null,
      confidence: 0.85,
      positionSizeMultiplier: 0.25,
      strategyRecommendations: [],
      riskAdjustments: [],
      lastUpdated: new Date(),
      traceId: "test-crisis",
    };
    
    const momentumDecision = shouldBotTrade("momentum", mockCrisisState);
    if (momentumDecision.allowed) {
      throw new Error("Momentum should NOT be allowed in crisis");
    }
    
    const defensiveDecision = shouldBotTrade("defensive", mockCrisisState);
    if (!defensiveDecision.allowed) {
      throw new Error("Defensive should be allowed in crisis");
    }
    
    const hedgingDecision = shouldBotTrade("hedging", mockCrisisState);
    if (!hedgingDecision.allowed) {
      throw new Error("Hedging should be allowed in crisis");
    }

    return {
      name: "Crisis Regime Handling",
      passed: true,
      duration: Date.now() - start,
      details: {
        momentumBlocked: !momentumDecision.allowed,
        defensiveAllowed: defensiveDecision.allowed,
        hedgingAllowed: hedgingDecision.allowed,
      },
    };
  } catch (error) {
    return {
      name: "Crisis Regime Handling",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runRegimeEngineTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
  summary: string;
}> {
  console.log("[REGIME_TESTS] Starting autonomous regime engine test suite...");
  
  const results: TestResult[] = [];
  
  results.push(await testUnifiedRegimeDetection());
  results.push(await testStrategyRecommendations());
  results.push(await testRiskAdjustments());
  results.push(await testBotTradingDecision());
  results.push(await testRegimeOverride());
  results.push(await testCacheManagement());
  results.push(await testCrisisRegimeHandling());
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  const summary = `Regime Engine Tests: ${passed}/${total} passed` + 
    (failed > 0 ? ` (${failed} failed)` : " - All tests passed!");
  
  console.log(`[REGIME_TESTS] ${summary}`);
  
  return { passed, failed, total, results, summary };
}
