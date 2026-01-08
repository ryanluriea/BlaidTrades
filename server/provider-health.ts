/**
 * Provider Health Monitoring System
 * Tracks real-time health of all data providers with latency metrics and status classification
 * INSTITUTIONAL REQUIREMENT: MiFID II / SEC Reg SCI compliance for data provider transparency
 */

export type ProviderStatus = "CONNECTED" | "DEGRADED" | "OFFLINE";

export interface ProviderHealthSnapshot {
  provider: string;
  category: string;
  status: ProviderStatus;
  latencyMs: number | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  errorMessage: string | null;
  updatedAt: Date;
}

export interface ProviderHealthConfig {
  degradedThresholdMs: number;
  offlineAfterFailures: number;
  staleAfterMinutes: number;
}

const DEFAULT_CONFIG: ProviderHealthConfig = {
  degradedThresholdMs: 3000,
  offlineAfterFailures: 3,
  staleAfterMinutes: 5,
};

const providerHealthStore = new Map<string, ProviderHealthSnapshot>();

const PROVIDER_CATEGORIES: Record<string, string> = {
  "Unusual Whales": "Options Flow",
  "FRED": "Macro Indicators",
  "Finnhub": "News Sentiment",
  "NewsAPI": "News Sentiment",
  "Marketaux": "News Sentiment",
  "FMP": "Economic Calendar",
  "Databento": "Market Data",
  "Polygon": "Market Data",
};

function classifyStatus(
  latencyMs: number | null,
  consecutiveFailures: number,
  lastSuccessAt: Date | null,
  config: ProviderHealthConfig
): ProviderStatus {
  if (consecutiveFailures >= config.offlineAfterFailures) {
    return "OFFLINE";
  }
  
  if (lastSuccessAt) {
    const minutesSinceSuccess = (Date.now() - lastSuccessAt.getTime()) / 60000;
    if (minutesSinceSuccess > config.staleAfterMinutes) {
      return "DEGRADED";
    }
  }
  
  if (latencyMs !== null && latencyMs > config.degradedThresholdMs) {
    return "DEGRADED";
  }
  
  if (consecutiveFailures > 0) {
    return "DEGRADED";
  }
  
  return "CONNECTED";
}

export function recordProviderSuccess(
  provider: string,
  latencyMs: number,
  config: ProviderHealthConfig = DEFAULT_CONFIG
): ProviderHealthSnapshot {
  const existing = providerHealthStore.get(provider);
  const now = new Date();
  
  const snapshot: ProviderHealthSnapshot = {
    provider,
    category: PROVIDER_CATEGORIES[provider] || "Unknown",
    status: "CONNECTED",
    latencyMs,
    lastSuccessAt: now,
    lastFailureAt: existing?.lastFailureAt || null,
    consecutiveFailures: 0,
    consecutiveSuccesses: (existing?.consecutiveSuccesses || 0) + 1,
    errorMessage: null,
    updatedAt: now,
  };
  
  snapshot.status = classifyStatus(latencyMs, 0, now, config);
  providerHealthStore.set(provider, snapshot);
  
  return snapshot;
}

export function recordProviderFailure(
  provider: string,
  errorMessage: string,
  config: ProviderHealthConfig = DEFAULT_CONFIG
): ProviderHealthSnapshot {
  const existing = providerHealthStore.get(provider);
  const now = new Date();
  const consecutiveFailures = (existing?.consecutiveFailures || 0) + 1;
  
  const snapshot: ProviderHealthSnapshot = {
    provider,
    category: PROVIDER_CATEGORIES[provider] || "Unknown",
    status: "OFFLINE",
    latencyMs: null,
    lastSuccessAt: existing?.lastSuccessAt || null,
    lastFailureAt: now,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    errorMessage,
    updatedAt: now,
  };
  
  snapshot.status = classifyStatus(null, consecutiveFailures, existing?.lastSuccessAt || null, config);
  providerHealthStore.set(provider, snapshot);
  
  return snapshot;
}

export function getProviderHealth(provider: string): ProviderHealthSnapshot | null {
  return providerHealthStore.get(provider) || null;
}

export function getProviderStatus(provider: string): ProviderStatus {
  const snapshot = providerHealthStore.get(provider);
  if (!snapshot) return "OFFLINE";
  
  const minutesSinceUpdate = (Date.now() - snapshot.updatedAt.getTime()) / 60000;
  if (minutesSinceUpdate > DEFAULT_CONFIG.staleAfterMinutes) {
    return "DEGRADED";
  }
  
  return snapshot.status;
}

export function getAllProviderHealth(): ProviderHealthSnapshot[] {
  return Array.from(providerHealthStore.values());
}

export function getProviderHealthByCategory(category: string): ProviderHealthSnapshot[] {
  return Array.from(providerHealthStore.values()).filter(p => p.category === category);
}

export function getConnectedProviderCount(): number {
  return Array.from(providerHealthStore.values()).filter(p => p.status === "CONNECTED").length;
}

export function getDegradedProviderCount(): number {
  return Array.from(providerHealthStore.values()).filter(p => p.status === "DEGRADED").length;
}

export function getOfflineProviderCount(): number {
  return Array.from(providerHealthStore.values()).filter(p => p.status === "OFFLINE").length;
}

export function resetProviderHealth(provider: string): void {
  providerHealthStore.delete(provider);
}

export function resetAllProviderHealth(): void {
  providerHealthStore.clear();
}

export function simulateProviderOutage(provider: string): ProviderHealthSnapshot {
  return recordProviderFailure(provider, "SIMULATED_OUTAGE: Provider manually marked offline for testing");
}

export function simulateProviderRecovery(provider: string): ProviderHealthSnapshot {
  return recordProviderSuccess(provider, 100);
}

export function getProviderHealthSummary(): {
  total: number;
  connected: number;
  degraded: number;
  offline: number;
  providers: ProviderHealthSnapshot[];
} {
  const providers = getAllProviderHealth();
  return {
    total: providers.length,
    connected: providers.filter(p => p.status === "CONNECTED").length,
    degraded: providers.filter(p => p.status === "DEGRADED").length,
    offline: providers.filter(p => p.status === "OFFLINE").length,
    providers,
  };
}
