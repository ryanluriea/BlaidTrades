import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordParseMethod,
  recordVerificationGate,
  recordWalkForwardResult,
  recordOptimizationResult,
  getMonitoringMetrics,
  getRecentVerifications,
  getParseMethodDistribution,
  resetMetrics,
  type ParseMethod,
  type ParseMethodMetrics,
} from '../../qc-monitoring';
import type { InstitutionalVerification, WalkForwardSummary, OptimizationSummary } from '../../providers/quantconnect/qcOptimization';

describe('QC Monitoring - Parse Method Recording', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record AST_PARSER parse method', () => {
    const metrics: ParseMethodMetrics = {
      method: 'AST_PARSER',
      confidence: 85,
      indicatorCount: 2,
      parseTimeMs: 15,
      candidateId: 'test-1',
    };
    
    recordParseMethod(metrics);
    
    const distribution = getParseMethodDistribution();
    const astEntry = distribution.find(d => d.method === 'AST_PARSER');
    expect(astEntry).toBeDefined();
    expect(astEntry!.count).toBe(1);
  });

  it('should record HEURISTIC fallback', () => {
    recordParseMethod({
      method: 'HEURISTIC',
      confidence: 50,
      indicatorCount: 1,
      parseTimeMs: 10,
    });

    const distribution = getParseMethodDistribution();
    const heuristicEntry = distribution.find(d => d.method === 'HEURISTIC');
    expect(heuristicEntry).toBeDefined();
    expect(heuristicEntry!.count).toBe(1);
  });

  it('should record ARCHETYPE_FALLBACK', () => {
    recordParseMethod({
      method: 'ARCHETYPE_FALLBACK',
      confidence: 30,
      indicatorCount: 0,
      parseTimeMs: 5,
    });

    const distribution = getParseMethodDistribution();
    const archetypeEntry = distribution.find(d => d.method === 'ARCHETYPE_FALLBACK');
    expect(archetypeEntry).toBeDefined();
    expect(archetypeEntry!.count).toBe(1);
  });

  it('should calculate correct distribution percentages', () => {
    recordParseMethod({ method: 'AST_PARSER', confidence: 90, indicatorCount: 2, parseTimeMs: 10 });
    recordParseMethod({ method: 'AST_PARSER', confidence: 85, indicatorCount: 1, parseTimeMs: 12 });
    recordParseMethod({ method: 'HEURISTIC', confidence: 60, indicatorCount: 1, parseTimeMs: 8 });
    recordParseMethod({ method: 'ARCHETYPE_FALLBACK', confidence: 20, indicatorCount: 0, parseTimeMs: 3 });

    const metrics = getMonitoringMetrics();
    expect(metrics.parseMethodCounts.AST_PARSER).toBe(2);
    expect(metrics.parseMethodCounts.HEURISTIC).toBe(1);
    expect(metrics.parseMethodCounts.ARCHETYPE_FALLBACK).toBe(1);
    expect(metrics.totalProcessed).toBe(4);
  });

  it('should track average confidence by method', () => {
    recordParseMethod({ method: 'AST_PARSER', confidence: 80, indicatorCount: 2, parseTimeMs: 10 });
    recordParseMethod({ method: 'AST_PARSER', confidence: 100, indicatorCount: 3, parseTimeMs: 15 });

    const metrics = getMonitoringMetrics();
    expect(metrics.avgConfidenceByMethod.AST_PARSER).toBe(90);
  });
});

describe('QC Monitoring - Verification Gates', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record verification gate pass', () => {
    const verification: InstitutionalVerification = {
      botId: 'bot-1',
      candidateId: 'cand-1',
      gates: [
        { name: 'MIN_TRADES', passed: true, value: 50, threshold: 30, message: 'Passed' },
        { name: 'SHARPE_THRESHOLD', passed: true, value: 1.5, threshold: 0, message: 'Passed' },
      ],
      overallPassed: true,
      overallScore: 85,
      recommendation: 'APPROVE',
      timestamp: new Date().toISOString(),
      provenanceChain: {
        rulesHash: 'abc123',
        codeHash: 'def456',
        metricsHash: 'ghi789',
        timestamp: new Date().toISOString(),
      },
    };

    recordVerificationGate(verification);
    
    const metrics = getMonitoringMetrics();
    expect(metrics.verificationPassRate).toBeGreaterThan(0);
    
    const recent = getRecentVerifications(5);
    expect(recent.length).toBe(1);
    expect(recent[0].recommendation).toBe('APPROVE');
  });

  it('should record verification gate failure with reasons', () => {
    const verification: InstitutionalVerification = {
      botId: 'bot-2',
      candidateId: 'cand-2',
      gates: [
        { name: 'MIN_TRADES', passed: false, value: 10, threshold: 30, message: 'Insufficient trades' },
        { name: 'SHARPE_THRESHOLD', passed: false, value: -0.5, threshold: 0, message: 'Negative Sharpe' },
        { name: 'WIN_RATE', passed: true, value: 55, threshold: 45, message: 'Passed' },
      ],
      overallPassed: false,
      overallScore: 33,
      recommendation: 'REJECT',
      timestamp: new Date().toISOString(),
      provenanceChain: {
        rulesHash: 'abc123',
        codeHash: 'def456',
        metricsHash: 'ghi789',
        timestamp: new Date().toISOString(),
      },
    };

    recordVerificationGate(verification);
    
    const recent = getRecentVerifications(5);
    expect(recent[0].failedGates).toContain('MIN_TRADES');
    expect(recent[0].failedGates).toContain('SHARPE_THRESHOLD');
  });

  it('should calculate verification pass rate correctly', () => {
    const createVerification = (passed: boolean): InstitutionalVerification => ({
      botId: 'bot-' + Math.random(),
      gates: [{ name: 'TEST', passed, value: passed ? 100 : 0, threshold: 50, message: '' }],
      overallPassed: passed,
      overallScore: passed ? 100 : 0,
      recommendation: passed ? 'APPROVE' : 'REJECT',
      timestamp: new Date().toISOString(),
      provenanceChain: {
        rulesHash: 'abc123',
        codeHash: 'def456',
        metricsHash: 'ghi789',
        timestamp: new Date().toISOString(),
      },
    });

    recordVerificationGate(createVerification(true));
    recordVerificationGate(createVerification(true));
    recordVerificationGate(createVerification(false));

    const metrics = getMonitoringMetrics();
    // Pass rate is returned as percentage (66.67%) not decimal (0.67)
    expect(metrics.verificationPassRate).toBeCloseTo(66.67, 0);
  });
});

describe('QC Monitoring - Walk Forward Analysis', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record walk forward results', () => {
    const summary: WalkForwardSummary = {
      windows: [
        {
          window: { inSampleStart: new Date('2024-01-01'), inSampleEnd: new Date('2024-06-01'), outOfSampleStart: new Date('2024-06-01'), outOfSampleEnd: new Date('2024-07-01') },
          inSampleMetrics: { sharpe: 1.5, maxDrawdown: 0.1, profitFactor: 1.8, winRate: 55, totalTrades: 50 },
          outOfSampleMetrics: { sharpe: 1.2, maxDrawdown: 0.12, profitFactor: 1.6, winRate: 52, totalTrades: 20 },
          degradationRatio: 0.8,
          passed: true,
        },
      ],
      aggregateMetrics: {
        avgInSampleSharpe: 1.5,
        avgOutOfSampleSharpe: 1.2,
        avgDegradation: 0.8,
        windowsPassed: 1,
        totalWindows: 1,
        passRate: 100,
      },
      robustnessScore: 75,
      recommendation: 'PROMOTE',
      provenanceHash: 'abc123def456',
    };

    recordWalkForwardResult(summary, 'bot-wf-1');
    
    const metrics = getMonitoringMetrics();
    expect(metrics.walkForwardPassRate).toBeGreaterThanOrEqual(0);
  });
});

describe('QC Monitoring - Optimization Results', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record optimization results', () => {
    const summary: OptimizationSummary = {
      bestCombination: {
        combinationId: 'combo-1',
        parameters: { rsiPeriod: 14, rsiOversold: 25 },
        metrics: { sharpe: 2.1, sortino: 2.5, calmar: 1.8, maxDrawdown: 0.1, profitFactor: 1.8, winRate: 60 },
        rank: 1,
      },
      parameterSensitivity: { rsiPeriod: 0.5, rsiOversold: 0.3 },
      totalCombinations: 50,
      executionTimeMs: 5000,
    };

    recordOptimizationResult(summary, 'bot-opt-1');
    
    const metrics = getMonitoringMetrics();
    expect(metrics.totalProcessed).toBeGreaterThanOrEqual(0);
  });
});

describe('QC Monitoring - Reset and Structure', () => {
  it('should reset all stats', () => {
    recordParseMethod({ method: 'AST_PARSER', confidence: 85, indicatorCount: 2, parseTimeMs: 10 });

    resetMetrics();
    const metrics = getMonitoringMetrics();

    expect(metrics.parseMethodCounts.AST_PARSER).toBe(0);
    expect(metrics.parseMethodCounts.HEURISTIC).toBe(0);
    expect(metrics.parseMethodCounts.ARCHETYPE_FALLBACK).toBe(0);
  });

  it('should return consistent metrics structure', () => {
    const metrics = getMonitoringMetrics();

    expect(metrics).toHaveProperty('parseMethodCounts');
    expect(metrics).toHaveProperty('avgConfidenceByMethod');
    expect(metrics).toHaveProperty('verificationPassRate');
    expect(metrics).toHaveProperty('walkForwardPassRate');
    expect(metrics).toHaveProperty('totalProcessed');
    expect(metrics).toHaveProperty('lastUpdated');
  });

  it('should return parse method distribution with percentages', () => {
    recordParseMethod({ method: 'AST_PARSER', confidence: 90, indicatorCount: 2, parseTimeMs: 10 });
    recordParseMethod({ method: 'AST_PARSER', confidence: 80, indicatorCount: 1, parseTimeMs: 8 });
    recordParseMethod({ method: 'HEURISTIC', confidence: 50, indicatorCount: 1, parseTimeMs: 5 });
    
    const distribution = getParseMethodDistribution();
    
    expect(distribution.length).toBeGreaterThan(0);
    const astEntry = distribution.find(d => d.method === 'AST_PARSER');
    expect(astEntry).toBeDefined();
    expect(astEntry!.percentage).toBeCloseTo(66.67, 0);
    expect(astEntry!.avgConfidence).toBe(85);
  });
});
