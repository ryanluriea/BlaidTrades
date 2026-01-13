/**
 * Correlation ID Middleware
 * 
 * Adds unique correlation IDs to every request for distributed tracing.
 * Pattern: Industry-standard request tracking across logs and services.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      startTime: number;
    }
  }
}

/**
 * Generate a short, unique correlation ID
 */
function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Middleware to add correlation ID to every request
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check for existing correlation ID from upstream (e.g., load balancer)
  const existingId = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  const correlationId = typeof existingId === 'string' ? existingId : generateCorrelationId();
  
  req.correlationId = correlationId;
  req.startTime = Date.now();
  
  // Add to response headers for client-side debugging
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}

/**
 * Structured logger that includes correlation ID
 */
export function createRequestLogger(req: Request) {
  const prefix = `[${req.correlationId}]`;
  
  return {
    info: (message: string, data?: Record<string, any>) => {
      console.log(`${prefix} ${message}`, data ? JSON.stringify(data) : '');
    },
    warn: (message: string, data?: Record<string, any>) => {
      console.warn(`${prefix} ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (message: string, error?: Error, data?: Record<string, any>) => {
      console.error(`${prefix} ${message}`, {
        error: error?.message,
        stack: error?.stack,
        ...data,
      });
    },
    debug: (message: string, data?: Record<string, any>) => {
      if (process.env.DEBUG) {
        console.log(`${prefix} [DEBUG] ${message}`, data ? JSON.stringify(data) : '');
      }
    },
  };
}

/**
 * Request completion logger middleware
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = req.startTime || Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;
    const path = req.path;
    
    // Skip health check logging to reduce noise
    if (path === '/healthz' || path === '/readyz' || path === '/api/health') {
      return;
    }
    
    const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[REQ] ${req.correlationId} ${method} ${path} ${statusCode} ${duration}ms [${level}]`);
  });
  
  next();
}
