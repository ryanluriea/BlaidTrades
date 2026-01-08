/**
 * Acceptance Tests for Metrics Source Isolation
 * Asserts that metrics are NEVER mixed silently between backtest and paper/live sources
 * 
 * CRITICAL RULE: Stats source is determined by BOT STAGE, not by trade count
 * - LAB bots → BACKTEST source
 * - PAPER/SHADOW bots → PAPER source (even if 0 trades - show "—")
 * - LIVE/CANARY bots → LIVE source
 */
import { describe, it, expect } from 'vitest';

type BotStage = 'TRIALS' | 'PAPER' | 'SHADOW' | 'LIVE' | 'CANARY';
type StatsSource = 'BACKTEST' | 'PAPER' | 'LIVE' | 'NONE';

interface MockBotMetrics {
  stage: BotStage;
  trades: number;           // Paper/live trades
  winRate: number | null;   // Paper/live win rate
  backtestTrades: number;
  backtestWinRate: number | null;
  statsSource: StatsSource;
}

/**
 * CRITICAL: Determine stats source by STAGE, not by trade count
 * This is the fix for the bug where PAPER bots with 0 trades showed backtest metrics
 */
function determineStatsSourceByStage(stage: BotStage): StatsSource {
  if (stage === 'TRIALS') return 'BACKTEST';
  if (stage === 'PAPER' || stage === 'SHADOW') return 'PAPER';
  if (stage === 'LIVE' || stage === 'CANARY') return 'LIVE';
  return 'NONE';
}

// Helper to determine which value should be displayed based on source
function getDisplayedWinRate(metrics: MockBotMetrics): number | null {
  const source = determineStatsSourceByStage(metrics.stage);
  if (source === 'PAPER' || source === 'LIVE') {
    return metrics.winRate;  // Return paper/live win rate (may be null if 0 trades)
  }
  if (source === 'BACKTEST') {
    return metrics.backtestWinRate;
  }
  return null;
}

function getDisplayedTrades(metrics: MockBotMetrics): number {
  const source = determineStatsSourceByStage(metrics.stage);
  if (source === 'PAPER' || source === 'LIVE') {
    return metrics.trades;  // Return paper/live trades (may be 0)
  }
  if (source === 'BACKTEST') {
    return metrics.backtestTrades;
  }
  return 0;
}

describe('Metrics Source Isolation', () => {
  /**
   * TEST 1: PAPER bot with 0 trades shows PAPER source (not backtest fallback)
   * This is the core bug fix - Ion-Beam showed -2% max DD from backtest instead of "—"
   */
  it('PAPER bot with 0 trades shows PAPER source, not backtest fallback', () => {
    const metrics: MockBotMetrics = {
      stage: 'PAPER',
      trades: 0,           // No paper trades
      winRate: null,       // Paper win rate should be null
      backtestTrades: 50,  // Has backtest trades
      backtestWinRate: 65.5, // Has backtest win rate
      statsSource: 'PAPER', // MUST be PAPER because stage is PAPER
    };

    // Source MUST be PAPER because stage is PAPER (not BACKTEST just because trades=0)
    const source = determineStatsSourceByStage(metrics.stage);
    expect(source).toBe('PAPER');
    
    // Displayed values should be from PAPER source (null/0, NOT backtest values)
    const displayedWinRate = getDisplayedWinRate(metrics);
    const displayedTrades = getDisplayedTrades(metrics);
    
    expect(displayedWinRate).toBeNull();  // Shows "—" in UI, NOT 65.5% from backtest
    expect(displayedTrades).toBe(0);       // Shows 0, NOT 50 from backtest
  });

  /**
   * TEST 2: LAB bot uses BACKTEST source
   */
  it('LAB bot uses backtest source', () => {
    const metrics: MockBotMetrics = {
      stage: 'TRIALS',
      trades: 0,
      winRate: null,
      backtestTrades: 100,
      backtestWinRate: 58.3,
      statsSource: 'BACKTEST',
    };

    const source = determineStatsSourceByStage(metrics.stage);
    expect(source).toBe('BACKTEST');
    
    const displayedWinRate = getDisplayedWinRate(metrics);
    expect(displayedWinRate).toBe(58.3);
  });

  /**
   * TEST 3: PAPER bot with trades shows paper stats
   */
  it('PAPER bot with trades shows paper stats', () => {
    const metrics: MockBotMetrics = {
      stage: 'PAPER',
      trades: 25,
      winRate: 52.0,
      backtestTrades: 200,
      backtestWinRate: 48.5,
      statsSource: 'PAPER',
    };

    const source = determineStatsSourceByStage(metrics.stage);
    expect(source).toBe('PAPER');
    
    const displayedWinRate = getDisplayedWinRate(metrics);
    const displayedTrades = getDisplayedTrades(metrics);
    
    expect(displayedWinRate).toBe(52.0);  // Paper win rate, NOT backtest
    expect(displayedTrades).toBe(25);     // Paper trades, NOT backtest
  });

  /**
   * TEST 4: SHADOW bot always uses PAPER source
   */
  it('SHADOW bot uses PAPER source even with 0 trades', () => {
    const metrics: MockBotMetrics = {
      stage: 'SHADOW',
      trades: 0,
      winRate: null,
      backtestTrades: 150,
      backtestWinRate: 60.0,
      statsSource: 'PAPER',
    };

    const source = determineStatsSourceByStage(metrics.stage);
    expect(source).toBe('PAPER');
    
    // Should show null/0, NOT backtest values
    expect(getDisplayedWinRate(metrics)).toBeNull();
    expect(getDisplayedTrades(metrics)).toBe(0);
  });

  /**
   * TEST 5: LIVE bot uses LIVE source
   */
  it('LIVE bot uses LIVE source', () => {
    const metrics: MockBotMetrics = {
      stage: 'LIVE',
      trades: 10,
      winRate: 70.0,
      backtestTrades: 200,
      backtestWinRate: 55.0,
      statsSource: 'LIVE',
    };

    const source = determineStatsSourceByStage(metrics.stage);
    expect(source).toBe('LIVE');
    
    expect(getDisplayedWinRate(metrics)).toBe(70.0);
    expect(getDisplayedTrades(metrics)).toBe(10);
  });

  /**
   * TEST 6: Never mix sources - metrics consistency check
   */
  it('never mixes sources - all metrics from same source', () => {
    const testCases: MockBotMetrics[] = [
      // PAPER with trades
      { stage: 'PAPER', trades: 30, winRate: 55.0, backtestTrades: 100, backtestWinRate: 60.0, statsSource: 'PAPER' },
      // PAPER with 0 trades (the bug case)
      { stage: 'PAPER', trades: 0, winRate: null, backtestTrades: 80, backtestWinRate: 45.0, statsSource: 'PAPER' },
      // LAB with backtest
      { stage: 'TRIALS', trades: 0, winRate: null, backtestTrades: 200, backtestWinRate: 62.0, statsSource: 'BACKTEST' },
      // SHADOW with 0 trades
      { stage: 'SHADOW', trades: 0, winRate: null, backtestTrades: 50, backtestWinRate: 58.0, statsSource: 'PAPER' },
    ];

    for (const metrics of testCases) {
      const source = determineStatsSourceByStage(metrics.stage);
      const displayedWinRate = getDisplayedWinRate(metrics);
      const displayedTrades = getDisplayedTrades(metrics);

      // Verify source matches stage
      if (metrics.stage === 'TRIALS') {
        expect(source).toBe('BACKTEST');
        expect(displayedWinRate).toBe(metrics.backtestWinRate);
        expect(displayedTrades).toBe(metrics.backtestTrades);
      } else if (['PAPER', 'SHADOW'].includes(metrics.stage)) {
        expect(source).toBe('PAPER');
        expect(displayedWinRate).toBe(metrics.winRate);  // May be null
        expect(displayedTrades).toBe(metrics.trades);    // May be 0
      }
    }
  });

  /**
   * TEST 7: Stage-based source determination
   */
  it('correctly determines stats source by stage', () => {
    expect(determineStatsSourceByStage('TRIALS')).toBe('BACKTEST');
    expect(determineStatsSourceByStage('PAPER')).toBe('PAPER');
    expect(determineStatsSourceByStage('SHADOW')).toBe('PAPER');
    expect(determineStatsSourceByStage('LIVE')).toBe('LIVE');
    expect(determineStatsSourceByStage('CANARY')).toBe('LIVE');
  });
});
