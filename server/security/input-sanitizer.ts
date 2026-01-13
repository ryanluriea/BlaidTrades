/**
 * Input Sanitization Module
 * 
 * Provides secure input validation and sanitization.
 * Pattern: Defense in depth - sanitize all user inputs.
 */

/**
 * Sanitize a string to prevent XSS attacks
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize SQL-like patterns (defense in depth, not replacement for parameterized queries)
 */
export function sanitizeSqlPattern(input: string): string {
  return input
    .replace(/'/g, "''")
    .replace(/;/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '');
}

/**
 * Validate and sanitize a UUID
 */
export function sanitizeUuid(input: string): string | null {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const trimmed = input.trim().toLowerCase();
  return uuidRegex.test(trimmed) ? trimmed : null;
}

/**
 * Sanitize a filename to prevent path traversal
 */
export function sanitizeFilename(input: string): string {
  return input
    .replace(/\.\./g, '')
    .replace(/[\/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Validate email format
 */
export function isValidEmail(input: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(input);
}

/**
 * Sanitize command-line arguments (prevent command injection)
 */
export function sanitizeShellArg(input: string): string {
  // Only allow alphanumeric, dash, underscore, dot
  return input.replace(/[^a-zA-Z0-9._-]/g, '');
}

/**
 * Validate integer within bounds
 */
export function sanitizeInteger(input: string | number, min: number, max: number): number | null {
  const num = typeof input === 'string' ? parseInt(input, 10) : input;
  if (isNaN(num) || num < min || num > max) {
    return null;
  }
  return num;
}

/**
 * Sanitize JSON input (parse safely)
 */
export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/**
 * Truncate string to max length
 */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.substring(0, maxLength);
}

/**
 * Validate URL
 */
export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize object keys (remove prototype pollution vectors)
 */
export function sanitizeObjectKeys(obj: Record<string, any>): Record<string, any> {
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  const result: Record<string, any> = {};
  
  for (const key of Object.keys(obj)) {
    if (!dangerous.includes(key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}
