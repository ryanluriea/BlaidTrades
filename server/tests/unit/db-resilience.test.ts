/**
 * Database Resilience Tests
 * 
 * Tests the ACTUAL production circuit breaker implementation from db-resilience.ts.
 * Verifies institutional fail-closed patterns for database reliability.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getCircuitBreakerState,
  resetCircuitBreaker,
  _testIsRetryableError,
  _testRecordFailure,
  _testRecordSuccess,
  CIRCUIT_BREAKER_CONFIG,
} from "../../db-resilience";

describe("Database Resilience - Circuit Breaker (Production Code)", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  describe("Circuit Breaker State Transitions", () => {
    it("should start in CLOSED state", () => {
      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(false);
      expect(state.failureCount).toBe(0);
    });

    it("should OPEN after threshold failures", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD; i++) {
        _testRecordFailure();
      }

      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(true);
      expect(state.failureCount).toBe(CIRCUIT_BREAKER_CONFIG.THRESHOLD);
    });

    it("should remain CLOSED below threshold", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD - 1; i++) {
        _testRecordFailure();
      }

      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(false);
    });

    it("should CLOSE after consecutive successes in half-open", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD; i++) {
        _testRecordFailure();
      }
      expect(getCircuitBreakerState().isOpen).toBe(true);

      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.HALF_OPEN_SUCCESSES; i++) {
        _testRecordSuccess();
      }

      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(false);
      expect(state.failureCount).toBe(0);
    });

    it("should reset consecutive successes on failure during half-open", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD; i++) {
        _testRecordFailure();
      }
      expect(getCircuitBreakerState().isOpen).toBe(true);

      _testRecordSuccess();
      _testRecordSuccess();
      expect(getCircuitBreakerState().consecutiveSuccesses).toBe(2);

      _testRecordFailure();
      expect(getCircuitBreakerState().consecutiveSuccesses).toBe(0);
    });

    it("should decrement failure count on success when closed", () => {
      _testRecordFailure();
      _testRecordFailure();
      _testRecordFailure();
      expect(getCircuitBreakerState().failureCount).toBe(3);

      _testRecordSuccess();
      expect(getCircuitBreakerState().failureCount).toBe(2);

      _testRecordSuccess();
      expect(getCircuitBreakerState().failureCount).toBe(1);
    });

    it("should track failure timestamps", () => {
      const before = Date.now();
      _testRecordFailure();

      const state = getCircuitBreakerState();
      expect(state.lastFailureTime).toBeGreaterThanOrEqual(before);
      expect(state.lastFailureTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("Retryable Error Classification (Production Logic)", () => {
    it("should identify connection errors as retryable", () => {
      const retryableErrors = [
        new Error("Connection refused by server"),
        new Error("Connection reset by peer"),
        new Error("Query timeout exceeded"),
        new Error("Deadlock detected"),
        new Error("Too many connections to database"),
        new Error("ECONNRESET: socket hang up"),
        new Error("ETIMEDOUT: connection timed out"),
        new Error("ECONNREFUSED: cannot connect"),
        new Error("statement_timeout exceeded"),
      ];

      for (const error of retryableErrors) {
        expect(_testIsRetryableError(error)).toBe(true);
      }
    });

    it("should NOT retry non-transient errors", () => {
      const nonRetryableErrors = [
        new Error("Syntax error in SQL"),
        new Error("Permission denied"),
        new Error("Table does not exist"),
        new Error("Constraint violation"),
        new Error("Invalid column name"),
        new Error("Foreign key constraint failed"),
      ];

      for (const error of nonRetryableErrors) {
        expect(_testIsRetryableError(error)).toBe(false);
      }
    });

    it("should return false for non-Error types", () => {
      expect(_testIsRetryableError("string error")).toBe(false);
      expect(_testIsRetryableError(null)).toBe(false);
      expect(_testIsRetryableError(undefined)).toBe(false);
      expect(_testIsRetryableError(42)).toBe(false);
    });
  });

  describe("Institutional Fail-Closed Pattern", () => {
    it("should BLOCK after threshold failures (fail-closed)", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD; i++) {
        _testRecordFailure();
      }

      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(true);
    });

    it("should require multiple successes to restore service", () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.THRESHOLD; i++) {
        _testRecordFailure();
      }
      expect(getCircuitBreakerState().isOpen).toBe(true);

      _testRecordSuccess();
      expect(getCircuitBreakerState().isOpen).toBe(true);

      _testRecordSuccess();
      expect(getCircuitBreakerState().isOpen).toBe(true);

      _testRecordSuccess();
      expect(getCircuitBreakerState().isOpen).toBe(false);
    });

    it("should expose configuration constants for audit", () => {
      expect(CIRCUIT_BREAKER_CONFIG.THRESHOLD).toBe(5);
      expect(CIRCUIT_BREAKER_CONFIG.RESET_MS).toBe(30000);
      expect(CIRCUIT_BREAKER_CONFIG.HALF_OPEN_SUCCESSES).toBe(3);
    });

    it("should reset cleanly for test isolation", () => {
      for (let i = 0; i < 10; i++) {
        _testRecordFailure();
      }
      expect(getCircuitBreakerState().isOpen).toBe(true);

      resetCircuitBreaker();

      const state = getCircuitBreakerState();
      expect(state.isOpen).toBe(false);
      expect(state.failureCount).toBe(0);
      expect(state.consecutiveSuccesses).toBe(0);
    });
  });
});
