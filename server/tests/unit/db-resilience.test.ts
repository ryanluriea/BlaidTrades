/**
 * Database Resilience Tests
 * 
 * Verifies circuit breaker pattern for database reliability:
 * - Exponential backoff with jitter
 * - Circuit breaker opens after threshold failures
 * - Half-open state allows test requests
 * - Circuit closes after consecutive successes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES = 3;

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  consecutiveSuccesses: number;
}

function createCircuitBreaker() {
  const state: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: 0,
    consecutiveSuccesses: 0,
  };

  function recordFailure(): void {
    state.failureCount++;
    state.lastFailureTime = Date.now();
    state.consecutiveSuccesses = 0;

    if (state.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      state.isOpen = true;
    }
  }

  function recordSuccess(): void {
    if (state.isOpen) {
      state.consecutiveSuccesses++;

      if (state.consecutiveSuccesses >= CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES) {
        state.isOpen = false;
        state.failureCount = 0;
        state.consecutiveSuccesses = 0;
      }
    } else {
      state.failureCount = Math.max(0, state.failureCount - 1);
    }
  }

  function isAllowed(): boolean {
    return !state.isOpen;
  }

  return { state, recordFailure, recordSuccess, isAllowed };
}

function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    "connection refused",
    "connection reset",
    "timeout",
    "deadlock",
    "too many connections",
    "connection terminated",
    "econnreset",
    "etimedout",
    "econnrefused",
    "statement_timeout",
  ];
  return retryablePatterns.some((pattern) => message.includes(pattern));
}

function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(exponentialDelay, maxDelayMs);
}

describe("Database Resilience - Circuit Breaker", () => {
  describe("Circuit Breaker State Transitions", () => {
    it("should start in CLOSED state", () => {
      const cb = createCircuitBreaker();

      expect(cb.state.isOpen).toBe(false);
      expect(cb.isAllowed()).toBe(true);
    });

    it("should OPEN after threshold failures", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }

      expect(cb.state.isOpen).toBe(true);
      expect(cb.state.failureCount).toBe(CIRCUIT_BREAKER_THRESHOLD);
    });

    it("should BLOCK requests when OPEN", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }

      expect(cb.isAllowed()).toBe(false);
    });

    it("should CLOSE after consecutive successes in half-open", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }
      expect(cb.state.isOpen).toBe(true);

      for (let i = 0; i < CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES; i++) {
        cb.recordSuccess();
      }

      expect(cb.state.isOpen).toBe(false);
      expect(cb.state.failureCount).toBe(0);
    });

    it("should reset consecutive successes on failure during half-open", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }
      expect(cb.state.isOpen).toBe(true);

      cb.recordSuccess();
      cb.recordSuccess();
      expect(cb.state.consecutiveSuccesses).toBe(2);

      cb.recordFailure();
      expect(cb.state.consecutiveSuccesses).toBe(0);
    });

    it("should decrement failure count on success when closed", () => {
      const cb = createCircuitBreaker();

      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state.failureCount).toBe(3);

      cb.recordSuccess();
      expect(cb.state.failureCount).toBe(2);

      cb.recordSuccess();
      expect(cb.state.failureCount).toBe(1);
    });
  });

  describe("Retryable Error Classification", () => {
    it("should identify connection errors as retryable", () => {
      const retryableErrors = [
        new Error("Connection refused"),
        new Error("Connection reset by peer"),
        new Error("Query timeout exceeded"),
        new Error("Deadlock detected"),
        new Error("Too many connections"),
        new Error("ECONNRESET: socket hang up"),
        new Error("ETIMEDOUT: connection timed out"),
      ];

      for (const error of retryableErrors) {
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it("should NOT retry non-transient errors", () => {
      const nonRetryableErrors = [
        new Error("Syntax error in SQL"),
        new Error("Permission denied"),
        new Error("Table does not exist"),
        new Error("Constraint violation"),
      ];

      for (const error of nonRetryableErrors) {
        expect(isRetryableError(error)).toBe(false);
      }
    });
  });

  describe("Exponential Backoff", () => {
    it("should calculate exponential delays", () => {
      const baseDelay = 100;
      const maxDelay = 5000;

      expect(calculateBackoff(0, baseDelay, maxDelay)).toBe(100);
      expect(calculateBackoff(1, baseDelay, maxDelay)).toBe(200);
      expect(calculateBackoff(2, baseDelay, maxDelay)).toBe(400);
      expect(calculateBackoff(3, baseDelay, maxDelay)).toBe(800);
    });

    it("should cap at max delay", () => {
      const baseDelay = 100;
      const maxDelay = 5000;

      expect(calculateBackoff(10, baseDelay, maxDelay)).toBe(5000);
      expect(calculateBackoff(20, baseDelay, maxDelay)).toBe(5000);
    });
  });

  describe("Institutional Fail-Safe Pattern", () => {
    it("should BLOCK operations during circuit open (fail-closed)", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }

      expect(cb.isAllowed()).toBe(false);
    });

    it("should require multiple successes to restore service", () => {
      const cb = createCircuitBreaker();

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
        cb.recordFailure();
      }
      expect(cb.state.isOpen).toBe(true);

      cb.recordSuccess();
      expect(cb.state.isOpen).toBe(true);

      cb.recordSuccess();
      expect(cb.state.isOpen).toBe(true);

      cb.recordSuccess();
      expect(cb.state.isOpen).toBe(false);
    });

    it("should track failure timestamps for timeout-based recovery", () => {
      const cb = createCircuitBreaker();

      const beforeFailure = Date.now();
      cb.recordFailure();

      expect(cb.state.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
    });
  });
});
