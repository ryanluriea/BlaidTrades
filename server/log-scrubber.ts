/**
 * Log Scrubber Utility
 * 
 * INSTITUTIONAL SECURITY: Removes sensitive data from API responses before logging
 * Prevents exposure of financial data, credentials, and PII in logs
 */

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /"password"\s*:\s*"[^"]*"/gi, replacement: '"password":"[REDACTED]"' },
  { pattern: /"token"\s*:\s*"[^"]*"/gi, replacement: '"token":"[REDACTED]"' },
  { pattern: /"apiKey"\s*:\s*"[^"]*"/gi, replacement: '"apiKey":"[REDACTED]"' },
  { pattern: /"api_key"\s*:\s*"[^"]*"/gi, replacement: '"api_key":"[REDACTED]"' },
  { pattern: /"secret"\s*:\s*"[^"]*"/gi, replacement: '"secret":"[REDACTED]"' },
  { pattern: /"sessionId"\s*:\s*"[^"]*"/gi, replacement: '"sessionId":"[REDACTED]"' },
  { pattern: /"session_id"\s*:\s*"[^"]*"/gi, replacement: '"session_id":"[REDACTED]"' },
  { pattern: /"Authorization"\s*:\s*"[^"]*"/gi, replacement: '"Authorization":"[REDACTED]"' },
  { pattern: /"authorization"\s*:\s*"[^"]*"/gi, replacement: '"authorization":"[REDACTED]"' },
  { pattern: /"Bearer [^"]+"/gi, replacement: '"Bearer [REDACTED]"' },
];

const FINANCIAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /"pnl"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"pnl":[PNL_SCRUBBED]' },
  { pattern: /"netPnl"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"netPnl":[PNL_SCRUBBED]' },
  { pattern: /"grossPnl"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"grossPnl":[PNL_SCRUBBED]' },
  { pattern: /"realizedPnl"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"realizedPnl":[PNL_SCRUBBED]' },
  { pattern: /"unrealizedPnl"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"unrealizedPnl":[PNL_SCRUBBED]' },
  { pattern: /"balance"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"balance":[BALANCE_SCRUBBED]' },
  { pattern: /"equity"\s*:\s*(-?\d+\.?\d*)/gi, replacement: '"equity":[EQUITY_SCRUBBED]' },
];

export type ScrubLevel = "minimal" | "standard" | "strict";

export function scrubSensitiveData(input: string, level: ScrubLevel = "standard"): string {
  let result = input;
  
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  
  if (level === "strict") {
    for (const { pattern, replacement } of FINANCIAL_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
  }
  
  return result;
}

export function scrubObject<T extends Record<string, any>>(obj: T, level: ScrubLevel = "standard"): T {
  const sensitiveKeys = new Set([
    "password", "token", "apiKey", "api_key", "secret", "sessionId",
    "session_id", "authorization", "Authorization", "Bearer",
  ]);
  
  const financialKeys = new Set([
    "pnl", "netPnl", "grossPnl", "realizedPnl", "unrealizedPnl",
    "balance", "equity",
  ]);
  
  function scrubValue(key: string, value: any): any {
    if (sensitiveKeys.has(key)) {
      return "[REDACTED]";
    }
    
    if (level === "strict" && financialKeys.has(key)) {
      return "[SCRUBBED]";
    }
    
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item, index) => scrubValue(String(index), item));
      }
      const scrubbed: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        scrubbed[k] = scrubValue(k, v);
      }
      return scrubbed;
    }
    
    return value;
  }
  
  return scrubValue("root", obj);
}

export function createScrubbedLogger(baseLogger: typeof console, level: ScrubLevel = "standard") {
  return {
    log: (...args: any[]) => baseLogger.log(...args.map(arg => 
      typeof arg === "string" ? scrubSensitiveData(arg, level) : arg
    )),
    error: (...args: any[]) => baseLogger.error(...args.map(arg => 
      typeof arg === "string" ? scrubSensitiveData(arg, level) : arg
    )),
    warn: (...args: any[]) => baseLogger.warn(...args.map(arg => 
      typeof arg === "string" ? scrubSensitiveData(arg, level) : arg
    )),
    info: (...args: any[]) => baseLogger.info(...args.map(arg => 
      typeof arg === "string" ? scrubSensitiveData(arg, level) : arg
    )),
  };
}

export function truncateForLogging(data: string, maxLength: number = 500): string {
  if (data.length <= maxLength) return data;
  return data.substring(0, maxLength) + `...[truncated ${data.length - maxLength} chars]`;
}
