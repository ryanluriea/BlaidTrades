/**
 * Universal Broker Resilience Wrapper
 * 
 * Provides circuit breaker + retry + timeout for all broker/market integrations.
 * Critical for trading systems where external API failures can cascade.
 * 
 * Covered integrations:
 * - Ironbeam (live trading)
 * - Tradovate (live trading)
 * - Databento (market data)
 * - Unusual Whales (options flow)
 * - FRED (economic data)
 * - News APIs (sentiment)
 */

import { withCircuitBreaker, withRetry, getAllCircuitStats, resetCircuit } from '../circuit-breaker';
import { latencyTracker } from '../observability/latency-tracker';

type IntegrationType = 'broker' | 'market_data' | 'research' | 'news';

interface BrokerConfig {
  name: string;
  type: IntegrationType;
  timeoutMs: number;
  maxRetries: number;
  failureThreshold: number;
  cooldownMs: number;
}

const BROKER_CONFIGS: Record<string, BrokerConfig> = {
  'ironbeam': {
    name: 'ironbeam',
    type: 'broker',
    timeoutMs: 10000,    // 10s for orders
    maxRetries: 2,       // Limited retries for orders
    failureThreshold: 3, // Open circuit after 3 failures
    cooldownMs: 30000,   // 30s cooldown
  },
  'tradovate': {
    name: 'tradovate',
    type: 'broker',
    timeoutMs: 10000,
    maxRetries: 2,
    failureThreshold: 3,
    cooldownMs: 30000,
  },
  'databento': {
    name: 'databento',
    type: 'market_data',
    timeoutMs: 30000,    // 30s for data fetches
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 60000,   // 1 min cooldown
  },
  'unusual_whales': {
    name: 'unusual_whales',
    type: 'research',
    timeoutMs: 15000,
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  'fred': {
    name: 'fred',
    type: 'research',
    timeoutMs: 20000,
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 120000,  // 2 min cooldown
  },
  'finnhub': {
    name: 'finnhub',
    type: 'news',
    timeoutMs: 15000,
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  'newsapi': {
    name: 'newsapi',
    type: 'news',
    timeoutMs: 15000,
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  'groq': {
    name: 'groq',
    type: 'research',
    timeoutMs: 60000,    // 60s for AI
    maxRetries: 2,
    failureThreshold: 5,
    cooldownMs: 30000,
  },
  'openai': {
    name: 'openai',
    type: 'research',
    timeoutMs: 90000,    // 90s for AI
    maxRetries: 2,
    failureThreshold: 5,
    cooldownMs: 30000,
  },
  'anthropic': {
    name: 'anthropic',
    type: 'research',
    timeoutMs: 90000,
    maxRetries: 2,
    failureThreshold: 5,
    cooldownMs: 30000,
  },
};

export async function withBrokerResilience<T>(
  broker: string,
  operation: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  const config = BROKER_CONFIGS[broker.toLowerCase()] ?? {
    name: broker,
    type: 'research' as IntegrationType,
    timeoutMs: 30000,
    maxRetries: 3,
    failureThreshold: 5,
    cooldownMs: 60000,
  };
  
  const circuitName = `${config.name}:${operation}`;
  const startTime = Date.now();
  
  try {
    const result = await withCircuitBreaker(
      circuitName,
      () => withRetry(circuitName, fn, {
        maxRetries: config.maxRetries,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        onRetry: (attempt, error) => {
          console.warn(`[BROKER_RESILIENCE] ${circuitName} retry ${attempt}: ${error.message}`);
        },
      }),
      fallback,
      {
        failureThreshold: config.failureThreshold,
        cooldownMs: config.cooldownMs,
        timeoutMs: config.timeoutMs,
      }
    );
    
    const durationMs = Date.now() - startTime;
    latencyTracker.record(`broker:${config.name}`, durationMs, false);
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    latencyTracker.record(`broker:${config.name}`, durationMs, true);
    throw error;
  }
}

export function getBrokerHealth(): Record<string, {
  broker: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  circuits: Array<{
    operation: string;
    state: string;
    failures: number;
    lastError?: string;
  }>;
}> {
  const allCircuits = getAllCircuitStats();
  const brokerHealth: Record<string, {
    broker: string;
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    circuits: Array<{
      operation: string;
      state: string;
      failures: number;
      lastError?: string;
    }>;
  }> = {};
  
  for (const [name, stats] of Object.entries(allCircuits)) {
    const [broker, operation] = name.split(':');
    if (!broker) continue;
    
    if (!brokerHealth[broker]) {
      brokerHealth[broker] = {
        broker,
        status: 'HEALTHY',
        circuits: [],
      };
    }
    
    brokerHealth[broker].circuits.push({
      operation: operation ?? 'default',
      state: stats.state,
      failures: stats.totalFailures,
      lastError: stats.lastError,
    });
    
    // Update overall status
    if (stats.state === 'OPEN') {
      brokerHealth[broker].status = 'UNAVAILABLE';
    } else if (stats.state === 'HALF_OPEN' && brokerHealth[broker].status !== 'UNAVAILABLE') {
      brokerHealth[broker].status = 'DEGRADED';
    }
  }
  
  return brokerHealth;
}

export function resetBrokerCircuit(broker: string, operation?: string): void {
  const circuitName = operation ? `${broker}:${operation}` : broker;
  resetCircuit(circuitName);
  console.log(`[BROKER_RESILIENCE] Reset circuit: ${circuitName}`);
}
