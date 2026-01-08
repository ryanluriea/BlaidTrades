/**
 * Token Bucket Rate Limiter for API Providers
 * Prevents throttling by controlling request rate
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

interface ProviderConfig {
  maxTokens: number;
  refillRate: number;
  requestCost: number;
}

// Provider rate limits (requests per minute -> tokens per second)
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  // Market Data
  polygon: { maxTokens: 100, refillRate: 100 / 60, requestCost: 1 },
  databento: { maxTokens: 50, refillRate: 50 / 60, requestCost: 1 },
  
  // AI/LLM Providers
  openai: { maxTokens: 60, refillRate: 1, requestCost: 1 },
  anthropic: { maxTokens: 60, refillRate: 1, requestCost: 1 },
  gemini: { maxTokens: 60, refillRate: 1, requestCost: 1 },
  groq: { maxTokens: 30, refillRate: 0.5, requestCost: 1 },
  xai: { maxTokens: 60, refillRate: 1, requestCost: 1 },
  
  // Alternative Data
  finnhub: { maxTokens: 30, refillRate: 0.5, requestCost: 1 },
  fred: { maxTokens: 120, refillRate: 2, requestCost: 1 },
  news_api: { maxTokens: 100, refillRate: 100 / 60, requestCost: 1 },
  unusual_whales: { maxTokens: 30, refillRate: 0.5, requestCost: 1 },
  
  // Brokers
  ironbeam: { maxTokens: 10, refillRate: 10 / 60, requestCost: 1 },
  tradovate: { maxTokens: 30, refillRate: 0.5, requestCost: 1 },
};

// In-memory bucket storage (per provider)
const buckets: Map<string, TokenBucket> = new Map();

/**
 * Get or create a token bucket for a provider
 */
function getBucket(provider: string): TokenBucket {
  const config = PROVIDER_CONFIGS[provider] || { maxTokens: 60, refillRate: 1, requestCost: 1 };
  
  if (!buckets.has(provider)) {
    buckets.set(provider, {
      tokens: config.maxTokens,
      lastRefill: Date.now(),
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
    });
  }
  
  return buckets.get(provider)!;
}

/**
 * Refill tokens based on time elapsed
 */
function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000; // seconds
  const tokensToAdd = elapsed * bucket.refillRate;
  
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}

/**
 * Try to acquire tokens for a request
 * Returns true if tokens were acquired, false if rate limited
 */
export function tryAcquire(provider: string, cost?: number): boolean {
  const config = PROVIDER_CONFIGS[provider];
  const requestCost = cost ?? config?.requestCost ?? 1;
  
  const bucket = getBucket(provider);
  refillBucket(bucket);
  
  if (bucket.tokens >= requestCost) {
    bucket.tokens -= requestCost;
    return true;
  }
  
  return false;
}

/**
 * Wait until tokens are available, then acquire
 * Returns the wait time in ms (0 if immediate)
 */
export async function acquireWithWait(provider: string, cost?: number): Promise<number> {
  const config = PROVIDER_CONFIGS[provider];
  const requestCost = cost ?? config?.requestCost ?? 1;
  
  const bucket = getBucket(provider);
  refillBucket(bucket);
  
  if (bucket.tokens >= requestCost) {
    bucket.tokens -= requestCost;
    return 0;
  }
  
  // Calculate wait time
  const tokensNeeded = requestCost - bucket.tokens;
  const waitSeconds = tokensNeeded / bucket.refillRate;
  const waitMs = Math.ceil(waitSeconds * 1000);
  
  // Wait and then acquire
  await new Promise(resolve => setTimeout(resolve, waitMs));
  
  refillBucket(bucket);
  bucket.tokens -= requestCost;
  
  return waitMs;
}

/**
 * Get current rate limit status for a provider
 */
export function getRateLimitStatus(provider: string): {
  available: number;
  max: number;
  refillRate: number;
  percentAvailable: number;
} {
  const bucket = getBucket(provider);
  refillBucket(bucket);
  
  return {
    available: Math.floor(bucket.tokens),
    max: bucket.maxTokens,
    refillRate: bucket.refillRate,
    percentAvailable: Math.round((bucket.tokens / bucket.maxTokens) * 100),
  };
}

/**
 * Get all provider rate limit statuses
 */
export function getAllRateLimitStatuses(): Record<string, ReturnType<typeof getRateLimitStatus>> {
  const statuses: Record<string, ReturnType<typeof getRateLimitStatus>> = {};
  
  for (const provider of Object.keys(PROVIDER_CONFIGS)) {
    statuses[provider] = getRateLimitStatus(provider);
  }
  
  return statuses;
}

/**
 * Reset a provider's bucket (e.g., after a rate limit error response)
 */
export function resetBucket(provider: string, tokensRemaining?: number): void {
  const bucket = getBucket(provider);
  
  if (tokensRemaining !== undefined) {
    bucket.tokens = tokensRemaining;
  } else {
    bucket.tokens = 0;
  }
  
  bucket.lastRefill = Date.now();
}

/**
 * Decorator for rate-limited API calls
 */
export function withRateLimit<T>(
  provider: string,
  fn: () => Promise<T>,
  options?: { cost?: number; throwOnLimit?: boolean }
): Promise<T> {
  const { cost, throwOnLimit = false } = options || {};
  
  if (!tryAcquire(provider, cost)) {
    if (throwOnLimit) {
      throw new Error(`Rate limit exceeded for provider: ${provider}`);
    }
    
    // Wait and retry
    return acquireWithWait(provider, cost).then(() => fn());
  }
  
  return fn();
}
