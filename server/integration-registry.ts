/**
 * Canonical Integration Registry
 * Single source of truth for all integration providers and their requirements
 */

export interface IntegrationDefinition {
  provider: string;
  category: 'data' | 'broker' | 'ai' | 'alerts' | 'storage';
  displayName: string;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  supportsVerify: boolean;
  supportsProofOfUse: boolean;
  description: string;
}

/**
 * Canonical registry of all integrations
 */
export const INTEGRATION_REGISTRY: Record<string, IntegrationDefinition> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET DATA PROVIDERS
  // ═══════════════════════════════════════════════════════════════════════════
  databento: {
    provider: 'databento',
    category: 'data',
    displayName: 'Databento',
    requiredEnvVars: ['DATABENTO_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Primary futures market data (CME MES/MNQ real-time + historical bars)',
  },
  polygon: {
    provider: 'polygon',
    category: 'data',
    displayName: 'Polygon.io',
    requiredEnvVars: ['POLYGON_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Backup market data provider (futures quotes, bars)',
  },
  finnhub: {
    provider: 'finnhub',
    category: 'data',
    displayName: 'Finnhub',
    requiredEnvVars: ['FINNHUB_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Alternative market data, news sentiment',
  },
  alphavantage: {
    provider: 'alphavantage',
    category: 'data',
    displayName: 'Alpha Vantage',
    requiredEnvVars: ['ALPHAVANTAGE_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Stock/forex data (backup)',
  },
  fmp: {
    provider: 'fmp',
    category: 'data',
    displayName: 'Financial Modeling Prep',
    requiredEnvVars: ['FMP_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Economic calendar events',
  },
  fred: {
    provider: 'fred',
    category: 'data',
    displayName: 'FRED',
    requiredEnvVars: ['FRED_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Federal Reserve economic data',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ALTERNATIVE DATA PROVIDERS
  // ═══════════════════════════════════════════════════════════════════════════
  unusual_whales: {
    provider: 'unusual_whales',
    category: 'data',
    displayName: 'Unusual Whales',
    requiredEnvVars: ['UNUSUAL_WHALES_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Options flow, dark pool data',
  },
  news_api: {
    provider: 'news_api',
    category: 'data',
    displayName: 'News API',
    requiredEnvVars: ['NEWS_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'News aggregation for sentiment',
  },
  marketaux: {
    provider: 'marketaux',
    category: 'data',
    displayName: 'Marketaux',
    requiredEnvVars: ['MARKETAUX_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'News sentiment analysis',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BROKERS / EXECUTION (3 Ironbeam accounts)
  // ═══════════════════════════════════════════════════════════════════════════
  ironbeam: {
    provider: 'ironbeam',
    category: 'broker',
    displayName: 'Ironbeam (Account 1)',
    requiredEnvVars: ['IRONBEAM_USERNAME_1', 'IRONBEAM_PASSWORD_1', 'IRONBEAM_API_KEY_1'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Primary futures broker for live trading',
  },
  ironbeam_2: {
    provider: 'ironbeam_2',
    category: 'broker',
    displayName: 'Ironbeam (Account 2)',
    requiredEnvVars: ['IRONBEAM_USERNAME_2', 'IRONBEAM_PASSWORD_2', 'IRONBEAM_API_KEY_2'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Secondary futures broker account',
  },
  ironbeam_3: {
    provider: 'ironbeam_3',
    category: 'broker',
    displayName: 'Ironbeam (Account 3)',
    requiredEnvVars: ['IRONBEAM_USERNAME_3', 'IRONBEAM_PASSWORD_3', 'IRONBEAM_API_KEY_3'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Tertiary futures broker account',
  },
  tradovate: {
    provider: 'tradovate',
    category: 'broker',
    displayName: 'Tradovate',
    requiredEnvVars: ['TRADOVATE_USERNAME', 'TRADOVATE_PASSWORD'],
    optionalEnvVars: ['TRADOVATE_APP_ID', 'TRADOVATE_APP_VERSION'],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Backup futures broker for execution',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AI / LLM PROVIDERS
  // ═══════════════════════════════════════════════════════════════════════════
  openai: {
    provider: 'openai',
    category: 'ai',
    displayName: 'OpenAI',
    requiredEnvVars: ['OPENAI_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'GPT models for evolution/mutation suggestions',
  },
  anthropic: {
    provider: 'anthropic',
    category: 'ai',
    displayName: 'Anthropic',
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Claude for Strategy Lab research',
  },
  gemini: {
    provider: 'gemini',
    category: 'ai',
    displayName: 'Google Gemini',
    requiredEnvVars: ['GOOGLE_GEMINI_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Gemini for strategy synthesis',
  },
  groq: {
    provider: 'groq',
    category: 'ai',
    displayName: 'Groq',
    requiredEnvVars: ['GROQ_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Fast inference (Llama models)',
  },
  xai: {
    provider: 'xai',
    category: 'ai',
    displayName: 'xAI Grok 4',
    requiredEnvVars: ['XAI_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Grok 4.1 for autonomous strategy research, contrarian analysis, and X/Twitter sentiment',
  },
  perplexity: {
    provider: 'perplexity',
    category: 'ai',
    displayName: 'Perplexity',
    requiredEnvVars: ['PERPLEXITY_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Web-grounded research for Strategy Lab (Sonar models with citations)',
  },
  openrouter: {
    provider: 'openrouter',
    category: 'ai',
    displayName: 'OpenRouter',
    requiredEnvVars: ['OPENROUTER_API_KEY'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Multi-model routing fallback',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS / ALERTS
  // ═══════════════════════════════════════════════════════════════════════════
  discord: {
    provider: 'discord',
    category: 'alerts',
    displayName: 'Discord',
    requiredEnvVars: ['DISCORD_WEBHOOK_OPS'],
    optionalEnvVars: ['DISCORD_WEBHOOK_TRADING', 'DISCORD_WEBHOOK_AUTONOMY', 'DISCORD_WEBHOOK_ALERTS', 'DISCORD_WEBHOOK_LAB', 'DISCORD_WEBHOOK_AUDIT'],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Discord webhooks for ops alerts, trading notifications, and autonomy events',
  },
  aws_sns: {
    provider: 'aws_sns',
    category: 'alerts',
    displayName: 'AWS SNS',
    requiredEnvVars: ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    optionalEnvVars: ['AWS_SNS_DEFAULT_SENDER_ID'],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'SMS notifications via AWS Simple Notification Service',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════
  redis: {
    provider: 'redis',
    category: 'storage',
    displayName: 'Redis (Primary)',
    requiredEnvVars: ['REDIS_URL'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Primary Redis for caching, distributed locks',
  },
  redis_queue: {
    provider: 'redis_queue',
    category: 'storage',
    displayName: 'Redis (Job Queue)',
    requiredEnvVars: ['QUEUE_REDIS_URL'],
    optionalEnvVars: [],
    supportsVerify: true,
    supportsProofOfUse: true,
    description: 'Job queue processing (bot_jobs)',
  },
};

/**
 * Get all integrations by category
 */
export function getIntegrationsByCategory(category: IntegrationDefinition['category']): IntegrationDefinition[] {
  return Object.values(INTEGRATION_REGISTRY).filter(i => i.category === category);
}

/**
 * Check if an integration is configured (all required env vars present)
 */
export function isIntegrationConfigured(provider: string): { configured: boolean; missingEnvVars: string[] } {
  const integration = INTEGRATION_REGISTRY[provider.toLowerCase()];
  if (!integration) {
    return { configured: false, missingEnvVars: [] };
  }
  
  const missingEnvVars = integration.requiredEnvVars.filter(
    envVar => !process.env[envVar]
  );
  
  return {
    configured: missingEnvVars.length === 0,
    missingEnvVars,
  };
}

/**
 * Get required integrations for a bot stage
 */
export function getRequiredIntegrationsForStage(stage: string): string[] {
  switch (stage) {
    case 'LIVE':
      // LIVE requires broker + data feed
      return ['databento', 'ironbeam'];
    case 'CANARY':
      // CANARY requires broker + data feed  
      return ['databento', 'ironbeam'];
    case 'SHADOW':
      // SHADOW requires broker + data feed (shadow execution)
      return ['databento', 'ironbeam'];
    case 'PAPER':
      // PAPER requires broker configured (for paper trading via broker API)
      // INSTITUTIONAL REQUIREMENT: Broker must be configured even for sim execution
      return ['databento', 'ironbeam'];
    case 'TRIALS':
    default:
      // TRIALS has no requirements (backtesting only)
      return [];
  }
}

/**
 * Check all required integrations for a stage
 */
export function checkRequiredIntegrations(stage: string): {
  allConfigured: boolean;
  missing: Array<{ provider: string; missingEnvVars: string[]; suggestedFix: string }>;
} {
  const required = getRequiredIntegrationsForStage(stage);
  const missing: Array<{ provider: string; missingEnvVars: string[]; suggestedFix: string }> = [];
  
  for (const provider of required) {
    const check = isIntegrationConfigured(provider);
    if (!check.configured) {
      const integration = INTEGRATION_REGISTRY[provider];
      missing.push({
        provider,
        missingEnvVars: check.missingEnvVars,
        suggestedFix: `Add the following environment variables: ${check.missingEnvVars.join(', ')}. Configure in Replit Secrets.`,
      });
    }
  }
  
  return {
    allConfigured: missing.length === 0,
    missing,
  };
}

/**
 * Get all integrations with their configuration status
 */
export function getAllIntegrationsStatus(): Array<IntegrationDefinition & { configured: boolean; missingEnvVars: string[] }> {
  return Object.values(INTEGRATION_REGISTRY).map(integration => {
    const check = isIntegrationConfigured(integration.provider);
    return {
      ...integration,
      configured: check.configured,
      missingEnvVars: check.missingEnvVars,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMOUS CREDENTIAL LIFECYCLE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

interface CredentialState {
  provider: string;
  wasConfigured: boolean;
  lastChecked: Date;
  becameConfiguredAt?: Date;
  becameMissingAt?: Date;
}

const credentialStateCache = new Map<string, CredentialState>();

/**
 * Track credential state changes for autonomous alert resolution
 * Returns providers that were recently configured (for auto-resolving alerts)
 */
export function checkCredentialStateChanges(): {
  newlyConfigured: string[];
  newlyMissing: string[];
  stableConfigured: string[];
  stableMissing: string[];
} {
  const now = new Date();
  const newlyConfigured: string[] = [];
  const newlyMissing: string[] = [];
  const stableConfigured: string[] = [];
  const stableMissing: string[] = [];

  for (const [provider, integration] of Object.entries(INTEGRATION_REGISTRY)) {
    const check = isIntegrationConfigured(provider);
    const previousState = credentialStateCache.get(provider);

    if (!previousState) {
      // First check - establish baseline
      credentialStateCache.set(provider, {
        provider,
        wasConfigured: check.configured,
        lastChecked: now,
        becameConfiguredAt: check.configured ? now : undefined,
        becameMissingAt: check.configured ? undefined : now,
      });
      
      if (check.configured) {
        stableConfigured.push(provider);
      } else {
        stableMissing.push(provider);
      }
      continue;
    }

    // Compare with previous state
    if (check.configured && !previousState.wasConfigured) {
      // Credential was added! Auto-resolve any related alerts
      newlyConfigured.push(provider);
      console.log(`[CREDENTIAL_LIFECYCLE] AUTO_RESOLVE provider=${provider} reason=credential_added`);
      
      credentialStateCache.set(provider, {
        ...previousState,
        wasConfigured: true,
        lastChecked: now,
        becameConfiguredAt: now,
        becameMissingAt: undefined,
      });
    } else if (!check.configured && previousState.wasConfigured) {
      // Credential was removed! Create alert
      newlyMissing.push(provider);
      console.warn(`[CREDENTIAL_LIFECYCLE] ALERT_CREATED provider=${provider} reason=credential_removed missing=${check.missingEnvVars.join(',')}`);
      
      credentialStateCache.set(provider, {
        ...previousState,
        wasConfigured: false,
        lastChecked: now,
        becameConfiguredAt: undefined,
        becameMissingAt: now,
      });
    } else if (check.configured) {
      stableConfigured.push(provider);
      credentialStateCache.set(provider, { ...previousState, lastChecked: now });
    } else {
      stableMissing.push(provider);
      credentialStateCache.set(provider, { ...previousState, lastChecked: now });
    }
  }

  return { newlyConfigured, newlyMissing, stableConfigured, stableMissing };
}

/**
 * Get credential lifecycle summary for system health display
 */
export function getCredentialLifecycleSummary(): {
  totalProviders: number;
  configured: number;
  missing: number;
  criticalMissing: string[];
  recentlyResolved: string[];
} {
  const allStatus = getAllIntegrationsStatus();
  const configured = allStatus.filter(i => i.configured);
  const missing = allStatus.filter(i => !i.configured);
  
  // Critical providers that must be configured for production
  const criticalProviders = ['databento', 'ironbeam', 'anthropic', 'openai'];
  const criticalMissing = criticalProviders.filter(p => {
    const status = allStatus.find(i => i.provider === p);
    return status && !status.configured;
  });

  // Get recently resolved (configured within last hour)
  const recentlyResolved: string[] = [];
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  for (const [provider, state] of credentialStateCache.entries()) {
    if (state.wasConfigured && state.becameConfiguredAt && state.becameConfiguredAt > oneHourAgo) {
      recentlyResolved.push(provider);
    }
  }

  return {
    totalProviders: allStatus.length,
    configured: configured.length,
    missing: missing.length,
    criticalMissing,
    recentlyResolved,
  };
}
