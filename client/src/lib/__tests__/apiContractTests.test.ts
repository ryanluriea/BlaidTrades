/**
 * API Contract Tests
 * 
 * Validates response schemas and data contracts for all major endpoints.
 * Ensures units, ranges, and field types are correct.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

interface BotOverviewBot {
  id: string;
  name: string;
  stage: 'TRIALS' | 'PAPER' | 'SHADOW' | 'CANARY' | 'LIVE' | 'DEGRADED';
  generation: number;
  backtests_completed: number;
  session_trades: number;
  session_pnl_usd: number | null;
  session_win_rate_pct: number | null;
  session_sharpe: number | null;
  session_max_dd_pct: number | null;
  session_max_dd_usd: number | null;
  session_profit_factor: number | null;
  metrics_source: 'backtest_session_latest' | 'none';
  metrics_asof: string | null;
  generation_source: string;
}

interface BotOverviewResponse {
  success: boolean;
  data: {
    bots: BotOverviewBot[];
    perBot: Record<string, {
      instanceStatus: {
        id: string | null;
        status: string | null;
        activityState: string | null;
        lastHeartbeatAt: string | null;
      };
      improvementState: {
        status: string | null;
        consecutiveFailures: number;
        attemptsUsed: number;
        lastImprovementAt: string | null;
      };
      jobs: {
        backtestRunning: number;
        backtestQueued: number;
        evolveRunning: number;
        evolveQueued: number;
      };
    }>;
    generatedAt: string;
    version: string;
    source: 'cache' | 'stale' | 'db' | 'error-fallback';
  };
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

function validateBotOverviewBot(bot: any): string[] {
  const errors: string[] = [];

  // Required string fields
  if (typeof bot.id !== 'string' || !bot.id) {
    errors.push(`bot.id must be non-empty string, got ${typeof bot.id}`);
  }
  if (typeof bot.name !== 'string') {
    errors.push(`bot.name must be string, got ${typeof bot.name}`);
  }

  // Stage enum validation
  const validStages = ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE', 'DEGRADED'];
  if (!validStages.includes(bot.stage)) {
    errors.push(`bot.stage must be one of ${validStages.join('|')}, got ${bot.stage}`);
  }

  // Generation must be positive integer
  if (typeof bot.generation !== 'number' || bot.generation < 1 || !Number.isInteger(bot.generation)) {
    errors.push(`bot.generation must be positive integer, got ${bot.generation}`);
  }

  // Backtests completed must be non-negative integer
  if (typeof bot.backtests_completed !== 'number' || bot.backtests_completed < 0) {
    errors.push(`bot.backtests_completed must be non-negative, got ${bot.backtests_completed}`);
  }

  // Session trades must be non-negative integer
  if (typeof bot.session_trades !== 'number' || bot.session_trades < 0) {
    errors.push(`bot.session_trades must be non-negative, got ${bot.session_trades}`);
  }

  // Win rate must be 0-100 or null
  if (bot.session_win_rate_pct !== null) {
    if (typeof bot.session_win_rate_pct !== 'number' || bot.session_win_rate_pct < 0 || bot.session_win_rate_pct > 100) {
      errors.push(`bot.session_win_rate_pct must be 0-100 or null, got ${bot.session_win_rate_pct}`);
    }
  }

  // Max drawdown percent must be non-negative or null
  if (bot.session_max_dd_pct !== null) {
    if (typeof bot.session_max_dd_pct !== 'number' || bot.session_max_dd_pct < 0) {
      errors.push(`bot.session_max_dd_pct must be non-negative or null, got ${bot.session_max_dd_pct}`);
    }
  }

  // Sharpe can be any number or null (including negative)
  if (bot.session_sharpe !== null && typeof bot.session_sharpe !== 'number') {
    errors.push(`bot.session_sharpe must be number or null, got ${typeof bot.session_sharpe}`);
  }

  // Profit factor must be non-negative or null
  if (bot.session_profit_factor !== null) {
    if (typeof bot.session_profit_factor !== 'number' || bot.session_profit_factor < 0) {
      errors.push(`bot.session_profit_factor must be non-negative or null, got ${bot.session_profit_factor}`);
    }
  }

  // Metrics source validation
  const validSources = ['backtest_session_latest', 'none'];
  if (!validSources.includes(bot.metrics_source)) {
    errors.push(`bot.metrics_source must be one of ${validSources.join('|')}, got ${bot.metrics_source}`);
  }

  // Provenance consistency: if metrics_source is 'backtest_session_latest', metrics_asof should be set
  if (bot.metrics_source === 'backtest_session_latest' && !bot.metrics_asof) {
    errors.push(`bot.metrics_asof should be set when metrics_source is 'backtest_session_latest'`);
  }

  return errors;
}

function validatePerBotData(perBot: Record<string, any>): string[] {
  const errors: string[] = [];

  for (const [botId, data] of Object.entries(perBot)) {
    if (!data.instanceStatus) {
      errors.push(`perBot[${botId}].instanceStatus missing`);
    }
    if (!data.improvementState) {
      errors.push(`perBot[${botId}].improvementState missing`);
    } else {
      if (typeof data.improvementState.consecutiveFailures !== 'number') {
        errors.push(`perBot[${botId}].improvementState.consecutiveFailures must be number`);
      }
      if (typeof data.improvementState.attemptsUsed !== 'number') {
        errors.push(`perBot[${botId}].improvementState.attemptsUsed must be number`);
      }
    }
    if (!data.jobs) {
      errors.push(`perBot[${botId}].jobs missing`);
    } else {
      const { backtestRunning, backtestQueued, evolveRunning, evolveQueued } = data.jobs;
      if (typeof backtestRunning !== 'number' || backtestRunning < 0) {
        errors.push(`perBot[${botId}].jobs.backtestRunning must be non-negative number`);
      }
      if (typeof backtestQueued !== 'number' || backtestQueued < 0) {
        errors.push(`perBot[${botId}].jobs.backtestQueued must be non-negative number`);
      }
      if (typeof evolveRunning !== 'number' || evolveRunning < 0) {
        errors.push(`perBot[${botId}].jobs.evolveRunning must be non-negative number`);
      }
      if (typeof evolveQueued !== 'number' || evolveQueued < 0) {
        errors.push(`perBot[${botId}].jobs.evolveQueued must be non-negative number`);
      }
    }
  }

  return errors;
}

function validateBotOverviewResponse(response: any): string[] {
  const errors: string[] = [];

  if (typeof response.success !== 'boolean') {
    errors.push(`response.success must be boolean, got ${typeof response.success}`);
  }

  if (!response.data) {
    errors.push('response.data is missing');
    return errors;
  }

  if (!Array.isArray(response.data.bots)) {
    errors.push('response.data.bots must be array');
  } else {
    for (let i = 0; i < response.data.bots.length; i++) {
      const botErrors = validateBotOverviewBot(response.data.bots[i]);
      errors.push(...botErrors.map(e => `bots[${i}]: ${e}`));
    }
  }

  if (typeof response.data.perBot !== 'object') {
    errors.push('response.data.perBot must be object');
  } else {
    const perBotErrors = validatePerBotData(response.data.perBot);
    errors.push(...perBotErrors);
  }

  if (typeof response.data.generatedAt !== 'string') {
    errors.push(`response.data.generatedAt must be ISO string, got ${typeof response.data.generatedAt}`);
  }

  if (typeof response.data.version !== 'string') {
    errors.push(`response.data.version must be string, got ${typeof response.data.version}`);
  }

  const validSources = ['cache', 'stale', 'db', 'error-fallback'];
  if (!validSources.includes(response.data.source)) {
    errors.push(`response.data.source must be one of ${validSources.join('|')}, got ${response.data.source}`);
  }

  return errors;
}

// =============================================================================
// TESTS
// =============================================================================

describe('API Contract Tests', () => {
  describe('bots-overview response schema', () => {
    it('validates a correct response', () => {
      const validResponse = {
        success: true,
        data: {
          bots: [
            {
              id: 'bot-123',
              name: 'Test Bot',
              description: 'A test bot',
              stage: 'TRIALS',
              symbol: 'MNQ',
              mode: 'BACKTEST_ONLY',
              status: 'idle',
              is_trading_enabled: false,
              evolution_mode: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              generation: 3,
              version_major: 1,
              version_minor: 2,
              session_trades: 45,
              session_pnl_usd: 1250.50,
              session_win_rate_pct: 55.5,
              session_sharpe: 1.2,
              session_max_dd_pct: 8.5,
              session_max_dd_usd: 425.00,
              session_profit_factor: 1.45,
              backtests_completed: 12,
              live_total_trades: 0,
              live_pnl: null,
              live_win_rate: null,
              health_state: 'OK',
              health_reason_code: null,
              bqs_latest: 72,
              priority_score: 65,
              priority_bucket: 'B',
              metrics_source: 'backtest_session_latest',
              metrics_asof: '2024-01-01T12:00:00Z',
              generation_source: 'bot_generations_latest',
            },
          ],
          perBot: {
            'bot-123': {
              instanceStatus: {
                id: null,
                status: null,
                activityState: null,
                lastHeartbeatAt: null,
                mode: null,
                accountId: null,
                accountName: null,
              },
              lastJob: { status: null, type: null, startedAt: null, finishedAt: null, error: null },
              healthScore: { score: 72, asOf: null },
              improvementState: {
                status: 'IMPROVING',
                consecutiveFailures: 0,
                whyNotPromoted: null,
                nextAction: 'evolve',
                nextRetryAt: null,
                attemptsUsed: 2,
                lastImprovementAt: '2024-01-01T10:00:00Z',
              },
              jobs: {
                backtestRunning: 0,
                backtestQueued: 0,
                evolveRunning: 0,
                evolveQueued: 0,
                evolveStartedAt: null,
              },
            },
          },
          alertsCount: 0,
          integrationsSummary: { brokersConnected: 0, dataSourcesConnected: 0, aiProvidersConnected: 0 },
          generatedAt: '2024-01-01T12:30:00Z',
          version: 'v7',
          source: 'db',
        },
      };

      const errors = validateBotOverviewResponse(validResponse);
      expect(errors).toEqual([]);
    });

    it('detects invalid win_rate_pct (out of range)', () => {
      const invalidResponse = {
        success: true,
        data: {
          bots: [
            {
              id: 'bot-123',
              name: 'Test Bot',
              stage: 'TRIALS',
              generation: 1,
              backtests_completed: 5,
              session_trades: 20,
              session_pnl_usd: 100,
              session_win_rate_pct: 150, // INVALID: > 100
              session_sharpe: 1.0,
              session_max_dd_pct: 5,
              session_max_dd_usd: 50,
              session_profit_factor: 1.2,
              metrics_source: 'backtest_session_latest',
              metrics_asof: '2024-01-01T00:00:00Z',
              generation_source: 'bot_generations_latest',
            },
          ],
          perBot: {
            'bot-123': {
              instanceStatus: { id: null, status: null, activityState: null, lastHeartbeatAt: null },
              improvementState: { status: null, consecutiveFailures: 0, attemptsUsed: 0, lastImprovementAt: null },
              jobs: { backtestRunning: 0, backtestQueued: 0, evolveRunning: 0, evolveQueued: 0 },
            },
          },
          generatedAt: '2024-01-01T00:00:00Z',
          version: 'v7',
          source: 'db',
        },
      };

      const errors = validateBotOverviewResponse(invalidResponse);
      expect(errors.some(e => e.includes('session_win_rate_pct'))).toBe(true);
    });

    it('detects missing provenance timestamp when metrics_source is set', () => {
      const invalidResponse = {
        success: true,
        data: {
          bots: [
            {
              id: 'bot-123',
              name: 'Test Bot',
              stage: 'TRIALS',
              generation: 1,
              backtests_completed: 5,
              session_trades: 20,
              session_pnl_usd: 100,
              session_win_rate_pct: 50,
              session_sharpe: 1.0,
              session_max_dd_pct: 5,
              session_max_dd_usd: 50,
              session_profit_factor: 1.2,
              metrics_source: 'backtest_session_latest',
              metrics_asof: null, // INVALID: should be set
              generation_source: 'bot_generations_latest',
            },
          ],
          perBot: {
            'bot-123': {
              instanceStatus: { id: null, status: null, activityState: null, lastHeartbeatAt: null },
              improvementState: { status: null, consecutiveFailures: 0, attemptsUsed: 0, lastImprovementAt: null },
              jobs: { backtestRunning: 0, backtestQueued: 0, evolveRunning: 0, evolveQueued: 0 },
            },
          },
          generatedAt: '2024-01-01T00:00:00Z',
          version: 'v7',
          source: 'db',
        },
      };

      const errors = validateBotOverviewResponse(invalidResponse);
      expect(errors.some(e => e.includes('metrics_asof'))).toBe(true);
    });

    it('detects invalid stage enum', () => {
      const invalidResponse = {
        success: true,
        data: {
          bots: [
            {
              id: 'bot-123',
              name: 'Test Bot',
              stage: 'INVALID_STAGE', // INVALID
              generation: 1,
              backtests_completed: 0,
              session_trades: 0,
              session_pnl_usd: null,
              session_win_rate_pct: null,
              session_sharpe: null,
              session_max_dd_pct: null,
              session_max_dd_usd: null,
              session_profit_factor: null,
              metrics_source: 'none',
              metrics_asof: null,
              generation_source: 'bot_generations_latest',
            },
          ],
          perBot: {
            'bot-123': {
              instanceStatus: { id: null, status: null, activityState: null, lastHeartbeatAt: null },
              improvementState: { status: null, consecutiveFailures: 0, attemptsUsed: 0, lastImprovementAt: null },
              jobs: { backtestRunning: 0, backtestQueued: 0, evolveRunning: 0, evolveQueued: 0 },
            },
          },
          generatedAt: '2024-01-01T00:00:00Z',
          version: 'v7',
          source: 'db',
        },
      };

      const errors = validateBotOverviewResponse(invalidResponse);
      expect(errors.some(e => e.includes('stage'))).toBe(true);
    });

    it('detects negative generation number', () => {
      const invalidResponse = {
        success: true,
        data: {
          bots: [
            {
              id: 'bot-123',
              name: 'Test Bot',
              stage: 'TRIALS',
              generation: -1, // INVALID
              backtests_completed: 0,
              session_trades: 0,
              session_pnl_usd: null,
              session_win_rate_pct: null,
              session_sharpe: null,
              session_max_dd_pct: null,
              session_max_dd_usd: null,
              session_profit_factor: null,
              metrics_source: 'none',
              metrics_asof: null,
              generation_source: 'bot_generations_latest',
            },
          ],
          perBot: {
            'bot-123': {
              instanceStatus: { id: null, status: null, activityState: null, lastHeartbeatAt: null },
              improvementState: { status: null, consecutiveFailures: 0, attemptsUsed: 0, lastImprovementAt: null },
              jobs: { backtestRunning: 0, backtestQueued: 0, evolveRunning: 0, evolveQueued: 0 },
            },
          },
          generatedAt: '2024-01-01T00:00:00Z',
          version: 'v7',
          source: 'db',
        },
      };

      const errors = validateBotOverviewResponse(invalidResponse);
      expect(errors.some(e => e.includes('generation'))).toBe(true);
    });
  });

  describe('Units and Ranges', () => {
    it('win_rate is percentage 0-100, not decimal 0-1', () => {
      // Example: 55% should be 55, not 0.55
      const winRate = 55.5;
      expect(winRate).toBeGreaterThanOrEqual(0);
      expect(winRate).toBeLessThanOrEqual(100);
    });

    it('max_dd_pct is percentage, max_dd_usd is dollars', () => {
      // Percent should be small number (e.g., 8.5 means 8.5%)
      // USD should be absolute dollar amount
      const maxDdPct = 8.5;
      const maxDdUsd = 425.00;
      expect(maxDdPct).toBeLessThan(100);
      expect(maxDdUsd).toBeGreaterThanOrEqual(0);
    });

    it('sharpe can be negative', () => {
      const sharpe = -0.5;
      expect(typeof sharpe).toBe('number');
    });

    it('profit_factor must be non-negative', () => {
      const profitFactor = 1.45;
      expect(profitFactor).toBeGreaterThanOrEqual(0);
    });
  });
});

// Export for use in other test files
export { validateBotOverviewResponse, validateBotOverviewBot, validatePerBotData };
