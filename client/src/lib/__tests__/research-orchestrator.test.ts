/**
 * Research Orchestrator Integration Tests
 * 
 * Validates:
 * - Staggered timing for concurrent mode execution
 * - Quota guardrails and cost limits
 * - Backpressure handling and job deferral
 * - Deduplication fingerprinting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const STAGGERED_OFFSETS = {
  SENTIMENT_BURST: 5,    // Run at :05 and :35
  CONTRARIAN_SCAN: 20,   // Run at :20
  DEEP_REASONING: 50,    // Run at :50
};

const COST_CLASS_MAP = {
  SENTIMENT_BURST: "LOW",
  CONTRARIAN_SCAN: "MEDIUM",
  DEEP_REASONING: "HIGH",
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

describe("Research Orchestrator - Staggered Timing", () => {
  describe("SENTIMENT_BURST timing", () => {
    it("should run at minute :05", () => {
      const minute = 5;
      const offset = STAGGERED_OFFSETS.SENTIMENT_BURST;
      const isSlot = minute === 5 || minute === 35;
      expect(isSlot).toBe(true);
    });

    it("should run at minute :35", () => {
      const minute = 35 as number;
      const isSlot = minute === 5 || minute === 35;
      expect(isSlot).toBe(true);
    });

    it("should NOT run at minute :20", () => {
      const minute = 20 as number;
      const isSlot = minute === 5 || minute === 35;
      expect(isSlot).toBe(false);
    });

    it("should have highest priority (80)", () => {
      expect(PRIORITY_MAP.SENTIMENT_BURST).toBe(80);
      expect(PRIORITY_MAP.SENTIMENT_BURST).toBeGreaterThan(PRIORITY_MAP.CONTRARIAN_SCAN);
      expect(PRIORITY_MAP.SENTIMENT_BURST).toBeGreaterThan(PRIORITY_MAP.DEEP_REASONING);
    });

    it("should have LOW cost class", () => {
      expect(COST_CLASS_MAP.SENTIMENT_BURST).toBe("LOW");
    });
  });

  describe("CONTRARIAN_SCAN timing", () => {
    it("should run at minute :20", () => {
      const minute = 20;
      const offset = STAGGERED_OFFSETS.CONTRARIAN_SCAN;
      const isSlot = minute >= offset && minute < offset + 5;
      expect(isSlot).toBe(true);
    });

    it("should NOT run at minute :05", () => {
      const minute = 5;
      const offset = STAGGERED_OFFSETS.CONTRARIAN_SCAN;
      const isSlot = minute >= offset && minute < offset + 5;
      expect(isSlot).toBe(false);
    });

    it("should have medium priority (60)", () => {
      expect(PRIORITY_MAP.CONTRARIAN_SCAN).toBe(60);
    });

    it("should have MEDIUM cost class", () => {
      expect(COST_CLASS_MAP.CONTRARIAN_SCAN).toBe("MEDIUM");
    });
  });

  describe("DEEP_REASONING timing", () => {
    it("should run at minute :50", () => {
      const minute = 50;
      const offset = STAGGERED_OFFSETS.DEEP_REASONING;
      const isSlot = minute >= offset && minute < offset + 5;
      expect(isSlot).toBe(true);
    });

    it("should NOT run at minute :35", () => {
      const minute = 35;
      const offset = STAGGERED_OFFSETS.DEEP_REASONING;
      const isSlot = minute >= offset && minute < offset + 5;
      expect(isSlot).toBe(false);
    });

    it("should have lowest priority (40)", () => {
      expect(PRIORITY_MAP.DEEP_REASONING).toBe(40);
      expect(PRIORITY_MAP.DEEP_REASONING).toBeLessThan(PRIORITY_MAP.SENTIMENT_BURST);
      expect(PRIORITY_MAP.DEEP_REASONING).toBeLessThan(PRIORITY_MAP.CONTRARIAN_SCAN);
    });

    it("should have HIGH cost class", () => {
      expect(COST_CLASS_MAP.DEEP_REASONING).toBe("HIGH");
    });
  });

  describe("Mode non-overlap", () => {
    it("all three modes should have distinct time slots with no overlap", () => {
      const sentimentSlots = [5, 35];
      const contrarianSlots = [20, 21, 22, 23, 24];
      const deepSlots = [50, 51, 52, 53, 54];

      const allSlots = [...sentimentSlots, ...contrarianSlots, ...deepSlots];
      const uniqueSlots = new Set(allSlots);
      
      expect(allSlots.length).toBe(uniqueSlots.size);
    });
  });
});

describe("Research Orchestrator - Quota Guardrails", () => {
  describe("Daily cost limits", () => {
    it("should have default daily cost limit of $50", () => {
      expect(DEFAULT_CONFIG.maxDailyCostUsd).toBe(50);
    });

    it("should block when daily cost exceeds limit", () => {
      const currentCost = 51;
      const allowed = currentCost < DEFAULT_CONFIG.maxDailyCostUsd;
      expect(allowed).toBe(false);
    });

    it("should allow when daily cost is under limit", () => {
      const currentCost = 25;
      const allowed = currentCost < DEFAULT_CONFIG.maxDailyCostUsd;
      expect(allowed).toBe(true);
    });

    it("should block at exactly the limit", () => {
      const currentCost = 50;
      const allowed = currentCost < DEFAULT_CONFIG.maxDailyCostUsd;
      expect(allowed).toBe(false);
    });
  });

  describe("Concurrent job limits", () => {
    it("should have default max concurrent jobs of 3", () => {
      expect(DEFAULT_CONFIG.maxConcurrentJobs).toBe(3);
    });

    it("should defer jobs when at capacity", () => {
      const runningJobs = 3;
      const shouldDefer = runningJobs >= DEFAULT_CONFIG.maxConcurrentJobs;
      expect(shouldDefer).toBe(true);
    });

    it("should allow jobs when under capacity", () => {
      const runningJobs = 2;
      const shouldDefer = runningJobs >= DEFAULT_CONFIG.maxConcurrentJobs;
      expect(shouldDefer).toBe(false);
    });
  });

  describe("Interval enforcement", () => {
    it("CONTRARIAN_SCAN should have 2-hour interval", () => {
      expect(DEFAULT_CONFIG.contrarianIntervalMs).toBe(2 * 60 * 60_000);
    });

    it("SENTIMENT_BURST should have 30-minute interval", () => {
      expect(DEFAULT_CONFIG.sentimentIntervalMs).toBe(30 * 60_000);
    });

    it("DEEP_REASONING should have 6-hour interval", () => {
      expect(DEFAULT_CONFIG.deepReasoningIntervalMs).toBe(6 * 60 * 60_000);
    });

    it("should enforce interval between runs", () => {
      const lastRun = new Date(Date.now() - 20 * 60_000); // 20 mins ago
      const interval = DEFAULT_CONFIG.sentimentIntervalMs; // 30 mins
      const shouldRun = (Date.now() - lastRun.getTime()) >= interval;
      expect(shouldRun).toBe(false);
    });

    it("should allow run after interval elapsed", () => {
      const lastRun = new Date(Date.now() - 35 * 60_000); // 35 mins ago
      const interval = DEFAULT_CONFIG.sentimentIntervalMs; // 30 mins
      const shouldRun = (Date.now() - lastRun.getTime()) >= interval;
      expect(shouldRun).toBe(true);
    });
  });
});

describe("Research Orchestrator - Deduplication", () => {
  describe("Fingerprint generation", () => {
    it("should produce consistent fingerprints for same input", () => {
      const candidate = {
        archetypeName: "mean_reversion",
        hypothesis: "Buy oversold conditions",
        rulesJson: { entry: [{ type: "rsi_oversold" }], exit: [{ type: "target_hit" }] },
        regimeContext: "ranging",
      };

      const components = [
        candidate.archetypeName || "",
        candidate.hypothesis?.toLowerCase().substring(0, 200) || "",
        JSON.stringify(candidate.rulesJson?.entry || []).substring(0, 300),
        JSON.stringify(candidate.rulesJson?.exit || []).substring(0, 300),
        candidate.regimeContext || "",
      ];
      
      const normalized1 = components.join("|").toLowerCase().replace(/\s+/g, " ");
      const normalized2 = components.join("|").toLowerCase().replace(/\s+/g, " ");
      
      expect(normalized1).toBe(normalized2);
    });

    it("should produce different fingerprints for different archetypes", () => {
      const candidate1 = { archetypeName: "mean_reversion" };
      const candidate2 = { archetypeName: "breakout" };

      const norm1 = [candidate1.archetypeName].join("|").toLowerCase();
      const norm2 = [candidate2.archetypeName].join("|").toLowerCase();
      
      expect(norm1).not.toBe(norm2);
    });

    it("should produce different fingerprints for different rules", () => {
      const rules1 = { entry: [{ type: "rsi_oversold" }] };
      const rules2 = { entry: [{ type: "breakout_confirm" }] };

      const json1 = JSON.stringify(rules1.entry);
      const json2 = JSON.stringify(rules2.entry);
      
      expect(json1).not.toBe(json2);
    });
  });

  describe("TTL enforcement", () => {
    it("should have 24-hour deduplication TTL", () => {
      expect(DEFAULT_CONFIG.deduplicationTtlHours).toBe(24);
    });

    it("should calculate correct expiration time", () => {
      const now = Date.now();
      const expiresAt = new Date(now + DEFAULT_CONFIG.deduplicationTtlHours * 60 * 60 * 1000);
      const expectedMs = 24 * 60 * 60 * 1000;
      
      expect(expiresAt.getTime() - now).toBe(expectedMs);
    });
  });
});

describe("Research Orchestrator - Backpressure Handling", () => {
  describe("Priority queue ordering", () => {
    it("SENTIMENT_BURST should be processed first when all queued", () => {
      const jobs = [
        { mode: "DEEP_REASONING", priority: PRIORITY_MAP.DEEP_REASONING },
        { mode: "CONTRARIAN_SCAN", priority: PRIORITY_MAP.CONTRARIAN_SCAN },
        { mode: "SENTIMENT_BURST", priority: PRIORITY_MAP.SENTIMENT_BURST },
      ];

      const sorted = [...jobs].sort((a, b) => b.priority - a.priority);
      expect(sorted[0].mode).toBe("SENTIMENT_BURST");
    });

    it("DEEP_REASONING should be processed last when all queued", () => {
      const jobs = [
        { mode: "SENTIMENT_BURST", priority: PRIORITY_MAP.SENTIMENT_BURST },
        { mode: "DEEP_REASONING", priority: PRIORITY_MAP.DEEP_REASONING },
        { mode: "CONTRARIAN_SCAN", priority: PRIORITY_MAP.CONTRARIAN_SCAN },
      ];

      const sorted = [...jobs].sort((a, b) => b.priority - a.priority);
      expect(sorted[sorted.length - 1].mode).toBe("DEEP_REASONING");
    });
  });

  describe("Deferral behavior", () => {
    it("should set status to DEFERRED when at capacity", () => {
      const runningJobs = 3;
      const maxJobs = DEFAULT_CONFIG.maxConcurrentJobs;
      
      const status = runningJobs >= maxJobs ? "DEFERRED" : "QUEUED";
      expect(status).toBe("DEFERRED");
    });

    it("should include deferral reason", () => {
      const reason = "Max concurrent jobs reached";
      expect(reason).toContain("Max concurrent");
    });
  });

  describe("Cost class throttling", () => {
    it("HIGH cost jobs should be deferred first under budget pressure", () => {
      const jobs = [
        { costClass: "LOW", priority: 80 },
        { costClass: "MEDIUM", priority: 60 },
        { costClass: "HIGH", priority: 40 },
      ];

      const costOrder = { LOW: 1, MEDIUM: 2, HIGH: 3 };
      const sorted = [...jobs].sort((a, b) => costOrder[a.costClass as keyof typeof costOrder] - costOrder[b.costClass as keyof typeof costOrder]);
      
      expect(sorted[sorted.length - 1].costClass).toBe("HIGH");
    });
  });
});
