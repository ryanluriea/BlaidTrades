import { describe, it, expect } from 'vitest';
import { 
  computeAllocations,
  type BotAllocationInput,
  type AccountBudget,
} from '../capitalAllocation';

const createBot = (overrides: Partial<BotAllocationInput> = {}): BotAllocationInput => ({
  botId: 'bot-1',
  priorityScore: 70,
  priorityBucket: 'B',
  stage: 'PAPER',
  healthState: 'OK',
  ...overrides,
});

const createBudget = (overrides: Partial<AccountBudget> = {}): AccountBudget => ({
  accountId: 'account-1',
  currentBalance: 50000,
  perTradeRiskBudgetDollars: 1000,
  dailyRiskBudgetDollars: 2000,
  maxContractsPerTrade: 5,
  maxTotalExposureContracts: 20,
  ...overrides,
});

describe('computeAllocations', () => {
  it('returns allocations for all bots', () => {
    const bots = [
      createBot({ botId: 'bot-1', priorityScore: 80 }),
      createBot({ botId: 'bot-2', priorityScore: 60 }),
    ];
    const budget = createBudget();
    
    const results = computeAllocations(bots, budget, 100);
    
    expect(results).toHaveLength(2);
    expect(results.find(r => r.botId === 'bot-1')).toBeDefined();
    expect(results.find(r => r.botId === 'bot-2')).toBeDefined();
  });

  it('higher priority score gets higher weight', () => {
    const bots = [
      createBot({ botId: 'bot-1', priorityScore: 90 }),
      createBot({ botId: 'bot-2', priorityScore: 50 }),
    ];
    const budget = createBudget();
    
    const results = computeAllocations(bots, budget, 100);
    const bot1 = results.find(r => r.botId === 'bot-1')!;
    const bot2 = results.find(r => r.botId === 'bot-2')!;
    
    expect(bot1.weight).toBeGreaterThan(bot2.weight);
  });

  it('DEGRADED bots get zero allocation', () => {
    const bots = [
      createBot({ botId: 'bot-1', priorityScore: 80, healthState: 'DEGRADED' }),
    ];
    const budget = createBudget();
    
    const results = computeAllocations(bots, budget, 100);
    
    expect(results[0].weight).toBe(0);
    expect(results[0].maxContractsDynamic).toBe(0);
  });

  it('respects account max contracts', () => {
    const bots = [
      createBot({ botId: 'bot-1', priorityScore: 95 }),
    ];
    const budget = createBudget({ maxContractsPerTrade: 3 });
    
    const results = computeAllocations(bots, budget, 10);
    
    expect(results[0].maxContractsDynamic).toBeLessThanOrEqual(3);
  });

  it('applies bucket downscale for C/D buckets', () => {
    const botsA = [createBot({ botId: 'bot-1', priorityScore: 80, priorityBucket: 'A' })];
    const botsD = [createBot({ botId: 'bot-1', priorityScore: 35, priorityBucket: 'D' })];
    const budget = createBudget();
    
    const resultsA = computeAllocations(botsA, budget, 100);
    const resultsD = computeAllocations(botsD, budget, 100);
    
    // D bucket gets 0.5x downscale
    expect(resultsD[0].maxRiskDollarsDynamic).toBeLessThan(resultsA[0].maxRiskDollarsDynamic);
  });
});
