/**
 * OpenTelemetry-Compatible Tracing
 * 
 * Provides distributed tracing with span context propagation.
 * Pattern: Lightweight tracing that can integrate with OpenTelemetry collectors.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

interface SpanContext {
  traceId: string;
  spanId: string;
}

// In-memory span storage (would be replaced with OpenTelemetry exporter in production)
const activeSpans: Map<string, Span> = new Map();
const completedSpans: Span[] = [];
const MAX_COMPLETED_SPANS = 1000;

/**
 * Generate a 16-byte trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate an 8-byte span ID (16 hex chars)
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create a new span
 */
export function startSpan(name: string, parentContext?: SpanContext): Span {
  const span: Span = {
    traceId: parentContext?.traceId || generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId || null,
    name,
    startTime: Date.now(),
    endTime: null,
    duration: null,
    status: 'UNSET',
    attributes: {},
    events: [],
  };
  
  activeSpans.set(span.spanId, span);
  return span;
}

/**
 * End a span
 */
export function endSpan(span: Span, status: 'OK' | 'ERROR' = 'OK'): void {
  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status;
  
  activeSpans.delete(span.spanId);
  completedSpans.push(span);
  
  // Rotate old spans
  while (completedSpans.length > MAX_COMPLETED_SPANS) {
    completedSpans.shift();
  }
}

/**
 * Add an attribute to a span
 */
export function setSpanAttribute(span: Span, key: string, value: string | number | boolean): void {
  span.attributes[key] = value;
}

/**
 * Add an event to a span
 */
export function addSpanEvent(span: Span, name: string, attributes: Record<string, string | number | boolean> = {}): void {
  span.events.push({
    name,
    timestamp: Date.now(),
    attributes,
  });
}

/**
 * Get span context from request headers (W3C Trace Context format)
 */
export function extractSpanContext(req: Request): SpanContext | undefined {
  const traceparent = req.headers['traceparent'];
  if (typeof traceparent === 'string') {
    // Format: 00-{trace-id}-{parent-span-id}-{flags}
    const parts = traceparent.split('-');
    if (parts.length >= 4 && parts[0] === '00') {
      return {
        traceId: parts[1],
        spanId: parts[2],
      };
    }
  }
  return undefined;
}

/**
 * Inject span context into response headers
 */
export function injectSpanContext(res: Response, span: Span): void {
  res.setHeader('traceparent', `00-${span.traceId}-${span.spanId}-01`);
}

/**
 * Tracing middleware for Express
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const parentContext = extractSpanContext(req);
  const span = startSpan(`HTTP ${req.method} ${req.path}`, parentContext);
  
  // Attach span to request for downstream use
  (req as any).span = span;
  
  setSpanAttribute(span, 'http.method', req.method);
  setSpanAttribute(span, 'http.url', req.url);
  setSpanAttribute(span, 'http.target', req.path);
  
  injectSpanContext(res, span);
  
  res.on('finish', () => {
    setSpanAttribute(span, 'http.status_code', res.statusCode);
    endSpan(span, res.statusCode >= 400 ? 'ERROR' : 'OK');
  });
  
  next();
}

/**
 * Get recent traces for debugging
 */
export function getRecentTraces(limit: number = 50): Span[] {
  return completedSpans.slice(-limit);
}

/**
 * Get trace by ID
 */
export function getTraceSpans(traceId: string): Span[] {
  return completedSpans.filter(s => s.traceId === traceId);
}

/**
 * Helper to wrap async functions with tracing
 */
export function traced<T>(name: string, fn: () => Promise<T>, parentSpan?: Span): Promise<T> {
  const context = parentSpan ? { traceId: parentSpan.traceId, spanId: parentSpan.spanId } : undefined;
  const span = startSpan(name, context);
  
  return fn()
    .then(result => {
      endSpan(span, 'OK');
      return result;
    })
    .catch(error => {
      setSpanAttribute(span, 'error', true);
      setSpanAttribute(span, 'error.message', error.message || 'Unknown error');
      endSpan(span, 'ERROR');
      throw error;
    });
}
