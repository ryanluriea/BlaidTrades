import { test, expect } from '@playwright/test';

/**
 * API Contract E2E Tests
 * 
 * Validates that API responses match expected schemas
 * and return data within acceptable ranges.
 */

// Supabase edge functions base URL
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oxkjdoltkazipawcgmtg.supabase.co';

test.describe('API Response Contract Tests', () => {
  test('bots-overview returns valid schema', async ({ request }) => {
    // This test requires authentication - skip in CI without credentials
    test.skip(!process.env.TEST_AUTH_TOKEN, 'Requires auth token');
    
    const response = await request.get(`${SUPABASE_URL}/functions/v1/bots-overview`, {
      headers: {
        'Authorization': `Bearer ${process.env.TEST_AUTH_TOKEN}`,
      },
    });
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Validate top-level structure
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data.bots)).toBe(true);
    expect(typeof data.data.perBot).toBe('object');
    expect(typeof data.data.generatedAt).toBe('string');
    expect(typeof data.data.version).toBe('string');
    
    // Validate response headers
    expect(response.headers()['x-request-id']).toBeDefined();
    expect(response.headers()['x-cache']).toBeDefined();
    
    // Validate bot schema
    for (const bot of data.data.bots) {
      expect(typeof bot.id).toBe('string');
      expect(typeof bot.name).toBe('string');
      expect(['LAB', 'PAPER', 'SHADOW', 'CANARY', 'LIVE', 'DEGRADED']).toContain(bot.stage);
      expect(typeof bot.generation).toBe('number');
      expect(bot.generation).toBeGreaterThanOrEqual(1);
      expect(typeof bot.backtests_completed).toBe('number');
      expect(bot.backtests_completed).toBeGreaterThanOrEqual(0);
      
      // Win rate should be 0-100 or null
      if (bot.session_win_rate_pct !== null) {
        expect(bot.session_win_rate_pct).toBeGreaterThanOrEqual(0);
        expect(bot.session_win_rate_pct).toBeLessThanOrEqual(100);
      }
      
      // Max DD percent should be non-negative or null
      if (bot.session_max_dd_pct !== null) {
        expect(bot.session_max_dd_pct).toBeGreaterThanOrEqual(0);
      }
      
      // Provenance fields should be present
      expect(['backtest_session_latest', 'none']).toContain(bot.metrics_source);
      expect(typeof bot.generation_source).toBe('string');
    }
    
    // Validate perBot schema
    for (const [botId, perBotData] of Object.entries(data.data.perBot) as [string, any][]) {
      expect(perBotData.instanceStatus).toBeDefined();
      expect(perBotData.improvementState).toBeDefined();
      expect(typeof perBotData.improvementState.consecutiveFailures).toBe('number');
      expect(typeof perBotData.improvementState.attemptsUsed).toBe('number');
      expect(perBotData.jobs).toBeDefined();
      expect(typeof perBotData.jobs.backtestRunning).toBe('number');
      expect(typeof perBotData.jobs.backtestQueued).toBe('number');
    }
  });

  test('production-readiness-audit returns valid score', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/functions/v1/production-readiness-audit`, {
      data: { run_type: 'E2E_TEST' },
    });
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    // Validate structure
    expect(typeof data.score).toBe('number');
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(data.components)).toBe(true);
    expect(Array.isArray(data.failures)).toBe(true);
    expect(Array.isArray(data.recommended_actions)).toBe(true);
    
    // Validate response headers
    expect(response.headers()['x-request-id']).toBeDefined();
    expect(response.headers()['x-duration-ms']).toBeDefined();
    
    // Validate components
    for (const component of data.components) {
      expect(typeof component.name).toBe('string');
      expect(typeof component.score).toBe('number');
      expect(typeof component.maxScore).toBe('number');
      expect(component.score).toBeLessThanOrEqual(component.maxScore);
      expect(Array.isArray(component.details) || typeof component.details === 'string').toBe(true);
      expect(Array.isArray(component.failures)).toBe(true);
    }
    
    console.log(`Audit score: ${data.score}/100`);
    console.log(`Components: ${data.components.map((c: any) => `${c.name}: ${c.score}/${c.maxScore}`).join(', ')}`);
  });

  test('health endpoint returns valid status', async ({ request }) => {
    const response = await request.get(`${SUPABASE_URL}/functions/v1/health`);
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBeDefined();
    expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
  });
});

test.describe('Response Time Verification', () => {
  test('bots-overview responds within p95 budget', async ({ request }) => {
    test.skip(!process.env.TEST_AUTH_TOKEN, 'Requires auth token');
    
    const times: number[] = [];
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const response = await request.get(`${SUPABASE_URL}/functions/v1/bots-overview`, {
        headers: {
          'Authorization': `Bearer ${process.env.TEST_AUTH_TOKEN}`,
        },
      });
      const duration = Date.now() - start;
      times.push(duration);
      
      expect(response.ok()).toBeTruthy();
      
      // Check server-reported duration
      const serverDuration = response.headers()['x-duration-ms'];
      if (serverDuration) {
        console.log(`Request ${i + 1}: client=${duration}ms, server=${serverDuration}ms, cache=${response.headers()['x-cache']}`);
      }
    }
    
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    
    console.log(`bots-overview p95: ${p95}ms`);
    expect(p95).toBeLessThan(1500); // p95 budget: 1.5s
  });
});
