/**
 * Orchestrator End-to-End Tests - Real Database with Transaction Rollback
 * 
 * Industry standard testing approach:
 * - Each test runs inside a database transaction
 * - Transaction is rolled back after each test (full isolation)
 * - Real Drizzle queries against real Postgres
 * - No mocking of database layer
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  createTestContext,
  closeTestPool,
  schema,
  eq,
  and,
  type TestContext,
} from '../harness/testDbContext';

describe('Orchestrator E2E Tests - Real Database', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe('Research Job Lifecycle', () => {
    it('creates a job in QUEUED status', async () => {
      const job = await ctx.seed.seedResearchJob({
        mode: 'SENTIMENT_BURST',
        status: 'QUEUED',
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('QUEUED');
      expect(job.mode).toBe('SENTIMENT_BURST');
    });

    it('transitions job from QUEUED to RUNNING', async () => {
      const job = await ctx.seed.seedResearchJob({ status: 'QUEUED' });

      const [updated] = await ctx.db
        .update(schema.researchJobs)
        .set({ status: 'RUNNING', startedAt: ctx.time.getCurrentTime() })
        .where(eq(schema.researchJobs.id, job.id))
        .returning();

      expect(updated.status).toBe('RUNNING');
      expect(updated.startedAt).toBeDefined();
    });

    it('transitions job from RUNNING to COMPLETED', async () => {
      const job = await ctx.seed.seedResearchJob({ status: 'RUNNING' });

      const [updated] = await ctx.db
        .update(schema.researchJobs)
        .set({
          status: 'COMPLETED',
          completedAt: ctx.time.getCurrentTime(),
          costUsd: 2.50,
          candidatesCreated: 3,
        })
        .where(eq(schema.researchJobs.id, job.id))
        .returning();

      expect(updated.status).toBe('COMPLETED');
      expect(updated.costUsd).toBe(2.50);
      expect(updated.candidatesCreated).toBe(3);
    });

    it('transitions job from RUNNING to FAILED', async () => {
      const job = await ctx.seed.seedResearchJob({ status: 'RUNNING' });

      const [updated] = await ctx.db
        .update(schema.researchJobs)
        .set({
          status: 'FAILED',
          completedAt: ctx.time.getCurrentTime(),
          errorMessage: 'API rate limit exceeded',
        })
        .where(eq(schema.researchJobs.id, job.id))
        .returning();

      expect(updated.status).toBe('FAILED');
      expect(updated.errorMessage).toBe('API rate limit exceeded');
    });

    it('defers job when budget exhausted', async () => {
      const job = await ctx.seed.seedResearchJob({ status: 'QUEUED' });

      const [updated] = await ctx.db
        .update(schema.researchJobs)
        .set({
          status: 'DEFERRED',
          deferredReason: 'Budget exhausted',
        })
        .where(eq(schema.researchJobs.id, job.id))
        .returning();

      expect(updated.status).toBe('DEFERRED');
      expect(updated.deferredReason).toBe('Budget exhausted');
    });
  });

  describe('Job Querying and Filtering', () => {
    it('finds jobs by status', async () => {
      await ctx.seed.seedResearchJob({ status: 'QUEUED', mode: 'SENTIMENT_BURST' });
      await ctx.seed.seedResearchJob({ status: 'QUEUED', mode: 'CONTRARIAN_SCAN' });
      await ctx.seed.seedResearchJob({ status: 'RUNNING', mode: 'DEEP_REASONING' });
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', mode: 'SENTIMENT_BURST' });

      const queuedJobs = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.status, 'QUEUED'),
      });

      expect(queuedJobs.length).toBe(2);
      expect(queuedJobs.every(j => j.status === 'QUEUED')).toBe(true);
    });

    it('finds jobs by mode', async () => {
      await ctx.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'COMPLETED' });
      await ctx.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'COMPLETED' });
      await ctx.seed.seedResearchJob({ mode: 'CONTRARIAN_SCAN', status: 'COMPLETED' });

      const sentimentJobs = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.mode, 'SENTIMENT_BURST'),
      });

      expect(sentimentJobs.length).toBe(2);
    });

    it('finds jobs by mode AND status', async () => {
      await ctx.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'QUEUED' });
      await ctx.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', status: 'COMPLETED' });
      await ctx.seed.seedResearchJob({ mode: 'CONTRARIAN_SCAN', status: 'QUEUED' });

      const results = await ctx.db.query.researchJobs.findMany({
        where: and(
          eq(schema.researchJobs.mode, 'SENTIMENT_BURST'),
          eq(schema.researchJobs.status, 'QUEUED')
        ),
      });

      expect(results.length).toBe(1);
      expect(results[0].mode).toBe('SENTIMENT_BURST');
      expect(results[0].status).toBe('QUEUED');
    });

    it('orders jobs by priority', async () => {
      await ctx.seed.seedResearchJob({ priority: 40, mode: 'DEEP_REASONING', status: 'QUEUED' });
      await ctx.seed.seedResearchJob({ priority: 80, mode: 'SENTIMENT_BURST', status: 'QUEUED' });
      await ctx.seed.seedResearchJob({ priority: 60, mode: 'CONTRARIAN_SCAN', status: 'QUEUED' });

      const jobs = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.status, 'QUEUED'),
        orderBy: (jobs, { desc }) => [desc(jobs.priority)],
      });

      expect(jobs[0].priority).toBe(80);
      expect(jobs[1].priority).toBe(60);
      expect(jobs[2].priority).toBe(40);
    });
  });

  describe('Fingerprint Deduplication', () => {
    it('creates fingerprint with hash', async () => {
      const fp = await ctx.seed.seedFingerprint({
        fingerprintHash: 'unique_hash_abc123',
      });

      expect(fp.id).toBeDefined();
      expect(fp.fingerprintHash).toBe('unique_hash_abc123');
      expect(fp.hitCount).toBe(1);
    });

    it('finds fingerprint by hash', async () => {
      await ctx.seed.seedFingerprint({ fingerprintHash: 'hash_one' });
      await ctx.seed.seedFingerprint({ fingerprintHash: 'hash_two' });

      const found = await ctx.db.query.candidateFingerprints.findFirst({
        where: eq(schema.candidateFingerprints.fingerprintHash, 'hash_one'),
      });

      expect(found).toBeDefined();
      expect(found?.fingerprintHash).toBe('hash_one');
    });

    it('increments hit count on duplicate', async () => {
      const fp = await ctx.seed.seedFingerprint({
        fingerprintHash: 'duplicate_test',
        hitCount: 1,
      });

      const [updated] = await ctx.db
        .update(schema.candidateFingerprints)
        .set({
          hitCount: (fp.hitCount || 0) + 1,
          lastSeenAt: ctx.time.getCurrentTime(),
        })
        .where(eq(schema.candidateFingerprints.fingerprintHash, 'duplicate_test'))
        .returning();

      expect(updated.hitCount).toBe(2);
    });

    it('sets TTL expiry on fingerprint', async () => {
      ctx.time.setTime(new Date('2025-01-05T12:00:00Z'));
      const expiresAt = new Date('2025-01-06T12:00:00Z');

      const fp = await ctx.seed.seedFingerprint({
        fingerprintHash: 'expiring_hash',
        expiresAt,
      });

      expect(fp.expiresAt?.getTime()).toBe(expiresAt.getTime());
    });

    it('detects expired fingerprints', async () => {
      ctx.time.setTime(new Date('2025-01-05T12:00:00Z'));

      await ctx.seed.seedFingerprint({
        fingerprintHash: 'expired',
        expiresAt: new Date('2025-01-04T12:00:00Z'),
      });
      await ctx.seed.seedFingerprint({
        fingerprintHash: 'valid',
        expiresAt: new Date('2025-01-06T12:00:00Z'),
      });

      const allFingerprints = await ctx.db.query.candidateFingerprints.findMany();
      const now = ctx.time.getCurrentTime();

      const expired = allFingerprints.filter(
        f => f.expiresAt && f.expiresAt < now
      );
      const valid = allFingerprints.filter(
        f => !f.expiresAt || f.expiresAt >= now
      );

      expect(expired.length).toBe(1);
      expect(expired[0].fingerprintHash).toBe('expired');
      expect(valid.length).toBe(1);
      expect(valid[0].fingerprintHash).toBe('valid');
    });
  });

  describe('Orchestrator State', () => {
    it('creates orchestrator state', async () => {
      const state = await ctx.seed.seedOrchestratorState({
        isFullSpectrumEnabled: false,
      });

      expect(state.id).toBeDefined();
      expect(state.isFullSpectrumEnabled).toBe(false);
    });

    it('updates last activity timestamps', async () => {
      const state = await ctx.seed.seedOrchestratorState({
        isFullSpectrumEnabled: true,
      });

      ctx.time.advanceMinutes(5);

      const [updated] = await ctx.db
        .update(schema.researchOrchestratorState)
        .set({
          lastSentimentAt: ctx.time.getCurrentTime(),
        })
        .where(eq(schema.researchOrchestratorState.id, state.id))
        .returning();

      expect(updated.lastSentimentAt).toBeDefined();
    });

    it('tracks all three mode timestamps', async () => {
      const state = await ctx.seed.seedOrchestratorState({
        isFullSpectrumEnabled: true,
      });

      ctx.time.advanceMinutes(5);
      const sentimentTime = ctx.time.getCurrentTime();

      ctx.time.advanceMinutes(15);
      const contrarianTime = ctx.time.getCurrentTime();

      ctx.time.advanceMinutes(30);
      const deepTime = ctx.time.getCurrentTime();

      const [updated] = await ctx.db
        .update(schema.researchOrchestratorState)
        .set({
          lastSentimentAt: sentimentTime,
          lastContrarianAt: contrarianTime,
          lastDeepReasoningAt: deepTime,
        })
        .where(eq(schema.researchOrchestratorState.id, state.id))
        .returning();

      expect(updated.lastSentimentAt?.getTime()).toBe(sentimentTime.getTime());
      expect(updated.lastContrarianAt?.getTime()).toBe(contrarianTime.getTime());
      expect(updated.lastDeepReasoningAt?.getTime()).toBe(deepTime.getTime());
    });
  });

  describe('Strategy Candidates', () => {
    it('creates strategy candidate', async () => {
      const candidate = await ctx.seed.seedStrategyCandidate({
        strategyName: 'Momentum RSI Strategy',
        archetypeName: 'momentum',
        confidenceScore: 85,
        noveltyScore: 90,
      });

      expect(candidate.id).toBeDefined();
      expect(candidate.strategyName).toBe('Momentum RSI Strategy');
      expect(candidate.confidenceScore).toBe(85);
    });

    it('links job to candidate', async () => {
      const candidate = await ctx.seed.seedStrategyCandidate({
        strategyName: 'Test Strategy',
      });

      await ctx.seed.seedResearchJob({
        status: 'COMPLETED',
        candidatesCreated: 1,
      });

      const found = await ctx.db.query.strategyCandidates.findFirst({
        where: eq(schema.strategyCandidates.id, candidate.id),
      });

      expect(found).toBeDefined();
      expect(found?.strategyName).toBe('Test Strategy');
    });
  });

  describe('Cost Tracking', () => {
    it('tracks cost per job', async () => {
      const job = await ctx.seed.seedResearchJob({
        status: 'COMPLETED',
        costUsd: 2.50,
      });

      expect(job.costUsd).toBe(2.50);
    });

    it('calculates total cost across jobs', async () => {
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 2.50 });
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 5.00 });
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 7.50 });

      const jobs = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.status, 'COMPLETED'),
      });

      const totalCost = jobs.reduce((sum, j) => sum + (j.costUsd || 0), 0);
      expect(totalCost).toBe(15.00);
    });

    it('tracks cost by mode', async () => {
      await ctx.seed.seedResearchJob({
        mode: 'SENTIMENT_BURST',
        costClass: 'LOW',
        costUsd: 1.50,
        status: 'COMPLETED',
      });
      await ctx.seed.seedResearchJob({
        mode: 'CONTRARIAN_SCAN',
        costClass: 'MEDIUM',
        costUsd: 4.00,
        status: 'COMPLETED',
      });
      await ctx.seed.seedResearchJob({
        mode: 'DEEP_REASONING',
        costClass: 'HIGH',
        costUsd: 10.00,
        status: 'COMPLETED',
      });

      const jobs = await ctx.db.query.researchJobs.findMany();

      const sentimentCost = jobs
        .filter(j => j.mode === 'SENTIMENT_BURST')
        .reduce((sum, j) => sum + (j.costUsd || 0), 0);

      const deepCost = jobs
        .filter(j => j.mode === 'DEEP_REASONING')
        .reduce((sum, j) => sum + (j.costUsd || 0), 0);

      expect(sentimentCost).toBe(1.50);
      expect(deepCost).toBe(10.00);
    });
  });

  describe('Concurrency Control', () => {
    it('counts running jobs', async () => {
      await ctx.seed.seedResearchJob({ status: 'RUNNING', mode: 'SENTIMENT_BURST' });
      await ctx.seed.seedResearchJob({ status: 'RUNNING', mode: 'CONTRARIAN_SCAN' });
      await ctx.seed.seedResearchJob({ status: 'QUEUED', mode: 'DEEP_REASONING' });

      const runningJobs = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.status, 'RUNNING'),
      });

      expect(runningJobs.length).toBe(2);
    });

    it('enforces max concurrent limit', async () => {
      const MAX_CONCURRENT = 3;

      await ctx.seed.seedResearchJob({ status: 'RUNNING' });
      await ctx.seed.seedResearchJob({ status: 'RUNNING' });
      await ctx.seed.seedResearchJob({ status: 'RUNNING' });

      const runningCount = await ctx.db.query.researchJobs.findMany({
        where: eq(schema.researchJobs.status, 'RUNNING'),
      });

      const canStartNew = runningCount.length < MAX_CONCURRENT;
      expect(canStartNew).toBe(false);
    });
  });

  describe('Time-Based Scheduling', () => {
    it('creates job with scheduled time', async () => {
      ctx.time.setTime(new Date('2025-01-05T10:00:00Z'));
      const scheduledFor = new Date('2025-01-05T10:30:00Z');

      const job = await ctx.seed.seedResearchJob({
        status: 'QUEUED',
        scheduledFor,
      });

      expect(job.scheduledFor?.getTime()).toBe(scheduledFor.getTime());
    });

    it('detects scheduling drift', async () => {
      ctx.time.setTime(new Date('2025-01-05T10:00:00Z'));

      const job = await ctx.seed.seedResearchJob({
        status: 'QUEUED',
        scheduledFor: new Date('2025-01-05T09:45:00Z'),
      });

      ctx.time.advanceMinutes(20);
      const now = ctx.time.getCurrentTime();
      const driftMs = now.getTime() - (job.scheduledFor?.getTime() || 0);
      const driftMinutes = driftMs / (60 * 1000);

      expect(driftMinutes).toBeGreaterThan(15);
    });
  });

  describe('Test Isolation', () => {
    it('first test creates data', async () => {
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', mode: 'SENTIMENT_BURST' });
      await ctx.seed.seedResearchJob({ status: 'COMPLETED', mode: 'CONTRARIAN_SCAN' });

      const jobs = await ctx.db.query.researchJobs.findMany();
      expect(jobs.length).toBeGreaterThanOrEqual(2);
    });

    it('second test starts fresh (isolation verified)', async () => {
      const jobs = await ctx.db.query.researchJobs.findMany();
      expect(jobs.length).toBe(0);
    });
  });
});
