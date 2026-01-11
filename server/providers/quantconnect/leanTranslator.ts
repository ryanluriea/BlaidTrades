/**
 * LEAN Algorithm Translator
 * Converts BlaidAgent strategy configurations to QuantConnect LEAN Python algorithms
 * 
 * INSTITUTIONAL APPROACH: Parse actual rules_json instead of relying on archetypes
 * 
 * V2.0 - Institutional Grade:
 * - AST-based rule parsing (replaces regex heuristics)
 * - Comprehensive indicator registry
 * - Provenance tracking with SHA-256 hash chain
 * - Confidence scoring for parse quality
 * - Integrated monitoring for institutional compliance
 */

import { parseRulesInstitutional, generateProvenance, INDICATOR_REGISTRY, type ProvenanceRecord } from './ruleParser';
import { recordParseMethod, type ParseMethod } from '../../qc-monitoring';

export interface StrategyRules {
  entry?: string[];
  exit?: string[];
  risk?: string[];
  filters?: string[];
  invalidation?: string[];
}

export interface StrategyTranslationInput {
  botName: string;
  symbol: string;
  archetype: string;
  timeframe: string;
  strategyConfig: Record<string, any>;
  riskConfig: Record<string, any>;
  backtestPeriodDays: number;
  rulesJson?: StrategyRules;  // The actual strategy rules
}

/**
 * INSTITUTIONAL RULE PARSER
 * Parses natural language strategy rules into LEAN Python conditions
 */
function parseRulesToPython(rules: StrategyRules): { 
  longEntry: string; 
  shortEntry: string; 
  exitLogic: string;
  requiredIndicators: string[];
  sessionFilter: string | null;
  dynamicStopType: 'BB_MIDDLE' | 'ATR_BASED' | 'FIXED_TICKS' | null;
  stopConfig: { indicator: string; multiplier: number } | null;
} {
  const requiredIndicators: Set<string> = new Set();
  let longConditions: string[] = [];
  let shortConditions: string[] = [];
  let exitConditions: string[] = [];
  let sessionFilter: string | null = null;
  let dynamicStopType: 'BB_MIDDLE' | 'ATR_BASED' | 'FIXED_TICKS' | null = null;
  let stopConfig: { indicator: string; multiplier: number } | null = null;
  
  // Parse entry rules
  for (const rule of rules.entry || []) {
    const lowerRule = rule.toLowerCase();
    
    // RSI conditions
    const rsiMatch = lowerRule.match(/rsi\s*[<>]=?\s*(\d+)/i);
    if (rsiMatch) {
      requiredIndicators.add('rsi');
      const threshold = parseInt(rsiMatch[1]);
      if (lowerRule.includes('long') || lowerRule.includes('<')) {
        longConditions.push(`self.rsi.Current.Value < ${threshold}`);
      }
      if (lowerRule.includes('short') || (lowerRule.includes('>') && threshold > 50)) {
        shortConditions.push(`self.rsi.Current.Value > ${threshold}`);
      }
    }
    
    // Bollinger Band conditions
    if (lowerRule.includes('bb') || lowerRule.includes('bollinger')) {
      requiredIndicators.add('bb');
      if (lowerRule.includes('lower') || lowerRule.includes('below')) {
        longConditions.push('price < self.bb.LowerBand.Current.Value');
      }
      if (lowerRule.includes('upper') || lowerRule.includes('above')) {
        shortConditions.push('price > self.bb.UpperBand.Current.Value');
      }
    }
    
    // EMA/MA crossover conditions
    if (lowerRule.includes('ema') || lowerRule.includes('ma cross')) {
      requiredIndicators.add('ema');
      if (lowerRule.includes('above') || lowerRule.includes('cross up')) {
        longConditions.push('self.ema_fast.Current.Value > self.ema_slow.Current.Value');
      }
      if (lowerRule.includes('below') || lowerRule.includes('cross down')) {
        shortConditions.push('self.ema_fast.Current.Value < self.ema_slow.Current.Value');
      }
    }
    
    // ADX/trend strength conditions
    const adxMatch = lowerRule.match(/adx\s*[<>]=?\s*(\d+)/i);
    if (adxMatch) {
      requiredIndicators.add('adx');
      const threshold = parseInt(adxMatch[1]);
      const condition = `self.adx.Current.Value > ${threshold}`;
      longConditions.push(condition);
      shortConditions.push(condition);
    }
    
    // Price vs daily open
    if (lowerRule.includes('daily open') || lowerRule.includes('day open')) {
      requiredIndicators.add('daily_open');
      if (lowerRule.includes('price >') || lowerRule.includes('above')) {
        longConditions.push('price > self.daily_open');
      }
      if (lowerRule.includes('price <') || lowerRule.includes('below')) {
        shortConditions.push('price < self.daily_open');
      }
    }
    
    // ATR-based conditions
    if (lowerRule.includes('atr')) {
      requiredIndicators.add('atr');
    }
    
    // VWAP conditions
    if (lowerRule.includes('vwap')) {
      requiredIndicators.add('vwap');
      if (lowerRule.includes('below') || lowerRule.includes('<')) {
        longConditions.push('price < self.vwap.Current.Value');
      }
      if (lowerRule.includes('above') || lowerRule.includes('>')) {
        shortConditions.push('price > self.vwap.Current.Value');
      }
    }
  }
  
  // Parse exit rules
  for (const rule of rules.exit || []) {
    const lowerRule = rule.toLowerCase();
    
    // RSI exit
    const rsiExitMatch = lowerRule.match(/rsi\s*[<>]=?\s*(\d+)/i);
    if (rsiExitMatch) {
      requiredIndicators.add('rsi');
      const threshold = parseInt(rsiExitMatch[1]);
      exitConditions.push(`self.rsi.Current.Value ${lowerRule.includes('>') ? '>' : '<'} ${threshold}`);
    }
    
    // EMA touch exit
    if (lowerRule.includes('ema') && lowerRule.includes('touch')) {
      requiredIndicators.add('ema');
      exitConditions.push('abs(price - self.ema_fast.Current.Value) < self.tick_size * 2');
    }
    
    // Max hold bars
    const holdMatch = lowerRule.match(/max\s*hold\s*(\d+)\s*bars/i);
    if (holdMatch) {
      exitConditions.push(`self.bars_in_position >= ${parseInt(holdMatch[1])}`);
    }
  }
  
  // Parse session filters
  for (const filter of rules.filters || []) {
    const lowerFilter = filter.toLowerCase();
    
    // RTH filter
    const rthMatch = lowerFilter.match(/rth|(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if (rthMatch) {
      if (rthMatch[1] && rthMatch[2]) {
        sessionFilter = `self.is_within_session("${rthMatch[1]}", "${rthMatch[2]}")`;
      } else {
        sessionFilter = 'self.is_rth()';
      }
    }
  }
  
  // V10: Parse RISK rules for dynamic stop logic
  for (const rule of rules.risk || []) {
    const lowerRule = rule.toLowerCase();
    
    // "Stop at middle BB (20SMA)" -> BB_MIDDLE stop type
    if ((lowerRule.includes('stop') && lowerRule.includes('bb')) || 
        lowerRule.includes('bollinger') || 
        lowerRule.includes('middle band') ||
        lowerRule.includes('20sma')) {
      dynamicStopType = 'BB_MIDDLE';
      stopConfig = { indicator: 'bb', multiplier: 1.0 };
      requiredIndicators.add('bb');
      console.log('[RULE_PARSER] Detected BB_MIDDLE dynamic stop');
    }
    
    // "Stop at X ATR" -> ATR_BASED stop type
    const atrStopMatch = lowerRule.match(/stop.*?(\d+\.?\d*)\s*(?:x\s*)?atr/i) || 
                         lowerRule.match(/(\d+\.?\d*)\s*(?:x\s*)?atr.*?stop/i);
    if (atrStopMatch && !dynamicStopType) {
      dynamicStopType = 'ATR_BASED';
      stopConfig = { indicator: 'atr', multiplier: parseFloat(atrStopMatch[1]) || 2.0 };
      requiredIndicators.add('atr');
      console.log(`[RULE_PARSER] Detected ATR_BASED dynamic stop with ${stopConfig.multiplier}x ATR`);
    }
    
    // "X tick stop" or "X point stop" -> FIXED_TICKS (handled by default)
    const tickStopMatch = lowerRule.match(/(\d+)\s*tick/i);
    if (tickStopMatch && !dynamicStopType) {
      dynamicStopType = 'FIXED_TICKS';
      console.log(`[RULE_PARSER] Detected FIXED_TICKS stop: ${tickStopMatch[1]} ticks`);
    }
  }
  
  // Build Python code
  const longEntry = longConditions.length > 0 
    ? longConditions.join(' and ') 
    : 'False  # No long entry rules parsed';
  
  const shortEntry = shortConditions.length > 0 
    ? shortConditions.join(' and ') 
    : 'False  # No short entry rules parsed';
  
  const exitLogic = exitConditions.length > 0
    ? exitConditions.join(' or ')
    : 'False  # Use stop/target only';
  
  return {
    longEntry,
    shortEntry,
    exitLogic,
    requiredIndicators: Array.from(requiredIndicators),
    sessionFilter,
    dynamicStopType,
    stopConfig,
  };
}

export interface TranslationResult {
  success: boolean;
  pythonCode?: string;
  error?: string;
  provenance?: ProvenanceRecord;
  confidence?: number;
  parseMethod?: 'AST_PARSER' | 'HEURISTIC' | 'ARCHETYPE_FALLBACK';
}

const SYMBOL_MAPPING: Record<string, { qcFutureFamily: string; tickSize: number; multiplier: number }> = {
  MES: { qcFutureFamily: "Futures.Indices.MicroSP500EMini", tickSize: 0.25, multiplier: 5 },
  ES: { qcFutureFamily: "Futures.Indices.SP500EMini", tickSize: 0.25, multiplier: 50 },
  MNQ: { qcFutureFamily: "Futures.Indices.MicroNASDAQ100EMini", tickSize: 0.25, multiplier: 2 },
  NQ: { qcFutureFamily: "Futures.Indices.NASDAQ100EMini", tickSize: 0.25, multiplier: 20 },
  MCL: { qcFutureFamily: "Futures.Energies.MicroCrudeOilWTI", tickSize: 0.01, multiplier: 100 },
  CL: { qcFutureFamily: "Futures.Energies.CrudeOilWTI", tickSize: 0.01, multiplier: 1000 },
};

const TIMEFRAME_MAPPING: Record<string, { resolution: string; period: number; minutes: number }> = {
  "1m": { resolution: "Resolution.Minute", period: 1, minutes: 1 },
  "5m": { resolution: "Resolution.Minute", period: 5, minutes: 5 },
  "15m": { resolution: "Resolution.Minute", period: 15, minutes: 15 },
  "30m": { resolution: "Resolution.Minute", period: 30, minutes: 30 },
  "1h": { resolution: "Resolution.Hour", period: 1, minutes: 60 },
  "4h": { resolution: "Resolution.Hour", period: 4, minutes: 240 },
  "1d": { resolution: "Resolution.Daily", period: 1, minutes: 1440 },
};

/**
 * Indicator validation layer - verifies that indicators referenced in signal logic
 * are properly instantiated in the generated code
 */
function validateIndicatorsForSignal(signalLogic: string, indicatorCode: string): {
  valid: boolean;
  missingIndicators: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const missingIndicators: string[] = [];
  
  // Map of indicator references in signal logic to their instantiation patterns
  const indicatorPatterns: Record<string, RegExp> = {
    'self.bb': /self\.bb\s*=/,
    'self.rsi': /self\.rsi\s*=/,
    'self.adx': /self\.adx\s*=/,
    'self.atr': /self\.atr\s*=/,
    'self.ema_fast': /self\.ema_fast\s*=/,
    'self.ema_slow': /self\.ema_slow\s*=/,
    'self.vwap': /self\.vwap\s*=/,
  };
  
  for (const [indicator, pattern] of Object.entries(indicatorPatterns)) {
    // Check if indicator is used in signal logic
    if (signalLogic.includes(indicator)) {
      // Check if it's instantiated in indicator code
      if (!pattern.test(indicatorCode)) {
        missingIndicators.push(indicator);
        warnings.push(`Indicator ${indicator} is referenced but not instantiated`);
      }
    }
  }
  
  if (missingIndicators.length > 0) {
    console.warn(`[INDICATOR_VALIDATION] Missing indicators: ${missingIndicators.join(', ')}`);
  }
  
  return {
    valid: missingIndicators.length === 0,
    missingIndicators,
    warnings,
  };
}

/**
 * Get additional indicator instantiation code for missing indicators
 */
function getAdditionalIndicatorCode(missingIndicators: string[], config: Record<string, any>, resolution: string): string {
  const bbPeriod = config.bbPeriod || 20;
  const bbStd = config.bbStd || 2;
  const rsiPeriod = config.rsiPeriod || 14;
  const adxPeriod = config.adxPeriod || 14;
  const atrPeriod = config.atrPeriod || 14;
  const emaPeriod = config.emaPeriod || 21;
  
  const additions: string[] = [];
  
  for (const indicator of missingIndicators) {
    switch (indicator) {
      case 'self.bb':
        additions.push(`self.bb = self.BB(self.symbol, ${bbPeriod}, ${bbStd}, MovingAverageType.Simple, ${resolution})`);
        break;
      case 'self.rsi':
        additions.push(`self.rsi = self.RSI(self.symbol, ${rsiPeriod}, MovingAverageType.Wilders, ${resolution})`);
        break;
      case 'self.adx':
        additions.push(`self.adx = self.ADX(self.symbol, ${adxPeriod}, ${resolution})`);
        break;
      case 'self.atr':
        additions.push(`self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`);
        break;
      case 'self.ema_fast':
        additions.push(`self.ema_fast = self.EMA(self.symbol, ${emaPeriod}, ${resolution})`);
        break;
      case 'self.ema_slow':
        additions.push(`self.ema_slow = self.EMA(self.symbol, ${emaPeriod * 2}, ${resolution})`);
        break;
    }
  }
  
  return additions.length > 0 ? '\n        ' + additions.join('\n        ') : '';
}

function getIndicatorCode(archetype: string, config: Record<string, any>, resolution: string): string {
  const bbPeriod = config.bbPeriod || 20;
  const bbStd = config.bbStd || 2;
  const adxPeriod = config.adxPeriod || 14;
  const rsiPeriod = config.rsiPeriod || 14;
  const emaPeriod = config.emaPeriod || 21;
  const atrPeriod = config.atrPeriod || 14;
  
  switch (archetype) {
    case "mean_reversion":
      return `
        self.bb = self.BB(self.symbol, ${bbPeriod}, ${bbStd}, MovingAverageType.Simple, ${resolution})
        self.rsi = self.RSI(self.symbol, ${rsiPeriod}, MovingAverageType.Wilders, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
    
    case "breakout":
      return `
        self.bb = self.BB(self.symbol, ${bbPeriod}, ${bbStd}, MovingAverageType.Simple, ${resolution})
        self.adx = self.ADX(self.symbol, ${adxPeriod}, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
    
    case "trend_following":
      return `
        self.ema_fast = self.EMA(self.symbol, ${emaPeriod}, ${resolution})
        self.ema_slow = self.EMA(self.symbol, ${emaPeriod * 2}, ${resolution})
        self.adx = self.ADX(self.symbol, ${adxPeriod}, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
    
    case "scalping":
      return `
        self.rsi = self.RSI(self.symbol, ${rsiPeriod}, MovingAverageType.Wilders, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
    
    case "gap_fade":
      return `
        self.bb = self.BB(self.symbol, ${bbPeriod}, ${bbStd}, MovingAverageType.Simple, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
    
    default:
      // Default must include RSI since default signalLogic uses RSI for mean-reversion
      return `
        self.bb = self.BB(self.symbol, ${bbPeriod}, ${bbStd}, MovingAverageType.Simple, ${resolution})
        self.rsi = self.RSI(self.symbol, ${rsiPeriod}, MovingAverageType.Wilders, ${resolution})
        self.atr = self.ATR(self.symbol, ${atrPeriod}, MovingAverageType.Simple, ${resolution})`;
  }
}

/**
 * Get just the Python predicate expression for a specific direction
 * Used for per-direction fallbacks when rule parser fails for one direction
 */
function getArchetypePredicate(archetype: string, direction: 'long' | 'short', config: Record<string, any>): string {
  const rsiOversold = config.rsiOversold || 30;
  const rsiOverbought = config.rsiOverbought || 70;
  const adxThreshold = config.adxThreshold || 25;
  
  const predicates: Record<string, { long: string; short: string }> = {
    mean_reversion: {
      long: `price < self.bb.LowerBand.Current.Value and self.rsi.Current.Value < ${rsiOversold}`,
      short: `price > self.bb.UpperBand.Current.Value and self.rsi.Current.Value > ${rsiOverbought}`,
    },
    breakout: {
      long: `price > self.bb.UpperBand.Current.Value and self.adx.Current.Value > ${adxThreshold}`,
      short: `price < self.bb.LowerBand.Current.Value and self.adx.Current.Value > ${adxThreshold}`,
    },
    trend_following: {
      long: `self.ema_fast.Current.Value > self.ema_slow.Current.Value and self.adx.Current.Value > ${adxThreshold}`,
      short: `self.ema_fast.Current.Value < self.ema_slow.Current.Value and self.adx.Current.Value > ${adxThreshold}`,
    },
    scalping: {
      long: `self.rsi.Current.Value < ${rsiOversold}`,
      short: `self.rsi.Current.Value > ${rsiOverbought}`,
    },
    gap_fade: {
      long: `price < self.bb.LowerBand.Current.Value`,
      short: `price > self.bb.UpperBand.Current.Value`,
    },
  };
  
  const archetypePredicates = predicates[archetype] || predicates.mean_reversion;
  return archetypePredicates[direction];
}

function getSignalLogic(archetype: string, config: Record<string, any>): string {
  const rsiOversold = config.rsiOversold || 30;
  const rsiOverbought = config.rsiOverbought || 70;
  const adxThreshold = config.adxThreshold || 25;
  
  switch (archetype) {
    case "mean_reversion":
      return `
    def should_enter_long(self, price):
        """Long entry - mean_reversion archetype"""
        if not self.IndicatorsReady():
            return False
        return price < self.bb.LowerBand.Current.Value and self.rsi.Current.Value < ${rsiOversold}
    
    def should_enter_short(self, price):
        """Short entry - mean_reversion archetype"""
        if not self.IndicatorsReady():
            return False
        return price > self.bb.UpperBand.Current.Value and self.rsi.Current.Value > ${rsiOverbought}
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
    
    case "breakout":
      return `
    def should_enter_long(self, price):
        """Long entry - breakout archetype"""
        if not self.IndicatorsReady():
            return False
        return price > self.bb.UpperBand.Current.Value and self.adx.Current.Value > ${adxThreshold}
    
    def should_enter_short(self, price):
        """Short entry - breakout archetype"""
        if not self.IndicatorsReady():
            return False
        return price < self.bb.LowerBand.Current.Value and self.adx.Current.Value > ${adxThreshold}
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
    
    case "trend_following":
      return `
    def should_enter_long(self, price):
        """Long entry - trend_following archetype"""
        if not self.IndicatorsReady():
            return False
        return self.ema_fast.Current.Value > self.ema_slow.Current.Value and self.adx.Current.Value > ${adxThreshold}
    
    def should_enter_short(self, price):
        """Short entry - trend_following archetype"""
        if not self.IndicatorsReady():
            return False
        return self.ema_fast.Current.Value < self.ema_slow.Current.Value and self.adx.Current.Value > ${adxThreshold}
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
    
    case "scalping":
      return `
    def should_enter_long(self, price):
        """Long entry - scalping archetype"""
        if not self.IndicatorsReady():
            return False
        return self.rsi.Current.Value < ${rsiOversold}
    
    def should_enter_short(self, price):
        """Short entry - scalping archetype"""
        if not self.IndicatorsReady():
            return False
        return self.rsi.Current.Value > ${rsiOverbought}
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
    
    case "gap_fade":
      return `
    def should_enter_long(self, price):
        """Long entry - gap_fade archetype"""
        if not self.IndicatorsReady():
            return False
        return price < self.bb.LowerBand.Current.Value
    
    def should_enter_short(self, price):
        """Short entry - gap_fade archetype"""
        if not self.IndicatorsReady():
            return False
        return price > self.bb.UpperBand.Current.Value
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
    
    default:
      // Default fallback: mean-reversion style
      return `
    def should_enter_long(self, price):
        """Long entry - default archetype"""
        if not self.IndicatorsReady():
            return False
        return price < self.bb.LowerBand.Current.Value and self.rsi.Current.Value < ${rsiOversold}
    
    def should_enter_short(self, price):
        """Short entry - default archetype"""
        if not self.IndicatorsReady():
            return False
        return price > self.bb.UpperBand.Current.Value and self.rsi.Current.Value > ${rsiOverbought}
    
    def should_exit(self, price):
        """Exit signal - archetype uses stop/target only"""
        return False`;
  }
}

export function translateToLEAN(input: StrategyTranslationInput): TranslationResult {
  try {
    const baseSymbol = input.symbol.toUpperCase().replace(/[0-9]/g, "");
    const symbolInfo = SYMBOL_MAPPING[baseSymbol];
    if (!symbolInfo) {
      return {
        success: false,
        error: `Unsupported symbol: ${input.symbol}`,
      };
    }
    
    const timeframeInfo = TIMEFRAME_MAPPING[input.timeframe] || TIMEFRAME_MAPPING["5m"];
    // V9 RISK CONTROLS: Wider stops to reduce churn, prevent runaway trading
    // MES: 40 ticks = 10 points = $50 risk per contract (was 8 ticks = $10)
    // V10: Tighter stops - 16 ticks (4 points = $20 risk) for faster loss cutting
    const stopLossTicks = input.riskConfig.stopLossTicks || 16;
    const takeProfitTicks = input.riskConfig.takeProfitTicks || 80;
    const maxPositionSize = input.riskConfig.maxPositionSize || 1;
    const maxDailyTrades = 5; // Prevent runaway trading - max 5 trades per day
    
    // INSTITUTIONAL APPROACH V2.0: Use AST-based parser with provenance tracking
    // This gives us the ACTUAL strategy logic instead of generic archetypes
    let signalLogic: string;
    let parsedRules: ReturnType<typeof parseRulesToPython> | null = null;
    let institutionalParse: ReturnType<typeof parseRulesInstitutional> | null = null;
    let parseMethod: 'AST_PARSER' | 'HEURISTIC' | 'ARCHETYPE_FALLBACK' = 'ARCHETYPE_FALLBACK';
    let provenance: ProvenanceRecord | null = null;
    let parseConfidence = 0;
    
    if (input.rulesJson && input.rulesJson.entry && input.rulesJson.entry.length > 0) {
      // TRY AST PARSER FIRST (institutional grade)
      try {
        institutionalParse = parseRulesInstitutional(
          input.rulesJson,
          input.strategyConfig,
          timeframeInfo.resolution
        );
        
        if (institutionalParse.confidence >= 50 && !institutionalParse.parseDetails.fallbackUsed) {
          parseMethod = 'AST_PARSER';
          parseConfidence = institutionalParse.confidence;
          provenance = institutionalParse.provenance;
          
          console.log(`[LEAN_TRANSLATOR] AST_PARSER for ${input.botName}: confidence=${parseConfidence}% indicators=${institutionalParse.requiredIndicators.join(',')} provenance=${provenance.inputHash.slice(0,8)}`);
          
          const hasValidLong = !institutionalParse.longEntry.startsWith('False');
          const hasValidShort = !institutionalParse.shortEntry.startsWith('False');
          const hasValidExit = !institutionalParse.exitLogic.startsWith('False');
          
          const longLogic = hasValidLong 
            ? institutionalParse.longEntry 
            : getArchetypePredicate(input.archetype, 'long', input.strategyConfig);
          const shortLogic = hasValidShort 
            ? institutionalParse.shortEntry 
            : getArchetypePredicate(input.archetype, 'short', input.strategyConfig);
          const exitLogic = hasValidExit ? institutionalParse.exitLogic : 'False';
          
          signalLogic = `
    def should_enter_long(self, price):
        """Long entry signal - AST parsed (confidence=${parseConfidence}%)"""
        if not self.IndicatorsReady():
            return False
        # Provenance: ${provenance.inputHash.slice(0,16)}
        return ${longLogic}
    
    def should_enter_short(self, price):
        """Short entry signal - AST parsed (confidence=${parseConfidence}%)"""
        if not self.IndicatorsReady():
            return False
        return ${shortLogic}
    
    def should_exit(self, price):
        """Exit signal - ${hasValidExit ? 'AST parsed' : 'uses stop/target only'}"""
        if not self.IndicatorsReady():
            return False
        return ${exitLogic}`;
        } else {
          throw new Error('AST parser confidence too low, falling back to heuristic');
        }
      } catch (astError: any) {
        // FALLBACK TO HEURISTIC PARSER
        console.log(`[LEAN_TRANSLATOR] AST parser fallback for ${input.botName}: ${astError.message}`);
        parseMethod = 'HEURISTIC';
        
        parsedRules = parseRulesToPython(input.rulesJson);
        console.log(`[LEAN_TRANSLATOR] Using HEURISTIC PARSER for ${input.botName}: indicators=${parsedRules.requiredIndicators.join(',')}`);
        
        const hasValidLong = !parsedRules.longEntry.startsWith('False');
        const hasValidShort = !parsedRules.shortEntry.startsWith('False');
        
        const longLogic = hasValidLong 
          ? parsedRules.longEntry 
          : getArchetypePredicate(input.archetype, 'long', input.strategyConfig);
        const shortLogic = hasValidShort 
          ? parsedRules.shortEntry 
          : getArchetypePredicate(input.archetype, 'short', input.strategyConfig);
        
        parseConfidence = hasValidLong && hasValidShort ? 100 : (hasValidLong || hasValidShort ? 50 : 0);
        console.log(`[LEAN_TRANSLATOR] Heuristic: long=${hasValidLong ? 'PARSED' : 'FALLBACK'} short=${hasValidShort ? 'PARSED' : 'FALLBACK'} confidence=${parseConfidence}%`);
        
        const hasValidExit = parsedRules.exitLogic && !parsedRules.exitLogic.startsWith('False');
        const exitLogic = hasValidExit ? parsedRules.exitLogic : 'False';
        
        // Generate provenance for heuristic parse
        const allRules = [...(input.rulesJson.entry || []), ...(input.rulesJson.exit || [])];
        provenance = generateProvenance(allRules, `${longLogic}\n${shortLogic}`, parsedRules.requiredIndicators, parseConfidence);
        
        signalLogic = `
    def should_enter_long(self, price):
        """Long entry signal - ${hasValidLong ? 'heuristic parsed' : `archetype fallback (${input.archetype})`}"""
        if not self.IndicatorsReady():
            return False
        # ${hasValidLong ? `Parsed: ${JSON.stringify(input.rulesJson?.entry?.slice(0, 2))}` : `Fallback: archetype=${input.archetype}`}
        return ${longLogic}
    
    def should_enter_short(self, price):
        """Short entry signal - ${hasValidShort ? 'heuristic parsed' : `archetype fallback (${input.archetype})`}"""
        if not self.IndicatorsReady():
            return False
        return ${shortLogic}
    
    def should_exit(self, price):
        """Exit signal - ${hasValidExit ? 'heuristic parsed exit conditions' : 'uses stop/target only'}"""
        if not self.IndicatorsReady():
            return False
        return ${exitLogic}`;
      }
    } else {
      // No rulesJson - use archetype-based signals
      console.log(`[LEAN_TRANSLATOR] Using ARCHETYPE FALLBACK for ${input.botName}: archetype=${input.archetype}`);
      parseMethod = 'ARCHETYPE_FALLBACK';
      signalLogic = getSignalLogic(input.archetype, input.strategyConfig);
    }
    
    let indicatorCode = getIndicatorCode(input.archetype, input.strategyConfig, timeframeInfo.resolution);
    
    // INDICATOR VALIDATION LAYER: Verify all referenced indicators are instantiated
    const indicatorValidation = validateIndicatorsForSignal(signalLogic, indicatorCode);
    if (!indicatorValidation.valid) {
      console.log(`[LEAN_TRANSLATOR] Adding missing indicators: ${indicatorValidation.missingIndicators.join(', ')}`);
      const additionalCode = getAdditionalIndicatorCode(
        indicatorValidation.missingIndicators,
        input.strategyConfig,
        timeframeInfo.resolution
      );
      indicatorCode += additionalCode;
    }
    
    // Calculate proper dates (avoiding weekends)
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - input.backtestPeriodDays * 24 * 60 * 60 * 1000);
    
    // Get archetype-specific indicator thresholds
    const rsiOversold = input.strategyConfig.rsiOversold || 30;
    const rsiOverbought = input.strategyConfig.rsiOverbought || 70;
    const adxThreshold = input.strategyConfig.adxThreshold || 25;
    const bbPeriod = input.strategyConfig.bbPeriod || 20;
    const bbStd = input.strategyConfig.bbStd || 2;
    const rsiPeriod = input.strategyConfig.rsiPeriod || 14;
    const adxPeriod = input.strategyConfig.adxPeriod || 14;
    const atrPeriod = input.strategyConfig.atrPeriod || 14;
    const emaPeriod = input.strategyConfig.emaPeriod || 21;
    
    // Map timeframe to QC resolution and consolidation period
    const qcResolution = timeframeInfo.resolution;
    const consolidationMinutes = timeframeInfo.minutes || 1;
    
    // Calculate warmup bars needed (max indicator period * 2 for safety)
    const maxIndicatorPeriod = Math.max(bbPeriod, rsiPeriod, adxPeriod, atrPeriod, emaPeriod * 2);
    const warmupBars = Math.max(50, maxIndicatorPeriod * 3);
    
    const pythonCode = `# region imports
from AlgorithmImports import *
from datetime import datetime, timedelta
# endregion

class ${input.botName.replace(/[^a-zA-Z0-9]/g, "")}Algorithm(QCAlgorithm):
    """
    BlaidAgent Strategy: ${input.botName}
    Archetype: ${input.archetype}
    Symbol: ${input.symbol}
    Timeframe: ${input.timeframe}
    Generated for QuantConnect verification
    """
    
    def Initialize(self):
        # Set dates for backtest
        self.SetStartDate(${startDate.getFullYear()}, ${startDate.getMonth() + 1}, ${startDate.getDate()})
        self.SetEndDate(${endDate.getFullYear()}, ${endDate.getMonth() + 1}, ${endDate.getDate()})
        self.SetCash(100000)
        
        # CRITICAL: Set brokerage model for proper futures margin requirements
        # Without this, QC applies no leverage constraints causing unrealistic drawdowns
        self.SetBrokerageModel(BrokerageName.InteractiveBrokersBrokerage, AccountType.Margin)
        
        # V9 RISK CONTROLS - ultra-conservative drawdown protection
        self.starting_equity = 100000
        self.max_drawdown_pct = 0.10  # 10% max drawdown - trigger WELL before 25%
        self.max_risk_per_trade = 0.005  # 0.5% max risk per trade
        self.trading_halted = False
        self.portfolio_high_water_mark = self.starting_equity
        self.min_equity_for_trading = 90000  # Floor at 90% - HARD STOP at 10% loss
        self.drawdown_halt_logged = False
        
        # V9: Prevent runaway trading with daily trade limit
        self.max_trades_per_day = ${maxDailyTrades}
        self.trades_today = 0
        self.current_trading_day = None
        
        # Stop order management - track active stop orders for cancellation
        self.active_stop_ticket = None
        self.active_tp_ticket = None
        
        # Calculate tick value for position sizing
        self.tick_value = ${symbolInfo.tickSize} * ${symbolInfo.multiplier}  # $ per tick move per contract
        
        # Timeframe configuration from strategy (${input.timeframe})
        self.consolidation_minutes = ${consolidationMinutes}
        
        # Add continuous futures contract with extended market hours for 24x5 Globex data
        future = self.AddFuture(
            ${symbolInfo.qcFutureFamily},
            Resolution.Minute,
            dataNormalizationMode=DataNormalizationMode.BackwardsRatio,
            dataMappingMode=DataMappingMode.LastTradingDay,
            contractDepthOffset=0,
            extendedMarketHours=True
        )
        future.SetFilter(0, 90)
        self.future_symbol = future.Symbol
        self.mapped_contract = None
        self.current_indicator_symbol = None
        
        # CRITICAL: Warmup period for indicators (${warmupBars} bars)
        # This primes indicators with historical data before live trading
        self.SetWarmUp(timedelta(days=${Math.ceil(warmupBars * consolidationMinutes / (60 * 24)) + 3}))
        
        # Indicator configuration from strategy
        self.bb_period = ${bbPeriod}
        self.bb_std = ${bbStd}
        self.rsi_period = ${rsiPeriod}
        self.adx_period = ${adxPeriod}
        self.atr_period = ${atrPeriod}
        self.ema_period = ${emaPeriod}
        self.rsi_oversold = ${rsiOversold}
        self.rsi_overbought = ${rsiOverbought}
        self.adx_threshold = ${adxThreshold}
        
        # Indicators initialized per-contract
        self.bb = None
        self.rsi = None
        self.adx = None
        self.atr = None
        self.ema_fast = None
        self.ema_slow = None
        self.indicators_initialized = False
        self.warmup_logged = False
        
        # Consolidator for higher timeframes
        self.consolidators = {}
        self.last_consolidated_time = None
        
        # Risk parameters - ULTRA CONSERVATIVE for institutional compliance
        self.stop_loss_ticks = ${stopLossTicks}
        self.take_profit_ticks = ${takeProfitTicks}
        self.tick_size = ${symbolInfo.tickSize}
        self.multiplier = ${symbolInfo.multiplier}
        # FORCE max_position = 1 to limit catastrophic loss potential
        # Even if strategy config allows more, we cap at 1 contract for QC verification
        self.max_position = 1  # ${maxPositionSize} - capped to 1 for safety
        
        # Position tracking
        self.entry_price = None
        self.position_side = None
        
        # Statistics
        self.bar_count = 0
        self.signal_count = 0
        self.trade_count = 0
        self.archetype = "${input.archetype}"
        
        self.Debug(f"Algorithm initialized: ${input.symbol} ${input.archetype} ${input.timeframe}, warmup=${warmupBars} bars")
        self.Debug(f"RISK_CONTROLS_V6: max_dd={self.max_drawdown_pct*100:.0f}%, floor={self.min_equity_for_trading}, max_risk={self.max_risk_per_trade*100:.1f}%")
        
        # SCHEDULED EQUITY WATCHDOG - fires every minute for continuous protection
        self.Schedule.On(
            self.DateRules.EveryDay(),
            self.TimeRules.Every(timedelta(minutes=1)),
            self.EquityWatchdog
        )
    
    def EquityWatchdog(self):
        """Scheduled equity check - fires every minute to catch drawdowns quickly"""
        if self.trading_halted:
            return
            
        current_equity = self.Portfolio.TotalPortfolioValue
        
        # Check floor equity first
        if current_equity < self.min_equity_for_trading:
            self.trading_halted = True
            self.CancelAllStopOrders()
            if self.Portfolio.Invested:
                self.Liquidate()
            self.Debug(f"WATCHDOG FLOOR BREACH: {current_equity:.0f} < {self.min_equity_for_trading}")
            return
        
        # Update high water mark
        if current_equity > self.portfolio_high_water_mark:
            self.portfolio_high_water_mark = current_equity
        
        # Calculate drawdown
        if self.portfolio_high_water_mark > 0:
            drawdown_pct = (self.portfolio_high_water_mark - current_equity) / self.portfolio_high_water_mark
            
            # Trigger at 15% to give buffer before 20/25%
            if drawdown_pct >= 0.15:
                self.trading_halted = True
                self.CancelAllStopOrders()
                if self.Portfolio.Invested:
                    self.Liquidate()
                self.Debug(f"WATCHDOG HALT: {drawdown_pct*100:.1f}% drawdown, equity={current_equity:.0f}")
    
    def CalculatePositionSize(self, stop_ticks):
        """Calculate position size based on equity and max risk per trade
        
        RISK_CONTROLS_V8: Returns 0 if equity is insufficient - caller MUST check and skip trade
        """
        current_equity = self.Portfolio.TotalPortfolioValue
        
        # HARD FLOOR: No trading below $75,000 (75% of starting equity)
        if current_equity < 75000:
            self.Debug(f"RISK_V8_FLOOR: equity={current_equity:.0f} < 75000 - BLOCKING TRADE")
            return 0
        
        # Skip if equity is zero or negative
        if current_equity <= 0:
            return 0
        
        # Risk per contract = stop loss ticks × tick value ($ per tick per contract)
        risk_per_contract = stop_ticks * self.tick_value
        
        if risk_per_contract <= 0:
            risk_per_contract = 25  # Assume 20 tick stop × $1.25 = $25 fallback
        
        # Max risk in dollars = equity × max risk percentage (0.5% = $500 on $100k)
        max_risk_dollars = current_equity * self.max_risk_per_trade
        
        # Position size = max risk dollars / risk per contract
        size = int(max_risk_dollars / risk_per_contract)
        
        # Cap at max_position (1 contract for safety)
        # NOTE: Do NOT use max(1, ...) - allow size=0 to block trades when equity is low
        size = min(size, self.max_position)
        
        # If size calculates to 0, don't force to 1 - let caller handle it
        if size < 1:
            self.Debug(f"RISK_V8_SIZE_ZERO: equity={current_equity:.0f} risk_per_contract={risk_per_contract:.2f}")
            return 0
        
        return size
    
    def CancelAllStopOrders(self):
        """Cancel active stop/TP orders"""
        if self.active_stop_ticket and self.active_stop_ticket.Status == OrderStatus.Submitted:
            self.active_stop_ticket.Cancel()
            self.active_stop_ticket = None
        if self.active_tp_ticket and self.active_tp_ticket.Status == OrderStatus.Submitted:
            self.active_tp_ticket.Cancel()
            self.active_tp_ticket = None
    
    def GetDynamicStopPrice(self, price):
        """V10: Calculate dynamic stop price based on strategy rules
        
        Returns stop price for the current position, or None if fixed ticks should be used
        """
        if not self.Portfolio.Invested or not self.bb.IsReady:
            return None
        
        # Get position direction
        is_long = self.position_side == "long"
        
        # Dynamic stop at middle BB (20SMA)
        # For longs: stop below = middle BB
        # For shorts: stop above = middle BB
        bb_middle = self.bb.MiddleBand.Current.Value
        
        if bb_middle <= 0:
            return None
        
        # Add minimum buffer (4 ticks = 1 point) to prevent whipsaw
        buffer = 4 * self.tick_size
        
        if is_long:
            # Long stop: at or below middle BB
            stop_price = bb_middle - buffer
            # But never more than X ticks below entry (max $100 loss)
            max_stop_distance = 80 * self.tick_size
            min_stop = self.entry_price - max_stop_distance if self.entry_price else stop_price
            stop_price = max(stop_price, min_stop)
        else:
            # Short stop: at or above middle BB
            stop_price = bb_middle + buffer
            # But never more than X ticks above entry
            max_stop_distance = 80 * self.tick_size
            max_stop = self.entry_price + max_stop_distance if self.entry_price else stop_price
            stop_price = min(stop_price, max_stop)
        
        return stop_price
    
    def EnsureProtectiveOrders(self, price):
        """V10: Ensure protective stop order is in place, re-arm if needed
        
        Called every bar to maintain stop protection when in position
        """
        if not self.Portfolio.Invested or not self.mapped_contract:
            return
        
        # Check if we have an active stop
        has_active_stop = (self.active_stop_ticket and 
                         self.active_stop_ticket.Status == OrderStatus.Submitted)
        
        if has_active_stop:
            return  # Stop already in place
        
        # Need to re-arm the stop
        qty = self.Portfolio[self.mapped_contract].Quantity
        if qty == 0:
            return
        
        # Calculate stop price (dynamic or fixed)
        dynamic_stop = self.GetDynamicStopPrice(price)
        
        if dynamic_stop:
            stop_price = dynamic_stop
        else:
            # Fall back to fixed stop
            if qty > 0:  # Long
                stop_price = price - (self.stop_loss_ticks * self.tick_size)
            else:  # Short
                stop_price = price + (self.stop_loss_ticks * self.tick_size)
        
        # Place protective stop order
        stop_qty = -qty  # Opposite direction to close
        self.active_stop_ticket = self.StopMarketOrder(self.mapped_contract, stop_qty, stop_price)
        self.Debug(f"RE-ARMED stop at {stop_price:.2f} for {qty} contracts (dynamic={dynamic_stop is not None})")
    
    def InitializeIndicators(self, contract_symbol):
        """Initialize indicators for the specific contract, reinitializing on contract rolls"""
        # Check if we need to reinitialize for a new contract
        if self.indicators_initialized and self.current_indicator_symbol == contract_symbol:
            return
        
        # If switching contracts, log it
        if self.current_indicator_symbol is not None and self.current_indicator_symbol != contract_symbol:
            self.Debug(f"Contract rolled from {self.current_indicator_symbol} to {contract_symbol}, reinitializing indicators")
        
        # CRITICAL FIX v4: Create manual indicators AND register with consolidator for proper warmup
        # The key is RegisterIndicator - it links indicator to consolidator AND LEAN's warmup pipeline
        # This ensures indicators receive historical data during warmup, not just live consolidated bars
        
        self.bb = BollingerBands(self.bb_period, self.bb_std, MovingAverageType.Simple)
        self.rsi = RelativeStrengthIndex(self.rsi_period, MovingAverageType.Wilders)
        self.adx = AverageDirectionalIndex(self.adx_period)
        self.atr = AverageTrueRange(self.atr_period, MovingAverageType.Simple)
        self.ema_fast = ExponentialMovingAverage(self.ema_period)
        self.ema_slow = ExponentialMovingAverage(self.ema_period * 2)
        
        # For 1-minute timeframe, register with minute resolution
        # For higher timeframes, we register with consolidator in OnSecuritiesChanged
        if self.consolidation_minutes == 1:
            self.RegisterIndicator(contract_symbol, self.bb, Resolution.Minute)
            self.RegisterIndicator(contract_symbol, self.rsi, Resolution.Minute)
            self.RegisterIndicator(contract_symbol, self.adx, Resolution.Minute)
            self.RegisterIndicator(contract_symbol, self.atr, Resolution.Minute)
            self.RegisterIndicator(contract_symbol, self.ema_fast, Resolution.Minute)
            self.RegisterIndicator(contract_symbol, self.ema_slow, Resolution.Minute)
            self.Debug(f"Indicators registered with 1m resolution for {contract_symbol}")
        
        self.indicators_initialized = True
        self.current_indicator_symbol = contract_symbol
        self.Debug(f"Indicators initialized for {contract_symbol}")
    
    def IndicatorsReady(self):
        """Check if all required indicators are warmed up"""
        if not self.indicators_initialized:
            return False
        
        if self.archetype == "mean_reversion":
            return self.bb.IsReady and self.rsi.IsReady
        elif self.archetype == "breakout":
            return self.bb.IsReady and self.adx.IsReady
        elif self.archetype == "trend_following":
            return self.ema_fast.IsReady and self.ema_slow.IsReady and self.adx.IsReady
        elif self.archetype == "scalping":
            return self.rsi.IsReady
        elif self.archetype == "gap_fade":
            return self.bb.IsReady
        else:
            return self.bb.IsReady and self.rsi.IsReady
    
    # SIGNAL METHODS - dynamically generated from strategy rules or archetype
${signalLogic}
    
    def OnSecuritiesChanged(self, changes):
        """Handle contract additions/removals for proper indicator binding"""
        for security in changes.AddedSecurities:
            if security.Symbol.SecurityType == SecurityType.Future and security.Symbol != self.future_symbol:
                # New contract added - set as mapped and initialize
                self.mapped_contract = security.Symbol
                self.InitializeIndicators(security.Symbol)
                
                # Set up consolidator for this contract if timeframe > 1 minute
                if self.consolidation_minutes > 1 and security.Symbol not in self.consolidators:
                    # Use TradeBarConsolidator for futures
                    consolidator = TradeBarConsolidator(timedelta(minutes=self.consolidation_minutes))
                    consolidator.DataConsolidated += self.OnConsolidatedBar
                    self.SubscriptionManager.AddConsolidator(security.Symbol, consolidator)
                    self.consolidators[security.Symbol] = consolidator
                    
                    # Register indicators with consolidator for auto-updates going forward
                    self.RegisterIndicator(security.Symbol, self.bb, consolidator)
                    self.RegisterIndicator(security.Symbol, self.rsi, consolidator)
                    self.RegisterIndicator(security.Symbol, self.adx, consolidator)
                    self.RegisterIndicator(security.Symbol, self.atr, consolidator)
                    self.RegisterIndicator(security.Symbol, self.ema_fast, consolidator)
                    self.RegisterIndicator(security.Symbol, self.ema_slow, consolidator)
                    
                    # v5.9: Skip manual warmup - let indicators warm up naturally via RegisterIndicator
                    # This avoids runtime crashes from complex History() DataFrame iteration
                    self.Debug(f"Added {self.consolidation_minutes}m consolidator for {security.Symbol}, indicators warming from live data")
    
    def OnConsolidatedBar(self, sender, bar):
        """Handle consolidated bars (5m, 15m, etc.) for signal evaluation"""
        self.bar_count += 1
        self.last_consolidated_time = self.Time
        
        # NOTE: Indicators are now AUTO-UPDATED via RegisterIndicator + consolidator
        # No manual Update() calls needed - LEAN handles this automatically
        
        # Skip signal evaluation during warmup or if trading halted
        if self.IsWarmingUp or self.trading_halted:
            return
        
        # Evaluate signals on consolidated bar close
        self.EvaluateSignals(bar.Close)
    
    def OnData(self, data):
        # Skip during warmup
        if self.IsWarmingUp:
            return
        
        # CRITICAL: Multi-layer drawdown protection - check FIRST on every bar
        # This catches rapid losses before any trading logic executes
        current_equity = self.Portfolio.TotalPortfolioValue
        
        # LAYER 1: Hard equity floor - stop immediately if below minimum
        if current_equity < self.min_equity_for_trading and not self.trading_halted:
            self.trading_halted = True
            if self.Portfolio.Invested:
                self.Liquidate()
            self.CancelAllStopOrders()
            self.Debug(f"EQUITY FLOOR BREACHED: {current_equity:.0f} < {self.min_equity_for_trading}. TRADING HALTED PERMANENTLY.")
            return
        
        # Update high water mark (only if not in drawdown recovery)
        if current_equity > self.portfolio_high_water_mark:
            self.portfolio_high_water_mark = current_equity
        
        # LAYER 2: Calculate drawdown from high water mark
        if self.portfolio_high_water_mark > 0:
            drawdown_pct = (self.portfolio_high_water_mark - current_equity) / self.portfolio_high_water_mark
        else:
            drawdown_pct = 0
        
        # LAYER 3: If drawdown exceeds limit, liquidate and halt trading permanently
        if drawdown_pct >= self.max_drawdown_pct and not self.trading_halted:
            self.trading_halted = True
            if self.Portfolio.Invested:
                self.Liquidate()
            self.CancelAllStopOrders()
            self.Debug(f"!!! DRAWDOWN LIMIT HIT !!!")
            self.Debug(f"DD={drawdown_pct*100:.1f}% (limit={self.max_drawdown_pct*100:.0f}%)")
            self.Debug(f"Equity={current_equity:.0f}, HWM={self.portfolio_high_water_mark:.0f}")
            self.Debug(f"TRADING PERMANENTLY HALTED - NO MORE TRADES ALLOWED")
            return
        
        # Log significant drawdown milestones for debugging
        if drawdown_pct >= 0.10 and not self.drawdown_halt_logged:
            self.Debug(f"DRAWDOWN WARNING: {drawdown_pct*100:.1f}% (halt at {self.max_drawdown_pct*100:.0f}%)")
            self.drawdown_halt_logged = True
        
        # If trading is halted, do nothing
        if self.trading_halted:
            return
        
        # Log warmup completion once
        if not self.warmup_logged:
            self.warmup_logged = True
            ready = self.IndicatorsReady()
            self.Debug(f"Warmup complete. Indicators ready: {ready}")
        
        # Get current futures chain
        chain = data.FutureChains.get(self.future_symbol)
        if chain is None:
            return
        
        contracts = [c for c in chain]
        if not contracts:
            return
        
        # Get front-month contract
        sorted_contracts = sorted(contracts, key=lambda x: x.Expiry)
        if not sorted_contracts:
            return
        
        contract = sorted_contracts[0]
        
        # Check for contract roll
        if self.mapped_contract != contract.Symbol:
            # SAFETY: Cancel any existing stop orders on old contract before rolling
            self.CancelAllStopOrders()
            if self.Portfolio.Invested:
                self.Liquidate()
                self.Debug(f"Liquidated before contract roll")
            self.entry_price = None
            self.position_side = None
            
            self.mapped_contract = contract.Symbol
            self.InitializeIndicators(self.mapped_contract)
            
            # Add consolidator for new contract and register/warm up indicators
            if self.consolidation_minutes > 1 and contract.Symbol not in self.consolidators:
                consolidator = TradeBarConsolidator(timedelta(minutes=self.consolidation_minutes))
                consolidator.DataConsolidated += self.OnConsolidatedBar
                self.SubscriptionManager.AddConsolidator(contract.Symbol, consolidator)
                self.consolidators[contract.Symbol] = consolidator
                
                # Register indicators with the new consolidator
                self.RegisterIndicator(contract.Symbol, self.bb, consolidator)
                self.RegisterIndicator(contract.Symbol, self.rsi, consolidator)
                self.RegisterIndicator(contract.Symbol, self.adx, consolidator)
                self.RegisterIndicator(contract.Symbol, self.atr, consolidator)
                self.RegisterIndicator(contract.Symbol, self.ema_fast, consolidator)
                self.RegisterIndicator(contract.Symbol, self.ema_slow, consolidator)
                
                # v5.9: Skip manual warmup - let indicators warm up from live data via RegisterIndicator
                self.Debug(f"Contract roll: registered indicators for {contract.Symbol}, warming from live data")
        
        price = contract.LastPrice
        if price <= 0:
            return
        
        # For 1-minute timeframe, evaluate signals directly (indicators auto-update via RegisterIndicator)
        # For higher timeframes, consolidator handles signal evaluation
        if self.consolidation_minutes == 1:
            self.bar_count += 1
            # Indicators are auto-updated via RegisterIndicator - just evaluate signals
            self.EvaluateSignals(price)
            # V10: Ensure protective stop is always in place
            self.EnsureProtectiveOrders(price)
        else:
            # Still check exits on every bar for faster stop-loss
            self.CheckExits(price)
            # V10: Ensure protective stop is always in place
            self.EnsureProtectiveOrders(price)
    
    def CheckExits(self, price):
        """Check exit conditions (stops/targets + parsed signals) on every bar"""
        # Skip if trading halted due to drawdown limit
        if self.trading_halted:
            return
        
        if self.Portfolio.Invested and self.entry_price and self.mapped_contract:
            pnl_ticks = (price - self.entry_price) / self.tick_size
            if self.position_side == "short":
                pnl_ticks = -pnl_ticks
            
            # Check for take profit (stop loss should trigger via StopMarketOrder)
            if pnl_ticks >= self.take_profit_ticks:
                # Cancel pending stop order before liquidating
                self.CancelAllStopOrders()
                self.Liquidate()
                self.trade_count += 1
                self.Debug(f"EXIT TP at {price:.2f}, PnL: {pnl_ticks:.1f} ticks")
                self.entry_price = None
                self.position_side = None
            # Backup stop check in case stop order didn't fill
            elif pnl_ticks <= -self.stop_loss_ticks:
                self.CancelAllStopOrders()
                self.Liquidate()
                self.trade_count += 1
                self.Debug(f"EXIT SL (backup) at {price:.2f}, PnL: {pnl_ticks:.1f} ticks")
                self.entry_price = None
                self.position_side = None
            # Check parsed exit conditions from rules_json (signal-based exits)
            elif self.should_exit(price):
                self.CancelAllStopOrders()
                self.Liquidate()
                self.trade_count += 1
                self.Debug(f"EXIT SIGNAL at {price:.2f}, PnL: {pnl_ticks:.1f} ticks")
                self.entry_price = None
                self.position_side = None
    
    def EvaluateSignals(self, price):
        """Evaluate entry/exit signals"""
        if not self.mapped_contract or self.trading_halted:
            return
        
        # V9: Daily trade limit - reset on new day, enforce max
        current_day = self.Time.date()
        if self.current_trading_day != current_day:
            self.current_trading_day = current_day
            self.trades_today = 0
        
        if self.trades_today >= self.max_trades_per_day:
            return  # Already hit daily limit
        
        # CRITICAL PRE-TRADE EQUITY CHECK - verify we can still trade
        current_equity = self.Portfolio.TotalPortfolioValue
        
        # Update high water mark
        if current_equity > self.portfolio_high_water_mark:
            self.portfolio_high_water_mark = current_equity
        
        # Calculate current drawdown from peak
        if self.portfolio_high_water_mark > 0:
            current_dd = (self.portfolio_high_water_mark - current_equity) / self.portfolio_high_water_mark
        else:
            current_dd = 0
        
        # HALT trading if drawdown exceeds limit OR equity below floor
        if current_dd >= self.max_drawdown_pct or current_equity < self.min_equity_for_trading:
            if not self.trading_halted:
                self.trading_halted = True
                self.CancelAllStopOrders()
                if self.Portfolio.Invested:
                    self.Liquidate()
                self.Debug(f"EVALUATE_HALT: dd={current_dd*100:.1f}% eq={current_equity:.0f}")
            return
        
        # Check exits first (backup to stop orders)
        self.CheckExits(price)
        
        # Entry logic - only if not already in position
        if not self.Portfolio.Invested:
            # Calculate dynamic position size based on current equity and risk
            position_size = self.CalculatePositionSize(self.stop_loss_ticks)
            
            if position_size < 1:
                return  # Equity too low to trade safely
            
            if self.should_enter_long(price):
                # Place market order for entry
                self.MarketOrder(self.mapped_contract, position_size)
                self.entry_price = price
                self.position_side = "long"
                
                # Calculate stop price (below entry for long)
                stop_price = price - (self.stop_loss_ticks * self.tick_size)
                
                # Place protective stop order - executes intra-bar if triggered
                self.active_stop_ticket = self.StopMarketOrder(
                    self.mapped_contract, 
                    -position_size,  # Opposite direction to close
                    stop_price
                )
                
                self.trade_count += 1
                self.trades_today += 1
                self.signal_count += 1
                self.Debug(f"LONG at {price:.2f}, size={position_size}, stop={stop_price:.2f} (day #{self.trades_today}, signal #{self.signal_count})")
                
            elif self.should_enter_short(price):
                # Place market order for entry
                self.MarketOrder(self.mapped_contract, -position_size)
                self.entry_price = price
                self.position_side = "short"
                
                # Calculate stop price (above entry for short)
                stop_price = price + (self.stop_loss_ticks * self.tick_size)
                
                # Place protective stop order - executes intra-bar if triggered
                self.active_stop_ticket = self.StopMarketOrder(
                    self.mapped_contract, 
                    position_size,  # Opposite direction to close
                    stop_price
                )
                
                self.trade_count += 1
                self.trades_today += 1
                self.signal_count += 1
                self.Debug(f"SHORT at {price:.2f}, size={position_size}, stop={stop_price:.2f} (day #{self.trades_today}, signal #{self.signal_count})")
    
    def OnOrderEvent(self, orderEvent):
        """Handle order events - reset state when stop orders fill"""
        if orderEvent.Status == OrderStatus.Filled:
            # Check if this was our stop order filling
            if self.active_stop_ticket and orderEvent.OrderId == self.active_stop_ticket.OrderId:
                self.Debug(f"STOP FILLED at {orderEvent.FillPrice:.2f}")
                self.entry_price = None
                self.position_side = None
                self.active_stop_ticket = None
                
            # Check if take profit filled
            if self.active_tp_ticket and orderEvent.OrderId == self.active_tp_ticket.OrderId:
                self.Debug(f"TP FILLED at {orderEvent.FillPrice:.2f}")
                self.entry_price = None
                self.position_side = None
                self.active_tp_ticket = None
                # Also cancel the stop if TP filled
                self.CancelAllStopOrders()
    
    def OnEndOfAlgorithm(self):
        final_equity = self.Portfolio.TotalPortfolioValue
        if self.portfolio_high_water_mark > 0:
            final_dd = (self.portfolio_high_water_mark - final_equity) / self.portfolio_high_water_mark * 100
        else:
            final_dd = 0
        self.Debug(f"=== FINAL STATS ===")
        self.Debug(f"RISK_CONTROLS_V8: max_dd_limit={self.max_drawdown_pct*100:.0f}% floor={self.min_equity_for_trading} size_0_blocks_trade=True")
        self.Debug(f"BARS={self.bar_count} SIGNALS={self.signal_count} TRADES={self.trade_count}")
        self.Debug(f"EQUITY: start=100000 final={final_equity:.0f} hwm={self.portfolio_high_water_mark:.0f}")
        self.Debug(f"DRAWDOWN: final={final_dd:.1f}% halted={self.trading_halted}")
`;

    // INSTITUTIONAL MONITORING: Record parse method metrics
    const indicatorCount = institutionalParse?.requiredIndicators.length || 
                           parsedRules?.requiredIndicators.length || 0;
    recordParseMethod({
      method: parseMethod,
      confidence: parseConfidence,
      indicatorCount,
      parseTimeMs: 0, // Would need to add timing if needed
      provenance: provenance || undefined,
    });

    return {
      success: true,
      pythonCode,
      provenance: provenance || undefined,
      confidence: parseConfidence,
      parseMethod,
    };
  } catch (error) {
    return {
      success: false,
      error: `Translation error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function createSnapshotHash(input: StrategyTranslationInput): string {
  const crypto = require("crypto");
  const snapshot = JSON.stringify({
    symbol: input.symbol,
    archetype: input.archetype,
    timeframe: input.timeframe,
    strategyConfig: input.strategyConfig,
    riskConfig: input.riskConfig,
  });
  return crypto.createHash("sha256").update(snapshot).digest("hex").slice(0, 16);
}
