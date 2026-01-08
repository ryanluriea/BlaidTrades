import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
      spans: Record<string, number>;
      userId?: number;
    }
  }
}

export interface RequestMetrics {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: number;
  spans?: Record<string, number>;
  botCount?: number;
}

const SLOW_REQUEST_WARN_MS = 1000;
const SLOW_REQUEST_ERROR_MS = 3000;

const latencyBuckets: Map<string, number[]> = new Map();

function recordLatency(path: string, durationMs: number) {
  const normalizedPath = normalizePath(path);
  if (!latencyBuckets.has(normalizedPath)) {
    latencyBuckets.set(normalizedPath, []);
  }
  const bucket = latencyBuckets.get(normalizedPath)!;
  bucket.push(durationMs);
  if (bucket.length > 1000) {
    bucket.shift();
  }
}

function normalizePath(path: string): string {
  return path
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[a-f0-9-]{36}/gi, '/:uuid');
}

export function getLatencyStats(path?: string): Record<string, { p50: number; p95: number; p99: number; count: number }> {
  const result: Record<string, { p50: number; p95: number; p99: number; count: number }> = {};
  
  const calculatePercentiles = (values: number[]) => {
    if (values.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      count: sorted.length,
    };
  };

  if (path) {
    const normalized = normalizePath(path);
    const bucket = latencyBuckets.get(normalized) || [];
    result[normalized] = calculatePercentiles(bucket);
  } else {
    for (const [p, bucket] of latencyBuckets) {
      result[p] = calculatePercentiles(bucket);
    }
  }

  return result;
}

export function getTopSlowEndpoints(limit = 10): Array<{ path: string; p95: number; count: number }> {
  const stats = getLatencyStats();
  return Object.entries(stats)
    .map(([path, s]) => ({ path, p95: s.p95, count: s.count }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, limit);
}

export function requestInstrumentationMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID().slice(0, 8);
  req.startTime = Date.now();
  req.spans = {};

  res.setHeader('X-Request-Id', req.requestId);

  res.on("finish", () => {
    const durationMs = Date.now() - req.startTime;
    const path = req.path;

    if (!path.startsWith("/api")) {
      return;
    }

    recordLatency(path, durationMs);

    const metrics: RequestMetrics = {
      requestId: req.requestId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs,
      userId: req.userId,
      spans: Object.keys(req.spans).length > 0 ? req.spans : undefined,
    };

    const spanStr = metrics.spans 
      ? ` spans=${JSON.stringify(metrics.spans)}` 
      : '';
    const userStr = metrics.userId ? ` user=${metrics.userId}` : '';

    if (durationMs >= SLOW_REQUEST_ERROR_MS) {
      console.error(`[REQ_ERROR] ${req.requestId} ${req.method} ${path} ${res.statusCode} ${durationMs}ms${userStr}${spanStr}`);
    } else if (durationMs >= SLOW_REQUEST_WARN_MS) {
      console.warn(`[REQ_WARN] ${req.requestId} ${req.method} ${path} ${res.statusCode} ${durationMs}ms${userStr}${spanStr}`);
    } else {
      console.log(`[REQ] ${req.requestId} ${req.method} ${path} ${res.statusCode} ${durationMs}ms${userStr}`);
    }

    // SEV-1: Only set header if response is not already finished
    if (res.statusCode >= 500 && !res.headersSent) {
      try {
        res.setHeader('X-Spans', JSON.stringify(metrics.spans || {}));
      } catch (e) {
        // Headers already sent, ignore
      }
    }
  });

  next();
}

export function startSpan(req: Request, name: string): () => void {
  const start = Date.now();
  return () => {
    req.spans[name] = Date.now() - start;
  };
}

export async function withSpan<T>(req: Request, name: string, fn: () => Promise<T>): Promise<T> {
  const endSpan = startSpan(req, name);
  try {
    return await fn();
  } finally {
    endSpan();
  }
}
