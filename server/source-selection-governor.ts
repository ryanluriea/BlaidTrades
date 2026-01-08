/**
 * Source Selection Governor
 * 
 * INSTITUTIONAL STANDARD: Autonomous source selection for trading bots
 * Runs post-optimization to enable/disable signal sources based on performance
 * 
 * Decision Triggers:
 * - DISABLE: Source weight stuck at floor (5%) for 3+ cycles + negative performance
 * - DISABLE: Provider health OFFLINE for extended period
 * - RE-ENABLE: Cooldown expires, probation trial with positive performance
 * 
 * Guardrails:
 * - Minimum 2 active sources required
 * - Falls back to global defaults if all would be disabled
 * - Every toggle logged for audit compliance
 */

import { 
  SourceId, 
  SourceState, 
  BotSourceStates, 
  SourceStateStatus,
  SOURCE_IDS,
  MIN_ENABLED_SOURCES,
  getDefaultBotSourceStates,
  getEnabledSourceCount,
} from "@shared/strategy-types";
import { bots } from "@shared/schema";
import { getProviderStatus, type ProviderStatus } from "./provider-health";
import { logActivityEvent } from "./activity-logger";
import { db } from "./db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const guardrailBlockedSources: Map<string, Set<SourceId>> = new Map();

// Governor configuration
export interface GovernorConfig {
  weightFloorThreshold: number;     // Weight below which source is considered underperforming (default: 0.08 = 8%)
  consecutiveFloorCycles: number;   // Number of cycles at floor before disable (default: 3)
  cooldownHours: number;            // Hours before disabled source can be re-enabled (default: 24)
  probationDurationHours: number;   // Hours for probation trial (default: 12)
  probationMinPerformance: number;  // Min performance score to pass probation (default: 0)
}

const DEFAULT_CONFIG: GovernorConfig = {
  weightFloorThreshold: 0.08,
  consecutiveFloorCycles: 3,
  cooldownHours: 24,
  probationDurationHours: 12,
  probationMinPerformance: 0,
};

// Source performance snapshot from adaptive weights
export interface SourcePerformanceSnapshot {
  sourceId: SourceId;
  weight: number;
  performanceScore: number;
  contributingBacktests: number;
  atWeightFloor: boolean;
  consecutiveCyclesAtFloor: number;
}

// Provider to source mapping
const PROVIDER_TO_SOURCE: Record<string, SourceId> = {
  "Unusual Whales": "options_flow",
  "FRED": "macro_indicators",
  "Finnhub": "news_sentiment",
  "NewsAPI": "news_sentiment",
  "Marketaux": "news_sentiment",
  "FMP": "economic_calendar",
};

// Governor decision
export interface GovernorDecision {
  sourceId: SourceId;
  previousStatus: SourceStateStatus;
  newStatus: SourceStateStatus;
  reason: string;
  triggeredBy: "PERFORMANCE" | "PROVIDER_HEALTH" | "COOLDOWN_EXPIRY" | "PROBATION_RESULT" | "MANUAL";
  timestamp: Date;
}

// Check if source should be disabled based on performance
function shouldDisableSource(
  snapshot: SourcePerformanceSnapshot,
  providerStatuses: ProviderStatus[],
  config: GovernorConfig
): { disable: boolean; reason: string } {
  // Check provider health first
  const hasOfflineProvider = providerStatuses.some(s => s === "OFFLINE");
  if (hasOfflineProvider) {
    return {
      disable: true,
      reason: "Provider OFFLINE - data unavailable",
    };
  }
  
  // Check weight floor + consecutive cycles
  if (snapshot.atWeightFloor && snapshot.consecutiveCyclesAtFloor >= config.consecutiveFloorCycles) {
    return {
      disable: true,
      reason: `Weight at floor (${(snapshot.weight * 100).toFixed(1)}%) for ${snapshot.consecutiveCyclesAtFloor} cycles`,
    };
  }
  
  // Check negative performance trend
  if (snapshot.performanceScore < -20 && snapshot.contributingBacktests >= 5) {
    return {
      disable: true,
      reason: `Negative performance score (${snapshot.performanceScore.toFixed(1)}) across ${snapshot.contributingBacktests} backtests`,
    };
  }
  
  return { disable: false, reason: "" };
}

// Check if disabled source should enter probation
function shouldEnterProbation(
  state: SourceState,
  now: Date
): boolean {
  if (state.status !== "disabled") return false;
  if (!state.disabledUntil) return false;
  
  return now >= state.disabledUntil;
}

// Check if probation source should be re-enabled or re-disabled
function evaluateProbation(
  state: SourceState,
  snapshot: SourcePerformanceSnapshot | undefined,
  config: GovernorConfig,
  now: Date
): { pass: boolean; reason: string } | null {
  if (state.status !== "probation") return null;
  if (!state.probationStartedAt) return null;
  
  const probationEnd = new Date(state.probationStartedAt.getTime() + config.probationDurationHours * 60 * 60 * 1000);
  
  // Still in probation period
  if (now < probationEnd) return null;
  
  // Probation ended - evaluate performance
  if (!snapshot) {
    return { pass: false, reason: "No performance data during probation" };
  }
  
  if (snapshot.performanceScore >= config.probationMinPerformance) {
    return { pass: true, reason: `Probation passed with score ${snapshot.performanceScore.toFixed(1)}` };
  }
  
  return { pass: false, reason: `Probation failed with score ${snapshot.performanceScore.toFixed(1)}` };
}

// Get provider statuses for a source
function getProviderStatusesForSource(sourceId: SourceId): ProviderStatus[] {
  const providerNames = Object.entries(PROVIDER_TO_SOURCE)
    .filter(([_, id]) => id === sourceId)
    .map(([name]) => name);
  
  return providerNames.map(name => getProviderStatus(name));
}

// Main governor function
export async function runSourceSelectionGovernor(
  botId: string,
  botName: string,
  currentStates: BotSourceStates,
  performanceSnapshots: SourcePerformanceSnapshot[],
  config: GovernorConfig = DEFAULT_CONFIG
): Promise<{
  newStates: BotSourceStates;
  decisions: GovernorDecision[];
}> {
  const now = new Date();
  const decisions: GovernorDecision[] = [];
  const newStates: BotSourceStates = {
    ...currentStates,
    states: { ...currentStates.states },
    lastGovernorRunAt: now,
  };
  
  // If autonomous selection is disabled, return unchanged
  if (!currentStates.useAutonomousSelection) {
    return { newStates, decisions };
  }
  
  // Process each source
  for (const sourceId of SOURCE_IDS) {
    const state = currentStates.states[sourceId];
    const snapshot = performanceSnapshots.find(s => s.sourceId === sourceId);
    const providerStatuses = getProviderStatusesForSource(sourceId);
    
    let newStatus: SourceStateStatus = state.status;
    let reason = "";
    let triggeredBy: GovernorDecision["triggeredBy"] = "PERFORMANCE";
    
    switch (state.status) {
      case "enabled": {
        // Check if should disable
        if (snapshot) {
          const disableCheck = shouldDisableSource(snapshot, providerStatuses, config);
          if (disableCheck.disable) {
            // Check guardrail - minimum sources
            const enabledCount = getEnabledSourceCount(newStates);
            if (enabledCount <= MIN_ENABLED_SOURCES) {
              reason = `Would disable but guardrail prevents: MIN_ENABLED_SOURCES=${MIN_ENABLED_SOURCES}`;
              
              // Only log if this is a NEW block (not previously blocked this cycle)
              const botBlocked = guardrailBlockedSources.get(botId) || new Set();
              if (!botBlocked.has(sourceId)) {
                botBlocked.add(sourceId);
                guardrailBlockedSources.set(botId, botBlocked);
                
                await logActivityEvent({
                  eventType: "SOURCE_GOVERNOR_BLOCKED",
                  severity: "WARN",
                  title: "Source Disable Blocked by Guardrail",
                  summary: `Bot ${botName}: Cannot disable ${sourceId} - would violate minimum sources (${MIN_ENABLED_SOURCES})`,
                  botId,
                  payload: { sourceId, reason: disableCheck.reason, enabledCount },
                });
              }
            } else {
              newStatus = "disabled";
              reason = disableCheck.reason;
              triggeredBy = providerStatuses.includes("OFFLINE") ? "PROVIDER_HEALTH" : "PERFORMANCE";
              
              // Clear from blocked set since it's actually being disabled now
              const botBlocked = guardrailBlockedSources.get(botId);
              if (botBlocked) {
                botBlocked.delete(sourceId);
              }
            }
          } else {
            // Source no longer needs to be disabled - clear from blocked set
            const botBlocked = guardrailBlockedSources.get(botId);
            if (botBlocked) {
              botBlocked.delete(sourceId);
            }
          }
        }
        break;
      }
      
      case "disabled": {
        // Check if should enter probation
        if (shouldEnterProbation(state, now)) {
          newStatus = "probation";
          reason = "Cooldown expired, entering probation trial";
          triggeredBy = "COOLDOWN_EXPIRY";
        }
        break;
      }
      
      case "probation": {
        // Evaluate probation result
        const probationResult = evaluateProbation(state, snapshot, config, now);
        if (probationResult) {
          if (probationResult.pass) {
            newStatus = "enabled";
            reason = probationResult.reason;
          } else {
            newStatus = "disabled";
            reason = probationResult.reason;
          }
          triggeredBy = "PROBATION_RESULT";
        }
        break;
      }
    }
    
    // Record decision if status changed
    if (newStatus !== state.status) {
      const decision: GovernorDecision = {
        sourceId,
        previousStatus: state.status,
        newStatus,
        reason,
        triggeredBy,
        timestamp: now,
      };
      decisions.push(decision);
      
      // Update state
      const updatedState: SourceState = {
        sourceId,
        status: newStatus,
        lastDecisionAt: now,
        reason,
        performanceScore: snapshot?.performanceScore,
        consecutiveFailures: snapshot?.consecutiveCyclesAtFloor,
      };
      
      if (newStatus === "disabled") {
        updatedState.disabledAt = now;
        updatedState.disabledUntil = new Date(now.getTime() + config.cooldownHours * 60 * 60 * 1000);
      }
      
      if (newStatus === "probation") {
        updatedState.probationStartedAt = now;
      }
      
      newStates.states[sourceId] = updatedState;
      
      // Log the decision
      await logActivityEvent({
        eventType: "SOURCE_GOVERNOR_DECISION",
        severity: newStatus === "disabled" ? "WARN" : "INFO",
        title: `Source ${newStatus === "disabled" ? "Disabled" : newStatus === "enabled" ? "Enabled" : "Probation"}`,
        summary: `Bot ${botName}: ${sourceId} ${state.status} → ${newStatus} (${reason})`,
        botId,
        payload: decision,
      });
    }
  }
  
  return { newStates, decisions };
}

// Reset a specific source to enabled
export function resetSourceToEnabled(
  currentStates: BotSourceStates,
  sourceId: SourceId
): BotSourceStates {
  return {
    ...currentStates,
    states: {
      ...currentStates.states,
      [sourceId]: {
        sourceId,
        status: "enabled" as const,
        lastDecisionAt: new Date(),
        reason: "Manual reset",
      },
    },
  };
}

// Reset all sources to default (all enabled)
export function resetAllSourcesToDefault(): BotSourceStates {
  return getDefaultBotSourceStates();
}

// Enable/disable autonomous selection
export function setAutonomousSelection(
  currentStates: BotSourceStates,
  enabled: boolean
): BotSourceStates {
  return {
    ...currentStates,
    useAutonomousSelection: enabled,
  };
}

// In-memory cache for bot source states (keyed by botId)
const botSourceStatesCache: Map<string, BotSourceStates> = new Map();

// Get source state for a bot (from cache or default)
export function getSourceState(botId: string): BotSourceStates {
  const cached = botSourceStatesCache.get(botId);
  if (cached) return cached;
  return getDefaultBotSourceStates();
}

// Update source state in cache
export function updateSourceState(botId: string, states: BotSourceStates): void {
  botSourceStatesCache.set(botId, states);
}

// Persist bot source states to database (strategyConfig column)
export async function persistBotSourceStates(
  botId: string,
  states: BotSourceStates
): Promise<void> {
  try {
    // Get current bot config
    const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    
    if (!bot) {
      console.warn(`[SOURCE_GOVERNOR] Bot ${botId} not found for state persistence`);
      return;
    }
    
    const currentConfig = (bot.strategyConfig as Record<string, any>) || {};
    const updatedConfig = {
      ...currentConfig,
      _sourceStates: states,
    };
    
    await db.update(bots)
      .set({ strategyConfig: updatedConfig })
      .where(eq(bots.id, botId));
    
    // Update cache
    botSourceStatesCache.set(botId, states);
    
    console.log(`[SOURCE_GOVERNOR] bot_id=${botId} states_persisted enabled=${getEnabledSourceCount(states)}`);
  } catch (error) {
    console.error(`[SOURCE_GOVERNOR] Failed to persist source states for bot ${botId}:`, error);
  }
}

// Load bot source states from database
export async function loadBotSourceStates(
  botId: string
): Promise<BotSourceStates> {
  // Check cache first
  const cached = botSourceStatesCache.get(botId);
  if (cached) return cached;
  
  try {
    const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    
    if (!bot) {
      return getDefaultBotSourceStates();
    }
    
    const config = (bot.strategyConfig as Record<string, any>) || {};
    const storedStates = config._sourceStates as BotSourceStates | undefined;
    
    if (storedStates && storedStates.states) {
      // Hydrate dates from JSON
      const hydrated: BotSourceStates = {
        ...storedStates,
        states: {} as any,
      };
      
      for (const [key, state] of Object.entries(storedStates.states)) {
        hydrated.states[key as SourceId] = {
          ...state,
          lastDecisionAt: state.lastDecisionAt ? new Date(state.lastDecisionAt) : undefined,
          disabledAt: state.disabledAt ? new Date(state.disabledAt) : undefined,
          disabledUntil: state.disabledUntil ? new Date(state.disabledUntil) : undefined,
          probationStartedAt: state.probationStartedAt ? new Date(state.probationStartedAt) : undefined,
        };
      }
      
      botSourceStatesCache.set(botId, hydrated);
      return hydrated;
    }
    
    return getDefaultBotSourceStates();
  } catch (error) {
    console.error(`[SOURCE_GOVERNOR] Failed to load source states for bot ${botId}:`, error);
    return getDefaultBotSourceStates();
  }
}

// Reset bot source states to defaults (all enabled)
export async function resetBotSourceStates(
  botId: string,
  traceId?: string
): Promise<void> {
  const tid = traceId || crypto.randomUUID().slice(0, 8);
  console.log(`[SOURCE_GOVERNOR] trace_id=${tid} bot_id=${botId} RESETTING_SOURCE_STATES`);
  
  // Reset to default states (all enabled, no autonomous selection)
  const defaultStates = getDefaultBotSourceStates();
  defaultStates.useAutonomousSelection = false; // Disable autonomous selection on reset
  defaultStates.lastGovernorRunAt = new Date();
  
  // Clear cache
  botSourceStatesCache.delete(botId);
  
  // Persist to database
  await persistBotSourceStates(botId, defaultStates);
  
  // Log activity event
  await logActivityEvent({
    eventType: "SOURCE_STATE_RESET",
    severity: "INFO",
    title: "Source states reset",
    summary: `All sources re-enabled for bot ${botId}`,
    botId,
    traceId: tid,
  });
  
  console.log(`[SOURCE_GOVERNOR] trace_id=${tid} bot_id=${botId} SOURCE_STATES_RESET complete`);
}
