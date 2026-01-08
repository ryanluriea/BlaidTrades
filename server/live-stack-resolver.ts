import { getRecentUsageEvents, getProofOfUse24h } from "./integration-usage";

const VERIFY_TTL_MS = 15 * 60 * 1000;

const PROVIDER_CATEGORIES = {
  marketData: {
    priority: ["databento", "polygon", "finnhub", "alphavantage", "fmp", "fred"],
    required_envs: {
      databento: ["DATABENTO_API_KEY"],
      polygon: ["POLYGON_API_KEY"],
      finnhub: ["FINNHUB_API_KEY"],
      alphavantage: ["ALPHAVANTAGE_API_KEY"],
      fmp: ["FMP_API_KEY"],
      fred: ["FRED_API_KEY"],
    },
  },
  alternativeData: {
    priority: ["unusual_whales", "news_api", "marketaux"],
    required_envs: {
      unusual_whales: ["UNUSUAL_WHALES_API_KEY"],
      news_api: ["NEWS_API_KEY"],
      marketaux: ["MARKETAUX_API_KEY"],
    },
  },
  execution: {
    priority: ["ironbeam", "ironbeam_2", "ironbeam_3", "tradovate"],
    required_envs: {
      ironbeam: ["IRONBEAM_USERNAME_1", "IRONBEAM_PASSWORD_1", "IRONBEAM_API_KEY_1"],
      ironbeam_2: ["IRONBEAM_USERNAME_2", "IRONBEAM_PASSWORD_2", "IRONBEAM_API_KEY_2"],
      ironbeam_3: ["IRONBEAM_USERNAME_3", "IRONBEAM_PASSWORD_3", "IRONBEAM_API_KEY_3"],
      tradovate: ["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD"],
    },
  },
  llm: {
    priority: ["openai", "anthropic", "gemini", "groq", "xai", "openrouter"],
    required_envs: {
      openai: ["OPENAI_API_KEY"],
      anthropic: ["ANTHROPIC_API_KEY"],
      gemini: ["GOOGLE_GEMINI_API_KEY"],
      groq: ["GROQ_API_KEY"],
      xai: ["XAI_API_KEY"],
      openrouter: ["OPENROUTER_API_KEY"],
    },
  },
  notifications: {
    priority: ["discord"],
    required_envs: {
      discord: ["DISCORD_WEBHOOK_URL"],
    },
  },
  infra: {
    priority: ["redis", "redis_queue"],
    required_envs: {
      redis: ["REDIS_URL"],
      redis_queue: ["QUEUE_REDIS_URL"],
    },
  },
};

export interface ProviderStatus {
  providerId: string;
  configured: boolean;
  verified: boolean;
  connected: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
  proof_24h: number;
  last_used_by_bot_id: number | null;
  missing_env_vars: string[];
  error_code: string | null;
  suggested_fix: string | null;
}

export interface LiveStackStatus {
  marketData: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  alternativeData: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  execution: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  llm: {
    primary: ProviderStatus | null;
    fallbacks: ProviderStatus[];
  };
  notifications: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  infra: {
    database: { connected: boolean; type: string };
    redis: { primary: ProviderStatus | null; queue: ProviderStatus | null };
  };
  autonomyGates: {
    system_status: "OK" | "DEGRADED" | "BLOCKED";
    autonomy_allowed: boolean;
    blockers: Array<{
      code: string;
      severity: "critical" | "warning";
      reason_human: string;
      suggested_fix: string;
      trace_id: string;
    }>;
  };
}

function checkEnvConfigured(envVars: string[]): { configured: boolean; missing: string[] } {
  const missing = envVars.filter((v) => !process.env[v]);
  return { configured: missing.length === 0, missing };
}

async function getProviderStatus(providerId: string, requiredEnvs: string[]): Promise<ProviderStatus> {
  const { configured, missing } = checkEnvConfigured(requiredEnvs);

  const events = await getRecentUsageEvents(providerId, 100);
  const proofOfUse = await getProofOfUse24h(providerId);
  const now = Date.now();

  const verifyEvents = events.filter((e: any) => e.operation === "verify");
  const lastVerify = verifyEvents[0] as any;
  const lastVerifyTime = lastVerify ? new Date(lastVerify.created_at).getTime() : 0;
  const verifiedRecently = lastVerify?.status === "OK" && now - lastVerifyTime < VERIFY_TTL_MS;

  const usageEvents = events.filter((e: any) => e.operation !== "verify");
  const lastUsage = usageEvents[0] as any;

  const lastError = events.find((e: any) => e.status === "ERROR") as any;
  const isFatalError = lastError?.reason_code?.includes("AUTH_") || lastError?.reason_code?.includes("FORBIDDEN");

  return {
    providerId,
    configured,
    verified: verifiedRecently,
    connected: configured && verifiedRecently && !isFatalError,
    last_verified_at: lastVerify?.created_at || null,
    last_used_at: proofOfUse.lastUsedAt,
    proof_24h: proofOfUse.count,
    last_used_by_bot_id: proofOfUse.lastUsedByBotId ? parseInt(proofOfUse.lastUsedByBotId) : null,
    missing_env_vars: missing,
    error_code: lastError?.reason_code || null,
    suggested_fix: !configured
      ? `Add ${missing.join(", ")} to Replit Secrets`
      : lastError
      ? `Last error: ${lastError.reason_code}`
      : null,
  };
}

function selectPrimaryAndBackups(
  statuses: ProviderStatus[]
): { primary: ProviderStatus | null; backups: ProviderStatus[] } {
  const connected = statuses.filter((s) => s.connected);
  const configured = statuses.filter((s) => s.configured && !s.connected);

  if (connected.length > 0) {
    return { primary: connected[0], backups: [...connected.slice(1), ...configured] };
  }
  if (configured.length > 0) {
    return { primary: configured[0], backups: configured.slice(1) };
  }
  return { primary: null, backups: statuses };
}

export async function resolveLiveStackStatus(): Promise<LiveStackStatus> {
  const blockers: LiveStackStatus["autonomyGates"]["blockers"] = [];

  // Market Data Providers
  const marketDataStatuses = await Promise.all(
    PROVIDER_CATEGORIES.marketData.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.marketData.required_envs[p as keyof typeof PROVIDER_CATEGORIES.marketData.required_envs] || [])
    )
  );
  const marketData = selectPrimaryAndBackups(marketDataStatuses);

  // Alternative Data Providers
  const altDataStatuses = await Promise.all(
    PROVIDER_CATEGORIES.alternativeData.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.alternativeData.required_envs[p as keyof typeof PROVIDER_CATEGORIES.alternativeData.required_envs] || [])
    )
  );
  const alternativeData = selectPrimaryAndBackups(altDataStatuses);

  // Execution / Brokers
  const executionStatuses = await Promise.all(
    PROVIDER_CATEGORIES.execution.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.execution.required_envs[p as keyof typeof PROVIDER_CATEGORIES.execution.required_envs] || [])
    )
  );
  const execution = selectPrimaryAndBackups(executionStatuses);

  // AI / LLM Providers
  const llmStatuses = await Promise.all(
    PROVIDER_CATEGORIES.llm.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.llm.required_envs[p as keyof typeof PROVIDER_CATEGORIES.llm.required_envs] || [])
    )
  );
  const llm = { primary: selectPrimaryAndBackups(llmStatuses).primary, fallbacks: selectPrimaryAndBackups(llmStatuses).backups };

  // Notifications
  const notificationStatuses = await Promise.all(
    PROVIDER_CATEGORIES.notifications.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.notifications.required_envs[p as keyof typeof PROVIDER_CATEGORIES.notifications.required_envs] || [])
    )
  );
  const notifications = selectPrimaryAndBackups(notificationStatuses);

  // Infrastructure
  const infraStatuses = await Promise.all(
    PROVIDER_CATEGORIES.infra.priority.map((p) =>
      getProviderStatus(p, PROVIDER_CATEGORIES.infra.required_envs[p as keyof typeof PROVIDER_CATEGORIES.infra.required_envs] || [])
    )
  );
  const hasDatabase = !!process.env.DATABASE_URL;
  const redisPrimary = infraStatuses.find(s => s.providerId === "redis") || null;
  const redisQueue = infraStatuses.find(s => s.providerId === "redis_queue") || null;
  
  const infra = {
    database: { connected: hasDatabase, type: "postgresql" },
    redis: { primary: redisPrimary, queue: redisQueue },
  };

  // Autonomy Gate Checks
  if (!marketData.primary?.configured) {
    blockers.push({
      code: "NO_MARKET_DATA",
      severity: "critical",
      reason_human: "No market data provider configured",
      suggested_fix: "Add DATABENTO_API_KEY or POLYGON_API_KEY to Replit Secrets",
      trace_id: crypto.randomUUID(),
    });
  } else if (!marketData.primary?.connected) {
    blockers.push({
      code: "MARKET_DATA_NOT_VERIFIED",
      severity: "warning",
      reason_human: "Market data provider configured but not verified",
      suggested_fix: "Click Verify button to test connection",
      trace_id: crypto.randomUUID(),
    });
  }

  if (!execution.primary?.configured) {
    blockers.push({
      code: "NO_EXECUTION",
      severity: "critical",
      reason_human: "No execution broker configured",
      suggested_fix: "Add IRONBEAM_USERNAME_1, IRONBEAM_PASSWORD_1, IRONBEAM_API_KEY_1 to Replit Secrets",
      trace_id: crypto.randomUUID(),
    });
  } else if (!execution.primary?.connected) {
    blockers.push({
      code: "EXECUTION_NOT_VERIFIED",
      severity: "warning",
      reason_human: "Execution broker configured but not verified",
      suggested_fix: "Click Verify button to test connection",
      trace_id: crypto.randomUUID(),
    });
  }

  if (!llm.primary?.configured) {
    blockers.push({
      code: "NO_LLM",
      severity: "warning",
      reason_human: "No LLM provider configured",
      suggested_fix: "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to Replit Secrets",
      trace_id: crypto.randomUUID(),
    });
  }

  const hasCritical = blockers.some((b) => b.severity === "critical");
  const hasWarning = blockers.some((b) => b.severity === "warning");
  const system_status = hasCritical ? "BLOCKED" : hasWarning ? "DEGRADED" : "OK";

  return {
    marketData,
    alternativeData,
    execution,
    llm,
    notifications,
    infra,
    autonomyGates: {
      system_status,
      autonomy_allowed: !hasCritical,
      blockers,
    },
  };
}
