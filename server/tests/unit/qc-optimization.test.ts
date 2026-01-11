import { describe, it, expect } from 'vitest';
import {
  generateParameterGrid,
  getDefaultOptimizationConfig,
  rankOptimizationResults,
  calculateParameterSensitivity,
  generateWalkForwardWindows,
  getDefaultWalkForwardConfig,
  evaluateWalkForwardResult,
  summarizeWalkForward,
  createVerificationGates,
  runInstitutionalVerification,
  type OptimizationResult,
  type WalkForwardResult,
} from '../../providers/quantconnect/qcOptimization';

describe('QC Optimization - Parameter Grid Generation', () => {
  it('should generate correct number of combinations', () => {
    const config = {
      parameters: [
        { name: 'rsiPeriod', min: 10, max: 20, step: 5, type: 'indicator_period' as const },
        { name: 'rsiThreshold', min: 25, max: 35, step: 5, type: 'threshold' as const },
      ],
      metric: 'sharpe' as const,
      maxCombinations: 100,
      parallelJobs: 5,
      backtestDays: 30,
    };
    
    const grid = generateParameterGrid(config);
    
    expect(grid.length).toBe(9);
    expect(grid[0].parameters).toHaveProperty('rsiPeriod');
    expect(grid[0].parameters).toHaveProperty('rsiThreshold');
  });

  it('should limit combinations to maxCombinations', () => {
    const config = {
      parameters: [
        { name: 'param1', min: 1, max: 100, step: 1, type: 'indicator_period' as const },
        { name: 'param2', min: 1, max: 100, step: 1, type: 'indicator_period' as const },
      ],
      metric: 'sharpe' as const,
      maxCombinations: 50,
      parallelJobs: 5,
      backtestDays: 30,
    };
    
    const grid = generateParameterGrid(config);
    
    expect(grid.length).toBeLessThanOrEqual(50);
  });

  it('should generate unique hashes for each combination', () => {
    const config = getDefaultOptimizationConfig();
    const grid = generateParameterGrid(config);
    
    const hashes = grid.map(c => c.hash);
    const uniqueHashes = new Set(hashes);
    
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it('should generate deterministic hashes', () => {
    const config = getDefaultOptimizationConfig();
    config.maxCombinations = 10;
    
    const grid1 = generateParameterGrid(config);
    const grid2 = generateParameterGrid(config);
    
    for (let i = 0; i < grid1.length; i++) {
      expect(grid1[i].hash).toBe(grid2[i].hash);
    }
  });
});

describe('QC Optimization - Result Ranking', () => {
  const mockResults: OptimizationResult[] = [
    {
      combinationId: 'a',
      parameters: { rsiPeriod: 14 },
      metrics: { sharpe: 1.5, profitFactor: 1.8, winRate: 55, maxDrawdown: 10, totalTrades: 50, netProfit: 5000 },
      rank: 0,
    },
    {
      combinationId: 'b',
      parameters: { rsiPeriod: 10 },
      metrics: { sharpe: 2.0, profitFactor: 2.0, winRate: 60, maxDrawdown: 8, totalTrades: 45, netProfit: 6000 },
      rank: 0,
    },
    {
      combinationId: 'c',
      parameters: { rsiPeriod: 21 },
      metrics: { sharpe: 0.8, profitFactor: 1.2, winRate: 48, maxDrawdown: 15, totalTrades: 55, netProfit: 2000 },
      rank: 0,
    },
  ];

  it('should rank by Sharpe ratio correctly', () => {
    const ranked = rankOptimizationResults([...mockResults], 'sharpe');
    
    expect(ranked[0].combinationId).toBe('b');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].combinationId).toBe('a');
    expect(ranked[2].combinationId).toBe('c');
  });

  it('should rank by profit factor correctly', () => {
    const ranked = rankOptimizationResults([...mockResults], 'profit_factor');
    
    expect(ranked[0].combinationId).toBe('b');
    expect(ranked[0].metrics.profitFactor).toBe(2.0);
  });

  it('should rank by win rate correctly', () => {
    const ranked = rankOptimizationResults([...mockResults], 'win_rate');
    
    // Best win rate should be first (60%)
    expect(ranked[0].metrics.winRate).toBe(60);
    expect(ranked[0].rank).toBe(1);
    // Verify ordering is descending by win rate
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].metrics.winRate).toBeLessThanOrEqual(ranked[i-1].metrics.winRate);
    }
  });
});

describe('QC Optimization - Parameter Sensitivity', () => {
  it('should calculate sensitivity for varying results', () => {
    const results: OptimizationResult[] = [
      { combinationId: '1', parameters: { period: 10 }, metrics: { sharpe: 1.0, profitFactor: 1.5, winRate: 50, maxDrawdown: 10, totalTrades: 30, netProfit: 1000 }, rank: 1 },
      { combinationId: '2', parameters: { period: 14 }, metrics: { sharpe: 2.0, profitFactor: 2.0, winRate: 55, maxDrawdown: 8, totalTrades: 35, netProfit: 2000 }, rank: 2 },
      { combinationId: '3', parameters: { period: 21 }, metrics: { sharpe: 0.5, profitFactor: 1.1, winRate: 45, maxDrawdown: 15, totalTrades: 25, netProfit: 500 }, rank: 3 },
    ];
    
    const sensitivity = calculateParameterSensitivity(results, ['period']);
    
    expect(sensitivity.period).toBeGreaterThan(0);
  });

  it('should return 0 sensitivity for constant parameter', () => {
    const results: OptimizationResult[] = [
      { combinationId: '1', parameters: { period: 14 }, metrics: { sharpe: 1.0, profitFactor: 1.5, winRate: 50, maxDrawdown: 10, totalTrades: 30, netProfit: 1000 }, rank: 1 },
      { combinationId: '2', parameters: { period: 14 }, metrics: { sharpe: 2.0, profitFactor: 2.0, winRate: 55, maxDrawdown: 8, totalTrades: 35, netProfit: 2000 }, rank: 2 },
    ];
    
    const sensitivity = calculateParameterSensitivity(results, ['period']);
    
    expect(sensitivity.period).toBe(0);
  });
});

describe('QC Optimization - Walk-Forward Analysis', () => {
  it('should generate correct number of windows', () => {
    const config = getDefaultWalkForwardConfig();
    config.numWindows = 3;
    
    const windows = generateWalkForwardWindows(config);
    
    expect(windows.length).toBe(3);
    expect(windows[0].windowId).toBe(1);
    expect(windows[2].windowId).toBe(3);
  });

  it('should have non-overlapping in-sample and out-of-sample periods', () => {
    const config = getDefaultWalkForwardConfig();
    const windows = generateWalkForwardWindows(config);
    
    for (const window of windows) {
      expect(window.inSampleEnd.getTime()).toBeLessThan(window.outOfSampleStart.getTime());
    }
  });

  it('should respect in-sample ratio', () => {
    const config = {
      totalPeriodDays: 100,
      inSampleRatio: 0.7,
      numWindows: 1,
      anchoredStart: false,
    };
    
    const windows = generateWalkForwardWindows(config);
    const window = windows[0];
    
    const inSampleDays = (window.inSampleEnd.getTime() - window.inSampleStart.getTime()) / (24 * 60 * 60 * 1000);
    const outOfSampleDays = (window.outOfSampleEnd.getTime() - window.outOfSampleStart.getTime()) / (24 * 60 * 60 * 1000);
    
    const ratio = inSampleDays / (inSampleDays + outOfSampleDays);
    expect(ratio).toBeCloseTo(0.7, 1);
  });
});

describe('QC Optimization - Walk-Forward Evaluation', () => {
  it('should calculate degradation correctly', () => {
    const inSample = { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 };
    const outOfSample = { sharpe: 1.5, winRate: 55, maxDrawdown: 12, totalTrades: 45 };
    
    const result = evaluateWalkForwardResult(inSample, outOfSample, 1);
    
    expect(result.degradation.sharpe).toBe(25);
    expect(result.degradation.winRate).toBeCloseTo(8.33, 1);
  });

  it('should pass when out-of-sample meets thresholds', () => {
    const inSample = { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 };
    const outOfSample = { sharpe: 1.5, winRate: 55, maxDrawdown: 12, totalTrades: 45 };
    
    const result = evaluateWalkForwardResult(inSample, outOfSample, 1);
    
    expect(result.passed).toBe(true);
  });

  it('should fail when out-of-sample has poor metrics', () => {
    const inSample = { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 };
    const outOfSample = { sharpe: 0.3, winRate: 40, maxDrawdown: 25, totalTrades: 20 };
    
    const result = evaluateWalkForwardResult(inSample, outOfSample, 1);
    
    expect(result.passed).toBe(false);
  });

  it('should fail when degradation is too high', () => {
    const inSample = { sharpe: 3.0, winRate: 70, maxDrawdown: 5, totalTrades: 100 };
    const outOfSample = { sharpe: 0.8, winRate: 50, maxDrawdown: 15, totalTrades: 40 };
    
    const result = evaluateWalkForwardResult(inSample, outOfSample, 1);
    
    expect(result.degradation.sharpe).toBeGreaterThan(50);
    expect(result.passed).toBe(false);
  });
});

describe('QC Optimization - Walk-Forward Summary', () => {
  const mockResults: WalkForwardResult[] = [
    {
      windowId: 1,
      inSampleMetrics: { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 },
      outOfSampleMetrics: { sharpe: 1.5, winRate: 55, maxDrawdown: 12, totalTrades: 45 },
      degradation: { sharpe: 25, winRate: 8.33 },
      passed: true,
    },
    {
      windowId: 2,
      inSampleMetrics: { sharpe: 1.8, winRate: 58, maxDrawdown: 12, totalTrades: 48 },
      outOfSampleMetrics: { sharpe: 1.2, winRate: 52, maxDrawdown: 15, totalTrades: 40 },
      degradation: { sharpe: 33.33, winRate: 10.34 },
      passed: true,
    },
    {
      windowId: 3,
      inSampleMetrics: { sharpe: 2.2, winRate: 62, maxDrawdown: 8, totalTrades: 55 },
      outOfSampleMetrics: { sharpe: 0.4, winRate: 42, maxDrawdown: 22, totalTrades: 30 },
      degradation: { sharpe: 81.82, winRate: 32.26 },
      passed: false,
    },
  ];

  it('should calculate aggregate metrics correctly', () => {
    const summary = summarizeWalkForward(mockResults);
    
    expect(summary.aggregateMetrics.avgInSampleSharpe).toBeCloseTo(2.0, 1);
    expect(summary.aggregateMetrics.avgOutOfSampleSharpe).toBeCloseTo(1.03, 1);
    expect(summary.aggregateMetrics.windowsPassed).toBe(2);
    expect(summary.aggregateMetrics.totalWindows).toBe(3);
    expect(summary.aggregateMetrics.passRate).toBeCloseTo(66.67, 0);
  });

  it('should calculate robustness score', () => {
    const summary = summarizeWalkForward(mockResults);
    
    expect(summary.robustnessScore).toBeGreaterThan(0);
    expect(summary.robustnessScore).toBeLessThanOrEqual(100);
  });

  it('should make appropriate recommendation', () => {
    const goodResults: WalkForwardResult[] = [
      { windowId: 1, inSampleMetrics: { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 }, outOfSampleMetrics: { sharpe: 1.8, winRate: 58, maxDrawdown: 11, totalTrades: 48 }, degradation: { sharpe: 10, winRate: 3.33 }, passed: true },
      { windowId: 2, inSampleMetrics: { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 }, outOfSampleMetrics: { sharpe: 1.7, winRate: 57, maxDrawdown: 12, totalTrades: 46 }, degradation: { sharpe: 15, winRate: 5 }, passed: true },
      { windowId: 3, inSampleMetrics: { sharpe: 2.0, winRate: 60, maxDrawdown: 10, totalTrades: 50 }, outOfSampleMetrics: { sharpe: 1.6, winRate: 56, maxDrawdown: 13, totalTrades: 44 }, degradation: { sharpe: 20, winRate: 6.67 }, passed: true },
    ];
    
    const summary = summarizeWalkForward(goodResults);
    
    expect(summary.recommendation).toBe('PROMOTE');
  });

  it('should generate provenance hash', () => {
    const summary = summarizeWalkForward(mockResults);
    
    expect(summary.provenanceHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should handle empty results', () => {
    const summary = summarizeWalkForward([]);
    
    expect(summary.windows.length).toBe(0);
    expect(summary.robustnessScore).toBe(0);
    expect(summary.recommendation).toBe('REJECT');
  });
});

describe('QC Optimization - Institutional Verification Gates', () => {
  const goodMetrics = {
    sharpe: 1.5,
    winRate: 55,
    maxDrawdown: 12,
    totalTrades: 50,
    profitFactor: 1.8,
  };

  const badMetrics = {
    sharpe: 0.2,
    winRate: 40,
    maxDrawdown: 30,
    totalTrades: 15,
    profitFactor: 0.9,
  };

  it('should create all required gates', () => {
    const gates = createVerificationGates(goodMetrics);
    
    const gateNames = gates.map(g => g.name);
    expect(gateNames).toContain('MINIMUM_TRADES');
    expect(gateNames).toContain('POSITIVE_SHARPE');
    expect(gateNames).toContain('ACCEPTABLE_DRAWDOWN');
    expect(gateNames).toContain('WIN_RATE_THRESHOLD');
    expect(gateNames).toContain('PROFIT_FACTOR');
  });

  it('should pass all gates for good metrics', () => {
    const gates = createVerificationGates(goodMetrics);
    
    const failedGates = gates.filter(g => !g.passed);
    expect(failedGates.length).toBe(0);
  });

  it('should fail gates for bad metrics', () => {
    const gates = createVerificationGates(badMetrics);
    
    const failedGates = gates.filter(g => !g.passed);
    expect(failedGates.length).toBeGreaterThan(0);
  });

  it('should add optimization gates when provided', () => {
    const optimizationSummary = {
      totalCombinations: 50,
      completedCombinations: 48,
      bestResult: null,
      topResults: [],
      averageMetrics: { sharpe: 1.0, winRate: 50, maxDrawdown: 15 },
      parameterSensitivity: {},
      startTime: new Date().toISOString(),
      status: 'COMPLETED' as const,
    };
    
    const gates = createVerificationGates(goodMetrics, optimizationSummary);
    
    expect(gates.some(g => g.name === 'OPTIMIZATION_COVERAGE')).toBe(true);
  });

  it('should add walk-forward gates when provided', () => {
    const walkForwardSummary = {
      windows: [],
      aggregateMetrics: {
        avgInSampleSharpe: 1.5,
        avgOutOfSampleSharpe: 1.2,
        avgDegradation: 20,
        windowsPassed: 2,
        totalWindows: 3,
        passRate: 66.67,
      },
      robustnessScore: 70,
      recommendation: 'PROMOTE' as const,
      provenanceHash: 'abc123',
    };
    
    const gates = createVerificationGates(goodMetrics, undefined, walkForwardSummary);
    
    expect(gates.some(g => g.name === 'WALK_FORWARD_ROBUSTNESS')).toBe(true);
    expect(gates.some(g => g.name === 'OUT_OF_SAMPLE_PERFORMANCE')).toBe(true);
  });
});

describe('QC Optimization - Full Institutional Verification', () => {
  const goodMetrics = {
    sharpe: 1.5,
    winRate: 55,
    maxDrawdown: 12,
    totalTrades: 50,
    profitFactor: 1.8,
  };

  const provenance = {
    rulesHash: 'abc123',
    codeHash: 'def456',
    backtestHash: 'ghi789',
  };

  it('should recommend PROMOTE for all passing gates', () => {
    const verification = runInstitutionalVerification(
      'bot-123',
      'candidate-456',
      goodMetrics,
      provenance
    );
    
    expect(verification.overallPassed).toBe(true);
    expect(verification.recommendation).toBe('PROMOTE');
  });

  it('should recommend REJECT for many failing gates', () => {
    const badMetrics = {
      sharpe: -0.5,
      winRate: 30,
      maxDrawdown: 40,
      totalTrades: 10,
      profitFactor: 0.5,
    };
    
    const verification = runInstitutionalVerification(
      'bot-123',
      'candidate-456',
      badMetrics,
      provenance
    );
    
    expect(verification.overallPassed).toBe(false);
    expect(verification.recommendation).toBe('REJECT');
  });

  it('should include provenance chain in verification', () => {
    const verification = runInstitutionalVerification(
      'bot-123',
      'candidate-456',
      goodMetrics,
      provenance
    );
    
    expect(verification.provenanceChain.rulesHash).toBe('abc123');
    expect(verification.provenanceChain.codeHash).toBe('def456');
    expect(verification.provenanceChain.backtestHash).toBe('ghi789');
  });

  it('should calculate overall score', () => {
    const verification = runInstitutionalVerification(
      'bot-123',
      'candidate-456',
      goodMetrics,
      provenance
    );
    
    expect(verification.overallScore).toBeGreaterThan(0);
    expect(verification.overallScore).toBeLessThanOrEqual(100);
  });

  it('should include timestamp', () => {
    const verification = runInstitutionalVerification(
      'bot-123',
      'candidate-456',
      goodMetrics,
      provenance
    );
    
    expect(verification.timestamp).toBeDefined();
    expect(new Date(verification.timestamp).getTime()).toBeGreaterThan(0);
  });
});
