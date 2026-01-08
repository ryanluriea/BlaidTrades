/**
 * Unified Graduation Gates - Single Source of Truth
 * 
 * Institutional-grade thresholds for bot promotion through lifecycle stages.
 * Used by both frontend (UI display) and backend (scheduler promotion logic).
 * 
 * Industry standards:
 * - 50-100 trades minimum for statistical significance
 * - Win rate >= 35% (lower is acceptable with high expectancy)
 * - Max drawdown <= 20% for risk management
 * - Profit factor > 1.2 (gross profit / gross loss)
 * - Sharpe >= 0.5 (risk-adjusted returns)
 * - Positive expectancy ($10-15+ per trade)
 * - Must have losing trades (realism check - no curve-fitted strategies)
 * - Verified market data source (data provenance)
 */

export interface GateThresholds {
  minTrades: number;
  minWinRate: number;       // percentage (35 = 35%)
  maxDrawdownPct: number;   // percentage (20 = 20%)
  minProfitFactor: number;  // ratio (1.2 = 1.2x)
  minExpectancy: number;    // dollars per trade
  minSharpe: number;        // ratio
  requireHasLosers: boolean;
  requireMarketDataProof: boolean;
  requireProfitable: boolean;
  minDays?: number;         // minimum days of trading (for later stages)
  requiresApproval?: boolean; // human approval required (CANARY→LIVE)
  requireWalkForwardValidation?: boolean; // walk-forward out-of-sample validation
  minWalkForwardConsistency?: number; // 0.0-1.0 consistency score
  maxOverfitRatio?: number; // training/testing performance ratio (2.0 = 2x overfit)
  requireStressTestPassed?: boolean; // must pass stress test scenarios
}

export const UNIFIED_STAGE_THRESHOLDS: Record<string, GateThresholds> = {
  TRIALS: {
    minTrades: 50,
    minWinRate: 35,
    maxDrawdownPct: 20,
    minProfitFactor: 1.2,
    minExpectancy: 10,
    minSharpe: 0.5,
    requireHasLosers: true,
    requireMarketDataProof: true,
    requireProfitable: true,
  },
  PAPER: {
    minTrades: 100,
    minWinRate: 40,
    maxDrawdownPct: 15,
    minProfitFactor: 1.3,
    minExpectancy: 15,
    minSharpe: 0.7,
    requireHasLosers: true,
    requireMarketDataProof: true,
    requireProfitable: true,
    minDays: 5,
  },
  SHADOW: {
    minTrades: 200,
    minWinRate: 45,
    maxDrawdownPct: 12,
    minProfitFactor: 1.4,
    minExpectancy: 20,
    minSharpe: 0.9,
    requireHasLosers: true,
    requireMarketDataProof: true,
    requireProfitable: true,
    minDays: 10,
    // Walk-forward validation (enabled v2.0)
    requireWalkForwardValidation: true,
    minWalkForwardConsistency: 0.5,
    maxOverfitRatio: 2.5,
  },
  CANARY: {
    minTrades: 300,
    minWinRate: 48,
    maxDrawdownPct: 10,
    minProfitFactor: 1.5,
    minExpectancy: 25,
    minSharpe: 1.0,
    requireHasLosers: true,
    requireMarketDataProof: true,
    requireProfitable: true,
    minDays: 14,
    requiresApproval: true,
    // Walk-forward + stress testing (enabled v2.0)
    requireWalkForwardValidation: true,
    minWalkForwardConsistency: 0.6,
    maxOverfitRatio: 2.0,
    requireStressTestPassed: true,
  },
  LIVE: {
    minTrades: 0,
    minWinRate: 0,
    maxDrawdownPct: 100,
    minProfitFactor: 0,
    minExpectancy: 0,
    minSharpe: 0,
    requireHasLosers: false,
    requireMarketDataProof: false,
    requireProfitable: false,
  },
};

export const DEFAULT_THRESHOLDS = UNIFIED_STAGE_THRESHOLDS.TRIALS;

export interface GateCheckResult {
  gateId: string;
  gateName: string;
  description: string;
  required: number | boolean;
  current: number | boolean;
  passed: boolean;
  unit: string;
  direction: 'min' | 'max' | 'eq';
}

export interface GraduationCheckResult {
  gates: GateCheckResult[];
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  blockers: string[];
}

export interface MetricsInput {
  totalTrades: number;
  winRate: number | null;        // decimal 0.0-1.0 from DB, or percentage 0-100
  winRateIsDecimal?: boolean;    // true if winRate is 0.0-1.0
  maxDrawdownPct: number | null; // percentage (already in % form)
  profitFactor: number | null;
  expectancy: number | null;
  sharpe: number | null;
  pnl: number;
  losers: number;
  hasMarketDataProof: boolean;
  walkForwardPassed?: boolean;
  walkForwardConsistency?: number | null; // 0.0-1.0
  overfitRatio?: number | null;
  stressTestPassed?: boolean;
}

/**
 * Check all graduation gates for a bot at a given stage
 * Returns detailed gate-by-gate results
 */
export function checkGraduationGates(
  metrics: MetricsInput,
  stage: string = 'TRIALS'
): GraduationCheckResult {
  const thresholds = UNIFIED_STAGE_THRESHOLDS[stage] ?? DEFAULT_THRESHOLDS;
  const gates: GateCheckResult[] = [];

  // Convert win rate to percentage if needed
  let winRatePct = metrics.winRate ?? 0;
  if (metrics.winRateIsDecimal && winRatePct <= 1) {
    winRatePct = winRatePct * 100;
  }

  // Gate 1: Minimum trades (sample size)
  gates.push({
    gateId: 'min_trades',
    gateName: 'Sample Size',
    description: 'Minimum trades for statistical significance',
    required: thresholds.minTrades,
    current: metrics.totalTrades,
    passed: metrics.totalTrades >= thresholds.minTrades,
    unit: 'trades',
    direction: 'min',
  });

  // Gate 2: Win Rate
  gates.push({
    gateId: 'win_rate',
    gateName: 'Win Rate',
    description: 'Percentage of winning trades',
    required: thresholds.minWinRate,
    current: Math.round(winRatePct * 10) / 10,
    passed: winRatePct >= thresholds.minWinRate,
    unit: '%',
    direction: 'min',
  });

  // Gate 3: Max Drawdown
  const dd = metrics.maxDrawdownPct ?? 0;
  gates.push({
    gateId: 'max_drawdown',
    gateName: 'Max Drawdown',
    description: 'Maximum peak-to-trough decline',
    required: thresholds.maxDrawdownPct,
    current: Math.round(dd * 10) / 10,
    passed: metrics.totalTrades > 0 && dd > 0 && dd <= thresholds.maxDrawdownPct,
    unit: '%',
    direction: 'max',
  });

  // Gate 4: Profit Factor
  const pf = metrics.profitFactor ?? 0;
  gates.push({
    gateId: 'profit_factor',
    gateName: 'Profit Factor',
    description: 'Gross profit divided by gross loss',
    required: thresholds.minProfitFactor,
    current: Math.round(pf * 100) / 100,
    passed: pf >= thresholds.minProfitFactor,
    unit: 'x',
    direction: 'min',
  });

  // Gate 5: Expectancy
  const exp = metrics.expectancy ?? 0;
  gates.push({
    gateId: 'expectancy',
    gateName: 'Expectancy',
    description: 'Average profit per trade',
    required: thresholds.minExpectancy,
    current: Math.round(exp * 100) / 100,
    passed: exp >= thresholds.minExpectancy,
    unit: '$',
    direction: 'min',
  });

  // Gate 6: Sharpe Ratio
  const sharpe = metrics.sharpe ?? 0;
  gates.push({
    gateId: 'sharpe',
    gateName: 'Sharpe Ratio',
    description: 'Risk-adjusted return measure',
    required: thresholds.minSharpe,
    current: Math.round(sharpe * 100) / 100,
    passed: sharpe >= thresholds.minSharpe,
    unit: '',
    direction: 'min',
  });

  // Gate 7: Profitable
  if (thresholds.requireProfitable) {
    gates.push({
      gateId: 'profitable',
      gateName: 'Profitable',
      description: 'Strategy must be net profitable',
      required: true,
      current: metrics.pnl > 0,
      passed: metrics.pnl > 0,
      unit: '',
      direction: 'eq',
    });
  }

  // Gate 8: Has Losers (realism check)
  if (thresholds.requireHasLosers) {
    gates.push({
      gateId: 'has_losers',
      gateName: 'Has Losers',
      description: 'Must have losing trades (curve-fit protection)',
      required: true,
      current: metrics.losers > 0,
      passed: metrics.losers > 0,
      unit: '',
      direction: 'eq',
    });
  }

  // Gate 9: Market Data Proof
  if (thresholds.requireMarketDataProof) {
    gates.push({
      gateId: 'market_data_proof',
      gateName: 'Data Verified',
      description: 'Market data source verified',
      required: true,
      current: metrics.hasMarketDataProof,
      passed: metrics.hasMarketDataProof,
      unit: '',
      direction: 'eq',
    });
  }

  // Gate 10: Walk-Forward Validation (Institutional requirement for advanced stages)
  if (thresholds.requireWalkForwardValidation) {
    gates.push({
      gateId: 'walk_forward_validation',
      gateName: 'Walk-Forward Passed',
      description: 'Out-of-sample validation passed',
      required: true,
      current: metrics.walkForwardPassed ?? false,
      passed: metrics.walkForwardPassed === true,
      unit: '',
      direction: 'eq',
    });
  }

  // Gate 11: Walk-Forward Consistency Score
  if (thresholds.minWalkForwardConsistency !== undefined) {
    const consistency = metrics.walkForwardConsistency ?? 0;
    gates.push({
      gateId: 'walk_forward_consistency',
      gateName: 'WF Consistency',
      description: 'Performance consistency across segments',
      required: thresholds.minWalkForwardConsistency,
      current: Math.round(consistency * 100) / 100,
      passed: consistency >= thresholds.minWalkForwardConsistency,
      unit: '',
      direction: 'min',
    });
  }

  // Gate 12: Overfit Ratio (training vs testing performance)
  if (thresholds.maxOverfitRatio !== undefined) {
    const overfit = metrics.overfitRatio ?? Infinity;
    gates.push({
      gateId: 'overfit_ratio',
      gateName: 'Overfit Ratio',
      description: 'Training/testing performance ratio (lower is better)',
      required: thresholds.maxOverfitRatio,
      current: overfit === Infinity ? 'N/A' as unknown as number : Math.round(overfit * 100) / 100,
      passed: overfit !== Infinity && overfit <= thresholds.maxOverfitRatio,
      unit: 'x',
      direction: 'max',
    });
  }

  // Gate 13: Stress Test (required for CANARY→LIVE)
  if (thresholds.requireStressTestPassed) {
    gates.push({
      gateId: 'stress_test_passed',
      gateName: 'Stress Test Passed',
      description: 'Passed crisis scenario testing',
      required: true,
      current: metrics.stressTestPassed ?? false,
      passed: metrics.stressTestPassed === true,
      unit: '',
      direction: 'eq',
    });
  }

  const passedCount = gates.filter(g => g.passed).length;
  const blockers = gates.filter(g => !g.passed).map(g => g.gateName);

  return {
    gates,
    allPassed: passedCount === gates.length,
    passedCount,
    totalCount: gates.length,
    blockers,
  };
}

/**
 * Quick check if bot passes all promotion gates (for scheduler)
 */
export function passesAllGates(metrics: MetricsInput, stage: string = 'TRIALS'): boolean {
  return checkGraduationGates(metrics, stage).allPassed;
}
