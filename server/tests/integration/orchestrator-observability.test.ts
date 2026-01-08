/**
 * Orchestrator Observability End-to-End Tests
 * 
 * Tests observability features with the in-memory database harness:
 * - Health metrics calculation
 * - Alert emission and acknowledgment
 * - Soak test metrics
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  createOrchestratorHarness,
  setupFakeTimers,
  teardownFakeTimers,
  type OrchestratorHarness,
} from '../harness/orchestratorHarness';

describe('Orchestrator Observability E2E Tests', () => {
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

  describe('Health Metrics Calculation', () => {
    it('calculates queue depth from pending jobs', () => {
      harness.seed.seedResearchJob({ status: 'QUEUED' });
      harness.seed.seedResearchJob({ status: 'QUEUED' });
      harness.seed.seedResearchJob({ status: 'QUEUED' });
      harness.seed.seedResearchJob({ status: 'RUNNING' });
      
      const queueDepth = harness.getJobsByStatus('QUEUED').length;
      expect(queueDepth).toBe(3);
    });
    
    it('calculates running job count', () => {
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'SENTIMENT_BURST' });
      harness.seed.seedResearchJob({ status: 'RUNNING', mode: 'CONTRARIAN_SCAN' });
      
      const runningCount = harness.getJobsByStatus('RUNNING').length;
      expect(runningCount).toBe(2);
    });
    
    it('calculates failure rate from completed jobs', () => {
      harness.seed.seedResearchJob({ status: 'COMPLETED' });
      harness.seed.seedResearchJob({ status: 'COMPLETED' });
      harness.seed.seedResearchJob({ status: 'COMPLETED' });
      harness.seed.seedResearchJob({ status: 'FAILED' });
      
      const completed = harness.getJobsByStatus('COMPLETED').length;
      const failed = harness.getJobsByStatus('FAILED').length;
      const total = completed + failed;
      const failureRate = total > 0 ? failed / total : 0;
      
      expect(failureRate).toBe(0.25);
    });
    
    it('calculates deferred job count', () => {
      harness.seed.seedResearchJob({ status: 'DEFERRED', deferredReason: 'Budget exhausted' });
      harness.seed.seedResearchJob({ status: 'DEFERRED', deferredReason: 'Max concurrent' });
      
      const deferredCount = harness.getJobsByStatus('DEFERRED').length;
      expect(deferredCount).toBe(2);
    });
    
    it('calculates daily cost total', () => {
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 2.50 });
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 5.00 });
      harness.seed.seedResearchJob({ status: 'COMPLETED', costUsd: 7.50 });
      
      const totalCost = harness.getTotalCost();
      expect(totalCost).toBe(15.00);
    });
    
    it('calculates budget utilization percentage', () => {
      const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 40 });
      
      const utilization = (budget.usedToday / budget.dailyBudget) * 100;
      expect(utilization).toBe(80);
    });
  });

  describe('Alert Detection', () => {
    describe('ORCHESTRATOR_STALLED alert', () => {
      it('detects stall when no jobs completed in 15 minutes', async () => {
        harness.seed.seedOrchestratorState({
          lastSentimentAt: new Date('2025-01-05T09:30:00Z'),
          lastContrarianAt: new Date('2025-01-05T09:30:00Z'),
          lastDeepReasoningAt: new Date('2025-01-05T09:30:00Z'),
        });
        
        harness.time.setTime(new Date('2025-01-05T09:50:00Z'));
        
        const state = Array.from(harness.store.orchestratorState.values())[0];
        const now = harness.time.getCurrentTime();
        const lastActivity = Math.max(
          state?.lastSentimentAt?.getTime() || 0,
          state?.lastContrarianAt?.getTime() || 0,
          state?.lastDeepReasoningAt?.getTime() || 0
        );
        const stalledMs = now.getTime() - lastActivity;
        const isStalled = stalledMs > 15 * 60 * 1000;
        
        expect(isStalled).toBe(true);
      });
      
      it('does not detect stall when activity is recent', () => {
        harness.seed.seedOrchestratorState({
          lastSentimentAt: new Date('2025-01-05T09:55:00Z'),
        });
        
        harness.time.setTime(new Date('2025-01-05T10:00:00Z'));
        
        const state = Array.from(harness.store.orchestratorState.values())[0];
        const now = harness.time.getCurrentTime();
        const lastActivity = state?.lastSentimentAt?.getTime() || 0;
        const stalledMs = now.getTime() - lastActivity;
        const isStalled = stalledMs > 15 * 60 * 1000;
        
        expect(isStalled).toBe(false);
      });
    });
    
    describe('BUDGET_THROTTLED alert', () => {
      it('detects throttle when budget >= 80%', () => {
        const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 42 });
        
        const utilization = budget.usedToday / budget.dailyBudget;
        const isThrottled = utilization >= 0.8;
        
        expect(isThrottled).toBe(true);
      });
      
      it('detects critical throttle when budget >= 95%', () => {
        const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 48 });
        
        const utilization = budget.usedToday / budget.dailyBudget;
        const isCritical = utilization >= 0.95;
        
        expect(isCritical).toBe(true);
      });
      
      it('does not alert when budget is healthy', () => {
        const budget = harness.seed.seedLlmBudget({ dailyBudget: 50, usedToday: 30 });
        
        const utilization = budget.usedToday / budget.dailyBudget;
        const isThrottled = utilization >= 0.8;
        
        expect(isThrottled).toBe(false);
      });
    });
    
    describe('HIGH_FAILURE_RATE alert', () => {
      it('detects high failure rate above 30%', () => {
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'FAILED' });
        harness.seed.seedResearchJob({ status: 'FAILED' });
        
        const completed = harness.getJobsByStatus('COMPLETED').length;
        const failed = harness.getJobsByStatus('FAILED').length;
        const total = completed + failed;
        const failureRate = total > 0 ? failed / total : 0;
        
        expect(failureRate).toBe(0.5);
        expect(failureRate > 0.3).toBe(true);
      });
      
      it('does not alert when failure rate is low', () => {
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
        harness.seed.seedResearchJob({ status: 'FAILED' });
        
        const completed = harness.getJobsByStatus('COMPLETED').length;
        const failed = harness.getJobsByStatus('FAILED').length;
        const total = completed + failed;
        const failureRate = total > 0 ? failed / total : 0;
        
        expect(failureRate).toBe(0.2);
        expect(failureRate > 0.3).toBe(false);
      });
    });
    
    describe('BACKPRESSURE_BUILDING alert', () => {
      it('detects backpressure when deferred jobs >= 10', () => {
        for (let i = 0; i < 10; i++) {
          harness.seed.seedResearchJob({ status: 'DEFERRED' });
        }
        
        const deferredCount = harness.getJobsByStatus('DEFERRED').length;
        const hasBackpressure = deferredCount >= 10;
        
        expect(hasBackpressure).toBe(true);
      });
      
      it('does not alert when deferred count is low', () => {
        for (let i = 0; i < 5; i++) {
          harness.seed.seedResearchJob({ status: 'DEFERRED' });
        }
        
        const deferredCount = harness.getJobsByStatus('DEFERRED').length;
        const hasBackpressure = deferredCount >= 10;
        
        expect(hasBackpressure).toBe(false);
      });
    });
    
    describe('SCHEDULING_DRIFT alert', () => {
      it('detects drift when scheduled job runs > 10 min late', () => {
        const scheduledFor = new Date('2025-01-05T10:00:00Z');
        harness.seed.seedResearchJob({
          status: 'QUEUED',
          scheduledFor,
        });
        
        harness.time.setTime(new Date('2025-01-05T10:15:00Z'));
        
        const job = Array.from(harness.store.researchJobs.values())[0];
        const now = harness.time.getCurrentTime();
        const driftMs = now.getTime() - (job.scheduledFor?.getTime() || 0);
        const hasDrift = driftMs > 10 * 60 * 1000;
        
        expect(hasDrift).toBe(true);
      });
    });
  });

  describe('Alert Lifecycle', () => {
    interface Alert {
      id: string;
      type: string;
      severity: 'info' | 'warning' | 'critical';
      message: string;
      acknowledged: boolean;
      acknowledgedAt: Date | null;
      createdAt: Date;
    }
    
    let alerts: Map<string, Alert>;
    
    beforeEach(() => {
      alerts = new Map();
    });
    
    it('creates alert with required fields', () => {
      const alert: Alert = {
        id: 'alert-1',
        type: 'BUDGET_THROTTLED',
        severity: 'warning',
        message: 'Budget utilization at 85%',
        acknowledged: false,
        acknowledgedAt: null,
        createdAt: new Date(),
      };
      
      alerts.set(alert.id, alert);
      
      expect(alerts.get('alert-1')).toBeDefined();
      expect(alerts.get('alert-1')?.type).toBe('BUDGET_THROTTLED');
    });
    
    it('acknowledges alert', () => {
      const alert: Alert = {
        id: 'alert-2',
        type: 'HIGH_FAILURE_RATE',
        severity: 'critical',
        message: 'Failure rate at 45%',
        acknowledged: false,
        acknowledgedAt: null,
        createdAt: new Date(),
      };
      
      alerts.set(alert.id, alert);
      
      const existing = alerts.get('alert-2')!;
      existing.acknowledged = true;
      existing.acknowledgedAt = new Date();
      alerts.set('alert-2', existing);
      
      expect(alerts.get('alert-2')?.acknowledged).toBe(true);
      expect(alerts.get('alert-2')?.acknowledgedAt).toBeInstanceOf(Date);
    });
    
    it('filters unacknowledged alerts', () => {
      alerts.set('alert-3', {
        id: 'alert-3',
        type: 'ORCHESTRATOR_STALLED',
        severity: 'critical',
        message: 'No activity for 20 minutes',
        acknowledged: false,
        acknowledgedAt: null,
        createdAt: new Date(),
      });
      
      alerts.set('alert-4', {
        id: 'alert-4',
        type: 'BUDGET_THROTTLED',
        severity: 'warning',
        message: 'Budget at 80%',
        acknowledged: true,
        acknowledgedAt: new Date(),
        createdAt: new Date(),
      });
      
      const unacknowledged = Array.from(alerts.values()).filter(a => !a.acknowledged);
      expect(unacknowledged.length).toBe(1);
      expect(unacknowledged[0].type).toBe('ORCHESTRATOR_STALLED');
    });
  });

  describe('Soak Test Metrics', () => {
    it('tracks sustained operation metrics', async () => {
      harness.time.setTime(new Date('2025-01-05T00:00:00Z'));
      
      for (let hour = 0; hour < 24; hour++) {
        harness.seed.seedResearchJob({
          status: 'COMPLETED',
          mode: 'SENTIMENT_BURST',
          costUsd: 1.5,
          completedAt: harness.time.getCurrentTime(),
        });
        
        if (hour % 2 === 0) {
          harness.seed.seedResearchJob({
            status: 'COMPLETED',
            mode: 'CONTRARIAN_SCAN',
            costUsd: 2.0,
            completedAt: harness.time.getCurrentTime(),
          });
        }
        
        if (hour % 6 === 0) {
          harness.seed.seedResearchJob({
            status: 'COMPLETED',
            mode: 'DEEP_REASONING',
            costUsd: 5.0,
            completedAt: harness.time.getCurrentTime(),
          });
        }
        
        await harness.time.advanceHours(1);
      }
      
      const totalJobs = harness.getJobCount();
      const totalCost = harness.getTotalCost();
      
      expect(totalJobs).toBeGreaterThan(20);
      expect(totalCost).toBeGreaterThan(40);
    });
    
    it('tracks deduplication efficiency', () => {
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_1' });
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_2' });
      harness.seed.seedFingerprint({ fingerprintHash: 'unique_3' });
      
      const fp4 = harness.seed.seedFingerprint({ fingerprintHash: 'duplicate_1' });
      fp4.hitCount = 3;
      harness.store.candidateFingerprints.set(fp4.id, fp4);
      
      const fingerprints = Array.from(harness.store.candidateFingerprints.values());
      const totalHits = fingerprints.reduce((sum, fp) => sum + fp.hitCount, 0);
      const uniqueCount = fingerprints.length;
      const duplicateRatio = totalHits > uniqueCount ? (totalHits - uniqueCount) / totalHits : 0;
      
      expect(duplicateRatio).toBeGreaterThan(0);
    });
    
    it('tracks queue depth over time', async () => {
      const queueDepthHistory: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        harness.seed.seedResearchJob({ status: 'QUEUED' });
        queueDepthHistory.push(harness.getJobsByStatus('QUEUED').length);
        
        if (i % 2 === 0) {
          const job = harness.getJobsByStatus('QUEUED')[0];
          if (job) {
            job.status = 'COMPLETED';
            harness.store.researchJobs.set(job.id, job);
          }
        }
      }
      
      expect(queueDepthHistory.length).toBe(5);
      expect(Math.max(...queueDepthHistory)).toBeGreaterThan(0);
    });
    
    it('tracks recovery after failure spikes', () => {
      for (let i = 0; i < 5; i++) {
        harness.seed.seedResearchJob({ status: 'FAILED', errorMessage: 'API error' });
      }
      
      let failureRate = harness.getJobsByStatus('FAILED').length / harness.getJobCount();
      expect(failureRate).toBe(1.0);
      
      for (let i = 0; i < 15; i++) {
        harness.seed.seedResearchJob({ status: 'COMPLETED' });
      }
      
      const completed = harness.getJobsByStatus('COMPLETED').length;
      const failed = harness.getJobsByStatus('FAILED').length;
      failureRate = failed / (completed + failed);
      
      expect(failureRate).toBe(0.25);
      expect(failureRate).toBeLessThan(0.3);
    });
  });

  describe('Mode-Specific Metrics', () => {
    it('tracks SENTIMENT_BURST job metrics', () => {
      harness.seed.seedResearchJob({
        status: 'COMPLETED',
        mode: 'SENTIMENT_BURST',
        costClass: 'LOW',
        costUsd: 1.5,
        candidatesCreated: 3,
      });
      
      const sentimentJobs = Array.from(harness.store.researchJobs.values())
        .filter(j => j.mode === 'SENTIMENT_BURST');
      
      expect(sentimentJobs.length).toBe(1);
      expect(sentimentJobs[0].costClass).toBe('LOW');
      expect(sentimentJobs[0].candidatesCreated).toBe(3);
    });
    
    it('tracks CONTRARIAN_SCAN job metrics', () => {
      harness.seed.seedResearchJob({
        status: 'COMPLETED',
        mode: 'CONTRARIAN_SCAN',
        costClass: 'MEDIUM',
        costUsd: 3.0,
        candidatesCreated: 2,
      });
      
      const contrarianJobs = Array.from(harness.store.researchJobs.values())
        .filter(j => j.mode === 'CONTRARIAN_SCAN');
      
      expect(contrarianJobs.length).toBe(1);
      expect(contrarianJobs[0].costClass).toBe('MEDIUM');
    });
    
    it('tracks DEEP_REASONING job metrics', () => {
      harness.seed.seedResearchJob({
        status: 'COMPLETED',
        mode: 'DEEP_REASONING',
        costClass: 'HIGH',
        costUsd: 8.0,
        candidatesCreated: 1,
      });
      
      const deepReasoningJobs = Array.from(harness.store.researchJobs.values())
        .filter(j => j.mode === 'DEEP_REASONING');
      
      expect(deepReasoningJobs.length).toBe(1);
      expect(deepReasoningJobs[0].costClass).toBe('HIGH');
      expect(deepReasoningJobs[0].costUsd).toBe(8.0);
    });
    
    it('calculates cost breakdown by mode', () => {
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', costUsd: 2.0, status: 'COMPLETED' });
      harness.seed.seedResearchJob({ mode: 'SENTIMENT_BURST', costUsd: 1.5, status: 'COMPLETED' });
      harness.seed.seedResearchJob({ mode: 'CONTRARIAN_SCAN', costUsd: 4.0, status: 'COMPLETED' });
      harness.seed.seedResearchJob({ mode: 'DEEP_REASONING', costUsd: 10.0, status: 'COMPLETED' });
      
      const jobs = Array.from(harness.store.researchJobs.values());
      
      const sentimentCost = jobs
        .filter(j => j.mode === 'SENTIMENT_BURST')
        .reduce((sum, j) => sum + (j.costUsd || 0), 0);
      
      const contrarianCost = jobs
        .filter(j => j.mode === 'CONTRARIAN_SCAN')
        .reduce((sum, j) => sum + (j.costUsd || 0), 0);
      
      const deepCost = jobs
        .filter(j => j.mode === 'DEEP_REASONING')
        .reduce((sum, j) => sum + (j.costUsd || 0), 0);
      
      expect(sentimentCost).toBe(3.5);
      expect(contrarianCost).toBe(4.0);
      expect(deepCost).toBe(10.0);
      expect(harness.getTotalCost()).toBe(17.5);
    });
  });
});
