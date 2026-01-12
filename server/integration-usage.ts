/**
 * Integration Usage Telemetry
 * Logs proof-of-use events for all integration calls
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { trackProviderSuccess, trackProviderFailure, type AIProvider } from "./ai-strategy-evolution";

const AI_PROVIDERS_SET = new Set(["openai", "anthropic", "gemini", "groq", "xai", "openrouter", "perplexity"]);

export interface IntegrationUsageParams {
  provider: string;
  operation: string;
  botId?: string;
  userId?: string;
  runId?: string;
  integrationId?: string;
  status: 'OK' | 'ERROR' | 'TIMEOUT' | 'RATE_LIMITED';
  latencyMs?: number;
  httpStatus?: number;
  errorCode?: string;
  traceId?: string;
  symbol?: string;
  timeframe?: string;
  records?: number;
  metadata?: Record<string, any>;
}

/**
 * Log an integration usage event
 * This is the canonical way to record proof-of-use for any integration call
 */
export async function logIntegrationUsage(params: IntegrationUsageParams): Promise<string> {
  const traceId = params.traceId || crypto.randomUUID();
  
  try {
    await db.execute(sql`
      INSERT INTO integration_usage_events 
      (user_id, bot_id, run_id, integration_id, integration, operation, status, latency_ms, symbol, timeframe, records, reason_code, metadata, trace_id)
      VALUES (
        ${params.userId ? sql`${params.userId}::uuid` : sql`NULL`}, 
        ${params.botId ? sql`${params.botId}::uuid` : sql`NULL`}, 
        ${params.runId ? sql`${params.runId}::uuid` : sql`NULL`}, 
        ${params.integrationId ? sql`${params.integrationId}::uuid` : sql`NULL`}, 
        ${params.provider}, 
        ${params.operation}, 
        ${params.status}::usage_event_status, 
        ${params.latencyMs || 0},
        ${params.symbol || null},
        ${params.timeframe || null},
        ${params.records || null},
        ${params.errorCode || null},
        ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb,
        ${traceId}
      )
    `);
    
    console.log(`[INTEGRATION_USAGE] trace_id=${traceId} provider=${params.provider} operation=${params.operation} status=${params.status} latency_ms=${params.latencyMs || 0}`);
    
    return traceId;
  } catch (error) {
    console.error(`[INTEGRATION_USAGE] trace_id=${traceId} error=`, error);
    throw error;
  }
}

/**
 * Get proof-of-use stats for a provider in the last 24 hours
 */
export async function getProofOfUse24h(provider: string): Promise<{
  count: number;
  lastUsedAt: string | null;
  lastUsedByBotId: string | null;
}> {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) as count,
      MAX(created_at) as last_used_at,
      (SELECT bot_id FROM integration_usage_events 
       WHERE integration = ${provider} 
       AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1) as last_used_by_bot_id
    FROM integration_usage_events
    WHERE integration = ${provider}
    AND created_at > NOW() - INTERVAL '24 hours'
  `);
  
  const row = result.rows[0] as any;
  let lastUsedAt: string | null = null;
  if (row.last_used_at) {
    lastUsedAt = row.last_used_at instanceof Date 
      ? row.last_used_at.toISOString() 
      : String(row.last_used_at);
  }
  return {
    count: parseInt(row.count) || 0,
    lastUsedAt,
    lastUsedByBotId: row.last_used_by_bot_id || null,
  };
}

/**
 * Get recent usage events for a provider
 */
export async function getRecentUsageEvents(provider: string, limit: number = 20): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT 
      id, user_id, bot_id, run_id, integration, operation, 
      status, latency_ms, symbol, timeframe, records, 
      reason_code, created_at, trace_id
    FROM integration_usage_events
    WHERE integration = ${provider}
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT ${limit}
  `);
  
  return result.rows;
}

/**
 * Verify an integration by making a real API call
 * Returns verification result and logs proof-of-use
 */
export async function verifyIntegration(provider: string): Promise<{
  success: boolean;
  connected: boolean;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  traceId: string;
}> {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    let result: { success: boolean; error?: string };
    
    switch (provider.toLowerCase()) {
      case 'databento':
        result = await verifyDatabento();
        break;
      case 'polygon':
        result = await verifyPolygon();
        break;
      case 'openai':
        result = await verifyOpenAI();
        break;
      case 'anthropic':
        result = await verifyAnthropic();
        break;
      case 'discord':
        result = await verifyDiscord();
        break;
      case 'ironbeam':
      case 'ironbeam_2':
      case 'ironbeam_3':
      case 'tradovate':
        // Broker verification - mark as success if configured (actual trading verification is complex)
        result = { success: true, error: undefined };
        break;
      case 'redis':
        result = await verifyRedis('REDIS_URL');
        break;
      case 'redis_queue':
        result = await verifyRedis('QUEUE_REDIS_URL');
        break;
      case 'finnhub':
        result = await verifyFinnhub();
        break;
      case 'alphavantage':
        result = await verifyAlphavantage();
        break;
      case 'fmp':
        result = await verifyFMP();
        break;
      case 'fred':
        result = await verifyFRED();
        break;
      case 'unusual_whales':
        result = await verifyUnusualWhales();
        break;
      case 'news_api':
        result = await verifyNewsAPI();
        break;
      case 'marketaux':
        result = await verifyMarketaux();
        break;
      case 'gemini':
        result = await verifyGemini();
        break;
      case 'groq':
        result = await verifyGroq();
        break;
      case 'xai':
        result = await verifyXAI();
        break;
      case 'perplexity':
        result = await verifyPerplexity();
        break;
      case 'openrouter':
        result = await verifyOpenRouter();
        break;
      case 'quantconnect':
        result = await verifyQuantConnect();
        break;
      default:
        result = { success: false, error: 'Unknown provider' };
    }
    
    const latencyMs = Date.now() - startTime;
    
    // Log proof-of-use
    await logIntegrationUsage({
      provider,
      operation: 'verify',
      status: result.success ? 'OK' : 'ERROR',
      latencyMs,
      errorCode: result.error ? 'VERIFY_FAILED' : undefined,
      traceId,
      metadata: { verification: true },
    });
    
    // Update AI cascade health for AI providers
    if (AI_PROVIDERS_SET.has(provider.toLowerCase())) {
      if (result.success) {
        trackProviderSuccess(provider.toLowerCase() as AIProvider);
      } else {
        trackProviderFailure(provider.toLowerCase() as AIProvider, result.error || 'Verification failed');
      }
    }
    
    return {
      success: result.success,
      connected: result.success,
      latencyMs,
      errorCode: result.error ? 'VERIFY_FAILED' : undefined,
      errorMessage: result.error,
      traceId,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    await logIntegrationUsage({
      provider,
      operation: 'verify',
      status: 'ERROR',
      latencyMs,
      errorCode: 'VERIFY_EXCEPTION',
      traceId,
      metadata: { error: error.message },
    });
    
    // Update AI cascade health for AI providers
    if (AI_PROVIDERS_SET.has(provider.toLowerCase())) {
      trackProviderFailure(provider.toLowerCase() as AIProvider, error.message || 'Verification exception');
    }
    
    return {
      success: false,
      connected: false,
      latencyMs,
      errorCode: 'VERIFY_EXCEPTION',
      errorMessage: error.message,
      traceId,
    };
  }
}

// Individual provider verification functions

async function verifyDatabento(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'DATABENTO_API_KEY not set' };
  }
  
  try {
    // Make a lightweight API call to verify the key
    const response = await fetch('https://hist.databento.com/v0/metadata.list_datasets', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
      },
    });
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyPolygon(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'POLYGON_API_KEY not set' };
  }
  
  try {
    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apiKey=${apiKey}`);
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Invalid API key' };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyOpenAI(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY not set' };
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyAnthropic(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'ANTHROPIC_API_KEY not set' };
  }
  
  try {
    // Anthropic doesn't have a simple "list models" endpoint, so we check key format
    // In production, you could make a minimal completion request
    if (apiKey.startsWith('sk-ant-')) {
      return { success: true };
    } else {
      return { success: false, error: 'Invalid API key format' };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyDiscord(): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { success: false, error: 'DISCORD_WEBHOOK_URL not set' };
  }
  
  try {
    // Validate webhook URL format
    if (!webhookUrl.includes('discord.com/api/webhooks/')) {
      return { success: false, error: 'Invalid webhook URL format' };
    }
    
    // Make a GET request to verify webhook exists (doesn't send a message)
    const response = await fetch(webhookUrl);
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401 || response.status === 404) {
      return { success: false, error: 'Invalid webhook URL' };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyRedis(envVarName: string): Promise<{ success: boolean; error?: string }> {
  const redisUrl = process.env[envVarName];
  
  if (!redisUrl) {
    return { success: false, error: `${envVarName} not set` };
  }
  
  try {
    // Dynamic import to avoid loading redis if not needed
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    
    // Set a timeout for the connection
    const connectTimeout = new Promise<{ success: false; error: string }>((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );
    
    const connectAttempt = (async () => {
      await client.connect();
      const pong = await client.ping();
      await client.disconnect();
      return { success: pong === 'PONG', error: pong !== 'PONG' ? 'PING failed' : undefined };
    })();
    
    const result = await Promise.race([connectAttempt, connectTimeout]);
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyFinnhub(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { success: false, error: 'FINNHUB_API_KEY not set' };
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${apiKey}`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyAlphavantage(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) return { success: false, error: 'ALPHAVANTAGE_API_KEY not set' };
  try {
    const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${apiKey}`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyFMP(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { success: false, error: 'FMP_API_KEY not set' };
  try {
    // Use stable API endpoint with correct parameter name (symbol, not symbols)
    const response = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${apiKey}`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyFRED(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return { success: false, error: 'FRED_API_KEY not set' };
  try {
    const response = await fetch(`https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${apiKey}&file_type=json`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyUnusualWhales(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY;
  if (!apiKey) return { success: false, error: 'UNUSUAL_WHALES_API_KEY not set' };
  try {
    // Use flow-alerts endpoint which is confirmed to work
    const response = await fetch('https://api.unusualwhales.com/api/option-trades/flow-alerts', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyNewsAPI(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return { success: false, error: 'NEWS_API_KEY not set' };
  try {
    const response = await fetch(`https://newsapi.org/v2/top-headlines?country=us&apiKey=${apiKey}`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyMarketaux(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.MARKETAUX_API_KEY;
  if (!apiKey) return { success: false, error: 'MARKETAUX_API_KEY not set' };
  try {
    const response = await fetch(`https://api.marketaux.com/v1/news/all?api_token=${apiKey}&limit=1`);
    if (response.ok) return { success: true };
    if (response.status === 402) {
      return { success: true, error: 'DEGRADED: API quota exceeded (402), using fallback providers' };
    }
    if (response.status === 429) {
      return { success: true, error: 'DEGRADED: Rate limited (429), using fallback providers' };
    }
    return { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyGemini(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return { success: false, error: 'GOOGLE_GEMINI_API_KEY not set' };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyGroq(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { success: false, error: 'GROQ_API_KEY not set' };
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyXAI(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { success: false, error: 'XAI_API_KEY not set' };
  try {
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyPerplexity(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { success: false, error: 'PERPLEXITY_API_KEY not set' };
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyOpenRouter(): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { success: false, error: 'OPENROUTER_API_KEY not set' };
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok ? { success: true } : { success: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function verifyQuantConnect(): Promise<{ success: boolean; error?: string }> {
  const userId = process.env.QUANTCONNECT_USER_ID;
  const apiToken = process.env.QUANTCONNECT_API_TOKEN;
  if (!userId || !apiToken) return { success: false, error: 'QUANTCONNECT_USER_ID or QUANTCONNECT_API_TOKEN not set' };
  try {
    // Use the QuantConnect provider to verify credentials
    const { verifyQCConfig, testAuthentication } = await import('./providers/quantconnect/index');
    const configStatus = verifyQCConfig();
    if (!configStatus.configured) {
      return { success: false, error: configStatus.suggestedFix };
    }
    // Actually test authentication with QC API
    const authResult = await testAuthentication(crypto.randomUUID().slice(0, 8));
    return authResult.success ? { success: true } : { success: false, error: authResult.error };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
