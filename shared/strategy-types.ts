/**
 * Canonical Strategy Type Definitions
 * 
 * INSTITUTIONAL STANDARD: Single source of truth for all strategy types.
 * All strategy mapping, creation, and execution MUST use these types.
 * 
 * Using TypeScript exhaustiveness checking to catch unhandled cases at compile time.
 */

// ============ CANONICAL ENTRY CONDITION TYPES ============
// These are the IMPLEMENTED entry logic types in strategy-executor.ts

export const ENTRY_CONDITION_TYPES = [
  "BREAKOUT",
  "MEAN_REVERSION", 
  "VWAP_TOUCH",
  "TREND_CONTINUATION",
  "GAP_FADE",
  "GAP_FILL",
  "REVERSAL",
  "RANGE_SCALP",
  "MOMENTUM_SURGE",
] as const;

export type EntryConditionType = typeof ENTRY_CONDITION_TYPES[number];

// ============ CANONICAL STRATEGY ARCHETYPES ============
// These are the high-level strategy categories that map to entry condition types

export const STRATEGY_ARCHETYPES = [
  "breakout",
  "orb_breakout",
  "rth_breakout",
  "breakout_retest",
  "mean_reversion",
  "exhaustion_fade",
  "gap_fade",
  "gap_fill",
  "gap_and_go",
  "reversal",
  "reversal_hunter",
  "vwap",
  "vwap_bounce",
  "vwap_reclaim",
  "vwap_scalper",
  "trend",
  "trend_following",
  "trend_ema_cross",
  "trend_macd",
  "momentum_surge",
  "scalping",
  "micro_pullback",
  "range_scalper",
] as const;

export type StrategyArchetype = typeof STRATEGY_ARCHETYPES[number];

// ============ ARCHETYPE TO ENTRY CONDITION MAPPING ============
// Canonical mapping from archetype to entry condition type

export const ARCHETYPE_TO_ENTRY_CONDITION: Record<StrategyArchetype, EntryConditionType> = {
  // Breakout family
  breakout: "BREAKOUT",
  orb_breakout: "BREAKOUT",
  rth_breakout: "BREAKOUT",
  breakout_retest: "BREAKOUT",
  
  // Mean reversion family
  mean_reversion: "MEAN_REVERSION",
  exhaustion_fade: "MEAN_REVERSION",
  
  // Gap strategies - DEDICATED TYPES
  gap_fade: "GAP_FADE",
  gap_fill: "GAP_FILL",
  gap_and_go: "BREAKOUT", // Gap and go is a breakout variant
  
  // Reversal family
  reversal: "REVERSAL",
  reversal_hunter: "REVERSAL",
  
  // VWAP family
  vwap: "VWAP_TOUCH",
  vwap_bounce: "VWAP_TOUCH",
  vwap_reclaim: "VWAP_TOUCH",
  vwap_scalper: "VWAP_TOUCH",
  
  // Trend family
  trend: "TREND_CONTINUATION",
  trend_following: "TREND_CONTINUATION",
  trend_ema_cross: "TREND_CONTINUATION",
  trend_macd: "TREND_CONTINUATION",
  momentum_surge: "MOMENTUM_SURGE",
  
  // Scalping family - Note: scalping/micro_pullback use TREND_CONTINUATION logic
  // because they rely on short EMA crosses, not range bounds
  scalping: "TREND_CONTINUATION",
  micro_pullback: "TREND_CONTINUATION",
  range_scalper: "RANGE_SCALP",  // Only range_scalper uses actual range logic
};

// ============ NORMALIZATION UTILITY ============
// Converts any input string to a canonical archetype

/**
 * FAIL-CLOSED archetype normalization
 * THROWS on unknown archetype - NO silent fallback allowed (SEV-0 requirement)
 */
export function normalizeArchetype(input: string): StrategyArchetype {
  // Basic normalization: lowercase, trim, spaces/hyphens/plus signs to underscores
  const normalized = input.toLowerCase().trim().replace(/\s+/g, "_").replace(/[-+]/g, "_");
  
  // Direct match
  if (STRATEGY_ARCHETYPES.includes(normalized as StrategyArchetype)) {
    return normalized as StrategyArchetype;
  }
  
  // Common aliases and variant patterns
  const aliases: Record<string, StrategyArchetype> = {
    // Mean reversion variants
    "mean_revert": "mean_reversion",
    "mean_rev": "mean_reversion",
    "mean_reversion_bb": "mean_reversion",
    "mean_reversion_keltner": "mean_reversion",
    "exhaustion": "exhaustion_fade",
    
    // VWAP variants
    "vwap_deviation_bands": "vwap",
    "vwap_touch": "vwap",
    
    // Momentum variants - "momo" is common trader slang for momentum
    "momentum_burst": "momentum_surge",
    "momentum": "momentum_surge",
    "momo": "momentum_surge",
    "momo_burst": "momentum_surge",
    "momo_alpha": "momentum_surge",
    "momo_surge": "momentum_surge",
    
    // Scalping variants - micro strategies use pullback/scalping logic
    "scalper": "scalping",
    "range_scalp": "range_scalper",
    "scalp": "scalping",
    "micro_pull": "micro_pullback",
    "micro_pullback_strategy": "micro_pullback",
    
    // Fade/Gap variants
    "fade": "gap_fade",
    "fade_hunter": "gap_fade",
    "fader": "gap_fade",
    "gap": "gap_fade",
    "gap_trading": "gap_fade",
    
    // Hunter variants
    "hunter": "reversal_hunter",
    "reversal_hunter": "reversal_hunter",
    
    // Trend variants
    "trend_momentum": "momentum_surge",
    "trend_follow": "trend_following",
    "ema_cross": "trend_ema_cross",
    "nq_trend": "trend_following",
    
    // Breakout variants
    "orb": "orb_breakout",
    "opening_range_breakout": "orb_breakout",
    "rth": "rth_breakout",
    "break_retest": "orb_breakout",
    
    // Reversal variants
    "reversal_trading": "reversal",
    
    // Volatility strategy variants (common in Strategy Lab generated names)
    "vol_squeeze": "breakout",
    "vol_squeeze_arb": "breakout",
    "vol_squeeze_hybrid": "breakout",
    "vol_squeeze_bb": "breakout",
    "vol_squeeze_break": "breakout",
    "vol_squeeze_momo": "momentum_surge",
    "vol_compression": "breakout",
    "vol_compression_break": "breakout",
    "vol_comp": "breakout",
    "vol_comp_break": "breakout",
    "volcomp": "breakout",
    "volcomp_break": "breakout",
    "volcomp_breakout": "breakout",
    "volatility_regime": "breakout",
    "volatility_regime_shift": "breakout",
    "volatility_break": "breakout",
    "vol_arb": "mean_reversion",
    "vol_arb_rth": "mean_reversion",
    "vol_arb_hybrid": "mean_reversion",
    "volatility_squeeze": "breakout",
    "volatility_compression": "breakout",
    "volatility_arb": "mean_reversion",
    
    // Tick/Micro scalping variants
    "tick_arb": "range_scalper",
    "tick_arb_mnq": "range_scalper",
    "tick_scalp": "scalping",
    "micro_vac": "scalping",
    "micro_vac_arb": "scalping",
    "micro_vacuum": "scalping",
    
    // Hybrid strategy variants (use primary indicator)
    "bb_adx": "mean_reversion",
    "bb_adx_hybrid": "mean_reversion",
    "vol_adx": "mean_reversion",
    "vol_adx_hybrid": "mean_reversion",
    "adx_breakout": "breakout",
    "adx_trend": "trend_following",
    
    // Arb variants (typically mean reversion based)
    "arb": "mean_reversion",
    "arbitrage": "mean_reversion",
    "stat_arb": "mean_reversion",
    "pair_trade": "mean_reversion",
    
    // Overnight/Session-based strategies
    "overnight_unwind": "gap_fade",
    "overnight_fade": "gap_fade",
    "overnight_reversal": "gap_fade",
    "overnight_reversion": "gap_fade",
    "overnight": "gap_fade",
    "reversion": "mean_reversion",
    "session_fade": "gap_fade",
    "asia_unwind": "gap_fade",
    "unwind": "gap_fade",
    
    // Multi-timeframe (MTF) strategies
    "mtf_ema_pullback": "trend_following",
    "mtf_pullback": "trend_following",
    "ema_pullback": "trend_following",
    "pullback": "trend_following",
    "pullback_entry": "trend_following",
    "mtf_trend": "trend_following",
    "mtf_momentum": "momentum_surge",
    
    // MACD-based strategies
    "macd_cross": "trend_macd",
    "macd_crossover": "trend_macd",
    "macd_signal": "trend_macd",
    "macd_divergence": "trend_macd",
    "macd": "trend_macd",
    
    // Auction/liquidity patterns
    "auction_liquidity_vac": "mean_reversion",
    "auction_liquidity": "mean_reversion",
    "liquidity_vac": "mean_reversion",
    "liquidity_sweep": "mean_reversion",
    "liquidity_hunt": "mean_reversion",
    "auction": "mean_reversion",
    "vac": "mean_reversion",
    
    // Additional common Strategy Lab patterns
    "range_fade": "mean_reversion",
    "range_reversion": "mean_reversion",
    "session_breakout": "breakout",
    "session_scalp": "scalping",
    "delta_divergence": "mean_reversion",
    "delta_fade": "mean_reversion",
    "orderflow_reversal": "reversal",
    "orderflow_scalp": "scalping",
    "volume_spike": "momentum_surge",
    "volume_surge": "momentum_surge",
    "squeeze_breakout": "breakout",
    "consolidation_break": "breakout",
    
    // Common Strategy Lab generated names (added for coverage)
    "diverge": "mean_reversion",
    "diverge_short": "mean_reversion",
    "diverge_long": "mean_reversion",
    "crush": "breakout",
    "crush_bounce": "breakout",
    "vol_crush": "breakout",
    "vol_grind": "trend_following",
    "grind": "trend_following",
    "grind_fade": "mean_reversion",
    "bounce": "mean_reversion",
    "ceiling": "mean_reversion",
    "ceiling_fade": "mean_reversion",
    "dormancy": "mean_reversion",
    "dormancy_fade": "mean_reversion",
    "complacency": "mean_reversion",
    "complacency_fade": "mean_reversion",
    "sentiment": "momentum_surge",
    "sentiment_fade": "mean_reversion",
    "peak_fade": "mean_reversion",
    "trap": "reversal",
    "fade_trap": "reversal",
    "quiet": "mean_reversion",
    "quiet_range": "mean_reversion",
    "echo": "scalping",
    "echo_chamber": "scalping",
  };
  
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  
  // Try to extract archetype from compound names like "mnq_trend_momentum" or "mes_gap_fade"
  // Strip common instrument prefixes (including full names like "nasdaq", "spx", "dowfutures")
  const withoutInstrument = normalized.replace(/^(mes|mnq|es|nq|ym|mym|rtm|m2k|cl|gc|nasdaq|spx|dowfutures|sp500|emini)_/, "");
  
  if (STRATEGY_ARCHETYPES.includes(withoutInstrument as StrategyArchetype)) {
    return withoutInstrument as StrategyArchetype;
  }
  
  if (aliases[withoutInstrument]) {
    return aliases[withoutInstrument];
  }
  
  // Partial match fallback: check if any archetype is contained in the input
  for (const archetype of STRATEGY_ARCHETYPES) {
    if (normalized.includes(archetype)) {
      return archetype;
    }
  }
  
  // Partial alias match fallback: check if any alias key appears as a whole word in the input
  // This catches bot names like "Momentum Bot Alpha" → contains "momentum" as word → "momentum_surge"
  // Uses word boundary matching (underscore, start, or end) to prevent false matches
  // e.g., "Handicap Strategy" should NOT match "gap" alias
  for (const [aliasKey, targetArchetype] of Object.entries(aliases)) {
    // Only match if aliasKey is at start, end, or surrounded by underscores
    const wordBoundaryPattern = new RegExp(`(^|_)${aliasKey}(_|$)`);
    if (wordBoundaryPattern.test(normalized)) {
      return targetArchetype;
    }
  }
  
  // FAIL-CLOSED: Throw instead of returning null (SEV-0 institutional requirement)
  throw new Error(`[STRATEGY_TYPE_ERROR] Unknown archetype: "${input}" (normalized: "${normalized}") - add to STRATEGY_ARCHETYPES or aliases`);
}

/**
 * SAFE archetype normalization that returns null instead of throwing
 * Use this for UI validation, NOT for execution paths
 */
export function tryNormalizeArchetype(input: string): StrategyArchetype | null {
  try {
    return normalizeArchetype(input);
  } catch {
    return null;
  }
}

/**
 * Infer archetype from strategy/bot name using canonical normalization
 * Names follow patterns like: "{SYMBOL} {Strategy Type}" (e.g., "MES Gap Fade", "MNQ VWAP Bounce")
 * or just "{Strategy Type}" (e.g., "Vol Comp Breakout", "Complacency Spike Fade")
 * 
 * Uses the canonical normalizeArchetype function which handles:
 * - All aliases and variant patterns
 * - Instrument prefix stripping (MES, MNQ, ES, NQ, etc.)
 * - Compound word handling and partial matching
 * 
 * FAIL-CLOSED: Returns null if archetype cannot be determined.
 * The caller must decide whether to fail or use a fallback.
 */
export function inferArchetypeFromName(strategyName: string, traceId?: string): StrategyArchetype | null {
  if (!strategyName) {
    if (traceId) {
      console.warn(`[STRATEGY_INFERENCE] trace_id=${traceId} FAILED: empty strategy name`);
    }
    return null;
  }
  
  // Try canonical normalization on the full name
  // normalizeArchetype already strips instrument prefixes and handles aliases
  try {
    const archetype = normalizeArchetype(strategyName);
    if (traceId && archetype) {
      console.log(`[STRATEGY_INFERENCE] trace_id=${traceId} strategy_name="${strategyName}" inferred_archetype="${archetype}"`);
    }
    return archetype;
  } catch {
    // normalizeArchetype throws on unknown - this is expected for some names
  }
  
  // Try extracting just the strategy part after the symbol
  // Names are typically "{SYMBOL} {Strategy}" like "MES Gap Fade"
  const parts = strategyName.split(' ');
  if (parts.length >= 2) {
    // Skip first part (symbol) and try the rest
    const strategyPart = parts.slice(1).join(' ');
    try {
      const archetype = normalizeArchetype(strategyPart);
      if (traceId && archetype) {
        console.log(`[STRATEGY_INFERENCE] trace_id=${traceId} strategy_name="${strategyName}" strategy_part="${strategyPart}" inferred_archetype="${archetype}"`);
      }
      return archetype;
    } catch {
      // Still couldn't normalize - continue to fallback
    }
  }
  
  // FAIL-CLOSED: Log warning and return null (no silent fallback)
  if (traceId) {
    console.warn(`[STRATEGY_INFERENCE] trace_id=${traceId} FAILED: could not infer archetype from strategy_name="${strategyName}"`);
  }
  return null;
}

// ============ EXHAUSTIVENESS HELPER ============
// TypeScript compile-time check for unhandled cases

export function assertNever(x: never, context: string): never {
  throw new Error(`[STRATEGY_TYPE_ERROR] Unhandled ${context}: ${JSON.stringify(x)}`);
}

// ============ ENTRY CONDITION FACTORY LOOKUP ============
// Maps archetypes to strategy factory names

export function getEntryConditionType(archetype: StrategyArchetype): EntryConditionType {
  return ARCHETYPE_TO_ENTRY_CONDITION[archetype];
}

// ============ VALIDATION UTILITIES ============

export function isValidArchetype(input: string): boolean {
  return normalizeArchetype(input) !== null;
}

export function isValidEntryConditionType(input: string): input is EntryConditionType {
  return ENTRY_CONDITION_TYPES.includes(input as EntryConditionType);
}

// ============ STRATEGY VERIFICATION ============
// Returns verification status for institutional audit

export interface StrategyVerification {
  inputArchetype: string;
  normalizedArchetype: StrategyArchetype | null;
  entryConditionType: EntryConditionType | null;
  isVerified: boolean;
  errorMessage: string | null;
}

export function verifyStrategyMapping(inputArchetype: string): StrategyVerification {
  const normalized = normalizeArchetype(inputArchetype);
  
  if (!normalized) {
    return {
      inputArchetype,
      normalizedArchetype: null,
      entryConditionType: null,
      isVerified: false,
      errorMessage: `Unknown archetype: "${inputArchetype}" - not in canonical list`,
    };
  }
  
  const entryConditionType = ARCHETYPE_TO_ENTRY_CONDITION[normalized];
  
  return {
    inputArchetype,
    normalizedArchetype: normalized,
    entryConditionType,
    isVerified: true,
    errorMessage: null,
  };
}

// ============ SESSION MODE CONFIGURATION ============
// Session mode defines when a bot is allowed to trade
// FULL_24x5: No session filtering - trade anytime market is open (CME 23h/day)
// RTH_US: Regular Trading Hours (09:30-16:00 ET for equities, 09:30-16:15 for CME index futures)
// ETH: Extended Trading Hours (overnight session)
// CUSTOM: User-defined start/end times

export const SESSION_MODES = ["FULL_24x5", "RTH_US", "ETH", "CUSTOM"] as const;
export type SessionMode = typeof SESSION_MODES[number];

export const RULES_PROFILES = ["PRODUCTION", "LAB_RELAXED"] as const;
export type RulesProfile = typeof RULES_PROFILES[number];

// Canonical session window definitions
export const SESSION_WINDOWS = {
  FULL_24x5: { start: "00:00", end: "23:59", description: "Full CME session (no filtering)" },
  RTH_US: { start: "09:30", end: "16:15", description: "US Regular Trading Hours" },
  ETH: { start: "18:00", end: "09:30", description: "Extended Trading Hours (overnight)" },
} as const;

export interface SessionConfig {
  mode: SessionMode;
  timezone: string;
  start?: string; // HH:MM, only for CUSTOM mode
  end?: string;   // HH:MM, only for CUSTOM mode
}

// Get effective session window for a given mode
export function getSessionWindow(mode: SessionMode, customStart?: string, customEnd?: string): { start: string; end: string } {
  if (mode === "CUSTOM" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  if (mode === "FULL_24x5" || mode === "ETH" || mode === "RTH_US") {
    return SESSION_WINDOWS[mode];
  }
  // Default to full session
  return SESSION_WINDOWS.FULL_24x5;
}

// Check if a mode allows 24/5 trading (no session filtering)
export function isUnrestrictedSession(mode: SessionMode): boolean {
  return mode === "FULL_24x5";
}

// ============ DIAGNOSTIC LOGGING ============

export function logStrategyResolution(
  traceId: string,
  inputArchetype: string,
  resolvedArchetype: StrategyArchetype | null,
  entryConditionType: EntryConditionType | null
): void {
  if (resolvedArchetype && entryConditionType) {
    console.log(
      `[STRATEGY_RESOLUTION] trace_id=${traceId} ` +
      `input="${inputArchetype}" → archetype="${resolvedArchetype}" → entry_type="${entryConditionType}"`
    );
  } else {
    console.error(
      `[STRATEGY_RESOLUTION_FAILED] trace_id=${traceId} ` +
      `input="${inputArchetype}" UNRESOLVED - falling back would violate institutional standards`
    );
  }
}

// ============ AUTONOMOUS SOURCE SELECTION ============
// Per-source state for autonomous source selection governor

export const SOURCE_IDS = [
  "options_flow",
  "macro_indicators",
  "news_sentiment",
  "economic_calendar",
] as const;

export type SourceId = typeof SOURCE_IDS[number];

export const SOURCE_STATES = [
  "enabled",    // Source is active and contributing to fusion
  "disabled",   // Source is disabled by governor due to poor performance
  "probation",  // Source is being tested after cooldown period
] as const;

export type SourceStateStatus = typeof SOURCE_STATES[number];

export interface SourceState {
  sourceId: SourceId;
  status: SourceStateStatus;
  disabledAt?: Date;        // When source was disabled
  disabledUntil?: Date;     // Cooldown expiry for re-enable trial
  probationStartedAt?: Date;// When probation trial started
  lastDecisionAt?: Date;    // When last state change occurred
  reason?: string;          // Human-readable reason for state
  performanceScore?: number;// Last computed performance score
  consecutiveFailures?: number; // Consecutive backtest failures for this source
}

export interface BotSourceStates {
  useAutonomousSelection: boolean; // If false, all sources stay enabled
  states: Record<SourceId, SourceState>;
  lastGovernorRunAt?: Date;
  governorVersion: string;
}

// Default source state - all enabled
export function getDefaultSourceState(sourceId: SourceId): SourceState {
  return {
    sourceId,
    status: "enabled",
  };
}

// Default bot source states - all 4 sources enabled, autonomous selection ON by default
// Each bot independently adapts its source selection based on performance
export function getDefaultBotSourceStates(): BotSourceStates {
  return {
    useAutonomousSelection: true, // Enabled by default for independent adaptation
    states: {
      options_flow: getDefaultSourceState("options_flow"),
      macro_indicators: getDefaultSourceState("macro_indicators"),
      news_sentiment: getDefaultSourceState("news_sentiment"),
      economic_calendar: getDefaultSourceState("economic_calendar"),
    },
    governorVersion: "1.0.0",
  };
}

// Get count of enabled sources
export function getEnabledSourceCount(botSourceStates: BotSourceStates): number {
  return Object.values(botSourceStates.states).filter(s => s.status === "enabled").length;
}

// Get list of enabled source IDs
export function getEnabledSourceIds(botSourceStates: BotSourceStates): SourceId[] {
  return Object.entries(botSourceStates.states)
    .filter(([_, state]) => state.status === "enabled")
    .map(([id]) => id as SourceId);
}

// Minimum sources required - guardrail
export const MIN_ENABLED_SOURCES = 2;

// ============ STARTUP VALIDATION ============
// Validates that all archetype mappings are consistent and detects drift early

export interface ArchetypeMappingDrift {
  archetype: StrategyArchetype;
  expectedCondition: EntryConditionType;
  issue: string;
}

/**
 * Validates all archetype-to-entry-condition mappings for consistency.
 * Call this at startup to detect mapping drift before bots fail.
 * Returns an array of issues found (empty = all good).
 */
export function validateArchetypeMappings(): ArchetypeMappingDrift[] {
  const issues: ArchetypeMappingDrift[] = [];
  
  // Verify all archetypes have a mapping
  for (const archetype of STRATEGY_ARCHETYPES) {
    const entryCondition = ARCHETYPE_TO_ENTRY_CONDITION[archetype];
    if (!entryCondition) {
      issues.push({
        archetype,
        expectedCondition: "BREAKOUT", // placeholder
        issue: `Archetype "${archetype}" has no entry condition mapping in ARCHETYPE_TO_ENTRY_CONDITION`,
      });
      continue;
    }
    
    // Verify entry condition is valid
    if (!ENTRY_CONDITION_TYPES.includes(entryCondition)) {
      issues.push({
        archetype,
        expectedCondition: entryCondition,
        issue: `Archetype "${archetype}" maps to invalid entry condition "${entryCondition}"`,
      });
    }
  }
  
  // Verify all entry conditions have at least one archetype mapping to them
  for (const entryCondition of ENTRY_CONDITION_TYPES) {
    const hasMapping = Object.values(ARCHETYPE_TO_ENTRY_CONDITION).includes(entryCondition);
    if (!hasMapping) {
      console.warn(`[STRATEGY_VALIDATION] Warning: Entry condition "${entryCondition}" has no archetype mapping`);
    }
  }
  
  return issues;
}

/**
 * FAIL-CLOSED startup check for archetype mappings.
 * Throws if any mapping issues are found - prevents server from starting with broken config.
 */
export function assertArchetypeMappingsValid(): void {
  const issues = validateArchetypeMappings();
  
  if (issues.length > 0) {
    const details = issues.map(i => `  - ${i.archetype}: ${i.issue}`).join("\n");
    throw new Error(
      `[STRATEGY_MAPPING_DRIFT] ${issues.length} archetype mapping issue(s) detected at startup:\n${details}\n` +
      `Fix these in shared/strategy-types.ts before starting the server.`
    );
  }
  
  console.log(`[STRATEGY_VALIDATION] All ${STRATEGY_ARCHETYPES.length} archetype mappings validated successfully`);
}
