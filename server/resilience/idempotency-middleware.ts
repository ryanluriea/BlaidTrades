/**
 * Idempotency Key Middleware
 * 
 * Ensures mutation operations are executed exactly once, even if
 * the client retries due to network failures.
 * 
 * Pattern used by:
 * - Stripe API
 * - PayPal
 * - AWS
 * - All major trading platforms
 * 
 * Features:
 * - Request deduplication
 * - Response caching for retries
 * - Configurable TTL
 * - Concurrent request handling
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  response?: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
  createdAt: number;
  completedAt?: number;
}

const IDEMPOTENCY_HEADER = 'idempotency-key';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_RECORDS = 10000; // Max cached responses to prevent memory exhaustion
const MAX_RESPONSE_SIZE_BYTES = 1024 * 1024; // 1MB max per cached response

class IdempotencyStore {
  private records: Map<string, IdempotencyRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(private ttlMs: number = DEFAULT_TTL_MS) {
    this.startCleanup();
  }
  
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expiredKeys: string[] = [];
      
      for (const [key, record] of this.records) {
        if (now - record.createdAt > this.ttlMs) {
          expiredKeys.push(key);
        }
      }
      
      for (const key of expiredKeys) {
        this.records.delete(key);
      }
      
      if (expiredKeys.length > 0) {
        console.log(`[IDEMPOTENCY] Cleaned up ${expiredKeys.length} expired records`);
      }
    }, CLEANUP_INTERVAL_MS);
    
    this.cleanupInterval.unref();
  }
  
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  get(key: string): IdempotencyRecord | undefined {
    return this.records.get(key);
  }
  
  create(key: string, requestHash: string): IdempotencyRecord | null {
    // Enforce max records limit to prevent memory exhaustion
    if (this.records.size >= MAX_RECORDS) {
      // Evict oldest records to make room (LRU-style)
      const recordsArray = Array.from(this.records.entries());
      recordsArray.sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toEvict = Math.ceil(MAX_RECORDS * 0.1); // Evict 10%
      for (let i = 0; i < toEvict && i < recordsArray.length; i++) {
        this.records.delete(recordsArray[i][0]);
      }
      console.log(`[IDEMPOTENCY] Evicted ${toEvict} oldest records (at capacity)`);
    }
    
    const record: IdempotencyRecord = {
      key,
      requestHash,
      status: 'processing',
      createdAt: Date.now(),
    };
    this.records.set(key, record);
    return record;
  }
  
  complete(
    key: string,
    response: { statusCode: number; body: unknown; headers: Record<string, string> }
  ): void {
    const record = this.records.get(key);
    if (record) {
      // Check response size to prevent memory exhaustion
      const bodySize = JSON.stringify(response.body || {}).length;
      if (bodySize > MAX_RESPONSE_SIZE_BYTES) {
        // Large responses can't be cached - delete the record so subsequent
        // requests are treated as fresh invocations (caller must handle retries)
        // This prevents half-broken state where status=completed but no cached response
        console.warn(`[IDEMPOTENCY] Response too large (${bodySize} bytes), deleting record key=${key.substring(0, 8)}...`);
        this.records.delete(key);
        return;
      }
      
      record.status = 'completed';
      record.response = response;
      record.completedAt = Date.now();
    }
  }
  
  fail(key: string): void {
    const record = this.records.get(key);
    if (record) {
      record.status = 'failed';
      record.completedAt = Date.now();
    }
  }
  
  delete(key: string): void {
    this.records.delete(key);
  }
  
  getStats(): { total: number; processing: number; completed: number; failed: number } {
    let processing = 0;
    let completed = 0;
    let failed = 0;
    
    for (const record of this.records.values()) {
      switch (record.status) {
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }
    
    return { total: this.records.size, processing, completed, failed };
  }
}

export const idempotencyStore = new IdempotencyStore();

function computeRequestHash(req: Request): string {
  const data = {
    method: req.method,
    path: req.path,
    body: req.body,
  };
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function idempotencyMiddleware(options: {
  required?: boolean;
  methods?: string[];
  paths?: RegExp[];
} = {}) {
  const {
    required = false,
    methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
    paths = [/^\/api\//],
  } = options;
  
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only apply to specified methods
    if (!methods.includes(req.method)) {
      next();
      return;
    }
    
    // Only apply to specified paths
    if (!paths.some(p => p.test(req.path))) {
      next();
      return;
    }
    
    const idempotencyKey = req.headers[IDEMPOTENCY_HEADER] as string | undefined;
    
    // If no key and not required, proceed
    if (!idempotencyKey) {
      if (required) {
        res.status(400).json({
          error: 'Idempotency-Key header is required for this operation',
        });
        return;
      }
      next();
      return;
    }
    
    const requestHash = computeRequestHash(req);
    const existing = idempotencyStore.get(idempotencyKey);
    
    if (existing) {
      // Check if it's the same request
      if (existing.requestHash !== requestHash) {
        res.status(422).json({
          error: 'Idempotency key already used with different request parameters',
        });
        return;
      }
      
      // If still processing, return conflict
      if (existing.status === 'processing') {
        res.status(409).json({
          error: 'Request with this idempotency key is still processing',
          retryAfter: 5,
        });
        return;
      }
      
      // If completed, return cached response
      if (existing.status === 'completed' && existing.response) {
        console.log(`[IDEMPOTENCY] Returning cached response for key=${idempotencyKey.substring(0, 8)}...`);
        
        res.set('Idempotency-Replayed', 'true');
        for (const [header, value] of Object.entries(existing.response.headers)) {
          res.set(header, value);
        }
        res.status(existing.response.statusCode).json(existing.response.body);
        return;
      }
      
      // If failed, allow retry
      if (existing.status === 'failed') {
        idempotencyStore.delete(idempotencyKey);
      }
    }
    
    // Create new record
    idempotencyStore.create(idempotencyKey, requestHash);
    
    // Capture original methods to intercept response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    let responseCaptured = false;
    
    const captureResponse = (body: unknown): void => {
      if (responseCaptured) return;
      responseCaptured = true;
      
      const headers: Record<string, string> = {};
      const rawHeaders = res.getHeaders();
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
      
      if (res.statusCode >= 200 && res.statusCode < 500) {
        idempotencyStore.complete(idempotencyKey, {
          statusCode: res.statusCode,
          body,
          headers,
        });
      } else {
        idempotencyStore.fail(idempotencyKey);
      }
    };
    
    res.json = function (body: unknown) {
      captureResponse(body);
      return originalJson(body);
    };
    
    res.send = function (body: unknown) {
      captureResponse(body);
      return originalSend(body);
    };
    
    next();
  };
}
