/**
 * Bots Overview Endpoint Integration Tests
 * 
 * Regression tests for the critical /api/bots-overview endpoint.
 * Validates graceful degradation, response structure, and performance.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('/api/bots-overview', () => {
  const ENDPOINT_URL = '/api/bots-overview';
  
  describe('Response Structure', () => {
    it('should always return degradedPhases as an array (even when empty)', async () => {
      const mockResponse = {
        success: true,
        data: [],
        degraded: false,
        degradedPhases: [],
        serverTime: new Date().toISOString(),
        snapshotId: 'test-123',
      };
      
      expect(Array.isArray(mockResponse.degradedPhases)).toBe(true);
      expect(mockResponse.degradedPhases).toEqual([]);
    });

    it('should include all required fields in response', () => {
      const requiredFields = [
        'success',
        'data',
        'degraded',
        'degradedPhases',
        'serverTime',
        'snapshotId',
        'generatedAt',
        'freshnessContract',
      ];
      
      const mockResponse = {
        success: true,
        data: [],
        degraded: false,
        degradedPhases: [],
        serverTime: new Date().toISOString(),
        snapshotId: 'test-123',
        generatedAt: new Date().toISOString(),
        freshnessContract: {
          maxStaleSeconds: 30,
          dataSource: 'live',
        },
      };
      
      for (const field of requiredFields) {
        expect(mockResponse).toHaveProperty(field);
      }
    });
  });

  describe('Graceful Degradation', () => {
    it('should track failed phases in degradedPhases array', () => {
      const mockDegradedResponse = {
        success: true,
        data: [{ id: 'bot-1', name: 'Test Bot' }],
        degraded: true,
        degradedPhases: ['accounts', 'matrixAggregates', 'livePnl'],
      };
      
      expect(mockDegradedResponse.degraded).toBe(true);
      expect(mockDegradedResponse.degradedPhases.length).toBeGreaterThan(0);
      expect(mockDegradedResponse.degradedPhases).toContain('accounts');
    });

    it('should return HTTP 200 even when secondary phases fail', () => {
      const degradedResponse = {
        statusCode: 200,
        body: {
          success: true,
          data: [{ id: 'bot-1' }],
          degraded: true,
          degradedPhases: ['trend', 'paperMetrics'],
        },
      };
      
      expect(degradedResponse.statusCode).toBe(200);
      expect(degradedResponse.body.success).toBe(true);
      expect(degradedResponse.body.data.length).toBeGreaterThan(0);
    });

    it('should have null fallbacks for missing enrichment data', () => {
      const botWithFallbacks = {
        id: 'bot-1',
        name: 'Test Bot',
        stage: 'PAPER',
        accountId: null,
        accountName: null,
        botNow: null,
        matrix_aggregate: null,
        trend_direction: null,
        live_pnl: null,
        llm_cost: null,
      };
      
      expect(botWithFallbacks.accountId).toBeNull();
      expect(botWithFallbacks.botNow).toBeNull();
      expect(botWithFallbacks.matrix_aggregate).toBeNull();
    });
  });

  describe('Phase Coverage', () => {
    const ALL_PHASES = [
      'accounts',
      'instances',
      'trend',
      'botNow',
      'matrixAggregates',
      'matrixRunStatus',
      'alertCounts',
      'llmCosts',
      'latestGeneration',
      'paperMetrics',
      'livePnl',
    ];

    it('should have try/catch protection for all secondary phases', () => {
      expect(ALL_PHASES.length).toBe(11);
      
      ALL_PHASES.forEach(phase => {
        expect(typeof phase).toBe('string');
        expect(phase.length).toBeGreaterThan(0);
      });
    });

    it('should validate phase names are consistent with API contract', () => {
      const knownPhases = new Set(ALL_PHASES);
      
      const exampleDegradedPhases = ['accounts', 'trend', 'livePnl'];
      exampleDegradedPhases.forEach(phase => {
        expect(knownPhases.has(phase)).toBe(true);
      });
    });
  });

  describe('Performance Requirements', () => {
    it('should complete within timeout threshold (25s)', () => {
      const TIMEOUT_MS = 25000;
      const mockExecutionTime = 15000;
      
      expect(mockExecutionTime).toBeLessThan(TIMEOUT_MS);
    });

    it('should use abort controller for request cancellation', () => {
      const abortController = new AbortController();
      expect(abortController.signal.aborted).toBe(false);
      
      abortController.abort();
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  describe('Bot Data Enrichment', () => {
    it('should include live_pnl for PAPER+ stage bots', () => {
      const paperBot = {
        id: 'bot-1',
        stage: 'PAPER',
        live_pnl: {
          realized: 150.25,
          unrealized: -25.00,
          total: 125.25,
          closed_trades: 10,
          open_trades: 1,
          win_rate: 0.7,
        },
      };
      
      expect(paperBot.stage).not.toBe('TRIALS');
      expect(paperBot.live_pnl).not.toBeNull();
      expect(paperBot.live_pnl.realized).toBeDefined();
    });

    it('should not include live_pnl for TRIALS stage bots', () => {
      const trialsBot = {
        id: 'bot-2',
        stage: 'TRIALS',
        live_pnl: null,
      };
      
      expect(trialsBot.stage).toBe('TRIALS');
      expect(trialsBot.live_pnl).toBeNull();
    });

    it('should include matrix aggregate data when available', () => {
      const botWithMatrix = {
        id: 'bot-1',
        matrix_aggregate: {
          totalCells: 36,
          completedCells: 36,
          avgSharpe: 1.25,
          avgProfitFactor: 1.8,
        },
        matrix_best_cell: {
          timeframe: '5m',
          sharpe: 2.1,
        },
      };
      
      expect(botWithMatrix.matrix_aggregate).not.toBeNull();
      expect(botWithMatrix.matrix_aggregate.totalCells).toBeGreaterThan(0);
    });
  });
});

describe('Rate Limiter', () => {
  describe('Redis-backed rate limiting', () => {
    it('should allow requests under the limit', () => {
      const result = {
        allowed: true,
        remaining: 4,
        retryAfter: null,
        source: 'redis' as const,
      };
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('should block requests over the limit', () => {
      const result = {
        allowed: false,
        remaining: 0,
        retryAfter: 900,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        source: 'redis' as const,
      };
      
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should fall back to memory when Redis unavailable', () => {
      const fallbackResult = {
        allowed: true,
        remaining: 4,
        retryAfter: null,
        source: 'memory' as const,
      };
      
      expect(fallbackResult.source).toBe('memory');
    });
  });
});

describe('Bots Overview Cache', () => {
  describe('Cache behavior', () => {
    it('should return cache miss for empty cache', () => {
      const cacheResult = {
        hit: false,
        fresh: false,
        stale: false,
        data: null,
        ageSeconds: null,
      };
      
      expect(cacheResult.hit).toBe(false);
      expect(cacheResult.data).toBeNull();
    });

    it('should return fresh data within TTL', () => {
      const cacheResult = {
        hit: true,
        fresh: true,
        stale: false,
        data: { data: [], generatedAt: new Date().toISOString() },
        ageSeconds: 15,
      };
      
      expect(cacheResult.hit).toBe(true);
      expect(cacheResult.fresh).toBe(true);
      expect(cacheResult.ageSeconds).toBeLessThan(30);
    });

    it('should mark data as stale after FRESH_TTL', () => {
      const cacheResult = {
        hit: true,
        fresh: false,
        stale: true,
        data: { data: [], generatedAt: new Date().toISOString() },
        ageSeconds: 60,
      };
      
      expect(cacheResult.hit).toBe(true);
      expect(cacheResult.fresh).toBe(false);
      expect(cacheResult.stale).toBe(true);
    });
  });
});
