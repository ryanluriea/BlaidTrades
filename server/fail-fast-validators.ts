/**
 * INSTITUTIONAL FAIL-FAST VALIDATORS
 * 
 * SEV-0 REQUIREMENT: All critical fields must be validated at creation time.
 * No silent defaults allowed. If validation fails, REJECT the data - do not save with fallbacks.
 * 
 * Pattern: "Fail closed, investigate fast" - halt on invalid data rather than continue incorrectly.
 */

import { inferArchetypeFromName, type StrategyArchetype } from "@shared/strategy-types";

// ============ ALERTING INFRASTRUCTURE ============

/**
 * Send a fail-fast alert to Discord and console
 * Non-blocking - failures logged but don't break the validation flow
 */
async function sendFailFastAlert(alertType: "VARIANCE" | "FALLBACK" | "CRITICAL", title: string, details: string): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { sendDiscord } = await import("./providers/notify/discordWebhook");
    
    await sendDiscord({
      channel: "system_health",
      message: `[FAIL-FAST ${alertType}] ${title}\n\n${details}`,
      severity: alertType === "CRITICAL" ? "ERROR" : "WARNING",
    });
  } catch (err) {
    console.error(`[FAIL_FAST_ALERT] Failed to send Discord alert: ${err}`);
  }
}

// ============ CONFIGURATION HELPERS ============

/**
 * Default max contracts per trade by stage
 * Can be overridden via environment variables: MAX_CONTRACTS_TRIALS, MAX_CONTRACTS_PAPER, etc.
 */
const DEFAULT_MAX_CONTRACTS: Record<string, number> = {
  TRIALS: 10,
  PAPER: 20,
  SHADOW: 30,
  CANARY: 50,
  LIVE: 100,
};

/**
 * Get max contracts limit for a given stage with env var override support
 * Validates parsed value to avoid NaN issues
 */
export function getMaxContractsLimit(stage?: string | null): number {
  const defaultLimit = 50;
  const stageKey = stage?.toUpperCase() || "";
  
  // Try environment variable override first
  const envKey = `MAX_CONTRACTS_${stageKey}`;
  const envValue = process.env[envKey];
  
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    } else {
      console.warn(`[FAIL_FAST_CONFIG] Invalid ${envKey}="${envValue}" (must be positive integer), using default`);
    }
  }
  
  // Fall back to stage default
  return DEFAULT_MAX_CONTRACTS[stageKey] || defaultLimit;
}

// ============ VALIDATION RESULT TYPES ============

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  field: string;
  message: string;
  severity: "SEV-0" | "SEV-1" | "SEV-2";
}

export interface ValidationWarning {
  code: string;
  field: string;
  message: string;
}

// ============ RISK PARAMETER VALIDATION (SEV-0) ============

export interface RiskConfig {
  stopLossTicks?: number;
  takeProfitTicks?: number;
  maxPositionSize?: number;
  maxDailyTrades?: number;
  maxDrawdownPercent?: number;
  riskPerTradePercent?: number;
}

export interface RiskValidationInput {
  riskConfig: RiskConfig | null | undefined;
  riskTier?: "conservative" | "moderate" | "aggressive" | null;
  maxContractsPerTrade?: number | null;
  maxContractsPerSymbol?: number | null;
  stage?: string;
  traceId?: string;
}

/**
 * SEV-0: Validate risk parameters before bot/candidate creation
 * FAIL-CLOSED: Returns errors if critical risk parameters are missing
 */
export function validateRiskConfig(input: RiskValidationInput): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  const { riskConfig, riskTier, maxContractsPerTrade, maxContractsPerSymbol, stage, traceId } = input;
  
  // SEV-0: riskConfig cannot be null/undefined or empty
  if (!riskConfig || Object.keys(riskConfig).length === 0) {
    errors.push({
      code: "RISK_CONFIG_MISSING",
      field: "riskConfig",
      message: "Risk configuration is required. Cannot create bot/candidate without risk parameters.",
      severity: "SEV-0",
    });
  } else {
    // SEV-0: stopLossTicks must be defined and positive
    if (!riskConfig.stopLossTicks || riskConfig.stopLossTicks <= 0) {
      errors.push({
        code: "STOP_LOSS_MISSING",
        field: "riskConfig.stopLossTicks",
        message: "Stop loss ticks must be defined and positive. Cannot trade without stop loss protection.",
        severity: "SEV-0",
      });
    }
    
    // SEV-0: maxPositionSize must be defined and within safe bounds
    if (!riskConfig.maxPositionSize || riskConfig.maxPositionSize <= 0) {
      errors.push({
        code: "MAX_POSITION_SIZE_MISSING",
        field: "riskConfig.maxPositionSize",
        message: "Maximum position size must be defined. Cannot trade with unlimited position sizes.",
        severity: "SEV-0",
      });
    } else if (riskConfig.maxPositionSize > 100) {
      errors.push({
        code: "MAX_POSITION_SIZE_EXCESSIVE",
        field: "riskConfig.maxPositionSize",
        message: `Maximum position size of ${riskConfig.maxPositionSize} exceeds safe limit of 100 contracts.`,
        severity: "SEV-0",
      });
    }
    
    // SEV-1: takeProfitTicks should be defined
    if (!riskConfig.takeProfitTicks || riskConfig.takeProfitTicks <= 0) {
      warnings.push({
        code: "TAKE_PROFIT_MISSING",
        field: "riskConfig.takeProfitTicks",
        message: "Take profit ticks not defined. Strategy will rely only on exit signals.",
      });
    }
    
    // SEV-1: maxDrawdownPercent should be defined for PAPER+ stages
    if (stage && ["PAPER", "SHADOW", "CANARY", "LIVE"].includes(stage)) {
      if (!riskConfig.maxDrawdownPercent || riskConfig.maxDrawdownPercent <= 0) {
        errors.push({
          code: "DRAWDOWN_LIMIT_MISSING",
          field: "riskConfig.maxDrawdownPercent",
          message: `Maximum drawdown percent must be defined for ${stage} stage bots.`,
          severity: "SEV-1",
        });
      }
    }
  }
  
  // SEV-0: maxContractsPerTrade must be defined for ALL stages
  // Even TRIALS bots need position limits to prevent unlimited leverage during backtests
  if (!maxContractsPerTrade || maxContractsPerTrade <= 0) {
    errors.push({
      code: "MAX_CONTRACTS_PER_TRADE_MISSING",
      field: "maxContractsPerTrade",
      message: `Max contracts per trade must be defined. Cannot trade without position limits.`,
      severity: "SEV-0",
    });
  } else {
    // Stage-based max contract limits (configurable for institutional accounts)
    // Default limits can be overridden via environment variables
    const stageLimit = getMaxContractsLimit(stage);
    
    if (maxContractsPerTrade > stageLimit) {
      errors.push({
        code: "MAX_CONTRACTS_PER_TRADE_EXCESSIVE",
        field: "maxContractsPerTrade",
        message: `Max contracts per trade of ${maxContractsPerTrade} exceeds ${stage || 'default'} stage limit of ${stageLimit}. Configure MAX_CONTRACTS_${stage || 'DEFAULT'} env var to override.`,
        severity: "SEV-0",
      });
    }
  }
  
  // SEV-1: maxContractsPerSymbol should be defined for PAPER+ stages
  if (stage && ["PAPER", "SHADOW", "CANARY", "LIVE"].includes(stage)) {
    if (!maxContractsPerSymbol || maxContractsPerSymbol <= 0) {
      errors.push({
        code: "MAX_CONTRACTS_PER_SYMBOL_MISSING",
        field: "maxContractsPerSymbol",
        message: `Max contracts per symbol must be defined for ${stage} stage.`,
        severity: "SEV-1",
      });
    }
  }
  
  // SEV-2: riskTier should be explicitly set
  if (!riskTier) {
    warnings.push({
      code: "RISK_TIER_DEFAULT",
      field: "riskTier",
      message: "Risk tier not explicitly set. Will use 'moderate' default.",
    });
  }
  
  // Log validation result
  if (traceId) {
    if (errors.length > 0) {
      console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} RISK_VALIDATION_FAILED errors=${errors.length} first_error=${errors[0].code}`);
    } else {
      console.log(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} RISK_VALIDATION_PASSED warnings=${warnings.length}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============ ARCHETYPE VALIDATION (SEV-1) ============

export interface ArchetypeValidationInput {
  archetypeName?: string | null;
  archetypeId?: string | null;
  strategyName: string;
  rulesJson?: Record<string, unknown> | null;
  traceId?: string;
}

/**
 * SEV-1: Validate archetype before strategy candidate creation
 * FAIL-CLOSED: Returns error if no valid archetype can be determined
 */
export function validateArchetype(input: ArchetypeValidationInput): ValidationResult & { inferredArchetype?: StrategyArchetype } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let inferredArchetype: StrategyArchetype | undefined;
  
  const { archetypeName, archetypeId, strategyName, rulesJson, traceId } = input;
  
  // Check explicit archetype first
  if (archetypeName) {
    // Archetype explicitly provided - validate it's a known type
    const normalized = inferArchetypeFromName(archetypeName);
    if (normalized) {
      inferredArchetype = normalized;
    } else {
      errors.push({
        code: "ARCHETYPE_INVALID",
        field: "archetypeName",
        message: `Archetype '${archetypeName}' is not a recognized strategy type.`,
        severity: "SEV-1",
      });
    }
  } else if (rulesJson && (rulesJson as Record<string, unknown>).archetype) {
    // Check rulesJson for archetype
    const rulesArchetype = (rulesJson as Record<string, unknown>).archetype as string;
    const normalized = inferArchetypeFromName(rulesArchetype);
    if (normalized) {
      inferredArchetype = normalized;
      warnings.push({
        code: "ARCHETYPE_FROM_RULES",
        field: "rulesJson.archetype",
        message: `Using archetype '${normalized}' from rulesJson.`,
      });
    }
  }
  
  // If still no archetype, try to infer from strategy name
  if (!inferredArchetype && strategyName) {
    const inferred = inferArchetypeFromName(strategyName, traceId);
    if (inferred) {
      inferredArchetype = inferred;
      warnings.push({
        code: "ARCHETYPE_INFERRED",
        field: "strategyName",
        message: `Inferred archetype '${inferred}' from strategy name '${strategyName}'.`,
      });
    }
  }
  
  // FAIL-CLOSED: If no archetype could be determined, reject
  if (!inferredArchetype) {
    errors.push({
      code: "ARCHETYPE_UNDETERMINABLE",
      field: "archetypeName",
      message: `Cannot determine archetype for strategy '${strategyName}'. Provide explicit archetypeName or use a strategy name that matches a known archetype pattern.`,
      severity: "SEV-1",
    });
  }
  
  // Log validation result
  if (traceId) {
    if (errors.length > 0) {
      console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} ARCHETYPE_VALIDATION_FAILED strategy="${strategyName}" error=${errors[0].code}`);
    } else {
      console.log(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} ARCHETYPE_VALIDATION_PASSED strategy="${strategyName}" archetype=${inferredArchetype}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inferredArchetype,
  };
}

// ============ PROMOTION GATE VALIDATION (SEV-0) ============

export interface PromotionGateMetrics {
  sharpeRatio?: number | null;
  maxDrawdownPercent?: number | null;
  winRate?: number | null;
  totalTrades?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
}

export interface PromotionValidationInput {
  metrics: PromotionGateMetrics;
  fromStage: string;
  toStage: string;
  botId: string;
  traceId?: string;
}

/**
 * SEV-0: Validate promotion gate metrics before any stage promotion
 * HARD STOP: Block promotion if critical metrics are NULL or invalid
 */
export function validatePromotionGate(input: PromotionValidationInput): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  const { metrics, fromStage, toStage, botId, traceId } = input;
  
  // SEV-0: Critical metrics must be non-null for any promotion
  if (metrics.sharpeRatio === null || metrics.sharpeRatio === undefined) {
    errors.push({
      code: "SHARPE_RATIO_NULL",
      field: "metrics.sharpeRatio",
      message: `Cannot promote bot ${botId.slice(0, 8)} from ${fromStage} to ${toStage}: Sharpe ratio is NULL. Run backtests first.`,
      severity: "SEV-0",
    });
  }
  
  if (metrics.maxDrawdownPercent === null || metrics.maxDrawdownPercent === undefined) {
    errors.push({
      code: "MAX_DRAWDOWN_NULL",
      field: "metrics.maxDrawdownPercent",
      message: `Cannot promote bot ${botId.slice(0, 8)} from ${fromStage} to ${toStage}: Max drawdown is NULL. Run backtests first.`,
      severity: "SEV-0",
    });
  }
  
  if (metrics.winRate === null || metrics.winRate === undefined) {
    errors.push({
      code: "WIN_RATE_NULL",
      field: "metrics.winRate",
      message: `Cannot promote bot ${botId.slice(0, 8)} from ${fromStage} to ${toStage}: Win rate is NULL. Run backtests first.`,
      severity: "SEV-0",
    });
  }
  
  // SEV-0: Total trades must be non-NULL (even if 0 - that's still a valid check)
  if (metrics.totalTrades === null || metrics.totalTrades === undefined) {
    errors.push({
      code: "TOTAL_TRADES_NULL",
      field: "metrics.totalTrades",
      message: `Cannot promote bot ${botId.slice(0, 8)} from ${fromStage} to ${toStage}: Total trades is NULL. Run backtests first.`,
      severity: "SEV-0",
    });
  } else if (metrics.totalTrades < 10) {
    errors.push({
      code: "INSUFFICIENT_TRADES",
      field: "metrics.totalTrades",
      message: `Cannot promote bot ${botId.slice(0, 8)}: Only ${metrics.totalTrades} trades. Minimum 10 required for statistical significance.`,
      severity: "SEV-0",
    });
  }
  
  // SEV-0: Profit factor must be non-NULL for any promotion
  if (metrics.profitFactor === null || metrics.profitFactor === undefined) {
    errors.push({
      code: "PROFIT_FACTOR_NULL",
      field: "metrics.profitFactor",
      message: `Cannot promote bot ${botId.slice(0, 8)} from ${fromStage} to ${toStage}: Profit factor is NULL. Run backtests first.`,
      severity: "SEV-0",
    });
  }
  
  // SEV-2: Expectancy should be tracked but is not universally available yet
  // Downgraded to warning for ALL stages since legacy data may not have expectancy
  // When expectancy tracking matures, this can be upgraded to SEV-1 blocker for CANARY+
  if (metrics.expectancy === null || metrics.expectancy === undefined) {
    warnings.push({
      code: "EXPECTANCY_NULL",
      field: "metrics.expectancy",
      message: `Bot ${botId.slice(0, 8)} has NULL expectancy - recommend running backtests to compute this metric before ${toStage} stage.`,
      severity: "SEV-2",
    });
  }
  
  // SEV-0: Stricter requirements for LIVE promotion
  if (toStage === "LIVE") {
    if (metrics.totalTrades !== null && metrics.totalTrades !== undefined && metrics.totalTrades < 50) {
      errors.push({
        code: "INSUFFICIENT_TRADES_FOR_LIVE",
        field: "metrics.totalTrades",
        message: `Cannot promote to LIVE: Only ${metrics.totalTrades} trades. Minimum 50 required for LIVE promotion.`,
        severity: "SEV-0",
      });
    }
  }
  
  // Log validation result
  if (traceId) {
    if (errors.length > 0) {
      console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} PROMOTION_GATE_BLOCKED bot=${botId.slice(0, 8)} ${fromStage}→${toStage} errors=${errors.length} first=${errors[0].code}`);
    } else {
      console.log(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} PROMOTION_GATE_PASSED bot=${botId.slice(0, 8)} ${fromStage}→${toStage}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============ SYMBOL VALIDATION ============

const SUPPORTED_SYMBOLS = ["MES", "MNQ", "ES", "NQ", "YM", "MYM", "RTY", "M2K", "CL", "GC"] as const;
export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number];

export function validateSymbol(symbol: string | null | undefined, traceId?: string): ValidationResult & { normalizedSymbol?: SupportedSymbol } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let normalizedSymbol: SupportedSymbol | undefined;
  
  if (!symbol) {
    errors.push({
      code: "SYMBOL_MISSING",
      field: "symbol",
      message: "Symbol is required. Cannot create bot without specifying trading instrument.",
      severity: "SEV-1",
    });
  } else {
    const upper = symbol.toUpperCase().replace(/[0-9]/g, "") as SupportedSymbol;
    if (SUPPORTED_SYMBOLS.includes(upper)) {
      normalizedSymbol = upper;
    } else {
      errors.push({
        code: "SYMBOL_UNSUPPORTED",
        field: "symbol",
        message: `Symbol '${symbol}' is not supported. Valid symbols: ${SUPPORTED_SYMBOLS.join(", ")}`,
        severity: "SEV-1",
      });
    }
  }
  
  if (traceId && errors.length > 0) {
    console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} SYMBOL_VALIDATION_FAILED symbol="${symbol}" error=${errors[0].code}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedSymbol,
  };
}

// ============ AGGREGATE VALIDATION FOR BOT CREATION ============

export interface BotCreationInput {
  name: string;
  symbol?: string | null;
  archetypeName?: string | null;
  riskConfig?: RiskConfig | null;
  strategyConfig?: Record<string, unknown> | null;
  stage?: string;
  riskTier?: "conservative" | "moderate" | "aggressive" | null;
  maxContractsPerTrade?: number | null;
  traceId?: string;
}

/**
 * Comprehensive validation for bot creation
 * Aggregates all validators and returns combined result
 */
export function validateBotCreation(input: BotCreationInput): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  const { name, symbol, archetypeName, riskConfig, stage, riskTier, maxContractsPerTrade, traceId } = input;
  
  // Validate name
  if (!name || name.trim().length === 0) {
    errors.push({
      code: "BOT_NAME_MISSING",
      field: "name",
      message: "Bot name is required.",
      severity: "SEV-1",
    });
  }
  
  // Validate symbol
  const symbolResult = validateSymbol(symbol, traceId);
  errors.push(...symbolResult.errors);
  warnings.push(...symbolResult.warnings);
  
  // Validate archetype (use name if archetypeName not provided)
  const archetypeResult = validateArchetype({
    archetypeName,
    strategyName: name,
    traceId,
  });
  errors.push(...archetypeResult.errors);
  warnings.push(...archetypeResult.warnings);
  
  // Validate risk config
  const riskResult = validateRiskConfig({
    riskConfig,
    riskTier,
    maxContractsPerTrade,
    stage,
    traceId,
  });
  errors.push(...riskResult.errors);
  warnings.push(...riskResult.warnings);
  
  // Log aggregate result
  if (traceId) {
    if (errors.length > 0) {
      console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} BOT_CREATION_BLOCKED name="${name}" sev0_errors=${errors.filter(e => e.severity === "SEV-0").length} sev1_errors=${errors.filter(e => e.severity === "SEV-1").length}`);
    } else {
      console.log(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} BOT_CREATION_VALIDATED name="${name}" warnings=${warnings.length}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============ HELPER TO FORMAT VALIDATION ERRORS ============

export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return "Validation passed";
  }
  
  const sev0 = result.errors.filter(e => e.severity === "SEV-0");
  const sev1 = result.errors.filter(e => e.severity === "SEV-1");
  const sev2 = result.errors.filter(e => e.severity === "SEV-2");
  
  const parts: string[] = [];
  
  if (sev0.length > 0) {
    parts.push(`SEV-0 (Critical): ${sev0.map(e => e.message).join("; ")}`);
  }
  if (sev1.length > 0) {
    parts.push(`SEV-1 (High): ${sev1.map(e => e.message).join("; ")}`);
  }
  if (sev2.length > 0) {
    parts.push(`SEV-2 (Medium): ${sev2.map(e => e.message).join("; ")}`);
  }
  
  return parts.join(" | ");
}

// ============ SESSION MODE VALIDATION (SEV-2) ============

const VALID_SESSION_MODES = ["RTH", "ETH", "FULL_24x5", "CUSTOM"] as const;
export type SessionMode = typeof VALID_SESSION_MODES[number];

export interface SessionModeValidationInput {
  sessionMode?: string | null;
  sessionConfig?: {
    startTime?: string;
    endTime?: string;
    timezone?: string;
  } | null;
  stage?: string;
  traceId?: string;
}

/**
 * Validate session mode configuration
 * - Missing session mode: SEV-2 warning (defaults to FULL_24x5)
 * - Invalid session mode: SEV-1 error (blocks creation)
 * - Incomplete CUSTOM config: SEV-1 error (blocks creation)
 */
export function validateSessionMode(input: SessionModeValidationInput): ValidationResult & { normalizedMode?: SessionMode } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let normalizedMode: SessionMode | undefined;
  
  const { sessionMode, sessionConfig, stage, traceId } = input;
  
  if (!sessionMode) {
    // SEV-2: Warn about implicit 24x5 default (doesn't block)
    warnings.push({
      code: "SESSION_MODE_IMPLICIT_DEFAULT",
      field: "sessionMode",
      message: `No session mode specified - defaulting to FULL_24x5. Consider setting explicit session mode for ${stage || 'this bot'}.`,
      severity: "SEV-2",
    });
    normalizedMode = "FULL_24x5";
  } else {
    const upper = sessionMode.toUpperCase() as SessionMode;
    if (VALID_SESSION_MODES.includes(upper)) {
      normalizedMode = upper;
    } else {
      // SEV-1: Invalid session mode is a blocking error (fail-closed)
      errors.push({
        code: "SESSION_MODE_INVALID",
        field: "sessionMode",
        message: `Invalid session mode '${sessionMode}'. Valid modes: ${VALID_SESSION_MODES.join(", ")}`,
        severity: "SEV-1",
      });
      // Do NOT fall back to FULL_24x5 - let it fail
    }
  }
  
  // Validate CUSTOM session config - SEV-1 if incomplete
  if (normalizedMode === "CUSTOM") {
    if (!sessionConfig || !sessionConfig.startTime || !sessionConfig.endTime) {
      errors.push({
        code: "CUSTOM_SESSION_INCOMPLETE",
        field: "sessionConfig",
        message: "CUSTOM session mode requires startTime and endTime in sessionConfig.",
        severity: "SEV-1",
      });
    }
  }
  
  if (traceId && (errors.length > 0 || warnings.length > 0)) {
    const level = errors.length > 0 ? "error" : "log";
    console[level](`[FAIL_FAST_VALIDATOR] trace_id=${traceId} SESSION_MODE_VALIDATION mode="${normalizedMode}" errors=${errors.length} warnings=${warnings.length}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedMode,
  };
}

// ============ TIMEFRAME VALIDATION ============

const VALID_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Timeframe = typeof VALID_TIMEFRAMES[number];

export function validateTimeframe(timeframe?: string | null, traceId?: string): ValidationResult & { normalizedTimeframe?: Timeframe } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let normalizedTimeframe: Timeframe | undefined;
  
  if (!timeframe) {
    warnings.push({
      code: "TIMEFRAME_MISSING",
      field: "timeframe",
      message: "No timeframe specified - defaulting to 5m. Consider setting explicit timeframe.",
      severity: "SEV-2",
    });
    normalizedTimeframe = "5m";
  } else {
    const lower = timeframe.toLowerCase() as Timeframe;
    if (VALID_TIMEFRAMES.includes(lower)) {
      normalizedTimeframe = lower;
    } else {
      errors.push({
        code: "TIMEFRAME_INVALID",
        field: "timeframe",
        message: `Invalid timeframe '${timeframe}'. Valid timeframes: ${VALID_TIMEFRAMES.join(", ")}`,
        severity: "SEV-1",
      });
    }
  }
  
  if (traceId && errors.length > 0) {
    console.error(`[FAIL_FAST_VALIDATOR] trace_id=${traceId} TIMEFRAME_VALIDATION_FAILED timeframe="${timeframe}"`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedTimeframe,
  };
}

// ============ MONITORING: FALLBACK RATE TRACKING ============

interface FallbackMetrics {
  archetypeFallbacks: number;
  configFallbacks: number;
  sessionModeFallbacks: number;
  timeframeFallbacks: number;
  totalValidations: number;
}

// In-memory fallback counters (reset on server restart)
const fallbackMetrics: FallbackMetrics = {
  archetypeFallbacks: 0,
  configFallbacks: 0,
  sessionModeFallbacks: 0,
  timeframeFallbacks: 0,
  totalValidations: 0,
};

// Threshold for alerting (5% fallback rate)
const FALLBACK_ALERT_THRESHOLD = parseFloat(process.env.FALLBACK_ALERT_THRESHOLD || "0.05");

export function recordFallback(type: keyof Omit<FallbackMetrics, "totalValidations">, traceId?: string) {
  fallbackMetrics[type]++;
  fallbackMetrics.totalValidations++;
  
  // Check if we should alert
  const rate = fallbackMetrics[type] / fallbackMetrics.totalValidations;
  if (rate > FALLBACK_ALERT_THRESHOLD && fallbackMetrics.totalValidations >= 20) {
    const message = `[FALLBACK_ALERT] ${type} fallback rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(FALLBACK_ALERT_THRESHOLD * 100).toFixed(1)}%`;
    console.warn(message);
    
    // Send Discord alert asynchronously (non-blocking)
    sendFailFastAlert(
      "FALLBACK",
      `High Fallback Rate: ${type}`,
      `Type: ${type}\nCurrent Rate: ${(rate * 100).toFixed(1)}%\nThreshold: ${(FALLBACK_ALERT_THRESHOLD * 100).toFixed(1)}%\nTotal Fallbacks: ${fallbackMetrics[type]}\nTotal Validations: ${fallbackMetrics.totalValidations}\nTrace ID: ${traceId || 'N/A'}\n\nHigh fallback rates indicate data quality issues or misconfiguration.`
    ).catch(() => {});
  }
}

export function incrementValidationCount() {
  fallbackMetrics.totalValidations++;
}

export function getFallbackMetrics(): FallbackMetrics & { rates: Record<string, number> } {
  const total = fallbackMetrics.totalValidations || 1; // Avoid division by zero
  return {
    ...fallbackMetrics,
    rates: {
      archetype: fallbackMetrics.archetypeFallbacks / total,
      config: fallbackMetrics.configFallbacks / total,
      sessionMode: fallbackMetrics.sessionModeFallbacks / total,
      timeframe: fallbackMetrics.timeframeFallbacks / total,
    },
  };
}

// ============ MONITORING: VARIANCE DETECTOR ============

interface BatchMetrics {
  values: number[];
  timestamp: Date;
}

const batchMetricsHistory: Map<string, BatchMetrics[]> = new Map();
const VARIANCE_ALERT_THRESHOLD = parseFloat(process.env.VARIANCE_ALERT_THRESHOLD || "0.001");
const MAX_BATCH_HISTORY = 10;

/**
 * Record batch metrics and check for near-zero variance (bug indicator)
 * If all values in a batch are identical, it likely indicates a bug
 */
export function recordBatchMetrics(batchId: string, metricName: string, values: number[]): { variance: number; alert: boolean; message?: string } {
  if (values.length < 2) {
    return { variance: 0, alert: false };
  }
  
  // Calculate variance
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  
  // Store history
  const key = `${batchId}:${metricName}`;
  const history = batchMetricsHistory.get(key) || [];
  history.push({ values, timestamp: new Date() });
  if (history.length > MAX_BATCH_HISTORY) {
    history.shift();
  }
  batchMetricsHistory.set(key, history);
  
  // Check for near-zero variance (all identical = likely bug)
  if (variance < VARIANCE_ALERT_THRESHOLD && values.length >= 5) {
    const message = `[VARIANCE_ALERT] batch=${batchId} metric=${metricName} variance=${variance.toExponential(2)} - all ${values.length} values nearly identical (${values[0].toFixed(4)}). This may indicate a bug.`;
    console.warn(message);
    
    // Send Discord alert asynchronously (non-blocking)
    sendFailFastAlert(
      "VARIANCE",
      `Near-Zero Variance Detected: ${metricName}`,
      `Batch: ${batchId}\nMetric: ${metricName}\nVariance: ${variance.toExponential(2)}\nValues: ${values.length} samples, all ≈ ${values[0].toFixed(4)}\n\nThis may indicate a calculation bug where all backtest results are identical.`
    ).catch(() => {});
    
    return { variance, alert: true, message };
  }
  
  return { variance, alert: false };
}

export function getVarianceAlertHistory(): Array<{ batchId: string; metricName: string; lastValues: number[]; timestamp: Date }> {
  const alerts: Array<{ batchId: string; metricName: string; lastValues: number[]; timestamp: Date }> = [];
  
  for (const [key, history] of batchMetricsHistory.entries()) {
    const [batchId, metricName] = key.split(":");
    const latest = history[history.length - 1];
    if (latest) {
      const mean = latest.values.reduce((a, b) => a + b, 0) / latest.values.length;
      const variance = latest.values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / latest.values.length;
      if (variance < VARIANCE_ALERT_THRESHOLD && latest.values.length >= 5) {
        alerts.push({ batchId, metricName, lastValues: latest.values, timestamp: latest.timestamp });
      }
    }
  }
  
  return alerts;
}

// ============ BACKTEST CRITICAL ERROR CLASSIFICATION ============

export type BacktestErrorSeverity = "CRITICAL" | "RECOVERABLE" | "WARNING";

export interface BacktestErrorClassification {
  code: string;
  severity: BacktestErrorSeverity;
  shouldHalt: boolean;
  message: string;
}

/**
 * Classify backtest errors as critical (halt) vs recoverable (continue with warning)
 * FAIL-CLOSED: Critical errors halt the backtest entirely
 */
export function classifyBacktestError(error: Error | string, context?: { symbol?: string; traceId?: string }): BacktestErrorClassification {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorLower = errorMessage.toLowerCase();
  
  // CRITICAL: Data integrity issues - halt immediately
  if (errorLower.includes("no historical data") || errorLower.includes("empty bar data")) {
    return {
      code: "NO_DATA",
      severity: "CRITICAL",
      shouldHalt: true,
      message: `No historical data available for ${context?.symbol || 'symbol'}. Cannot run backtest without data.`,
    };
  }
  
  if (errorLower.includes("bar validation failed") || errorLower.includes("invalid ohlc")) {
    return {
      code: "CORRUPT_DATA",
      severity: "CRITICAL",
      shouldHalt: true,
      message: "Bar data failed validation. Data integrity compromised.",
    };
  }
  
  if (errorLower.includes("instrument not supported") || errorLower.includes("symbol not found")) {
    return {
      code: "INVALID_SYMBOL",
      severity: "CRITICAL",
      shouldHalt: true,
      message: `Symbol ${context?.symbol || 'unknown'} is not supported.`,
    };
  }
  
  if (errorLower.includes("strategy rules") || errorLower.includes("archetype undeterminable")) {
    return {
      code: "INVALID_STRATEGY",
      severity: "CRITICAL",
      shouldHalt: true,
      message: "Strategy configuration is invalid or incomplete.",
    };
  }
  
  if (errorLower.includes("division by zero") || errorLower.includes("nan") || errorLower.includes("infinity")) {
    return {
      code: "CALCULATION_ERROR",
      severity: "CRITICAL",
      shouldHalt: true,
      message: "Calculation error detected. Results would be invalid.",
    };
  }
  
  // RECOVERABLE: Temporary issues that can be retried
  if (errorLower.includes("timeout") || errorLower.includes("rate limit") || errorLower.includes("network")) {
    return {
      code: "TRANSIENT_ERROR",
      severity: "RECOVERABLE",
      shouldHalt: false,
      message: "Temporary error occurred. Backtest can be retried.",
    };
  }
  
  if (errorLower.includes("cache miss") || errorLower.includes("cache expired")) {
    return {
      code: "CACHE_MISS",
      severity: "RECOVERABLE",
      shouldHalt: false,
      message: "Cache miss - fetching fresh data.",
    };
  }
  
  // WARNING: Non-critical issues
  if (errorLower.includes("session filter") || errorLower.includes("no trades generated")) {
    return {
      code: "NO_SIGNALS",
      severity: "WARNING",
      shouldHalt: false,
      message: "No trading signals generated during backtest period.",
    };
  }
  
  // Default: Treat unknown errors as critical (fail-closed)
  return {
    code: "UNKNOWN_ERROR",
    severity: "CRITICAL",
    shouldHalt: true,
    message: `Unknown error: ${errorMessage.slice(0, 200)}`,
  };
}

/**
 * Assert backtest can proceed - throws if critical error detected
 */
export function assertBacktestCanProceed(error: Error | string, context?: { symbol?: string; traceId?: string }): void {
  const classification = classifyBacktestError(error, context);
  
  if (classification.shouldHalt) {
    const traceInfo = context?.traceId ? ` trace_id=${context.traceId}` : "";
    console.error(`[BACKTEST_HALT]${traceInfo} ${classification.code}: ${classification.message}`);
    throw new Error(`[${classification.code}] ${classification.message}`);
  }
  
  // Log recoverable errors as warnings
  if (classification.severity === "RECOVERABLE" || classification.severity === "WARNING") {
    console.warn(`[BACKTEST_WARNING] ${classification.code}: ${classification.message}`);
  }
}
