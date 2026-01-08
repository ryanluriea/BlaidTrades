interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number | null;
  errorCode?: string;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (entry?.lockedUntil && now < entry.lockedUntil) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
      errorCode: "RATE_LIMIT_EXCEEDED",
    };
  }

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    rateLimitStore.set(key, {
      count: 1,
      firstAttempt: now,
      lockedUntil: null,
    });
    return {
      allowed: true,
      remaining: MAX_ATTEMPTS - 1,
      retryAfter: null,
    };
  }

  const newCount = entry.count + 1;

  if (newCount > MAX_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_MS;
    rateLimitStore.set(key, {
      count: newCount,
      firstAttempt: entry.firstAttempt,
      lockedUntil,
    });
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(LOCKOUT_MS / 1000),
      errorCode: "RATE_LIMIT_EXCEEDED",
    };
  }

  rateLimitStore.set(key, {
    count: newCount,
    firstAttempt: entry.firstAttempt,
    lockedUntil: null,
  });

  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - newCount,
    retryAfter: null,
  };
}

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

export function getRateLimitKey(userId: string, ip: string, endpoint: string): string {
  return `${endpoint}:${userId}:${ip}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.firstAttempt > WINDOW_MS && (!entry.lockedUntil || now > entry.lockedUntil)) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);
