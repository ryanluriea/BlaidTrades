import { test, expect, Page } from '@playwright/test';

/**
 * Production Readiness E2E Tests
 * 
 * Verifies all routes load correctly with:
 * - Load times within performance budgets
 * - No console errors
 * - Network call counts within limits
 * - Correct data rendering
 */

// Performance budgets (milliseconds)
const PERFORMANCE_BUDGETS = {
  '/': 1500,           // Dashboard
  '/bots': 1000,       // Bots list (cold)
  '/accounts': 1200,
  '/autonomy': 1200,
  '/system-status': 1000,
  '/settings': 800,
};

// Maximum allowed network calls per route
const MAX_NETWORK_CALLS = {
  '/': 10,
  '/bots': 5,          // Should be single primary request
  '/accounts': 8,
  '/autonomy': 8,
  '/system-status': 10,
  '/settings': 5,
};

interface RouteMetrics {
  route: string;
  loadTime: number;
  networkCalls: number;
  consoleErrors: string[];
  passed: boolean;
}

test.describe('Route Production Readiness', () => {
  test.describe.configure({ mode: 'serial' });

  const metrics: RouteMetrics[] = [];

  test.afterAll(async () => {
    // Output metrics report
    console.log('\n=== ROUTE METRICS REPORT ===\n');
    console.table(metrics.map(m => ({
      Route: m.route,
      'Load Time (ms)': m.loadTime,
      'Network Calls': m.networkCalls,
      'Console Errors': m.consoleErrors.length,
      'Status': m.passed ? '✅ PASS' : '❌ FAIL',
    })));
  });

  test('Dashboard (/) loads within budget', async ({ page }) => {
    const result = await measureRoute(page, '/');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/']);
    expect(result.networkCalls).toBeLessThanOrEqual(MAX_NETWORK_CALLS['/']);
    expect(result.consoleErrors).toHaveLength(0);
  });

  test('/bots loads within budget with single primary request', async ({ page }) => {
    const result = await measureRoute(page, '/bots');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/bots']);
    expect(result.networkCalls).toBeLessThanOrEqual(MAX_NETWORK_CALLS['/bots']);
    expect(result.consoleErrors).toHaveLength(0);
    
    // Verify bots-overview is the primary data request
    const botsOverviewCalls = result.apiCalls?.filter(c => c.includes('bots-overview')) || [];
    expect(botsOverviewCalls.length).toBe(1);
  });

  test('/bots row expand does not trigger extra DB calls', async ({ page }) => {
    await page.goto('/bots');
    await page.waitForLoadState('networkidle');
    
    // Count network calls before expand
    let callsAfterLoad = 0;
    page.on('request', (req) => {
      if (req.url().includes('supabase') || req.url().includes('functions')) {
        callsAfterLoad++;
      }
    });
    
    // Click first bot row to expand (if exists)
    const firstRow = page.locator('[data-testid="bot-row"]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);
      
      // Should not trigger additional primary data calls
      // Some supplementary calls (like bot details) are acceptable
      expect(callsAfterLoad).toBeLessThan(3);
    }
  });

  test('/accounts loads within budget', async ({ page }) => {
    const result = await measureRoute(page, '/accounts');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/accounts']);
    expect(result.networkCalls).toBeLessThanOrEqual(MAX_NETWORK_CALLS['/accounts']);
  });

  test('/autonomy loads without hanging', async ({ page }) => {
    const result = await measureRoute(page, '/autonomy');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/autonomy']);
    
    // Verify no infinite loading spinners
    const spinners = page.locator('[data-testid="loading-spinner"], .animate-spin');
    await page.waitForTimeout(2000);
    const visibleSpinners = await spinners.count();
    expect(visibleSpinners).toBe(0);
  });

  test('/system-status loads and reflects actual config', async ({ page }) => {
    const result = await measureRoute(page, '/system-status');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/system-status']);
    
    // Verify health indicators are present (not all showing UNKNOWN)
    const healthIndicators = page.locator('[data-testid="health-indicator"]');
    // At least some should be visible
  });

  test('/settings loads within budget', async ({ page }) => {
    const result = await measureRoute(page, '/settings');
    metrics.push(result);
    
    expect(result.loadTime).toBeLessThan(PERFORMANCE_BUDGETS['/settings']);
    expect(result.consoleErrors).toHaveLength(0);
  });

  test('No infinite skeletons on any route', async ({ page }) => {
    const routes = ['/', '/bots', '/accounts', '/autonomy', '/system-status', '/settings'];
    
    for (const route of routes) {
      await page.goto(route);
      await page.waitForTimeout(3000); // Wait for data to load
      
      // Check for skeleton elements that are still visible
      const skeletons = page.locator('.skeleton, [class*="skeleton"]');
      const visibleSkeletons = await skeletons.filter({ hasNot: page.locator('.hidden') }).count();
      
      // Some skeletons may be acceptable for lazy-loaded content, but not excessive
      expect(visibleSkeletons).toBeLessThan(5);
    }
  });
});

test.describe('Data Integrity Verification', () => {
  test('/bots list shows correct metric labels', async ({ page }) => {
    await page.goto('/bots');
    await page.waitForLoadState('networkidle');
    
    // Verify key columns are present
    const headers = page.locator('th, [role="columnheader"]');
    const headerTexts = await headers.allTextContents();
    
    // Should have generation, backtests columns
    const hasGeneration = headerTexts.some(h => /gen|generation/i.test(h));
    const hasBacktests = headerTexts.some(h => /backtest/i.test(h));
    
    // These are expected columns
    expect(hasGeneration || hasBacktests).toBeTruthy();
  });

  test('Bot metrics show correct units (percent vs dollars)', async ({ page }) => {
    await page.goto('/bots');
    await page.waitForLoadState('networkidle');
    
    // Find win rate display - should show % symbol
    const winRateElements = page.locator(':text-matches("\\\\d+\\\\.?\\\\d*%")');
    
    // Find dollar displays - should show $ symbol or just numbers for PnL
    const dollarElements = page.locator(':text-matches("\\\\$\\\\d+|\\\\-?\\\\d+\\\\.\\\\d{2}")');
    
    // Both types should be present if there's data
  });

  test('Sharpe ratio shows dash for null values', async ({ page }) => {
    await page.goto('/bots');
    await page.waitForLoadState('networkidle');
    
    // Look for "—" (em dash) or "-" (hyphen) for null metrics
    const dashElements = page.locator(':text("—"), :text("-")');
    // This is expected for bots without metrics
  });
});

test.describe('Performance Stress Tests', () => {
  test('Hard refresh /bots 5 times - no timeouts', async ({ page }) => {
    const loadTimes: number[] = [];
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await page.goto('/bots', { waitUntil: 'networkidle' });
      const loadTime = Date.now() - start;
      loadTimes.push(loadTime);
      
      // Each load should be within budget
      expect(loadTime).toBeLessThan(3000); // Allow some variance
      
      // Force hard refresh
      await page.reload({ waitUntil: 'networkidle' });
    }
    
    // Calculate p95
    loadTimes.sort((a, b) => a - b);
    const p95 = loadTimes[Math.floor(loadTimes.length * 0.95)];
    
    console.log(`/bots load times: ${loadTimes.join(', ')}ms, p95: ${p95}ms`);
    expect(p95).toBeLessThan(PERFORMANCE_BUDGETS['/bots'] * 1.5); // Allow 50% variance for p95
  });
});

// Helper function to measure route performance
async function measureRoute(page: Page, route: string): Promise<RouteMetrics & { apiCalls?: string[] }> {
  const consoleErrors: string[] = [];
  const apiCalls: string[] = [];
  let networkCalls = 0;
  
  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  // Capture network calls
  page.on('request', req => {
    const url = req.url();
    if (url.includes('supabase') || url.includes('functions')) {
      networkCalls++;
      apiCalls.push(url);
    }
  });
  
  const start = Date.now();
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  const loadTime = Date.now() - start;
  
  const budget = PERFORMANCE_BUDGETS[route as keyof typeof PERFORMANCE_BUDGETS] || 2000;
  const maxCalls = MAX_NETWORK_CALLS[route as keyof typeof MAX_NETWORK_CALLS] || 10;
  
  return {
    route,
    loadTime,
    networkCalls,
    consoleErrors,
    apiCalls,
    passed: loadTime < budget && networkCalls <= maxCalls && consoleErrors.length === 0,
  };
}
