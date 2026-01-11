/**
 * INSTITUTIONAL AST-BASED RULE PARSER
 * 
 * Structured parser for strategy rules with:
 * - Token lexer for accurate parsing
 * - Comprehensive indicator registry
 * - Confidence scoring
 * - Provenance tracking (hash of input → output)
 * 
 * Replaces heuristic regex parsing with proper AST traversal
 */

import crypto from 'crypto';

// ============================================================================
// TOKEN TYPES & LEXER
// ============================================================================

export type TokenType = 
  | 'INDICATOR'      // RSI, EMA, BB, MACD, ADX, ATR, VWAP, SMA
  | 'COMPARISON'     // <, >, <=, >=, ==, crosses_above, crosses_below
  | 'LOGICAL'        // and, or, not
  | 'NUMBER'         // 30, 70, 1.5
  | 'DIRECTION'      // long, short, buy, sell
  | 'PROPERTY'       // upper, lower, middle, fast, slow, value, signal
  | 'PRICE'          // price, close, open, high, low
  | 'SESSION'        // RTH, ETH, pre-market, after-hours
  | 'TIME'           // 09:30, 16:00
  | 'IDENTIFIER'     // generic identifier
  | 'LPAREN'         // (
  | 'RPAREN'         // )
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// ============================================================================
// INDICATOR REGISTRY - Comprehensive coverage of all TA indicators
// ============================================================================

export interface IndicatorDef {
  name: string;
  qcClass: string;                    // QuantConnect class name
  defaultPeriod: number;
  pythonRef: string;                  // How to reference in Python
  properties: string[];               // Available properties (upper, lower, signal, etc.)
  category: 'momentum' | 'trend' | 'volatility' | 'volume' | 'price';
}

export const INDICATOR_REGISTRY: Record<string, IndicatorDef> = {
  rsi: {
    name: 'Relative Strength Index',
    qcClass: 'RelativeStrengthIndex',
    defaultPeriod: 14,
    pythonRef: 'self.rsi',
    properties: ['value'],
    category: 'momentum',
  },
  macd: {
    name: 'MACD',
    qcClass: 'MovingAverageConvergenceDivergence',
    defaultPeriod: 12,
    pythonRef: 'self.macd',
    properties: ['value', 'signal', 'histogram', 'fast', 'slow'],
    category: 'momentum',
  },
  bb: {
    name: 'Bollinger Bands',
    qcClass: 'BollingerBands',
    defaultPeriod: 20,
    pythonRef: 'self.bb',
    properties: ['upper', 'lower', 'middle', 'bandwidth', 'percentb'],
    category: 'volatility',
  },
  ema: {
    name: 'Exponential Moving Average',
    qcClass: 'ExponentialMovingAverage',
    defaultPeriod: 21,
    pythonRef: 'self.ema',
    properties: ['value'],
    category: 'trend',
  },
  sma: {
    name: 'Simple Moving Average',
    qcClass: 'SimpleMovingAverage',
    defaultPeriod: 20,
    pythonRef: 'self.sma',
    properties: ['value'],
    category: 'trend',
  },
  adx: {
    name: 'Average Directional Index',
    qcClass: 'AverageDirectionalIndex',
    defaultPeriod: 14,
    pythonRef: 'self.adx',
    properties: ['value', 'positive_di', 'negative_di'],
    category: 'trend',
  },
  atr: {
    name: 'Average True Range',
    qcClass: 'AverageTrueRange',
    defaultPeriod: 14,
    pythonRef: 'self.atr',
    properties: ['value'],
    category: 'volatility',
  },
  vwap: {
    name: 'Volume Weighted Average Price',
    qcClass: 'VolumeWeightedAveragePrice',
    defaultPeriod: 1,
    pythonRef: 'self.vwap',
    properties: ['value'],
    category: 'volume',
  },
  stoch: {
    name: 'Stochastic Oscillator',
    qcClass: 'Stochastic',
    defaultPeriod: 14,
    pythonRef: 'self.stoch',
    properties: ['k', 'd', 'value'],
    category: 'momentum',
  },
  cci: {
    name: 'Commodity Channel Index',
    qcClass: 'CommodityChannelIndex',
    defaultPeriod: 20,
    pythonRef: 'self.cci',
    properties: ['value'],
    category: 'momentum',
  },
  mfi: {
    name: 'Money Flow Index',
    qcClass: 'MoneyFlowIndex',
    defaultPeriod: 14,
    pythonRef: 'self.mfi',
    properties: ['value'],
    category: 'volume',
  },
  obv: {
    name: 'On Balance Volume',
    qcClass: 'OnBalanceVolume',
    defaultPeriod: 1,
    pythonRef: 'self.obv',
    properties: ['value'],
    category: 'volume',
  },
  roc: {
    name: 'Rate of Change',
    qcClass: 'RateOfChange',
    defaultPeriod: 12,
    pythonRef: 'self.roc',
    properties: ['value'],
    category: 'momentum',
  },
  williams: {
    name: 'Williams %R',
    qcClass: 'WilliamsPercentR',
    defaultPeriod: 14,
    pythonRef: 'self.williams_r',
    properties: ['value'],
    category: 'momentum',
  },
  keltner: {
    name: 'Keltner Channels',
    qcClass: 'KeltnerChannels',
    defaultPeriod: 20,
    pythonRef: 'self.keltner',
    properties: ['upper', 'lower', 'middle'],
    category: 'volatility',
  },
  donchian: {
    name: 'Donchian Channels',
    qcClass: 'DonchianChannel',
    defaultPeriod: 20,
    pythonRef: 'self.donchian',
    properties: ['upper', 'lower', 'middle'],
    category: 'volatility',
  },
  ichimoku: {
    name: 'Ichimoku Cloud',
    qcClass: 'IchimokuCloud',
    defaultPeriod: 9,
    pythonRef: 'self.ichimoku',
    properties: ['tenkan', 'kijun', 'senkou_a', 'senkou_b', 'chikou'],
    category: 'trend',
  },
  psar: {
    name: 'Parabolic SAR',
    qcClass: 'ParabolicStopAndReverse',
    defaultPeriod: 1,
    pythonRef: 'self.psar',
    properties: ['value'],
    category: 'trend',
  },
  supertrend: {
    name: 'SuperTrend',
    qcClass: 'SuperTrend',
    defaultPeriod: 10,
    pythonRef: 'self.supertrend',
    properties: ['value', 'direction'],
    category: 'trend',
  },
};

// ============================================================================
// AST NODE TYPES
// ============================================================================

export type ASTNodeType = 
  | 'CONDITION'           // indicator < 30
  | 'CROSSOVER'           // price crosses_above ema
  | 'COMPARISON'          // RSI > 70
  | 'LOGICAL_AND'         // condition and condition
  | 'LOGICAL_OR'          // condition or condition
  | 'LOGICAL_NOT'         // not condition
  | 'INDICATOR_REF'       // self.rsi.Current.Value
  | 'PRICE_REF'           // price
  | 'NUMBER_LITERAL'      // 30
  | 'SESSION_FILTER';     // is_rth()

export interface ASTNode {
  type: ASTNodeType;
  children?: ASTNode[];
  value?: string | number;
  indicator?: string;
  property?: string;
  operator?: string;
  direction?: 'long' | 'short' | 'both';
}

// ============================================================================
// LEXER - Tokenize rule strings
// ============================================================================

const INDICATOR_KEYWORDS = Object.keys(INDICATOR_REGISTRY);
const COMPARISON_OPS = ['<', '>', '<=', '>=', '==', '!=', 'crosses_above', 'crosses_below', 'above', 'below'];
const LOGICAL_OPS = ['and', 'or', 'not', '&&', '||', '!'];
const DIRECTION_KEYWORDS = ['long', 'short', 'buy', 'sell'];
const PROPERTY_KEYWORDS = ['upper', 'lower', 'middle', 'fast', 'slow', 'value', 'signal', 'k', 'd', 'histogram'];
const PRICE_KEYWORDS = ['price', 'close', 'open', 'high', 'low'];
const SESSION_KEYWORDS = ['rth', 'eth', 'pre-market', 'after-hours', 'premarket', 'afterhours'];

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const text = input.toLowerCase().trim();
  
  while (pos < text.length) {
    // Skip whitespace
    if (/\s/.test(text[pos])) {
      pos++;
      continue;
    }
    
    // Parentheses
    if (text[pos] === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: pos });
      pos++;
      continue;
    }
    if (text[pos] === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: pos });
      pos++;
      continue;
    }
    
    // Numbers (including decimals)
    const numMatch = text.slice(pos).match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      tokens.push({ type: 'NUMBER', value: numMatch[0], position: pos });
      pos += numMatch[0].length;
      continue;
    }
    
    // Time patterns (HH:MM)
    const timeMatch = text.slice(pos).match(/^\d{1,2}:\d{2}/);
    if (timeMatch) {
      tokens.push({ type: 'TIME', value: timeMatch[0], position: pos });
      pos += timeMatch[0].length;
      continue;
    }
    
    // Comparison operators (multi-char first)
    const compMatch = text.slice(pos).match(/^(crosses_above|crosses_below|<=|>=|==|!=|<|>)/);
    if (compMatch) {
      tokens.push({ type: 'COMPARISON', value: compMatch[0], position: pos });
      pos += compMatch[0].length;
      continue;
    }
    
    // Words (identifiers, keywords)
    const wordMatch = text.slice(pos).match(/^[a-z_][a-z0-9_-]*/i);
    if (wordMatch) {
      const word = wordMatch[0].toLowerCase();
      let tokenType: TokenType = 'IDENTIFIER';
      
      if (INDICATOR_KEYWORDS.includes(word)) {
        tokenType = 'INDICATOR';
      } else if (LOGICAL_OPS.includes(word)) {
        tokenType = 'LOGICAL';
      } else if (DIRECTION_KEYWORDS.includes(word)) {
        tokenType = 'DIRECTION';
      } else if (PROPERTY_KEYWORDS.includes(word)) {
        tokenType = 'PROPERTY';
      } else if (PRICE_KEYWORDS.includes(word)) {
        tokenType = 'PRICE';
      } else if (SESSION_KEYWORDS.includes(word)) {
        tokenType = 'SESSION';
      } else if (word === 'above' || word === 'below') {
        tokenType = 'COMPARISON';
      }
      
      tokens.push({ type: tokenType, value: word, position: pos });
      pos += word.length;
      continue;
    }
    
    // Skip unknown characters
    pos++;
  }
  
  tokens.push({ type: 'EOF', value: '', position: pos });
  return tokens;
}

// ============================================================================
// PARSER - Build AST from tokens
// ============================================================================

export interface ParseResult {
  success: boolean;
  ast?: ASTNode;
  error?: string;
  indicators: string[];
  confidence: number;
  parseDetails: {
    tokensFound: number;
    indicatorsDetected: string[];
    conditionsBuilt: number;
    fallbackUsed: boolean;
  };
}

export function parseRuleToAST(ruleText: string): ParseResult {
  const tokens = tokenize(ruleText);
  const indicators: Set<string> = new Set();
  let conditionsBuilt = 0;
  let fallbackUsed = false;
  
  const parseDetails = {
    tokensFound: tokens.length - 1, // Exclude EOF
    indicatorsDetected: [] as string[],
    conditionsBuilt: 0,
    fallbackUsed: false,
  };
  
  try {
    // Simple condition parsing: look for patterns like "indicator comparison number"
    let currentIndex = 0;
    const conditions: ASTNode[] = [];
    let currentDirection: 'long' | 'short' | 'both' = 'both';
    
    while (currentIndex < tokens.length && tokens[currentIndex].type !== 'EOF') {
      const token = tokens[currentIndex];
      
      // Track direction hints
      if (token.type === 'DIRECTION') {
        if (token.value === 'long' || token.value === 'buy') {
          currentDirection = 'long';
        } else if (token.value === 'short' || token.value === 'sell') {
          currentDirection = 'short';
        }
        currentIndex++;
        continue;
      }
      
      // Parse indicator conditions
      if (token.type === 'INDICATOR') {
        const indicator = token.value;
        indicators.add(indicator);
        parseDetails.indicatorsDetected.push(indicator);
        
        // Look for property (optional)
        let property = 'value';
        if (currentIndex + 1 < tokens.length && tokens[currentIndex + 1].type === 'PROPERTY') {
          property = tokens[currentIndex + 1].value;
          currentIndex++;
        }
        
        // Look for comparison operator
        if (currentIndex + 1 < tokens.length && tokens[currentIndex + 1].type === 'COMPARISON') {
          const operator = tokens[currentIndex + 1].value;
          currentIndex++;
          
          // Look for number or price reference
          if (currentIndex + 1 < tokens.length) {
            const rightToken = tokens[currentIndex + 1];
            if (rightToken.type === 'NUMBER') {
              conditions.push({
                type: 'COMPARISON',
                indicator,
                property,
                operator: normalizeOperator(operator),
                value: parseFloat(rightToken.value),
                direction: currentDirection,
              });
              conditionsBuilt++;
              currentIndex++;
            } else if (rightToken.type === 'PRICE') {
              conditions.push({
                type: 'COMPARISON',
                indicator,
                property,
                operator: normalizeOperator(operator),
                value: rightToken.value,
                direction: currentDirection,
              });
              conditionsBuilt++;
              currentIndex++;
            }
          }
        }
        
        currentIndex++;
        continue;
      }
      
      // Parse price conditions (price < indicator)
      if (token.type === 'PRICE') {
        if (currentIndex + 1 < tokens.length && tokens[currentIndex + 1].type === 'COMPARISON') {
          const operator = tokens[currentIndex + 1].value;
          currentIndex++;
          
          if (currentIndex + 1 < tokens.length) {
            const rightToken = tokens[currentIndex + 1];
            if (rightToken.type === 'INDICATOR') {
              indicators.add(rightToken.value);
              parseDetails.indicatorsDetected.push(rightToken.value);
              
              let property = 'value';
              if (currentIndex + 2 < tokens.length && tokens[currentIndex + 2].type === 'PROPERTY') {
                property = tokens[currentIndex + 2].value;
                currentIndex++;
              }
              
              conditions.push({
                type: 'COMPARISON',
                indicator: rightToken.value,
                property,
                operator: invertOperator(normalizeOperator(operator)),
                value: 'price',
                direction: currentDirection,
              });
              conditionsBuilt++;
              currentIndex++;
            } else if (rightToken.type === 'NUMBER') {
              conditions.push({
                type: 'COMPARISON',
                indicator: 'price',
                property: 'value',
                operator: normalizeOperator(operator),
                value: parseFloat(rightToken.value),
                direction: currentDirection,
              });
              conditionsBuilt++;
              currentIndex++;
            }
          }
        }
        currentIndex++;
        continue;
      }
      
      currentIndex++;
    }
    
    // Build final AST
    if (conditions.length === 0) {
      fallbackUsed = true;
      parseDetails.fallbackUsed = true;
      return {
        success: false,
        error: 'No valid conditions parsed from rule',
        indicators: Array.from(indicators),
        confidence: 0,
        parseDetails,
      };
    }
    
    // Combine conditions with AND
    const rootNode: ASTNode = conditions.length === 1 
      ? conditions[0]
      : { type: 'LOGICAL_AND', children: conditions };
    
    parseDetails.conditionsBuilt = conditionsBuilt;
    
    // Calculate confidence based on parsing success
    const confidence = Math.min(100, Math.round(
      (conditionsBuilt / Math.max(1, parseDetails.tokensFound / 4)) * 100
    ));
    
    return {
      success: true,
      ast: rootNode,
      indicators: Array.from(indicators),
      confidence,
      parseDetails,
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      indicators: Array.from(indicators),
      confidence: 0,
      parseDetails: { ...parseDetails, fallbackUsed: true },
    };
  }
}

function normalizeOperator(op: string): string {
  switch (op) {
    case 'above': return '>';
    case 'below': return '<';
    case 'crosses_above': return 'CROSSES_ABOVE';
    case 'crosses_below': return 'CROSSES_BELOW';
    default: return op;
  }
}

function invertOperator(op: string): string {
  switch (op) {
    case '>': return '<';
    case '<': return '>';
    case '>=': return '<=';
    case '<=': return '>=';
    case 'CROSSES_ABOVE': return 'CROSSES_BELOW';
    case 'CROSSES_BELOW': return 'CROSSES_ABOVE';
    default: return op;
  }
}

// ============================================================================
// CODE GENERATOR - AST to Python
// ============================================================================

export function astToPython(ast: ASTNode, config: Record<string, any> = {}): string {
  switch (ast.type) {
    case 'COMPARISON':
      return generateComparison(ast, config);
    case 'LOGICAL_AND':
      return ast.children?.map(c => astToPython(c, config)).join(' and ') || 'False';
    case 'LOGICAL_OR':
      return ast.children?.map(c => astToPython(c, config)).join(' or ') || 'False';
    case 'LOGICAL_NOT':
      return `not (${ast.children?.[0] ? astToPython(ast.children[0], config) : 'False'})`;
    default:
      return 'False';
  }
}

function generateComparison(node: ASTNode, config: Record<string, any>): string {
  const indicator = node.indicator || '';
  const property = node.property || 'value';
  const operator = node.operator || '>';
  const value = node.value;
  
  // Get Python reference for indicator
  const indicatorDef = INDICATOR_REGISTRY[indicator];
  if (!indicatorDef && indicator !== 'price') {
    return 'False  # Unknown indicator';
  }
  
  // Build left side (indicator reference)
  let leftSide = '';
  if (indicator === 'price') {
    leftSide = 'price';
  } else {
    leftSide = getIndicatorPythonRef(indicator, property);
  }
  
  // Build right side
  let rightSide = '';
  if (typeof value === 'number') {
    rightSide = value.toString();
  } else if (value === 'price') {
    rightSide = 'price';
  } else if (typeof value === 'string' && INDICATOR_REGISTRY[value]) {
    rightSide = getIndicatorPythonRef(value, 'value');
  } else {
    rightSide = String(value);
  }
  
  // Handle crossover operators
  if (operator === 'CROSSES_ABOVE') {
    return `${leftSide} > ${rightSide} and self._prev_${indicator}_value < ${rightSide}`;
  }
  if (operator === 'CROSSES_BELOW') {
    return `${leftSide} < ${rightSide} and self._prev_${indicator}_value > ${rightSide}`;
  }
  
  return `${leftSide} ${operator} ${rightSide}`;
}

function getIndicatorPythonRef(indicator: string, property: string): string {
  const def = INDICATOR_REGISTRY[indicator];
  if (!def) return `self.${indicator}.Current.Value`;
  
  const baseRef = def.pythonRef;
  
  switch (indicator) {
    case 'bb':
      if (property === 'upper') return `${baseRef}.UpperBand.Current.Value`;
      if (property === 'lower') return `${baseRef}.LowerBand.Current.Value`;
      if (property === 'middle') return `${baseRef}.MiddleBand.Current.Value`;
      return `${baseRef}.MiddleBand.Current.Value`;
    case 'macd':
      if (property === 'signal') return `${baseRef}.Signal.Current.Value`;
      if (property === 'histogram') return `${baseRef}.Histogram.Current.Value`;
      return `${baseRef}.Current.Value`;
    case 'stoch':
      if (property === 'k') return `${baseRef}.StochK.Current.Value`;
      if (property === 'd') return `${baseRef}.StochD.Current.Value`;
      return `${baseRef}.StochK.Current.Value`;
    case 'adx':
      if (property === 'positive_di') return `${baseRef}.PositiveDirectionalIndex.Current.Value`;
      if (property === 'negative_di') return `${baseRef}.NegativeDirectionalIndex.Current.Value`;
      return `${baseRef}.Current.Value`;
    default:
      return `${baseRef}.Current.Value`;
  }
}

// ============================================================================
// INDICATOR CODE GENERATOR
// ============================================================================

export function generateIndicatorInstantiation(
  indicators: string[], 
  config: Record<string, any>,
  resolution: string
): string {
  const lines: string[] = [];
  
  for (const indicator of indicators) {
    const def = INDICATOR_REGISTRY[indicator];
    if (!def) continue;
    
    const period = config[`${indicator}Period`] || def.defaultPeriod;
    
    switch (indicator) {
      case 'rsi':
        lines.push(`        self.rsi = self.RSI(self.symbol, ${period}, MovingAverageType.Wilders, ${resolution})`);
        break;
      case 'bb':
        const bbStd = config.bbStd || 2;
        lines.push(`        self.bb = self.BB(self.symbol, ${period}, ${bbStd}, MovingAverageType.Simple, ${resolution})`);
        break;
      case 'ema':
        lines.push(`        self.ema = self.EMA(self.symbol, ${period}, ${resolution})`);
        lines.push(`        self.ema_fast = self.EMA(self.symbol, ${config.emaFastPeriod || 8}, ${resolution})`);
        lines.push(`        self.ema_slow = self.EMA(self.symbol, ${config.emaSlowPeriod || 21}, ${resolution})`);
        break;
      case 'sma':
        lines.push(`        self.sma = self.SMA(self.symbol, ${period}, ${resolution})`);
        break;
      case 'adx':
        lines.push(`        self.adx = self.ADX(self.symbol, ${period}, ${resolution})`);
        break;
      case 'atr':
        lines.push(`        self.atr = self.ATR(self.symbol, ${period}, MovingAverageType.Wilders, ${resolution})`);
        break;
      case 'vwap':
        lines.push(`        self.vwap = self.VWAP(self.symbol)`);
        break;
      case 'macd':
        const fast = config.macdFast || 12;
        const slow = config.macdSlow || 26;
        const signal = config.macdSignal || 9;
        lines.push(`        self.macd = self.MACD(self.symbol, ${fast}, ${slow}, ${signal}, MovingAverageType.Exponential, ${resolution})`);
        break;
      case 'stoch':
        const kPeriod = config.stochK || 14;
        const dPeriod = config.stochD || 3;
        lines.push(`        self.stoch = self.STO(self.symbol, ${kPeriod}, ${dPeriod}, ${dPeriod})`);
        break;
      case 'cci':
        lines.push(`        self.cci = self.CCI(self.symbol, ${period}, MovingAverageType.Simple, ${resolution})`);
        break;
      case 'mfi':
        lines.push(`        self.mfi = self.MFI(self.symbol, ${period})`);
        break;
      case 'roc':
        lines.push(`        self.roc = self.ROC(self.symbol, ${period}, ${resolution})`);
        break;
      case 'williams':
        lines.push(`        self.williams_r = self.WILR(self.symbol, ${period}, ${resolution})`);
        break;
      case 'psar':
        const afStart = config.psarAfStart || 0.02;
        const afMax = config.psarAfMax || 0.2;
        lines.push(`        self.psar = self.PSAR(self.symbol, ${afStart}, 0.02, ${afMax})`);
        break;
      case 'keltner':
        const atrMult = config.keltnerAtrMult || 2;
        lines.push(`        self.keltner = self.KCH(self.symbol, ${period}, ${atrMult}, MovingAverageType.Exponential, ${resolution})`);
        break;
      case 'donchian':
        lines.push(`        self.donchian = self.DCH(self.symbol, ${period})`);
        break;
    }
  }
  
  return lines.join('\n');
}

// ============================================================================
// PROVENANCE TRACKING - Hash chain for audit
// ============================================================================

export interface ProvenanceRecord {
  inputHash: string;          // SHA-256 of input rules
  outputHash: string;         // SHA-256 of generated code
  timestamp: string;
  version: string;
  indicators: string[];
  confidence: number;
}

export function generateProvenance(
  inputRules: string[],
  generatedCode: string,
  indicators: string[],
  confidence: number
): ProvenanceRecord {
  const inputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(inputRules))
    .digest('hex');
    
  const outputHash = crypto
    .createHash('sha256')
    .update(generatedCode)
    .digest('hex');
    
  return {
    inputHash,
    outputHash,
    timestamp: new Date().toISOString(),
    version: '2.0.0-institutional',
    indicators,
    confidence,
  };
}

// ============================================================================
// MAIN PARSING INTERFACE
// ============================================================================

export interface InstitutionalParseResult {
  longEntry: string;
  shortEntry: string;
  exitLogic: string;
  requiredIndicators: string[];
  indicatorCode: string;
  confidence: number;
  provenance: ProvenanceRecord;
  parseDetails: {
    longConditions: number;
    shortConditions: number;
    exitConditions: number;
    fallbackUsed: boolean;
  };
}

export function parseRulesInstitutional(
  rules: { entry?: string[]; exit?: string[]; risk?: string[]; filters?: string[] },
  config: Record<string, any> = {},
  resolution: string = 'Resolution.Minute'
): InstitutionalParseResult {
  const allIndicators: Set<string> = new Set();
  let longConditions: string[] = [];
  let shortConditions: string[] = [];
  let exitConditions: string[] = [];
  let totalConfidence = 0;
  let conditionCount = 0;
  let fallbackUsed = false;
  
  // Parse entry rules
  for (const rule of rules.entry || []) {
    const result = parseRuleToAST(rule);
    if (result.success && result.ast) {
      result.indicators.forEach(i => allIndicators.add(i));
      
      const pythonCode = astToPython(result.ast, config);
      
      // Determine direction
      const direction = result.ast.direction || 'both';
      if (direction === 'long' || direction === 'both') {
        longConditions.push(pythonCode);
      }
      if (direction === 'short' || direction === 'both') {
        // For short, we might need to invert some conditions
        shortConditions.push(pythonCode);
      }
      
      totalConfidence += result.confidence;
      conditionCount++;
    } else {
      fallbackUsed = true;
    }
  }
  
  // Parse exit rules
  for (const rule of rules.exit || []) {
    const result = parseRuleToAST(rule);
    if (result.success && result.ast) {
      result.indicators.forEach(i => allIndicators.add(i));
      exitConditions.push(astToPython(result.ast, config));
      totalConfidence += result.confidence;
      conditionCount++;
    }
  }
  
  // Build final Python expressions
  const longEntry = longConditions.length > 0 
    ? longConditions.join(' and ') 
    : 'False  # No long conditions parsed';
  
  const shortEntry = shortConditions.length > 0 
    ? shortConditions.join(' and ') 
    : 'False  # No short conditions parsed';
  
  const exitLogic = exitConditions.length > 0
    ? exitConditions.join(' or ')
    : 'False  # Use stop/target only';
  
  const indicators = Array.from(allIndicators);
  const indicatorCode = generateIndicatorInstantiation(indicators, config, resolution);
  
  const avgConfidence = conditionCount > 0 ? Math.round(totalConfidence / conditionCount) : 0;
  
  // Generate provenance
  const allRules = [...(rules.entry || []), ...(rules.exit || [])];
  const generatedCode = `${longEntry}\n${shortEntry}\n${exitLogic}`;
  const provenance = generateProvenance(allRules, generatedCode, indicators, avgConfidence);
  
  return {
    longEntry,
    shortEntry,
    exitLogic,
    requiredIndicators: indicators,
    indicatorCode,
    confidence: avgConfidence,
    provenance,
    parseDetails: {
      longConditions: longConditions.length,
      shortConditions: shortConditions.length,
      exitConditions: exitConditions.length,
      fallbackUsed,
    },
  };
}
