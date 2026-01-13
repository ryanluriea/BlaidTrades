import { get, set, del } from "idb-keyval";
import { z } from "zod";

/**
 * Institutional-Grade Cache Infrastructure
 * 
 * Industry-standard patterns from Netflix, Spotify, and financial platforms:
 * 1. Schema Versioning - Auto-invalidate on structure changes
 * 2. Zod Validation - Reject malformed data before React hydration
 * 3. Cache Metrics - Track hit/miss/failure rates for SLO monitoring
 * 4. Quarantine Queue - Store failed hydrations for post-mortem debugging
 * 5. Remote Kill-Switch - Disable caching without redeploy
 */

export const CACHE_SCHEMA_VERSION = "v3";
const IDB_CACHE_KEY = "blaidagent-query-cache-v2";
const IDB_QUARANTINE_KEY = "blaidagent-cache-quarantine";
const CACHE_METRICS_KEY = "blaidagent-cache-metrics";
const KILL_SWITCH_KEY = "blaidagent-cache-disabled";

export interface CacheMetrics {
  hydrationAttempts: number;
  hydrationSuccesses: number;
  hydrationFailures: number;
  validationFailures: number;
  schemaVersionMismatches: number;
  quarantinedPayloads: number;
  lastHydrationMs: number;
  lastHydrationTimestamp: string;
  killSwitchActivations: number;
}

export interface QuarantinedPayload {
  id: string;
  timestamp: string;
  errorType: string;
  errorMessage: string;
  queryKey: string;
  payloadSizeBytes: number;
  schemaVersion: string;
}

const CacheEntrySchema = z.object({
  schemaVersion: z.string(),
  timestamp: z.string(),
  clientState: z.object({
    queries: z.array(z.object({
      queryKey: z.array(z.any()),
      state: z.object({
        data: z.any().optional(),
        dataUpdateCount: z.number().optional(),
        dataUpdatedAt: z.number().optional(),
        error: z.any().nullable().optional(),
        errorUpdateCount: z.number().optional(),
        errorUpdatedAt: z.number().optional(),
        fetchFailureCount: z.number().optional(),
        fetchFailureReason: z.any().nullable().optional(),
        fetchMeta: z.any().nullable().optional(),
        isInvalidated: z.boolean().optional(),
        status: z.string().optional(),
        fetchStatus: z.string().optional(),
      }).passthrough(),
      queryHash: z.string().optional(),
    }).passthrough()).optional(),
    mutations: z.array(z.any()).optional(),
  }).passthrough(),
  buster: z.string().optional(),
});

const metricsDefault: CacheMetrics = {
  hydrationAttempts: 0,
  hydrationSuccesses: 0,
  hydrationFailures: 0,
  validationFailures: 0,
  schemaVersionMismatches: 0,
  quarantinedPayloads: 0,
  lastHydrationMs: 0,
  lastHydrationTimestamp: "",
  killSwitchActivations: 0,
};

let cachedMetrics: CacheMetrics | null = null;
let idbAvailable: boolean | null = null;
let idbCheckPromise: Promise<boolean> | null = null;

export function initIdbCheck(): Promise<boolean> {
  if (idbAvailable !== null) return Promise.resolve(idbAvailable);
  if (idbCheckPromise) return idbCheckPromise;
  
  idbCheckPromise = (async () => {
    try {
      const testKey = "__idb_test__";
      await set(testKey, "test");
      await del(testKey);
      idbAvailable = true;
    } catch {
      idbAvailable = false;
    }
    return idbAvailable;
  })();
  
  return idbCheckPromise;
}

if (typeof window !== "undefined") {
  initIdbCheck();
}

export async function getCacheMetrics(): Promise<CacheMetrics> {
  if (cachedMetrics) return cachedMetrics;
  try {
    const stored = localStorage.getItem(CACHE_METRICS_KEY);
    if (stored) {
      cachedMetrics = JSON.parse(stored);
      return cachedMetrics!;
    }
  } catch {}
  cachedMetrics = { ...metricsDefault };
  return cachedMetrics;
}

async function persistMetrics(metrics: CacheMetrics): Promise<void> {
  cachedMetrics = metrics;
  try {
    localStorage.setItem(CACHE_METRICS_KEY, JSON.stringify(metrics));
  } catch {}
}

async function incrementMetric(key: keyof CacheMetrics, value: number = 1): Promise<void> {
  const metrics = await getCacheMetrics();
  (metrics[key] as number) = ((metrics[key] as number) || 0) + value;
  await persistMetrics(metrics);
}

async function setMetric(key: keyof CacheMetrics, value: number | string): Promise<void> {
  const metrics = await getCacheMetrics();
  (metrics[key] as any) = value;
  await persistMetrics(metrics);
}

let remoteKillSwitchChecked = false;
let remoteKillSwitchValue = false;

export function isCacheKillSwitchActive(): boolean {
  try {
    // Check remote value first (if fetched), then localStorage
    if (remoteKillSwitchChecked && remoteKillSwitchValue) {
      return true;
    }
    return localStorage.getItem(KILL_SWITCH_KEY) === "true";
  } catch {
    return false;
  }
}

export async function checkRemoteKillSwitch(): Promise<boolean> {
  const startTime = performance.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
    
    const response = await fetch("/api/system/cache-control", {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - startTime);
    
    if (response.ok) {
      const data = await response.json();
      remoteKillSwitchChecked = true;
      remoteKillSwitchValue = data.killSwitch === true;
      // Sync to localStorage for immediate effect
      if (remoteKillSwitchValue) {
        localStorage.setItem(KILL_SWITCH_KEY, "true");
        console.warn(`[CACHE_INFRA] Remote kill switch ACTIVE - caching disabled (${latencyMs}ms, source=${data.source})`);
      } else {
        localStorage.removeItem(KILL_SWITCH_KEY);
        console.debug(`[CACHE_INFRA] Remote kill switch check: OFF (${latencyMs}ms, source=${data.source})`);
      }
      return remoteKillSwitchValue;
    } else if (response.status >= 500) {
      // Server error - FAIL SAFE: treat as kill-switch active to prevent stale data issues
      console.warn(`[CACHE_INFRA] Kill-switch fetch failed: HTTP ${response.status} (${latencyMs}ms) - FAIL SAFE: skipping cache`);
      remoteKillSwitchChecked = true;
      remoteKillSwitchValue = true;
      return true;
    } else {
      // Client error (4xx) - fall back to localStorage
      console.warn(`[CACHE_INFRA] Kill-switch fetch failed: HTTP ${response.status} (${latencyMs}ms) - using localStorage fallback`);
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : "Unknown error";
    
    // Network/timeout error on first load: fall back to localStorage (may be offline)
    // If localStorage also empty, proceed with fresh state
    console.warn(`[CACHE_INFRA] Kill-switch fetch error: ${message} (${latencyMs}ms) - using localStorage fallback`);
  }
  remoteKillSwitchChecked = true;
  return isCacheKillSwitchActive();
}

export function setCacheKillSwitch(disabled: boolean): void {
  try {
    if (disabled) {
      localStorage.setItem(KILL_SWITCH_KEY, "true");
      remoteKillSwitchValue = true;
      incrementMetric("killSwitchActivations");
      console.warn("[CACHE_INFRA] Kill switch ACTIVATED - caching disabled");
    } else {
      localStorage.removeItem(KILL_SWITCH_KEY);
      remoteKillSwitchValue = false;
      console.info("[CACHE_INFRA] Kill switch DEACTIVATED - caching enabled");
    }
  } catch {}
}

async function quarantinePayload(
  queryKey: string,
  errorType: string,
  errorMessage: string,
  payloadSize: number
): Promise<void> {
  try {
    const quarantine: QuarantinedPayload[] = JSON.parse(
      localStorage.getItem(IDB_QUARANTINE_KEY) || "[]"
    );
    
    const entry: QuarantinedPayload = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      errorType,
      errorMessage: errorMessage.slice(0, 500),
      queryKey: queryKey.slice(0, 200),
      payloadSizeBytes: payloadSize,
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
    
    quarantine.unshift(entry);
    const trimmed = quarantine.slice(0, 50);
    localStorage.setItem(IDB_QUARANTINE_KEY, JSON.stringify(trimmed));
    await incrementMetric("quarantinedPayloads");
    
    console.warn("[CACHE_INFRA] Quarantined failed payload:", entry);
  } catch {}
}

export async function getQuarantinedPayloads(): Promise<QuarantinedPayload[]> {
  try {
    return JSON.parse(localStorage.getItem(IDB_QUARANTINE_KEY) || "[]");
  } catch {
    return [];
  }
}

export async function clearQuarantine(): Promise<void> {
  try {
    localStorage.removeItem(IDB_QUARANTINE_KEY);
  } catch {}
}

function isEmptyObject(obj: any): boolean {
  return obj && typeof obj === "object" && Object.keys(obj).length === 0;
}

function normalizeRegimeAdjustment(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== "object") return null;
  if (isEmptyObject(obj)) return null;
  const regimeMatch = obj.regimeMatch ?? obj.regime_match;
  if (regimeMatch === undefined || regimeMatch === null) return null;
  return {
    originalScore: obj.originalScore ?? obj.original_score ?? 0,
    adjustedScore: obj.adjustedScore ?? obj.adjusted_score ?? 0,
    regimeBonus: obj.regimeBonus ?? obj.regime_bonus ?? 0,
    regimeMatch: regimeMatch,
    reason: obj.reason ?? "",
    currentRegime: obj.currentRegime ?? obj.current_regime ?? "UNKNOWN",
  };
}

function normalizeCandidate(candidate: any): any {
  if (!candidate || typeof candidate !== "object") return candidate;
  const clone = { ...candidate };
  
  if ("regimeAdjustment" in clone) {
    clone.regimeAdjustment = normalizeRegimeAdjustment(clone.regimeAdjustment);
  }
  if ("regime_adjustment" in clone) {
    clone.regime_adjustment = normalizeRegimeAdjustment(clone.regime_adjustment);
  }
  
  const nullableEmptyFields = [
    "linkedBot", "linked_bot",
    "qcVerification", "qc_verification",
    "explainersJson", "explainers_json",
    "plainLanguageSummaryJson", "plain_language_summary_json",
    "reasoning_json", "reasoningJson",
    "evidence_json", "evidenceJson",
    "capital_sim_json", "capitalSimJson",
    "expected_metrics_json", "expectedMetricsJson",
    "ai_usage_json", "aiUsageJson",
    "genetic_traits", "geneticTraits",
  ];
  
  for (const field of nullableEmptyFields) {
    if (field in clone && isEmptyObject(clone[field])) {
      clone[field] = null;
    }
  }
  
  if ("scores" in clone && clone.scores && typeof clone.scores === "object") {
    if ("aggregate" in clone.scores && isEmptyObject(clone.scores.aggregate)) {
      clone.scores = { ...clone.scores, aggregate: null };
    }
  }
  if ("blueprint" in clone && clone.blueprint && typeof clone.blueprint === "object") {
    if (isEmptyObject(clone.blueprint)) {
      clone.blueprint = { name: null, archetype: null };
    }
  }
  
  return clone;
}

function normalizeCandidateArray(arr: any): any[] {
  if (!Array.isArray(arr)) return arr;
  return arr.map(normalizeCandidate);
}

function normalizeCacheData(client: any): any {
  if (!client?.clientState?.queries) return client;
  
  try {
    const clonedClient = JSON.parse(JSON.stringify(client));
    
    for (const query of clonedClient.clientState.queries) {
      const keyFirst = query?.queryKey?.[0];
      const isStrategyLabQuery = 
        (typeof keyFirst === "string" && (keyFirst.includes("strategy-lab") || keyFirst.includes("strategy-candidates"))) ||
        (Array.isArray(query?.queryKey) && query.queryKey.some((k: any) => 
          typeof k === "string" && (k.includes("strategy-lab") || k.includes("strategy-candidates"))
        ));
      
      if (!isStrategyLabQuery) continue;
      
      const stateData = query?.state?.data;
      if (!stateData) continue;
      
      if (Array.isArray(stateData)) {
        query.state.data = normalizeCandidateArray(stateData);
      } else if (stateData?.pages && Array.isArray(stateData.pages)) {
        query.state.data.pages = stateData.pages.map((page: any) => {
          if (Array.isArray(page)) return normalizeCandidateArray(page);
          if (page?.data && Array.isArray(page.data)) {
            return { ...page, data: normalizeCandidateArray(page.data) };
          }
          return page;
        });
      } else if (stateData?.data && Array.isArray(stateData.data)) {
        query.state.data.data = normalizeCandidateArray(stateData.data);
      } else if (typeof stateData === "object") {
        query.state.data = normalizeCandidate(stateData);
      }
    }
    return clonedClient;
  } catch {
    return client;
  }
}

function validateCacheStructure(cached: any): { valid: boolean; error?: string } {
  try {
    CacheEntrySchema.parse(cached);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown validation error";
    return { valid: false, error: message };
  }
}

function checkSchemaVersion(cached: any): boolean {
  const storedVersion = cached?.schemaVersion;
  if (!storedVersion) return false;
  return storedVersion === CACHE_SCHEMA_VERSION;
}

export const institutionalPersister = {
  persistClient: async (client: any) => {
    if (isCacheKillSwitchActive()) {
      console.debug("[CACHE_INFRA] Kill switch active - skipping persist");
      return;
    }
    
    const useIdb = idbAvailable ?? await initIdbCheck();
    const payload = {
      ...client,
      schemaVersion: CACHE_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
    };
    
    if (useIdb) {
      try {
        await set(IDB_CACHE_KEY, payload);
        return;
      } catch {
        idbAvailable = false;
      }
    }
    try {
      localStorage.setItem(IDB_CACHE_KEY, JSON.stringify(payload));
    } catch {}
  },
  
  restoreClient: async () => {
    const startTime = performance.now();
    await incrementMetric("hydrationAttempts");
    
    // Check remote kill-switch FIRST before hydrating any cached data
    // This allows Ops to disable caching remotely without redeploy
    await checkRemoteKillSwitch();
    
    if (isCacheKillSwitchActive()) {
      console.info("[CACHE_INFRA] Kill switch active - returning fresh state");
      return undefined;
    }
    
    const useIdb = idbAvailable ?? await initIdbCheck();
    
    try {
      let cached;
      if (useIdb) {
        cached = await get(IDB_CACHE_KEY);
      }
      if (!cached) {
        const lsData = localStorage.getItem(IDB_CACHE_KEY);
        if (lsData) cached = JSON.parse(lsData);
      }
      
      if (!cached) {
        return undefined;
      }
      
      if (!checkSchemaVersion(cached)) {
        await incrementMetric("schemaVersionMismatches");
        console.warn(
          `[CACHE_INFRA] Schema version mismatch (stored=${cached?.schemaVersion}, current=${CACHE_SCHEMA_VERSION}) - invalidating cache`
        );
        await institutionalPersister.removeClient();
        return undefined;
      }
      
      const validation = validateCacheStructure(cached);
      if (!validation.valid) {
        await incrementMetric("validationFailures");
        const payloadSize = JSON.stringify(cached).length;
        await quarantinePayload(
          "cache-root",
          "VALIDATION_FAILURE",
          validation.error || "Unknown",
          payloadSize
        );
        console.error("[CACHE_INFRA] Validation failed:", validation.error);
        await institutionalPersister.removeClient();
        return undefined;
      }
      
      const normalized = normalizeCacheData(cached);
      
      const hydrationMs = Math.round(performance.now() - startTime);
      await setMetric("lastHydrationMs", hydrationMs);
      await setMetric("lastHydrationTimestamp", new Date().toISOString());
      await incrementMetric("hydrationSuccesses");
      
      console.info(`[CACHE_INFRA] Hydration success in ${hydrationMs}ms`);
      
      return normalized;
    } catch (err) {
      await incrementMetric("hydrationFailures");
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[CACHE_INFRA] Hydration failed:", errorMessage);
      
      await quarantinePayload("cache-restore", "HYDRATION_ERROR", errorMessage, 0);
      
      try {
        await institutionalPersister.removeClient();
      } catch {}
      
      return undefined;
    }
  },
  
  removeClient: async () => {
    try {
      const useIdb = idbAvailable ?? await initIdbCheck();
      if (useIdb) await del(IDB_CACHE_KEY);
      localStorage.removeItem(IDB_CACHE_KEY);
    } catch {}
  },
};

export async function reportCacheHealth(): Promise<{
  metrics: CacheMetrics;
  quarantineCount: number;
  killSwitchActive: boolean;
  schemaVersion: string;
  hydrationSuccessRate: number;
}> {
  const metrics = await getCacheMetrics();
  const quarantine = await getQuarantinedPayloads();
  
  const successRate = metrics.hydrationAttempts > 0
    ? (metrics.hydrationSuccesses / metrics.hydrationAttempts) * 100
    : 100;
  
  return {
    metrics,
    quarantineCount: quarantine.length,
    killSwitchActive: isCacheKillSwitchActive(),
    schemaVersion: CACHE_SCHEMA_VERSION,
    hydrationSuccessRate: Math.round(successRate * 100) / 100,
  };
}

export async function resetCacheMetrics(): Promise<void> {
  cachedMetrics = { ...metricsDefault };
  await persistMetrics(cachedMetrics);
}

if (typeof window !== "undefined") {
  (window as any).__cacheInfra = {
    getCacheMetrics,
    getQuarantinedPayloads,
    clearQuarantine,
    setCacheKillSwitch,
    isCacheKillSwitchActive,
    checkRemoteKillSwitch,
    reportCacheHealth,
    resetCacheMetrics,
    CACHE_SCHEMA_VERSION,
  };
}
