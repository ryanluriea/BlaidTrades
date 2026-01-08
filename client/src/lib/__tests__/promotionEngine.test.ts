import { describe, it, expect } from 'vitest';
import { 
  evaluateLabToPaperPromotion, 
  DEFAULT_PROMOTION_RULES,
  type BotPromotionInput,
  type MetricsRollup 
} from '../promotionEngine';

const createRollup = (overrides: Partial<MetricsRollup> = {}): MetricsRollup => ({
  trades: 50,
  winRate: 55,
  sharpe: 0.8,
  profitFactor: 1.3,
  expectancy: 25,
  maxDdPct: 5,
  activeDays: 10,
  lastTradeAt: new Date().toISOString(),
  ...overrides,
});

const createInput = (overrides: Partial<BotPromotionInput> = {}): BotPromotionInput => ({
  botId: 'test-bot',
  currentStage: 'TRIALS',
  healthState: 'OK',
  healthReasons: [],
  rollup30: createRollup(),
  lastBacktestCompletedAt: new Date().toISOString(),
  lastBacktestStatus: 'completed',
  ...overrides,
});

describe('evaluateLabToPaperPromotion', () => {
  it('promotes when all criteria are met', () => {
    const result = evaluateLabToPaperPromotion(createInput());
    expect(result.decision).toBe('PROMOTE');
    expect(result.toStage).toBe('PAPER');
  });

  it('keeps in LAB when trades below threshold', () => {
    const input = createInput({
      rollup30: createRollup({ trades: 10 }),
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons).toContain(`Trades 10 < required ${DEFAULT_PROMOTION_RULES.lab_autopromote_min_trades}`);
  });

  it('keeps in LAB when sharpe below threshold', () => {
    const input = createInput({
      rollup30: createRollup({ sharpe: 0.3 }),
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('Sharpe'))).toBe(true);
  });

  it('keeps in LAB when profit factor below threshold', () => {
    const input = createInput({
      rollup30: createRollup({ profitFactor: 0.9 }),
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('Profit factor'))).toBe(true);
  });

  it('keeps in LAB when max drawdown above threshold', () => {
    const input = createInput({
      rollup30: createRollup({ maxDdPct: 12 }),
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('Max DD'))).toBe(true);
  });

  it('freezes when health is DEGRADED', () => {
    const input = createInput({
      healthState: 'DEGRADED',
      healthReasons: ['Stale heartbeat'],
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('FREEZE');
  });

  it('allows WARN health when health_required is WARN_OK', () => {
    const input = createInput({
      healthState: 'WARN',
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('PROMOTE');
  });

  it('blocks WARN health when health_required is OK_ONLY', () => {
    const input = createInput({
      healthState: 'WARN',
    });
    const rules = { ...DEFAULT_PROMOTION_RULES, lab_autopromote_health_required: 'OK_ONLY' as const };
    const result = evaluateLabToPaperPromotion(input, rules);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('Health must be OK'))).toBe(true);
  });

  it('keeps in LAB when no backtest and coverage required', () => {
    const input = createInput({
      lastBacktestCompletedAt: null,
      lastBacktestStatus: null,
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons).toContain('No completed backtest found');
  });

  it('keeps in LAB when backtest too old', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 14);
    const input = createInput({
      lastBacktestCompletedAt: oldDate.toISOString(),
      lastBacktestStatus: 'completed',
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('days old'))).toBe(true);
  });

  it('keeps in LAB when no recent activity', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 14);
    const input = createInput({
      rollup30: createRollup({ lastTradeAt: oldDate.toISOString() }),
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons.some(r => r.includes('Last trade'))).toBe(true);
  });

  it('skips non-LAB bots', () => {
    const input = createInput({
      currentStage: 'PAPER',
    });
    const result = evaluateLabToPaperPromotion(input);
    expect(result.decision).toBe('KEEP');
    expect(result.reasons).toContain('Not in LAB stage - skipping LAB→PAPER evaluation');
  });

  it('every decision writes audit reasons', () => {
    const input = createInput();
    const result = evaluateLabToPaperPromotion(input);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.metricsSnapshot).not.toBeNull();
  });
});
