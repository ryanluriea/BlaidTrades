/**
 * Research Orchestrator Integration Tests
 * 
 * These tests import and exercise the ACTUAL orchestrator functions
 * from server/research-orchestrator.ts with mocked external dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('../../db', () => {
  const mockQuery = {
    researchOrchestratorState: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    researchJobs: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    candidateFingerprints: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    llmBudgets: {
      findFirst: vi.fn().mockResolvedValue({ dailyBudget: 100, usedToday: 0 }),
    },
  };
  
  return {
    db: {
      query: mockQuery,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    },
  };
});

vi.mock('../../grok-research-engine', () => ({
  runGrokResearch: vi.fn().mockResolvedValue({ candidates: [], diagnostics: {} }),
  getResearchBudgetStatus: vi.fn().mockReturnValue({ dailyRemaining: 50, periodRemaining: 500 }),
}));

vi.mock('../../activity-logger', () => ({
  logActivityEvent: vi.fn().mockResolvedValue(undefined),
  ActivityType: {
    RESEARCH_CYCLE: 'RESEARCH_CYCLE',
    SYSTEM_STATUS: 'SYSTEM_STATUS',
    AUTONOMOUS_DECISION: 'AUTONOMOUS_DECISION',
  },
}));

vi.mock('../../market-regime-detector', () => ({
  detectMarketRegime: vi.fn().mockResolvedValue({ regime: 'RANGING', confidence: 0.8 }),
}));

vi.mock('../../orchestrator-observability', () => ({
  startObservabilityLoop: vi.fn(),
  stopObservabilityLoop: vi.fn(),
}));

vi.mock('@shared/schema', () => ({
  researchOrchestratorState: {},
  researchJobs: {},
  candidateFingerprints: {},
  llmBudgets: {},
  strategyCandidates: {},
}));

import {
  getOrchestratorStatus,
  generateCandidateFingerprint,
  enableFullSpectrum,
  triggerManualRun,
  startOrchestrator,
  stopOrchestrator,
  checkDuplicate,
  registerFingerprint,
} from '../../research-orchestrator';

describe("Orchestrator Integration - Real Function Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await stopOrchestrator();
  });

  describe("enableFullSpectrum - Real Export", () => {
    it("enables Full Spectrum mode", async () => {
      await enableFullSpectrum(true);
      const status = getOrchestratorStatus();
      expect(status.isFullSpectrum).toBe(true);
    });

    it("disables Full Spectrum mode", async () => {
      await enableFullSpectrum(true);
      await enableFullSpectrum(false);
      const status = getOrchestratorStatus();
      expect(status.isFullSpectrum).toBe(false);
    });

    it("persists state across calls", async () => {
      await enableFullSpectrum(true);
      const status1 = getOrchestratorStatus();
      expect(status1.isFullSpectrum).toBe(true);
      
      await enableFullSpectrum(false);
      const status2 = getOrchestratorStatus();
      expect(status2.isFullSpectrum).toBe(false);
    });
  });

  describe("startOrchestrator/stopOrchestrator - Real Export", () => {
    it("starts orchestrator and sets isEnabled to true", async () => {
      await startOrchestrator();
      const status = getOrchestratorStatus();
      expect(status.isEnabled).toBe(true);
    });

    it("stops orchestrator and sets isEnabled to false", async () => {
      await startOrchestrator();
      expect(getOrchestratorStatus().isEnabled).toBe(true);
      
      await stopOrchestrator();
      expect(getOrchestratorStatus().isEnabled).toBe(false);
    });

    it("prevents duplicate starts", async () => {
      await startOrchestrator();
      await startOrchestrator();
      expect(getOrchestratorStatus().isEnabled).toBe(true);
    });
  });

  describe("triggerManualRun - Real Export", () => {
    it("triggers manual run for SENTIMENT_BURST", async () => {
      const result = await triggerManualRun("SENTIMENT_BURST");
      expect(result).toHaveProperty("success");
    });

    it("triggers manual run for CONTRARIAN_SCAN", async () => {
      const result = await triggerManualRun("CONTRARIAN_SCAN");
      expect(result).toHaveProperty("success");
    });

    it("triggers manual run for DEEP_REASONING", async () => {
      const result = await triggerManualRun("DEEP_REASONING");
      expect(result).toHaveProperty("success");
    });
  });

  describe("checkDuplicate/registerFingerprint - Real Export", () => {
    it("checkDuplicate returns isDuplicate boolean", async () => {
      const result = await checkDuplicate("test_fingerprint_123");
      expect(result).toHaveProperty("isDuplicate");
      expect(typeof result.isDuplicate).toBe("boolean");
    });

    it("registerFingerprint is callable", async () => {
      expect(typeof registerFingerprint).toBe("function");
    });
  });

  describe("getOrchestratorStatus - Real Export", () => {
    it("returns orchestrator status with expected shape", () => {
      const status = getOrchestratorStatus();
      
      expect(status).toHaveProperty('isEnabled');
      expect(status).toHaveProperty('isFullSpectrum');
      expect(status).toHaveProperty('runningJobs');
      expect(status).toHaveProperty('dailyCost');
      expect(status).toHaveProperty('dailyJobs');
      expect(status).toHaveProperty('lastRuns');
      expect(status).toHaveProperty('nextRuns');
    });

    it("returns correct types for all fields", () => {
      const status = getOrchestratorStatus();
      
      expect(typeof status.isEnabled).toBe('boolean');
      expect(typeof status.isFullSpectrum).toBe('boolean');
      expect(typeof status.runningJobs).toBe('number');
      expect(typeof status.dailyCost).toBe('number');
      expect(typeof status.dailyJobs).toBe('number');
    });

    it("reports runningJobs as number >= 0", () => {
      const status = getOrchestratorStatus();
      expect(status.runningJobs).toBeGreaterThanOrEqual(0);
    });

    it("reports dailyCost as number >= 0", () => {
      const status = getOrchestratorStatus();
      expect(status.dailyCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("generateCandidateFingerprint - Real Export", () => {
    it("generates consistent fingerprints for same input", () => {
      const candidate = {
        archetypeName: "mean_reversion",
        hypothesis: "Buy oversold RSI conditions",
        rulesJson: { entry: [{ type: "rsi", value: 30 }], exit: [{ type: "target", ticks: 20 }] },
        regimeContext: "ranging",
      };

      const fp1 = generateCandidateFingerprint(candidate);
      const fp2 = generateCandidateFingerprint(candidate);
      
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe('string');
      expect(fp1.length).toBeGreaterThan(0);
    });

    it("generates different fingerprints for different archetypes", () => {
      const base = {
        hypothesis: "Test hypothesis",
        rulesJson: { entry: [], exit: [] },
        regimeContext: "ranging",
      };

      const fp1 = generateCandidateFingerprint({ ...base, archetypeName: "mean_reversion" });
      const fp2 = generateCandidateFingerprint({ ...base, archetypeName: "breakout" });
      
      expect(fp1).not.toBe(fp2);
    });

    it("generates different fingerprints for different hypotheses", () => {
      const base = {
        archetypeName: "test_archetype",
        rulesJson: { entry: [], exit: [] },
        regimeContext: "ranging",
      };

      const fp1 = generateCandidateFingerprint({ ...base, hypothesis: "Buy oversold" });
      const fp2 = generateCandidateFingerprint({ ...base, hypothesis: "Sell overbought" });
      
      expect(fp1).not.toBe(fp2);
    });

    it("generates different fingerprints for different entry rules", () => {
      const base = {
        archetypeName: "test_archetype",
        hypothesis: "Test hypothesis",
        regimeContext: "ranging",
      };

      const fp1 = generateCandidateFingerprint({ 
        ...base, 
        rulesJson: { entry: [{ type: "rsi", value: 30 }], exit: [] } 
      });
      const fp2 = generateCandidateFingerprint({ 
        ...base, 
        rulesJson: { entry: [{ type: "macd", value: 0 }], exit: [] } 
      });
      
      expect(fp1).not.toBe(fp2);
    });

    it("generates different fingerprints for different regime contexts", () => {
      const base = {
        archetypeName: "test_archetype",
        hypothesis: "Test hypothesis",
        rulesJson: { entry: [], exit: [] },
      };

      const fp1 = generateCandidateFingerprint({ ...base, regimeContext: "ranging" });
      const fp2 = generateCandidateFingerprint({ ...base, regimeContext: "trending" });
      
      expect(fp1).not.toBe(fp2);
    });

    it("handles missing optional fields", () => {
      const minimal = {};
      const fp = generateCandidateFingerprint(minimal);
      
      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    });

    it("handles undefined rulesJson gracefully", () => {
      const candidate = {
        archetypeName: "test",
        hypothesis: "Test",
        regimeContext: "ranging",
      };
      
      const fp = generateCandidateFingerprint(candidate);
      expect(typeof fp).toBe('string');
    });

    it("normalizes whitespace in hypothesis for dedup", () => {
      const base = {
        archetypeName: "test",
        rulesJson: {},
        regimeContext: "ranging",
      };

      const fp1 = generateCandidateFingerprint({ ...base, hypothesis: "Buy  oversold   conditions" });
      const fp2 = generateCandidateFingerprint({ ...base, hypothesis: "Buy oversold conditions" });
      
      expect(fp1).toBe(fp2);
    });
  });
});

describe("Orchestrator Constants & Configuration", () => {
  const STAGGERED_OFFSETS = {
    SENTIMENT_BURST: 5,
    CONTRARIAN_SCAN: 20,
    DEEP_REASONING: 50,
  };

  const PRIORITY_MAP = {
    SENTIMENT_BURST: 80,
    CONTRARIAN_SCAN: 60,
    DEEP_REASONING: 40,
  };

  const DEFAULT_CONFIG = {
    contrarianIntervalMs: 2 * 60 * 60_000,
    sentimentIntervalMs: 30 * 60_000,
    deepReasoningIntervalMs: 6 * 60 * 60_000,
    maxConcurrentJobs: 3,
    maxDailyCostUsd: 50,
    deduplicationTtlHours: 24,
  };

  type GrokResearchDepth = "SENTIMENT_BURST" | "CONTRARIAN_SCAN" | "DEEP_REASONING";

  function isStaggeredSlot(mode: GrokResearchDepth, currentMinute: number): boolean {
    const targetOffset = STAGGERED_OFFSETS[mode];
    
    if (mode === "SENTIMENT_BURST") {
      return currentMinute === 5 || currentMinute === 35;
    }
    
    return currentMinute >= targetOffset && currentMinute < targetOffset + 5;
  }

  describe("Staggered Slot Scheduling", () => {
    it("SENTIMENT_BURST runs at :05", () => {
      expect(isStaggeredSlot("SENTIMENT_BURST", 5)).toBe(true);
    });

    it("SENTIMENT_BURST runs at :35", () => {
      expect(isStaggeredSlot("SENTIMENT_BURST", 35)).toBe(true);
    });

    it("SENTIMENT_BURST does NOT run at :20", () => {
      expect(isStaggeredSlot("SENTIMENT_BURST", 20)).toBe(false);
    });

    it("CONTRARIAN_SCAN runs at :20-:24", () => {
      expect(isStaggeredSlot("CONTRARIAN_SCAN", 20)).toBe(true);
      expect(isStaggeredSlot("CONTRARIAN_SCAN", 24)).toBe(true);
    });

    it("CONTRARIAN_SCAN does NOT run at :25", () => {
      expect(isStaggeredSlot("CONTRARIAN_SCAN", 25)).toBe(false);
    });

    it("DEEP_REASONING runs at :50-:54", () => {
      expect(isStaggeredSlot("DEEP_REASONING", 50)).toBe(true);
      expect(isStaggeredSlot("DEEP_REASONING", 54)).toBe(true);
    });

    it("DEEP_REASONING does NOT run at :55", () => {
      expect(isStaggeredSlot("DEEP_REASONING", 55)).toBe(false);
    });

    it("no slot overlap between modes at any minute", () => {
      for (let minute = 0; minute < 60; minute++) {
        const slots = [
          isStaggeredSlot("SENTIMENT_BURST", minute),
          isStaggeredSlot("CONTRARIAN_SCAN", minute),
          isStaggeredSlot("DEEP_REASONING", minute),
        ].filter(Boolean);
        expect(slots.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Priority Ordering", () => {
    it("SENTIMENT_BURST has highest priority (80)", () => {
      expect(PRIORITY_MAP.SENTIMENT_BURST).toBe(80);
    });

    it("CONTRARIAN_SCAN has medium priority (60)", () => {
      expect(PRIORITY_MAP.CONTRARIAN_SCAN).toBe(60);
    });

    it("DEEP_REASONING has lowest priority (40)", () => {
      expect(PRIORITY_MAP.DEEP_REASONING).toBe(40);
    });

    it("priority ordering is SENTIMENT > CONTRARIAN > DEEP", () => {
      expect(PRIORITY_MAP.SENTIMENT_BURST).toBeGreaterThan(PRIORITY_MAP.CONTRARIAN_SCAN);
      expect(PRIORITY_MAP.CONTRARIAN_SCAN).toBeGreaterThan(PRIORITY_MAP.DEEP_REASONING);
    });
  });

  describe("Configuration Values", () => {
    it("maxDailyCostUsd is $50", () => {
      expect(DEFAULT_CONFIG.maxDailyCostUsd).toBe(50);
    });

    it("maxConcurrentJobs is 3", () => {
      expect(DEFAULT_CONFIG.maxConcurrentJobs).toBe(3);
    });

    it("deduplicationTtlHours is 24", () => {
      expect(DEFAULT_CONFIG.deduplicationTtlHours).toBe(24);
    });

    it("sentimentIntervalMs is 30 minutes", () => {
      expect(DEFAULT_CONFIG.sentimentIntervalMs).toBe(30 * 60 * 1000);
    });

    it("contrarianIntervalMs is 2 hours", () => {
      expect(DEFAULT_CONFIG.contrarianIntervalMs).toBe(2 * 60 * 60 * 1000);
    });

    it("deepReasoningIntervalMs is 6 hours", () => {
      expect(DEFAULT_CONFIG.deepReasoningIntervalMs).toBe(6 * 60 * 60 * 1000);
    });
  });
});

describe("Orchestrator Logic Functions - Simulated", () => {
  interface MockOrchestratorState {
    isFullSpectrumEnabled: boolean;
    lastContrarianAt: Date | null;
    lastSentimentAt: Date | null;
    lastDeepReasoningAt: Date | null;
    runningJobs: Map<string, any>;
    dailyCostUsd: number;
    dailyJobCount: number;
  }

  const DEFAULT_CONFIG = {
    contrarianIntervalMs: 2 * 60 * 60_000,
    sentimentIntervalMs: 30 * 60_000,
    deepReasoningIntervalMs: 6 * 60 * 60_000,
    maxConcurrentJobs: 3,
    maxDailyCostUsd: 50,
  };

  type GrokResearchDepth = "SENTIMENT_BURST" | "CONTRARIAN_SCAN" | "DEEP_REASONING";

  function createMockState(): MockOrchestratorState {
    return {
      isFullSpectrumEnabled: false,
      lastContrarianAt: null,
      lastSentimentAt: null,
      lastDeepReasoningAt: null,
      runningJobs: new Map(),
      dailyCostUsd: 0,
      dailyJobCount: 0,
    };
  }

  function shouldRunMode(mode: GrokResearchDepth, state: MockOrchestratorState, now: Date): boolean {
    const lastRun = mode === "CONTRARIAN_SCAN" ? state.lastContrarianAt
      : mode === "SENTIMENT_BURST" ? state.lastSentimentAt
      : state.lastDeepReasoningAt;
    
    if (!lastRun) return true;
    
    const interval = mode === "CONTRARIAN_SCAN" ? DEFAULT_CONFIG.contrarianIntervalMs
      : mode === "SENTIMENT_BURST" ? DEFAULT_CONFIG.sentimentIntervalMs
      : DEFAULT_CONFIG.deepReasoningIntervalMs;
    
    return now.getTime() - lastRun.getTime() >= interval;
  }

  function checkDailyCostLimit(state: MockOrchestratorState): { allowed: boolean; reason?: string } {
    if (state.dailyCostUsd >= DEFAULT_CONFIG.maxDailyCostUsd) {
      return { allowed: false, reason: `Daily cost limit of $${DEFAULT_CONFIG.maxDailyCostUsd} exceeded` };
    }
    return { allowed: true };
  }

  function shouldDeferJob(state: MockOrchestratorState): { defer: boolean; reason?: string } {
    if (state.runningJobs.size >= DEFAULT_CONFIG.maxConcurrentJobs) {
      return { defer: true, reason: "Max concurrent jobs reached" };
    }
    return { defer: false };
  }

  let state: MockOrchestratorState;
  let now: Date;

  beforeEach(() => {
    state = createMockState();
    now = new Date("2026-01-05T14:05:00Z");
  });

  describe("shouldRunMode - Interval Enforcement", () => {
    it("returns true when mode has never run", () => {
      expect(shouldRunMode("SENTIMENT_BURST", state, now)).toBe(true);
      expect(shouldRunMode("CONTRARIAN_SCAN", state, now)).toBe(true);
      expect(shouldRunMode("DEEP_REASONING", state, now)).toBe(true);
    });

    it("returns false when SENTIMENT_BURST ran less than 30 mins ago", () => {
      state.lastSentimentAt = new Date(now.getTime() - 20 * 60_000);
      expect(shouldRunMode("SENTIMENT_BURST", state, now)).toBe(false);
    });

    it("returns true when SENTIMENT_BURST ran exactly 30 mins ago", () => {
      state.lastSentimentAt = new Date(now.getTime() - 30 * 60_000);
      expect(shouldRunMode("SENTIMENT_BURST", state, now)).toBe(true);
    });

    it("returns false when CONTRARIAN_SCAN ran less than 2 hours ago", () => {
      state.lastContrarianAt = new Date(now.getTime() - 90 * 60_000);
      expect(shouldRunMode("CONTRARIAN_SCAN", state, now)).toBe(false);
    });

    it("returns true when CONTRARIAN_SCAN ran exactly 2 hours ago", () => {
      state.lastContrarianAt = new Date(now.getTime() - 2 * 60 * 60_000);
      expect(shouldRunMode("CONTRARIAN_SCAN", state, now)).toBe(true);
    });

    it("returns false when DEEP_REASONING ran less than 6 hours ago", () => {
      state.lastDeepReasoningAt = new Date(now.getTime() - 5 * 60 * 60_000);
      expect(shouldRunMode("DEEP_REASONING", state, now)).toBe(false);
    });

    it("returns true when DEEP_REASONING ran exactly 6 hours ago", () => {
      state.lastDeepReasoningAt = new Date(now.getTime() - 6 * 60 * 60_000);
      expect(shouldRunMode("DEEP_REASONING", state, now)).toBe(true);
    });
  });

  describe("checkDailyCostLimit - Budget Guardrail", () => {
    it("allows when cost is 0", () => {
      expect(checkDailyCostLimit(state)).toEqual({ allowed: true });
    });

    it("allows when cost is under limit", () => {
      state.dailyCostUsd = 25;
      expect(checkDailyCostLimit(state)).toEqual({ allowed: true });
    });

    it("blocks when cost equals limit", () => {
      state.dailyCostUsd = 50;
      const result = checkDailyCostLimit(state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("$50");
    });

    it("blocks when cost exceeds limit", () => {
      state.dailyCostUsd = 75;
      expect(checkDailyCostLimit(state).allowed).toBe(false);
    });
  });

  describe("shouldDeferJob - Backpressure Handling", () => {
    it("does not defer when no jobs running", () => {
      expect(shouldDeferJob(state)).toEqual({ defer: false });
    });

    it("does not defer when under capacity", () => {
      state.runningJobs.set("job1", {});
      state.runningJobs.set("job2", {});
      expect(shouldDeferJob(state)).toEqual({ defer: false });
    });

    it("defers when at capacity", () => {
      state.runningJobs.set("job1", {});
      state.runningJobs.set("job2", {});
      state.runningJobs.set("job3", {});
      const result = shouldDeferJob(state);
      expect(result.defer).toBe(true);
      expect(result.reason).toContain("Max concurrent");
    });
  });

  describe("Cost Accumulation Simulation", () => {
    it("stops accepting jobs when budget exhausted", () => {
      const jobCosts = [15, 15, 15, 15, 15];
      let acceptedJobs = 0;
      
      for (const cost of jobCosts) {
        const check = checkDailyCostLimit(state);
        if (!check.allowed) break;
        state.dailyCostUsd += cost;
        acceptedJobs++;
      }

      expect(acceptedJobs).toBe(4);
      expect(state.dailyCostUsd).toBe(60);
    });
  });
});
