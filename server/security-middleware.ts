import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_TOKEN_HEADER = "x-csrf-token";

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ 
      error: "Authentication required",
      code: "AUTH_REQUIRED"
    });
  }
  next();
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
  
  if (safeMethod) {
    return next();
  }

  if (!req.session?.userId) {
    return next();
  }

  const tokenFromHeader = req.headers[CSRF_TOKEN_HEADER] as string;
  const sessionToken = req.session?.csrfToken;

  if (!tokenFromHeader || !sessionToken) {
    console.warn(`[CSRF] Missing token - header: ${!!tokenFromHeader}, session: ${!!sessionToken}`);
    return res.status(403).json({
      error: "CSRF token missing",
      code: "CSRF_MISSING"
    });
  }

  if (tokenFromHeader !== sessionToken) {
    console.warn(`[CSRF] Token mismatch`);
    return res.status(403).json({
      error: "CSRF token mismatch",
      code: "CSRF_MISMATCH"
    });
  }

  next();
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export function rateLimit(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + config.windowMs });
      return next();
    }

    if (record.count >= config.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests",
        code: "RATE_LIMITED",
        retryAfterSeconds: retryAfter
      });
    }

    record.count++;
    next();
  };
}

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10
});

export const twoFactorRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  maxRequests: 5
});

export const tradingRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  maxRequests: 30
});

export const adminRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  maxRequests: 20
});

const deviceBindings = new Map<string, { ip: string; userAgent: string; createdAt: Date }>();

export function bindTempTokenToDevice(tokenHash: string, ip: string, userAgent: string) {
  deviceBindings.set(tokenHash, {
    ip,
    userAgent,
    createdAt: new Date()
  });
}

export function validateDeviceBinding(tokenHash: string, ip: string, userAgent: string): boolean {
  const binding = deviceBindings.get(tokenHash);
  if (!binding) return true;
  
  return binding.ip === ip && binding.userAgent === userAgent;
}

export function clearDeviceBinding(tokenHash: string) {
  deviceBindings.delete(tokenHash);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
  
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000);
  for (const [key, binding] of deviceBindings.entries()) {
    if (binding.createdAt < tenMinutesAgo) {
      deviceBindings.delete(key);
    }
  }
}, 60 * 1000);
