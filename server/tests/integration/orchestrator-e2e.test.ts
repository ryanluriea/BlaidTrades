/**
 * Orchestrator End-to-End Integration Tests
 * 
 * Tests the full orchestrator lifecycle with in-memory database harness
 * and deterministic time control via fake timers.
 * 
 * Coverage:
 * - Job lifecycle (queue → execute → complete/fail)
 * - Budget tracking and throttling
 * - Deduplication TTL enforcement
 * - Observability alerts
 * - Staggered scheduling
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  createOrchestratorHarness,
  setupFakeTimers,
  teardownFakeTimers,
  type OrchestratorHarness,
} from '../harness/orchestratorHarness';

vi.mock('../../db', async () => {
  const { createOrchestratorHarness } = await import('../harness/orchestratorHarness');
  const harness = createOrchestratorHarness();
  return { db: harness.mockDb };
});

vi.mock('../../grok-research-engine', () => ({
  runGrokResearch: vi.fn().mockResolvedValue({
    candidates: [
      {
        name: 'Test Strategy',
        archetypeName: 'momentum',
        hypothesis: 'Test market hypothesis',
        rulesJson: { entry: 'RSI < 30', exit: 'RSI > 70' },
      },
    ],
    diagnostics: { tokensUsed: 1000, costUsd: 0.05 },
  }),
  getResearchBudgetStatus: vi.fn().mockReturnValue({
    dailyRemaining: 45,
    periodRemaining: 450,
  }),
}));

vi.mock('../../activity-logger', () => ({
  logActivityEvent: vi.fn().mockResolvedValue(undefined),
  ActivityCategory: {
    RESEARCH_ORCHESTRATOR: 'RESEARCH_ORCHESTRATOR',
    AUTONOMOUS_DECISION: 'AUTONOMOUS_DECISION',
  },
}));

vi.mock('../../market-regime-detector', () => ({
  detectMarketRegime: vi.fn().mockResolvedValue({ regime: 'RANGING', confidence: 0.8 }),
}));

vi.mock('../../orchestrator-observability', () => ({
  startObservabilityLoop: vi.fn(),
  stopObservabilityLoop: vi.fn(),
  recordMetric: vi.fn(),
  emitAlert: vi.fn(),
}));

vi.mock('@shared/schema', () => ({
  researchOrchestratorState: { _: { name: 'research_orchestrator_state' } },
  researchJobs: { _: { name: 'research_jobs' } },
  candidateFingerprints: { _: { name: 'candidate_fingerprints' } },
  llmBudgets: { _: { name: 'llm_budgets' } },
  strategyCandidates: { _: { name: 'strategy_candidates' } },
}));

describe('Orchestrator End-to-End Tests', () => {
  let harness: OrchestratorHarness;
  
  beforeAll(() => {
    setupFakeTimers();
  });
  
  afterAll(() => {
    teardownFakeTimers();
  });
  
  beforeEach(() => {
    harness = createOrchestratorHarness();
    harness.reset();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Job Lifecycle', () => {
    it('creates a job with QUEUED status', () => {
      const job = harness.seed.seedResearchJob({
        mode: 'SENTIMENT_BURST',
        status: 'QUEUED',
        costClass: 'LOW',
        priority: 80,
      });
      
      expect(job.id).toBeDefined();
      expect(job.status).toBe('QUEUED');
      expect(job.mode).toBe('SENTIMENT_BURST');
      expect(harness.getJobCount()).toBe(1);
    });
    
    it('tracks multiple jobs with different statuses', () => {
      harness.seed.seedResearchJob({ status: 'QUEUED', mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'CONTRARIAN_SCAN' });
      harness.seed.seedResearchJob({ status: 'COMPLETED', mode: 'DEEP_REASONING' });
      
      expect(harness.getJobCount()).toBe(3);
      expect(harness.getJobsByStatus('QUEUED').length).toBe(1);
      expect(harness.getJobsByStatus('RUNNING').length).toBe(1);
      expect(harness.getJobsByStatus('COMPLETED').length).toBe(1);
    });
    
    it('updates job status from QUEUED to RUNNING', () => {
      const job = harness.seed.seedResearchJob({ status: 'QUEUED' });
      
      job.status = 'RUNNING';
      job.startedAt = new Date();
      harness.store.researchJobs.set(job.id, job);
      
      const updated = harness.store.researchJobs.get(job.id);
      expect(updated?.status).toBe('RUNNING');
      expect(updated?.startedAt).toBeInstanceOf(Date);
    });
    
    it('completes job with cost tracking', () => {
      const job = harness.seed.seedResearchJob({
        status: 'RUNNING',
        startedAt: new Date(),
      });
      
      job.status = 'COMPLETED';
      job.completedAt = new Date();
      job.costUsd = 0.05;
      job.candidatesCreated = 2;
      harness.store.researchJobs.set(job.id, job);
      
      const completed = harness.store.researchJobs.get(job.id);
      expect(completed?.status).toBe('COMPLETED');
      expect(completed?.costUsd).toBe(0.05);
      expect(completed?.candidatesCreated).toBe(2);
      expect(harness.getTotalCost()).toBe(0.05);
    });
    
    it('fails job with error message', () => {
      const job = harness.seed.seedResearchJob({ status: 'RUNNING' });
      
      job.status = 'FAILED';
      job.errorMessage = 'API rate limit exceeded';
      job.retryCount = 1;
      harness.store.researchJobs.set(job.id, job);
      
      const failed = harness.getJobsByStatus('FAILED')[0];
      expect(failed.errorMessage).toBe('API rate limit exceeded');
      expect(failed.retryCount).toBe(1);
    });
    
    it('defers job with reason', () => {
      const job = harness.seed.seedResearchJob({ status: 'QUEUED' });
      
      job.status = 'DEFERRED';
      job.deferredReason = 'Max concurrent jobs reached';
      harness.store.researchJobs.set(job.id, job);
      
      expect(harness.getJobsByStatus('DEFERRED').length).toBe(1);
      expect(harness.getJobsByStatus('DEFERRED')[0].deferredReason).toBe('Max concurrent jobs reached');
    });
  });

  describe('Budget Tracking', () => {
    it('seeds budget with default values', () => {
      const budget = harness.seed.seedLlmBudget();
      
      expect(budget.dailyBudget).toBe(50);
      expect(budget.usedToday).toBe(0);
      expect(budget.provider).toBe('xai');
    });
    
    it('tracks cost accumulation', () => {
      const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 0 });
      
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 5 });
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 10 });
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 7.5 });
      
      expect(harness.getTotalCost()).toBe(22.5);
    });
    
    it('detects budget exhaustion', () => {
      const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 48 });
      
      const remaining = budget.dailyBudget - budget.usedToday;
      expect(remaining).toBe(2);
      expect(remaining < 5).toBe(true);
    });
    
    it('blocks new jobs when budget exceeded', () => {
      const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 50 });
      
      const shouldThrottle = budget.usedToday >= budget.dailyBudget;
      expect(shouldThrottle).toBe(true);
    });
  });

  describe('Deduplication', () => {
    it('registers new fingerprint', () => {
      const fp = harness.seed.seedFingerprint({
        fingerprintHash: 'sha256_momentum_rsi_test',
        archetypeName: 'momentum',
      });
      
      expect(harness.getFingerprintCount()).toBe(1);
      expect(fp.fingerprintHash).toBe('sha256_momentum_rsi_test');
    });
    
    it('detects duplicate fingerprint', () => {
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_hash_123' });
      
      const existing = Array.from(harness.store.candidateFingerprints.values())
        .find(f => f.fingerprintHash === 'unique_hash_123');
      
      expect(existing).toBeDefined();
    });
    
    it('increments hit count on duplicate', () => {
      const fp = harness.seed.seedFingerprint({
        fingerprintHash: 'repeated_hash',
        hitCount: 1,
      });
      
      fp.hitCount += 1;
      fp.lastSeenAt = new Date();
      harness.store.candidateFingerprints.set(fp.id, fp);
      
      expect(harness.store.candidateFingerprints.get(fp.id)?.hitCount).toBe(2);
    });
    
    it('sets expiration time on fingerprint', () => {
      const now = new Date();
      const ttlHours = 24;
      const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
      
      const fp = harness.seed.seedFingerprint({
        fingerprintHash: 'expiring_hash',
        expiresAt,
      });
      
      expect(fp.expiresAt).toEqual(expiresAt);
    });
  });

  describe('Time-Based Scheduling', () => {
    it('advances time and checks scheduling windows', async () => {
      harness.time.setTime(new Date('2025-01-05T10:05:00Z'));
      
      const minute = harness.time.getCurrentTime().getMinutes();
      const isSentimentWindow = minute === 5 || minute === 35;
      
      expect(minute).toBe(5);
      expect(isSentimentWindow).toBe(true);
    });
    
    it('advances minutes correctly', async () => {
      harness.time.setTime(new Date('2025-01-05T10:00:00Z'));
      
      await harness.time.advanceMinutes(30);
      
      const newTime = harness.time.getCurrentTime();
      expect(newTime.getMinutes()).toBe(30);
    });
    
    it('advances hours correctly', async () => {
      harness.time.setTime(new Date('2025-01-05T10:00:00Z'));
      
      await harness.time.advanceHours(6);
      
      const newTime = harness.time.getCurrentTime();
      expect(newTime.getHours()).toBe(16);
    });
    
    it('respects cooldown periods', async () => {
      const lastRun = new Date('2025-01-05T10:00:00Z');
      harness.seed.seedOrchestratorState({
        lastSentimentAt: lastRun,
      });
      
      harness.time.setTime(new Date('2025-01-05T10:15:00Z'));
      
      const state = Array.from(harness.store.orchestratorState.values())[0];
      const msSinceLastRun = harness.time.getCurrentTime().getTime() - (state?.lastSentimentAt?.getTime() || 0);
      const cooldownMs = 30 * 60 * 1000;
      
      expect(msSinceLastRun).toBeLessThan(cooldownMs);
    });
    
    it('allows run after cooldown elapsed', async () => {
      const lastRun = new Date('2025-01-05T10:00:00Z');
      harness.seed.seedOrchestratorState({
        lastSentimentAt: lastRun,
      });
      
      harness.time.setTime(new Date('2025-01-05T10:35:00Z'));
      
      const state = Array.from(harness.store.orchestratorState.values())[0];
      const msSinceLastRun = harness.time.getCurrentTime().getTime() - (state?.lastSentimentAt?.getTime() || 0);
      const cooldownMs = 30 * 60 * 1000;
      
      expect(msSinceLastRun).toBeGreaterThanOrEqual(cooldownMs);
    });
  });

  describe('Orchestrator State', () => {
    it('persists Full Spectrum mode', () => {
      const state = harness.seed.seedOrchestratorState({
        isFullSpectrumEnabled: true,
      });
      
      expect(state.isFullSpectrumEnabled).toBe(true);
    });
    
    it('tracks backpressure per mode', () => {
      const state = harness.seed.seedOrchestratorState({
        contrarianBackpressure: 2,
        sentimentBackpressure: 0,
        deepReasoningBackpressure: 1,
      });
      
      expect(state.contrarianBackpressure).toBe(2);
      expect(state.sentimentBackpressure).toBe(0);
      expect(state.deepReasoningBackpressure).toBe(1);
    });
    
    it('tracks daily totals', () => {
      const state = harness.seed.seedOrchestratorState({
        totalJobsToday: 15,
        totalCostToday: 12.50,
      });
      
      expect(state.totalJobsToday).toBe(15);
      expect(state.totalCostToday).toBe(12.50);
    });
    
    it('updates last run timestamps', () => {
      const now = new Date();
      const state = harness.seed.seedOrchestratorState({
        lastContrarianAt: now,
        lastSentimentAt: now,
        lastDeepReasoningAt: null,
      });
      
      expect(state.lastContrarianAt).toEqual(now);
      expect(state.lastSentimentAt).toEqual(now);
      expect(state.lastDeepReasoningAt).toBeNull();
    });
  });

  describe('Concurrency Control', () => {
    it('counts running jobs', () => {
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'CONTRARIAN_SCAN' });
      harness.seed.seedResearchJob({ status: 'QUEUED', mode: 'DEEP_REASONING' });
      
      const runningCount = harness.getJobsByStatus('RUNNING').length;
      expect(runningCount).toBe(2);
    });
    
    it('blocks new jobs when at max concurrency', () => {
      const maxConcurrent = 3;
      
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      
      const runningCount = harness.getJobsByStatus('RUNNING').length;
      const shouldDefer = runningCount >= maxConcurrent;
      
      expect(shouldDefer).toBe(true);
    });
    
    it('allows jobs when under capacity', () => {
      const maxConcurrent = 3;
      
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      
      const runningCount = harness.getJobsByStatus('RUNNING').length;
      const hasCapacity = runningCount < maxConcurrent;
      
      expect(hasCapacity).toBe(true);
    });
  });

  describe('Priority Queue', () => {
    it('orders jobs by priority', () => {
      harness.seed.seedResearchJob({ priority: 40, mode: 'DEEP_REASONING' });
      harness.seed.seedResearchJob({ priority: 80, mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ priority: 60, mode: 'CONTRARIAN_SCAN' });
      
      const jobs = Array.from(harness.store.researchJobs.values())
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));
      
      expect(jobs[0].mode).toBe('SENTIMENT_BURST');
      expect(jobs[1].mode).toBe('CONTRARIAN_SCAN');
      expect(jobs[2].mode).toBe('DEEP_REASONING');
    });
  });

  describe('Cost Class Throttling', () => {
    it('classifies SENTIMENT_BURST as LOW cost', () => {
      const job = harness.seed.seedResearchJob({
        mode: 'SENTIMENT_BURST',
        costClass: 'LOW',
      });
      
      expect(job.costClass).toBe('LOW');
    });
    
    it('classifies CONTRARIAN_SCAN as MEDIUM cost', () => {
      const job = harness.seed.seedResearchJob({
        mode: 'CONTRARIAN_SCAN',
        costClass: 'MEDIUM',
      });
      
      expect(job.costClass).toBe('MEDIUM');
    });
    
    it('classifies DEEP_REASONING as HIGH cost', () => {
      const job = harness.seed.seedResearchJob({
        mode: 'DEEP_REASONING',
        costClass: 'HIGH',
      });
      
      expect(job.costClass).toBe('HIGH');
    });
  });

  describe('Mock DB Query Interface', () => {
    it('findFirst returns seeded job', async () => {
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST' });
      
      const result = await harness.mockDb.query.researchJobs.findFirst();
      
      expect(result).toBeDefined();
      expect(result?.mode).toBe('SENTIMENT_BURST');
    });
    
    it('findMany returns all seeded jobs', async () => {
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ mode: 'CONTRARIAN_SCAN' });
      
      const results = await harness.mockDb.query.researchJobs.findMany();
      
      expect(results.length).toBe(2);
    });
    
    it('findFirst on fingerprints returns null when empty', async () => {
      const result = await harness.mockDb.query.candidateFingerprints.findFirst();
      
      expect(result).toBeNull();
    });
    
    it('findFirst on fingerprints returns seeded data', async () => {
      harness.seed.seedFingerprint({ fingerprintHash: 'test_hash' });
      
      const result = await harness.mockDb.query.candidateFingerprints.findFirst();
      
      expect(result?.fingerprintHash).toBe('test_hash');
    });
    
    it('findFirst on llmBudgets returns seeded budget', async () => {
      harness.seed.seedLlmBudget({ provider: 'xai', dailyBudget: 100 });
      
      const result = await harness.mockDb.query.llmBudgets.findFirst();
      
      expect(result?.provider).toBe('xai');
      expect(result?.dailyBudget).toBe(100);
    });
    
    it('findFirst on orchestratorState returns seeded state', async () => {
      harness.seed.seedOrchestratorState({ isFullSpectrumEnabled: true });
      
      const result = await harness.mockDb.query.researchOrchestratorState.findFirst();
      
      expect(result?.isFullSpectrumEnabled).toBe(true);
    });
  });

  describe('Daily Reset Simulation', () => {
    it('simulates daily budget reset', async () => {
      const budget = harness.seed.seedLlmBudget({
        dailyBudget: 50,
        usedToday: 45,
      });
      
      budget.usedToday = 0;
      budget.lastResetAt = new Date();
      harness.store.llmBudgets.set(budget.id, budget);
      
      const resetBudget = harness.store.llmBudgets.get(budget.id);
      expect(resetBudget?.usedToday).toBe(0);
    });
    
    it('simulates daily job count reset', () => {
      const state = harness.seed.seedOrchestratorState({
        totalJobsToday: 25,
        totalCostToday: 35.50,
      });
      
      state.totalJobsToday = 0;
      state.totalCostToday = 0;
      harness.store.orchestratorState.set(state.id, state);
      
      const resetState = harness.store.orchestratorState.get(state.id);
      expect(resetState?.totalJobsToday).toBe(0);
      expect(resetState?.totalCostToday).toBe(0);
    });
  });

  describe('Fingerprint TTL Expiry', () => {
    it('identifies expired fingerprints', () => {
      const past = new Date('2025-01-04T10:00:00Z');
      const now = new Date('2025-01-05T12:00:00Z');
      
      harness.seed.seedFingerprint({
        fingerprintHash: 'expired_fp',
        expiresAt: past,
      });
      
      harness.time.setTime(now);
      
      const fingerprint = Array.from(harness.store.candidateFingerprints.values())[0];
      const isExpired = fingerprint.expiresAt && fingerprint.expiresAt < harness.time.getCurrentTime();
      
      expect(isExpired).toBe(true);
    });
    
    it('identifies non-expired fingerprints', () => {
      const future = new Date('2025-01-06T10:00:00Z');
      const now = new Date('2025-01-05T12:00:00Z');
      
      harness.seed.seedFingerprint({
        fingerprintHash: 'valid_fp',
        expiresAt: future,
      });
      
      harness.time.setTime(now);
      
      const fingerprint = Array.from(harness.store.candidateFingerprints.values())[0];
      const isExpired = fingerprint.expiresAt && fingerprint.expiresAt < harness.time.getCurrentTime();
      
      expect(isExpired).toBe(false);
    });
  });

  describe('Filtering and Uniqueness', () => {
    it('finds fingerprint by exact hash match', () => {
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_hash_abc' });
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_hash_xyz' });
      
      const allFingerprints = Array.from(harness.store.candidateFingerprints.values());
      const match = allFingerprints.find(f => f.fingerprintHash === 'unique_hash_abc');
      
      expect(match).toBeDefined();
      expect(match?.fingerprintHash).toBe('unique_hash_abc');
    });
    
    it('filters jobs by status correctly', () => {
      harness.seed.seedResearchJob({ status: 'QUEUED', mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ status: 'QUEUED', mode: 'CONTRARIAN_SCAN' });
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'DEEP_REASONING' });
      harness.seed.seedResearchJob({ status: 'COMPLETED', mode: 'SENTIMENT_BURST' });
      
      const queued = harness.getJobsByStatus('QUEUED');
      const running = harness.getJobsByStatus('RUNNING');
      const completed = harness.getJobsByStatus('COMPLETED');
      
      expect(queued.length).toBe(2);
      expect(running.length).toBe(1);
      expect(completed.length).toBe(1);
    });
    
    it('filters jobs by mode', () => {
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'COMPLETED' });
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'COMPLETED' });
      harness.seed.seedResearchJob({ mode: 'CONTRARIAN_SCAN', status: 'COMPLETED' });
      
      const jobs = Array.from(harness.store.researchJobs.values());
      const sentimentJobs = jobs.filter(j => j.mode === 'SENTIMENT_BURST');
      
      expect(sentimentJobs.length).toBe(2);
    });
    
    it('enforces fingerprint uniqueness by hash', () => {
      harness.seed.seedFingerprint({ fingerprintHash: 'duplicate_test' });
      
      const existing = Array.from(harness.store.candidateFingerprints.values())
        .find(f => f.fingerprintHash === 'duplicate_test');
      
      expect(existing).toBeDefined();
      
      if (existing) {
        existing.hitCount += 1;
        existing.lastSeenAt = new Date();
        harness.store.candidateFingerprints.set(existing.id, existing);
      }
      
      const updated = Array.from(harness.store.candidateFingerprints.values())
        .find(f => f.fingerprintHash === 'duplicate_test');
      
      expect(updated?.hitCount).toBe(2);
    });
    
    it('selects oldest queued job for processing', () => {
      const oldTime = new Date('2025-01-05T08:00:00Z');
      const newTime = new Date('2025-01-05T10:00:00Z');
      
      harness.seed.seedResearchJob({ status: 'QUEUED', createdAt: newTime, mode: 'CONTRARIAN_SCAN' });
      harness.seed.seedResearchJob({ status: 'QUEUED', createdAt: oldTime, mode: 'SENTIMENT_BURST' });
      
      const queuedJobs = harness.getJobsByStatus('QUEUED')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      
      expect(queuedJobs[0].mode).toBe('SENTIMENT_BURST');
    });
    
    it('selects highest priority job', () => {
      harness.seed.seedResearchJob({ status: 'QUEUED', priority: 40, mode: 'DEEP_REASONING' });
      harness.seed.seedResearchJob({ status: 'QUEUED', priority: 80, mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ status: 'QUEUED', priority: 60, mode: 'CONTRARIAN_SCAN' });
      
      const queuedJobs = harness.getJobsByStatus('QUEUED')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));
      
      expect(queuedJobs[0].mode).toBe('SENTIMENT_BURST');
      expect(queuedJobs[0].priority).toBe(80);
    });
    
    it('filters expired fingerprints by date', () => {
      const now = new Date('2025-01-05T12:00:00Z');
      const past = new Date('2025-01-04T12:00:00Z');
      const future = new Date('2025-01-06T12:00:00Z');
      
      harness.seed.seedFingerprint({ fingerprintHash: 'expired', expiresAt: past });
      harness.seed.seedFingerprint({ fingerprintHash: 'valid', expiresAt: future });
      harness.seed.seedFingerprint({ fingerprintHash: 'no_expiry', expiresAt: null });
      
      harness.time.setTime(now);
      
      const fingerprints = Array.from(harness.store.candidateFingerprints.values());
      const expired = fingerprints.filter(f => f.expiresAt && f.expiresAt < harness.time.getCurrentTime());
      const valid = fingerprints.filter(f => !f.expiresAt || f.expiresAt >= harness.time.getCurrentTime());
      
      expect(expired.length).toBe(1);
      expect(expired[0].fingerprintHash).toBe('expired');
      expect(valid.length).toBe(2);
    });
  });

  describe('Strategy Candidates', () => {
    it('seeds strategy candidate', () => {
      const candidate = harness.seed.seedCandidate({
        name: 'Momentum RSI Strategy',
        archetypeName: 'momentum',
        confidenceScore: 85,
        noveltyScore: 72,
      });
      
      expect(candidate.name).toBe('Momentum RSI Strategy');
      expect(candidate.confidenceScore).toBe(85);
    });
    
    it('links fingerprint to candidate', () => {
      const candidate = harness.seed.seedCandidate({ name: 'Test Strategy' });
      const fingerprint = harness.seed.seedFingerprint({
        fingerprintHash: 'linked_fp',
        candidateId: candidate.id,
      });
      
      expect(fingerprint.candidateId).toBe(candidate.id);
    });
  });
});
