// Rule Translator - Converts JSON config keys to human-readable descriptions
// This is the "revolutionary" feature that makes bot rules understandable

// Import unified thresholds from shared source of truth
import { UNIFIED_STAGE_THRESHOLDS } from '@shared/graduationGates';

export interface RuleDefinition {
  name: string;
  description: (value: any, context?: RuleContext) => string;
  category: 'entry' | 'exit' | 'risk' | 'time' | 'regime' | 'promotion';
  icon?: string;
  valueFormatter?: (value: any) => string;
  getStatus?: (value: any, context?: RuleContext) => 'active' | 'inactive' | 'passing' | 'failing' | 'warning';
}

export interface RuleContext {
  contractSize?: number;
  tickSize?: number;
  instrument?: string;
  currentPrice?: number;
  accountEquity?: number;
  botMetrics?: {
    totalTrades?: number;
    winRate?: number;
    profitFactor?: number;
    maxDrawdown?: number;
    sharpe?: number;
  };
}

// Promotion thresholds - derived from unified graduation gates
// SINGLE SOURCE OF TRUTH: shared/graduationGates.ts
const trialsThresholds = UNIFIED_STAGE_THRESHOLDS.TRIALS;
const paperThresholds = UNIFIED_STAGE_THRESHOLDS.PAPER;
const shadowThresholds = UNIFIED_STAGE_THRESHOLDS.SHADOW;

export const PROMOTION_THRESHOLDS = {
  TRIALS_TO_PAPER: {
    min_trades: trialsThresholds.minTrades,           // 50 (unified)
    min_profit_factor: trialsThresholds.minProfitFactor, // 1.2 (unified)
    min_win_rate: trialsThresholds.minWinRate,        // 35 (unified)
    max_drawdown: trialsThresholds.maxDrawdownPct,    // 20% (unified)
    min_expectancy: trialsThresholds.minExpectancy,   // $10 (unified)
    min_sharpe: trialsThresholds.minSharpe,           // 0.5 (unified)
  },
  PAPER_TO_SHADOW: {
    min_trades: paperThresholds.minTrades,         // 100 (unified)
    min_profit_factor: paperThresholds.minProfitFactor, // 1.3 (unified)
    min_win_rate: paperThresholds.minWinRate,      // 40 (unified)
    max_drawdown: paperThresholds.maxDrawdownPct,  // 15% (unified)
    min_expectancy: paperThresholds.minExpectancy, // $15 (unified)
    min_sharpe: paperThresholds.minSharpe,         // 0.7 (unified)
    min_days: paperThresholds.minDays,             // 5 (unified)
  },
  SHADOW_TO_CANARY: {
    min_trades: shadowThresholds.minTrades,        // 200 (unified)
    min_profit_factor: shadowThresholds.minProfitFactor, // 1.4 (unified)
    min_win_rate: shadowThresholds.minWinRate,     // 45 (unified)
    max_drawdown: shadowThresholds.maxDrawdownPct, // 12% (unified)
    min_expectancy: shadowThresholds.minExpectancy, // $20 (unified)
    min_sharpe: shadowThresholds.minSharpe,        // 0.9 (unified)
    min_days: shadowThresholds.minDays,            // 10 (unified)
  },
};

// Strategy rule translations
export const STRATEGY_RULES: Record<string, RuleDefinition> = {
  entry_deviation_pct: {
    name: 'Price Deviation Threshold',
    description: (val) => `Enter when price moves ${(val * 100).toFixed(2)}% from moving average`,
    category: 'entry',
    valueFormatter: (val) => `${(val * 100).toFixed(2)}%`,
    getStatus: (val) => val ? 'active' : 'inactive',
  },
  vwap_deviation_entry: {
    name: 'VWAP Deviation Entry',
    description: (val) => `Enter when price is ${(val * 100).toFixed(1)}% away from VWAP (mean reversion)`,
    category: 'entry',
    valueFormatter: (val) => `${(val * 100).toFixed(1)}%`,
  },
  lookback_period: {
    name: 'Lookback Period',
    description: (val) => `Use ${val} bars to calculate moving average for entry signals`,
    category: 'entry',
    valueFormatter: (val) => `${val} bars`,
  },
  min_momentum: {
    name: 'Minimum Momentum',
    description: (val) => `Require ${(val * 100).toFixed(2)}% price momentum before entering`,
    category: 'entry',
    valueFormatter: (val) => `${(val * 100).toFixed(2)}%`,
  },
  require_retest: {
    name: 'Require Retest',
    description: (val) => val ? 'Wait for price to retest level before entering' : 'Enter immediately on breakout (no retest required)',
    category: 'entry',
    getStatus: (val) => val ? 'active' : 'inactive',
  },
  require_htf_alignment: {
    name: 'Higher Timeframe Alignment',
    description: (val) => val ? 'Only trade when higher timeframe trend agrees' : 'Trade regardless of higher timeframe trend',
    category: 'entry',
    getStatus: (val) => val ? 'active' : 'inactive',
  },
  regime_detection_enabled: {
    name: 'Regime Detection',
    description: (val) => val ? 'Filter trades based on market regime (trend vs range)' : 'Trade in all market conditions',
    category: 'regime',
    getStatus: (val) => val ? 'active' : 'inactive',
  },
  breakout_buffer_ticks: {
    name: 'Breakout Buffer',
    description: (val, ctx) => `Wait for ${val} ticks ($${((ctx?.tickSize || 0.25) * val * (ctx?.contractSize || 5)).toFixed(0)}) beyond level before entering`,
    category: 'entry',
    valueFormatter: (val) => `${val} ticks`,
  },
  opening_range_minutes: {
    name: 'Opening Range Window',
    description: (val) => `Use first ${val} minutes of session to establish opening range`,
    category: 'time',
    valueFormatter: (val) => `${val} min`,
  },
  atr_period: {
    name: 'ATR Period',
    description: (val) => `Calculate Average True Range over ${val} bars for volatility bands`,
    category: 'entry',
    valueFormatter: (val) => `${val} bars`,
  },
  atr_multiplier: {
    name: 'ATR Multiplier',
    description: (val) => `Set bands at ${val}x ATR from mean (lower = more trades, higher = more selective)`,
    category: 'entry',
    valueFormatter: (val) => `${val}x`,
  },
  slope_period: {
    name: 'Slope Period',
    description: (val) => `Measure momentum over ${val} bars for trend direction`,
    category: 'entry',
    valueFormatter: (val) => `${val} bars`,
  },
  min_volume_ratio: {
    name: 'Volume Filter',
    description: (val) => `Require ${(val * 100).toFixed(0)}% of average volume before entering`,
    category: 'entry',
    valueFormatter: (val) => `${(val * 100).toFixed(0)}%`,
  },
  max_hold_time_minutes: {
    name: 'Max Hold Time',
    description: (val) => `Exit position after ${val} minutes if target/stop not hit`,
    category: 'exit',
    valueFormatter: (val) => `${val} min`,
  },
  session_start: {
    name: 'Session Start',
    description: (val) => `Begin trading at ${val} ET`,
    category: 'time',
    valueFormatter: (val) => val,
  },
  session_end: {
    name: 'Session End',
    description: (val) => `Stop trading at ${val} ET`,
    category: 'time',
    valueFormatter: (val) => val,
  },
  type: {
    name: 'Strategy Type',
    description: (val) => `${formatStrategyType(val)} strategy`,
    category: 'entry',
    valueFormatter: formatStrategyType,
  },
  instrument: {
    name: 'Instrument',
    description: (val) => `Trades ${val} futures`,
    category: 'entry',
    valueFormatter: (val) => val,
  },
  timeframe: {
    name: 'Timeframe',
    description: (val) => `Analyzes ${val} bars for signals`,
    category: 'entry',
    valueFormatter: (val) => val,
  },
};

// Risk rule translations
export const RISK_RULES: Record<string, RuleDefinition> = {
  stop_loss_ticks: {
    name: 'Stop Loss',
    description: (val, ctx) => {
      const dollarValue = val * (ctx?.tickSize || 0.25) * (ctx?.contractSize || 5);
      return `Exit at -${val} ticks ($${dollarValue.toFixed(0)} per contract) if trade goes against you`;
    },
    category: 'exit',
    valueFormatter: (val) => `${val} ticks`,
  },
  profit_target_ticks: {
    name: 'Profit Target',
    description: (val, ctx) => {
      const dollarValue = val * (ctx?.tickSize || 0.25) * (ctx?.contractSize || 5);
      return `Take profit at +${val} ticks ($${dollarValue.toFixed(0)} per contract)`;
    },
    category: 'exit',
    valueFormatter: (val) => `${val} ticks`,
  },
  max_trades_per_day: {
    name: 'Max Daily Trades',
    description: (val) => `Stop trading after ${val} trades per day (prevent overtrading)`,
    category: 'risk',
    valueFormatter: (val) => `${val} trades`,
  },
  cooldown_minutes: {
    name: 'Trade Cooldown',
    description: (val) => `Wait ${val} minutes between trades (prevent revenge trading)`,
    category: 'risk',
    valueFormatter: (val) => `${val} min`,
  },
  max_position_size: {
    name: 'Max Position Size',
    description: (val) => `Maximum ${val} contracts per position`,
    category: 'risk',
    valueFormatter: (val) => `${val} contracts`,
  },
  max_daily_loss: {
    name: 'Max Daily Loss',
    description: (val) => `Stop trading for the day if losses exceed $${val}`,
    category: 'risk',
    valueFormatter: (val) => `$${val}`,
  },
  risk_per_trade_pct: {
    name: 'Risk Per Trade',
    description: (val) => `Risk ${val}% of account equity per trade`,
    category: 'risk',
    valueFormatter: (val) => `${val}%`,
  },
};

function formatStrategyType(type: string): string {
  const typeMap: Record<string, string> = {
    'vwap_bias': 'VWAP Bias',
    'mean_reversion': 'Mean Reversion',
    'orb_breakout': 'Opening Range Breakout',
    'microtrend_flow': 'Microtrend',
    'trend_follower': 'Trend Following',
    'session_hl_breakout': 'Session High/Low Breakout',
    'orderflow_imbalance': 'Order Flow Imbalance',
    'news_window': 'News Window',
  };
  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export interface TranslatedRule {
  key: string;
  name: string;
  description: string;
  category: 'entry' | 'exit' | 'risk' | 'time' | 'regime' | 'promotion';
  value: any;
  formattedValue: string;
  status: 'active' | 'inactive' | 'passing' | 'failing' | 'warning';
  isBoolean: boolean;
}

export function translateRules(
  strategyConfig: Record<string, any>,
  riskConfig: Record<string, any>,
  context?: RuleContext
): TranslatedRule[] {
  const rules: TranslatedRule[] = [];

  // Translate strategy rules
  for (const [key, value] of Object.entries(strategyConfig)) {
    const def = STRATEGY_RULES[key];
    if (!def) continue;

    rules.push({
      key,
      name: def.name,
      description: def.description(value, context),
      category: def.category,
      value,
      formattedValue: def.valueFormatter?.(value) ?? String(value),
      status: def.getStatus?.(value, context) ?? (value ? 'active' : 'inactive'),
      isBoolean: typeof value === 'boolean',
    });
  }

  // Translate risk rules
  for (const [key, value] of Object.entries(riskConfig)) {
    const def = RISK_RULES[key];
    if (!def) continue;

    rules.push({
      key,
      name: def.name,
      description: def.description(value, context),
      category: def.category,
      value,
      formattedValue: def.valueFormatter?.(value) ?? String(value),
      status: def.getStatus?.(value, context) ?? 'active',
      isBoolean: typeof value === 'boolean',
    });
  }

  return rules;
}

export interface PromotionRequirement {
  name: string;
  description: string;
  required: number | string;
  current: number | string | null;
  isPassing: boolean;
  percentage?: number;
}

export function getPromotionRequirements(
  stage: string,
  metrics: {
    totalTrades?: number;
    profitFactor?: number;
    winRate?: number;
    maxDrawdown?: number;
  }
): PromotionRequirement[] {
  const requirements: PromotionRequirement[] = [];
  
  if (stage === 'TRIALS') {
    const thresholds = PROMOTION_THRESHOLDS.LAB_TO_PAPER;
    
    requirements.push({
      name: 'Minimum Trades',
      description: 'Complete enough backtested trades for statistical validity',
      required: thresholds.min_trades,
      current: metrics.totalTrades ?? 0,
      isPassing: (metrics.totalTrades ?? 0) >= thresholds.min_trades,
      percentage: Math.min(100, ((metrics.totalTrades ?? 0) / thresholds.min_trades) * 100),
    });

    requirements.push({
      name: 'Profit Factor',
      description: 'Gross profit divided by gross loss (>1 = profitable)',
      required: thresholds.min_profit_factor,
      current: metrics.profitFactor ?? 0,
      isPassing: (metrics.profitFactor ?? 0) >= thresholds.min_profit_factor,
      percentage: Math.min(100, ((metrics.profitFactor ?? 0) / thresholds.min_profit_factor) * 100),
    });

    requirements.push({
      name: 'Win Rate',
      description: 'Percentage of winning trades',
      required: `${thresholds.min_win_rate}%`,
      current: metrics.winRate ? `${metrics.winRate.toFixed(1)}%` : '0%',
      isPassing: (metrics.winRate ?? 0) >= thresholds.min_win_rate,
      percentage: Math.min(100, ((metrics.winRate ?? 0) / thresholds.min_win_rate) * 100),
    });

    requirements.push({
      name: 'Max Drawdown',
      description: 'Maximum peak-to-trough decline',
      required: `$${thresholds.max_drawdown}`,
      current: metrics.maxDrawdown ? `$${metrics.maxDrawdown.toFixed(0)}` : '$0',
      isPassing: (metrics.maxDrawdown ?? 0) <= thresholds.max_drawdown,
      percentage: metrics.maxDrawdown ? Math.min(100, (1 - (metrics.maxDrawdown / thresholds.max_drawdown)) * 100 + 50) : 100,
    });
  }

  return requirements;
}

// Calculate Risk/Reward ratio
export function calculateRiskReward(stopTicks: number, targetTicks: number): string {
  if (!stopTicks || stopTicks === 0) return 'N/A';
  const ratio = targetTicks / stopTicks;
  return `1:${ratio.toFixed(1)}`;
}
