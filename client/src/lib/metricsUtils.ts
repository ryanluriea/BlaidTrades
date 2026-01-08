/**
 * Institutional-Grade Metrics Utility Library
 * 
 * Provides consistent, statistically correct metric calculations across
 * the entire application. All formulas follow industry standards.
 * 
 * CRITICAL: Use these functions everywhere - no duplicate calculations!
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Daily risk-free rate (5% annual / 252 trading days) */
export const DAILY_RISK_FREE_RATE = 0.05 / 252;

/** Trading days per year for annualization */
export const TRADING_DAYS_PER_YEAR = 252;

/** Minimum samples required for statistical significance */
export const MIN_SAMPLES = {
  sharpe: 20,      // 20 trading days minimum for Sharpe
  sortino: 20,     // 20 trading days minimum for Sortino
  calmar: 60,      // 60 days (3 months) for Calmar
  winRate: 30,     // 30 trades for reliable win rate
  profitFactor: 30, // 30 trades for reliable PF
  basic: 10,       // 10 data points for any basic metric
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Trade {
  pnl: number;
  entryTime: Date | string;
  exitTime: Date | string;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  fees?: number;
}

export interface DailyReturn {
  date: string;
  pnl: number;
  returnPct: number;
  equity: number;
}

export interface StandardStats {
  mean: number;
  sampleStdDev: number;
  populationStdDev: number;
  variance: number;
  n: number;
}

export interface SharpeResult {
  sharpe: number | null;
  tStatistic: number | null;
  pValue: number | null;
  confidenceInterval: [number, number] | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  dailyReturns: number[];
  annualizedReturn: number;
  annualizedVolatility: number;
}

export interface SortinoResult {
  sortino: number | null;
  downsideDeviation: number;
  annualizedReturn: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
}

export interface CalmarResult {
  calmar: number | null;
  annualizedReturn: number;
  maxDrawdownPct: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
}

export interface MaxDrawdownResult {
  maxDrawdownAbs: number;
  maxDrawdownPct: number;
  peakEquity: number;
  troughEquity: number;
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate: string | null;
  currentDrawdownPct: number;
}

export interface UlcerIndexResult {
  ulcerIndex: number;
  painIndex: number;
  drawdownSeries: number[];
}

export interface StreakResult {
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  currentStreakType: 'WIN' | 'LOSS' | 'NONE';
}

export interface ExpectancyResult {
  expectancy: number;        // Dollar expectancy
  expectancyR: number | null; // R-multiple expectancy
  avgWin: number;
  avgLoss: number;
  winRate: number;
  profitFactor: number;
}

export interface ComprehensiveMetrics {
  // Core metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  
  // Risk-adjusted
  sharpe: SharpeResult;
  sortino: SortinoResult;
  calmar: CalmarResult;
  
  // Drawdown
  maxDrawdown: MaxDrawdownResult;
  ulcerIndex: UlcerIndexResult;
  
  // Expectancy
  expectancy: ExpectancyResult;
  
  // Streaks
  streaks: StreakResult;
  
  // Statistical confidence
  statisticallySignificant: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  warnings: string[];
}

// ============================================================================
// BASIC STATISTICAL FUNCTIONS
// ============================================================================

/**
 * Compute standard statistics (mean, std dev) for an array of numbers
 * Uses SAMPLE variance (n-1) for unbiased estimation - institutional standard
 */
export function computeStandardStats(values: number[]): StandardStats {
  const n = values.length;
  
  if (n === 0) {
    return { mean: 0, sampleStdDev: 0, populationStdDev: 0, variance: 0, n: 0 };
  }
  
  if (n === 1) {
    return { mean: values[0], sampleStdDev: 0, populationStdDev: 0, variance: 0, n: 1 };
  }
  
  const mean = values.reduce((a, b) => a + b, 0) / n;
  
  // Sum of squared deviations
  const sumSquaredDev = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0);
  
  // Sample variance (n-1) - CORRECT for estimating population variance from sample
  const sampleVariance = sumSquaredDev / (n - 1);
  const sampleStdDev = Math.sqrt(sampleVariance);
  
  // Population variance (n) - only use when you have the entire population
  const populationVariance = sumSquaredDev / n;
  const populationStdDev = Math.sqrt(populationVariance);
  
  return {
    mean,
    sampleStdDev,
    populationStdDev,
    variance: sampleVariance, // Default to sample variance
    n,
  };
}

/**
 * Compute downside deviation (for Sortino ratio)
 * Only considers returns below the target (typically 0 or risk-free rate)
 */
export function computeDownsideDeviation(
  returns: number[],
  target: number = 0
): number {
  if (returns.length < 2) return 0;
  
  const downsideReturns = returns
    .filter(r => r < target)
    .map(r => Math.pow(r - target, 2));
  
  if (downsideReturns.length === 0) return 0;
  
  // Use sample std dev (n-1)
  const sumSquaredDownside = downsideReturns.reduce((a, b) => a + b, 0);
  return Math.sqrt(sumSquaredDownside / (returns.length - 1));
}

// ============================================================================
// DAILY RETURNS CALCULATION
// ============================================================================

/**
 * Convert trades to daily P&L returns as percentage of equity
 * This is the CORRECT way to calculate Sharpe - using daily percentage returns
 */
export function computeDailyReturns(
  trades: Trade[],
  initialCapital: number
): DailyReturn[] {
  if (!trades.length || initialCapital <= 0) return [];
  
  // Sort trades by exit time
  const sortedTrades = [...trades].sort((a, b) => {
    const aTime = typeof a.exitTime === 'string' ? new Date(a.exitTime) : a.exitTime;
    const bTime = typeof b.exitTime === 'string' ? new Date(b.exitTime) : b.exitTime;
    return aTime.getTime() - bTime.getTime();
  });
  
  // Group by trading day
  const dailyPnL = new Map<string, number>();
  
  for (const trade of sortedTrades) {
    const exitDate = typeof trade.exitTime === 'string' 
      ? trade.exitTime.split('T')[0] 
      : trade.exitTime.toISOString().split('T')[0];
    
    const currentPnl = dailyPnL.get(exitDate) || 0;
    dailyPnL.set(exitDate, currentPnl + trade.pnl);
  }
  
  // Convert to daily returns with running equity
  const dailyReturns: DailyReturn[] = [];
  let equity = initialCapital;
  
  const sortedDates = Array.from(dailyPnL.keys()).sort();
  
  for (const date of sortedDates) {
    const pnl = dailyPnL.get(date)!;
    const returnPct = equity > 0 ? pnl / equity : 0;
    equity += pnl;
    
    dailyReturns.push({
      date,
      pnl,
      returnPct,
      equity,
    });
  }
  
  return dailyReturns;
}

// ============================================================================
// SHARPE RATIO - INSTITUTIONAL STANDARD
// ============================================================================

/**
 * Compute Sharpe Ratio using DAILY PERCENTAGE RETURNS
 * 
 * Formula: (Mean(daily_returns) - risk_free_rate) / StdDev(daily_returns) * sqrt(252)
 * 
 * CRITICAL: This is the ONLY correct way to calculate Sharpe:
 * 1. Use daily percentage returns (not dollar P&L)
 * 2. Use sample standard deviation (n-1)
 * 3. Subtract risk-free rate before dividing
 * 4. Annualize with sqrt(252)
 */
export function computeSharpeRatio(
  dailyReturns: number[],
  riskFreeRate: number = DAILY_RISK_FREE_RATE
): SharpeResult {
  const n = dailyReturns.length;
  
  // Insufficient data guard
  if (n < MIN_SAMPLES.sharpe) {
    return {
      sharpe: null,
      tStatistic: null,
      pValue: null,
      confidenceInterval: null,
      confidence: 'INSUFFICIENT',
      dailyReturns,
      annualizedReturn: 0,
      annualizedVolatility: 0,
    };
  }
  
  const stats = computeStandardStats(dailyReturns);
  
  // Excess return over risk-free rate
  const excessReturn = stats.mean - riskFreeRate;
  
  // Handle zero volatility
  if (stats.sampleStdDev === 0) {
    return {
      sharpe: excessReturn > 0 ? Infinity : excessReturn < 0 ? -Infinity : 0,
      tStatistic: null,
      pValue: null,
      confidenceInterval: null,
      confidence: 'LOW',
      dailyReturns,
      annualizedReturn: stats.mean * TRADING_DAYS_PER_YEAR,
      annualizedVolatility: 0,
    };
  }
  
  // Daily Sharpe
  const dailySharpe = excessReturn / stats.sampleStdDev;
  
  // Annualized Sharpe
  const annualizedSharpe = dailySharpe * Math.sqrt(TRADING_DAYS_PER_YEAR);
  
  // Annualized metrics
  const annualizedReturn = stats.mean * TRADING_DAYS_PER_YEAR;
  const annualizedVolatility = stats.sampleStdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);
  
  // T-statistic for statistical significance
  // t = sharpe * sqrt(n) / sqrt(1 + sharpe^2 / 2)
  const tStatistic = annualizedSharpe * Math.sqrt(n) / Math.sqrt(1 + Math.pow(annualizedSharpe, 2) / 2);
  
  // Approximate p-value (two-tailed) using normal approximation
  const pValue = 2 * (1 - normalCDF(Math.abs(tStatistic)));
  
  // 95% confidence interval using standard error
  // SE(Sharpe) ≈ sqrt((1 + 0.5 * sharpe^2) / n)
  const standardError = Math.sqrt((1 + 0.5 * Math.pow(annualizedSharpe, 2)) / n);
  const z95 = 1.96;
  const confidenceInterval: [number, number] = [
    annualizedSharpe - z95 * standardError,
    annualizedSharpe + z95 * standardError,
  ];
  
  // Determine confidence level
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  if (n >= 100 && pValue < 0.05) {
    confidence = 'HIGH';
  } else if (n >= 50 && pValue < 0.10) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }
  
  return {
    sharpe: isFinite(annualizedSharpe) ? Number(annualizedSharpe.toFixed(4)) : null,
    tStatistic: isFinite(tStatistic) ? Number(tStatistic.toFixed(4)) : null,
    pValue: isFinite(pValue) ? Number(pValue.toFixed(4)) : null,
    confidenceInterval: confidenceInterval.every(isFinite) 
      ? [Number(confidenceInterval[0].toFixed(4)), Number(confidenceInterval[1].toFixed(4))]
      : null,
    confidence,
    dailyReturns,
    annualizedReturn: Number((annualizedReturn * 100).toFixed(2)), // As percentage
    annualizedVolatility: Number((annualizedVolatility * 100).toFixed(2)), // As percentage
  };
}

/**
 * Simple helper to compute Sharpe from trades directly
 */
export function computeSharpeFromTrades(
  trades: Trade[],
  initialCapital: number,
  riskFreeRate: number = DAILY_RISK_FREE_RATE
): SharpeResult {
  const dailyReturns = computeDailyReturns(trades, initialCapital);
  return computeSharpeRatio(
    dailyReturns.map(d => d.returnPct),
    riskFreeRate
  );
}

// ============================================================================
// SORTINO RATIO
// ============================================================================

/**
 * Compute Sortino Ratio - like Sharpe but only penalizes downside volatility
 * Better for strategies that have asymmetric return distributions
 */
export function computeSortinoRatio(
  dailyReturns: number[],
  riskFreeRate: number = DAILY_RISK_FREE_RATE
): SortinoResult {
  const n = dailyReturns.length;
  
  if (n < MIN_SAMPLES.sortino) {
    return {
      sortino: null,
      downsideDeviation: 0,
      annualizedReturn: 0,
      confidence: 'INSUFFICIENT',
    };
  }
  
  const stats = computeStandardStats(dailyReturns);
  const excessReturn = stats.mean - riskFreeRate;
  const downsideDeviation = computeDownsideDeviation(dailyReturns, riskFreeRate);
  
  if (downsideDeviation === 0) {
    return {
      sortino: excessReturn > 0 ? Infinity : 0,
      downsideDeviation: 0,
      annualizedReturn: stats.mean * TRADING_DAYS_PER_YEAR * 100,
      confidence: 'LOW',
    };
  }
  
  const dailySortino = excessReturn / downsideDeviation;
  const annualizedSortino = dailySortino * Math.sqrt(TRADING_DAYS_PER_YEAR);
  
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  if (n >= 100) confidence = 'HIGH';
  else if (n >= 50) confidence = 'MEDIUM';
  else confidence = 'LOW';
  
  return {
    sortino: isFinite(annualizedSortino) ? Number(annualizedSortino.toFixed(4)) : null,
    downsideDeviation: Number((downsideDeviation * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100).toFixed(2)),
    annualizedReturn: Number((stats.mean * TRADING_DAYS_PER_YEAR * 100).toFixed(2)),
    confidence,
  };
}

// ============================================================================
// CALMAR RATIO
// ============================================================================

/**
 * Compute Calmar Ratio - Annualized return / Max drawdown
 * Good for comparing strategies with different holding periods
 */
export function computeCalmarRatio(
  annualizedReturnPct: number,
  maxDrawdownPct: number
): CalmarResult {
  if (maxDrawdownPct === 0) {
    return {
      calmar: annualizedReturnPct > 0 ? Infinity : 0,
      annualizedReturn: annualizedReturnPct,
      maxDrawdownPct: 0,
      confidence: 'LOW',
    };
  }
  
  const calmar = annualizedReturnPct / Math.abs(maxDrawdownPct);
  
  return {
    calmar: isFinite(calmar) ? Number(calmar.toFixed(4)) : null,
    annualizedReturn: annualizedReturnPct,
    maxDrawdownPct,
    confidence: maxDrawdownPct > 5 ? 'HIGH' : 'MEDIUM', // Need real drawdown to be meaningful
  };
}

// ============================================================================
// MAX DRAWDOWN - INSTITUTIONAL STANDARD
// ============================================================================

/**
 * Compute Maximum Drawdown with proper percentage calculation
 * 
 * CRITICAL: maxDrawdownPct = maxDD / (initial_capital + peak_cumulative_pnl) * 100
 * NOT: maxDD / peak_pnl (which gives misleading small percentages)
 */
export function computeMaxDrawdown(
  trades: Trade[],
  initialCapital: number
): MaxDrawdownResult {
  if (!trades.length || initialCapital <= 0) {
    return {
      maxDrawdownAbs: 0,
      maxDrawdownPct: 0,
      peakEquity: initialCapital,
      troughEquity: initialCapital,
      peakDate: null,
      troughDate: null,
      recoveryDate: null,
      currentDrawdownPct: 0,
    };
  }
  
  // Sort trades chronologically
  const sortedTrades = [...trades].sort((a, b) => {
    const aTime = typeof a.exitTime === 'string' ? new Date(a.exitTime) : a.exitTime;
    const bTime = typeof b.exitTime === 'string' ? new Date(b.exitTime) : b.exitTime;
    return aTime.getTime() - bTime.getTime();
  });
  
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownAbs = 0;
  let troughEquity = initialCapital;
  let peakDate: string | null = null;
  let troughDate: string | null = null;
  let recoveryDate: string | null = null;
  let inDrawdown = false;
  let currentPeakDate: string | null = null;
  
  for (const trade of sortedTrades) {
    equity += trade.pnl;
    const exitDate = typeof trade.exitTime === 'string' 
      ? trade.exitTime.split('T')[0]
      : trade.exitTime.toISOString().split('T')[0];
    
    if (equity > peakEquity) {
      peakEquity = equity;
      currentPeakDate = exitDate;
      
      if (inDrawdown && !recoveryDate) {
        recoveryDate = exitDate;
      }
      inDrawdown = false;
    }
    
    const drawdown = peakEquity - equity;
    
    if (drawdown > maxDrawdownAbs) {
      maxDrawdownAbs = drawdown;
      troughEquity = equity;
      peakDate = currentPeakDate;
      troughDate = exitDate;
      recoveryDate = null; // Reset recovery since we have new max DD
      inDrawdown = true;
    }
  }
  
  // Calculate percentage based on PEAK EQUITY (not peak P&L)
  // This is the institutional standard - DD as % of portfolio at peak
  const maxDrawdownPct = peakEquity > 0 
    ? (maxDrawdownAbs / peakEquity) * 100 
    : 0;
  
  // Current drawdown
  const currentDrawdown = peakEquity - equity;
  const currentDrawdownPct = peakEquity > 0 
    ? (currentDrawdown / peakEquity) * 100 
    : 0;
  
  return {
    maxDrawdownAbs: Number(maxDrawdownAbs.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    peakEquity: Number(peakEquity.toFixed(2)),
    troughEquity: Number(troughEquity.toFixed(2)),
    peakDate,
    troughDate,
    recoveryDate,
    currentDrawdownPct: Number(currentDrawdownPct.toFixed(2)),
  };
}

// ============================================================================
// ULCER INDEX
// ============================================================================

/**
 * Compute Ulcer Index - measures depth and duration of drawdowns
 * Lower is better. Invented by Peter Martin.
 * 
 * UI = sqrt(mean(drawdown_percentages^2))
 */
export function computeUlcerIndex(
  trades: Trade[],
  initialCapital: number
): UlcerIndexResult {
  if (!trades.length || initialCapital <= 0) {
    return { ulcerIndex: 0, painIndex: 0, drawdownSeries: [] };
  }
  
  const sortedTrades = [...trades].sort((a, b) => {
    const aTime = typeof a.exitTime === 'string' ? new Date(a.exitTime) : a.exitTime;
    const bTime = typeof b.exitTime === 'string' ? new Date(b.exitTime) : b.exitTime;
    return aTime.getTime() - bTime.getTime();
  });
  
  let equity = initialCapital;
  let peak = initialCapital;
  const drawdownSeries: number[] = [];
  
  for (const trade of sortedTrades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    drawdownSeries.push(drawdownPct);
  }
  
  if (drawdownSeries.length === 0) {
    return { ulcerIndex: 0, painIndex: 0, drawdownSeries: [] };
  }
  
  // Ulcer Index = sqrt(mean of squared drawdowns)
  const sumSquaredDD = drawdownSeries.reduce((sum, dd) => sum + dd * dd, 0);
  const ulcerIndex = Math.sqrt(sumSquaredDD / drawdownSeries.length);
  
  // Pain Index = mean of drawdowns (simpler version)
  const painIndex = drawdownSeries.reduce((sum, dd) => sum + dd, 0) / drawdownSeries.length;
  
  return {
    ulcerIndex: Number(ulcerIndex.toFixed(4)),
    painIndex: Number(painIndex.toFixed(4)),
    drawdownSeries,
  };
}

// ============================================================================
// WIN/LOSS STREAKS
// ============================================================================

/**
 * Compute consecutive win/loss streaks
 */
export function computeStreaks(trades: Trade[]): StreakResult {
  if (!trades.length) {
    return {
      maxWinStreak: 0,
      maxLossStreak: 0,
      currentStreak: 0,
      currentStreakType: 'NONE',
    };
  }
  
  const sortedTrades = [...trades].sort((a, b) => {
    const aTime = typeof a.exitTime === 'string' ? new Date(a.exitTime) : a.exitTime;
    const bTime = typeof b.exitTime === 'string' ? new Date(b.exitTime) : b.exitTime;
    return aTime.getTime() - bTime.getTime();
  });
  
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentStreak = 0;
  let currentStreakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
  let winStreak = 0;
  let lossStreak = 0;
  
  for (const trade of sortedTrades) {
    if (trade.pnl > 0) {
      winStreak++;
      lossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, winStreak);
      currentStreak = winStreak;
      currentStreakType = 'WIN';
    } else if (trade.pnl < 0) {
      lossStreak++;
      winStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
      currentStreak = lossStreak;
      currentStreakType = 'LOSS';
    } else {
      // Break even trade - reset both
      winStreak = 0;
      lossStreak = 0;
      currentStreak = 0;
      currentStreakType = 'NONE';
    }
  }
  
  return {
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    currentStreakType,
  };
}

// ============================================================================
// EXPECTANCY
// ============================================================================

/**
 * Compute Expectancy in dollars and R-multiples
 * R-multiple expectancy requires knowing the initial risk per trade
 */
export function computeExpectancy(
  trades: Trade[],
  avgRiskPerTrade?: number // Optional: average initial risk for R-multiple calc
): ExpectancyResult {
  if (!trades.length) {
    return {
      expectancy: 0,
      expectancyR: null,
      avgWin: 0,
      avgLoss: 0,
      winRate: 0,
      profitFactor: 0,
    };
  }
  
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl < 0);
  
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));
  
  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  
  // Dollar expectancy
  const totalPnl = grossProfit - grossLoss;
  const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;
  
  // R-multiple expectancy (if risk is provided)
  let expectancyR: number | null = null;
  if (avgRiskPerTrade && avgRiskPerTrade > 0) {
    expectancyR = expectancy / avgRiskPerTrade;
  }
  
  return {
    expectancy: Number(expectancy.toFixed(2)),
    expectancyR: expectancyR !== null ? Number(expectancyR.toFixed(3)) : null,
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    winRate: Number(winRate.toFixed(2)),
    profitFactor: isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : null,
  };
}

// ============================================================================
// COMPREHENSIVE METRICS COMPUTATION
// ============================================================================

/**
 * Compute ALL institutional-grade metrics from a trade list
 * This is the main entry point for comprehensive analysis
 */
export function computeComprehensiveMetrics(
  trades: Trade[],
  initialCapital: number,
  options: {
    riskFreeRate?: number;
    avgRiskPerTrade?: number;
  } = {}
): ComprehensiveMetrics {
  const {
    riskFreeRate = DAILY_RISK_FREE_RATE,
    avgRiskPerTrade,
  } = options;
  
  const warnings: string[] = [];
  
  // Basic counts
  const totalTrades = trades.length;
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl < 0);
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = grossProfit - grossLoss;
  
  // Win rate and profit factor
  const winRate = totalTrades >= MIN_SAMPLES.winRate 
    ? Number(((winners.length / totalTrades) * 100).toFixed(2))
    : null;
  const profitFactor = grossLoss > 0 && totalTrades >= MIN_SAMPLES.profitFactor
    ? Number((grossProfit / grossLoss).toFixed(3))
    : null;
  
  // Daily returns for risk-adjusted metrics
  const dailyReturns = computeDailyReturns(trades, initialCapital);
  const dailyReturnPcts = dailyReturns.map(d => d.returnPct);
  
  // Risk-adjusted ratios
  const sharpe = computeSharpeRatio(dailyReturnPcts, riskFreeRate);
  const sortino = computeSortinoRatio(dailyReturnPcts, riskFreeRate);
  
  // Max drawdown
  const maxDrawdown = computeMaxDrawdown(trades, initialCapital);
  
  // Calmar ratio
  const calmar = computeCalmarRatio(sharpe.annualizedReturn, maxDrawdown.maxDrawdownPct);
  
  // Ulcer index
  const ulcerIndex = computeUlcerIndex(trades, initialCapital);
  
  // Expectancy
  const expectancy = computeExpectancy(trades, avgRiskPerTrade);
  
  // Streaks
  const streaks = computeStreaks(trades);
  
  // Statistical significance determination
  let statisticallySignificant = false;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'INSUFFICIENT';
  
  if (sharpe.confidence === 'HIGH' && totalTrades >= 100) {
    statisticallySignificant = true;
    confidence = 'HIGH';
  } else if (sharpe.confidence === 'MEDIUM' && totalTrades >= 50) {
    statisticallySignificant = sharpe.pValue !== null && sharpe.pValue < 0.10;
    confidence = 'MEDIUM';
  } else if (totalTrades >= MIN_SAMPLES.basic) {
    confidence = 'LOW';
  }
  
  // Warnings
  if (totalTrades < MIN_SAMPLES.sharpe) {
    warnings.push(`Insufficient trading days for reliable Sharpe (${dailyReturns.length}/${MIN_SAMPLES.sharpe})`);
  }
  if (totalTrades < MIN_SAMPLES.winRate) {
    warnings.push(`Insufficient trades for reliable win rate (${totalTrades}/${MIN_SAMPLES.winRate})`);
  }
  if (maxDrawdown.maxDrawdownPct > 20) {
    warnings.push(`High maximum drawdown: ${maxDrawdown.maxDrawdownPct.toFixed(1)}%`);
  }
  if (profitFactor !== null && profitFactor < 1) {
    warnings.push(`Profit factor below 1.0 indicates losing strategy`);
  }
  
  return {
    totalTrades,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,
    profitFactor,
    totalPnl: Number(totalPnl.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    sharpe,
    sortino,
    calmar,
    maxDrawdown,
    ulcerIndex,
    expectancy,
    streaks,
    statisticallySignificant,
    confidence,
    warnings,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Standard normal CDF approximation
 * Used for p-value calculation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

/**
 * Check if a metric value is valid and displayable
 */
export function isValidMetric(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && isFinite(value) && !isNaN(value);
}

/**
 * Format a metric for display with appropriate precision
 */
export function formatMetric(
  value: number | null | undefined,
  type: 'sharpe' | 'percent' | 'currency' | 'ratio' | 'count',
  options: { showSign?: boolean; decimals?: number } = {}
): string {
  if (!isValidMetric(value)) return '—';
  
  const { showSign = false, decimals } = options;
  const sign = showSign && value > 0 ? '+' : '';
  
  switch (type) {
    case 'sharpe':
      return `${sign}${value.toFixed(decimals ?? 2)}`;
    case 'percent':
      return `${sign}${value.toFixed(decimals ?? 1)}%`;
    case 'currency':
      return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 0 })}`;
    case 'ratio':
      return `${sign}${value.toFixed(decimals ?? 2)}`;
    case 'count':
      return Math.round(value).toLocaleString('en-US');
    default:
      return value.toString();
  }
}

/**
 * Get confidence badge color
 */
export function getConfidenceColor(confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'): string {
  switch (confidence) {
    case 'HIGH': return 'text-emerald-500';
    case 'MEDIUM': return 'text-amber-500';
    case 'LOW': return 'text-orange-500';
    case 'INSUFFICIENT': return 'text-muted-foreground';
  }
}

// ============================================================================
// LEGACY COMPATIBILITY FUNCTIONS
// ============================================================================

/**
 * Simple Sharpe calculation for backward compatibility
 * Use computeSharpeRatio for full institutional version
 */
export function computeSimpleSharpe(returns: number[]): number | null {
  if (returns.length < MIN_SAMPLES.sharpe) return null;
  
  const stats = computeStandardStats(returns);
  if (stats.sampleStdDev === 0) return 0;
  
  const excessReturn = stats.mean - DAILY_RISK_FREE_RATE;
  return (excessReturn / stats.sampleStdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Simple max drawdown for backward compatibility
 */
export function computeSimpleMaxDD(
  pnls: number[],
  initialCapital: number
): { maxDD: number; maxDDPct: number } {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  
  return {
    maxDD,
    maxDDPct: peak > 0 ? (maxDD / peak) * 100 : 0,
  };
}
