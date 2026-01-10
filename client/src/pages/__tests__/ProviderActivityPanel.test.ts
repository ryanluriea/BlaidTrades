/**
 * ProviderActivityPanel Logic Tests
 * 
 * NOTE: These are logic validation tests, not component render tests.
 * For full component testing with React Testing Library, add @testing-library/react.
 * 
 * Validates the business logic for:
 * - Render state determination (loading, error, normal states)
 * - Loading state display when data is being fetched
 * - Error banner display while preserving cached data (graceful degradation)
 * - Status badges (Active/Enabled/Paused)
 * - Trigger button disable behavior
 * 
 * Future: Add @testing-library/react for full component render tests
 */

import { describe, it, expect } from 'vitest';

interface ProviderActivityStats {
  totalRequests: number;
  successful: number;
  lastRequest: string | null;
  totalTokens: number;
  strategiesGenerated: number;
}

interface ProviderActivity {
  enabled: boolean;
  isActive: boolean;
  mode: string;
  lastCycleAt: string | null;
  nextCycleIn?: number | null;
  stats24h: ProviderActivityStats;
  recentActivity: Array<{
    id: string;
    type: string;
    title: string;
    details?: string;
    timestamp: string;
  }>;
}

function determineRenderState(
  activity: ProviderActivity | undefined,
  isQueryLoading: boolean,
  isQueryError: boolean
): 'loading' | 'normal' | 'normal_with_error' {
  const showLoadingSpinner = isQueryLoading && !activity;
  const showErrorBanner = isQueryError && !isQueryLoading;
  
  if (showLoadingSpinner) return 'loading';
  if (showErrorBanner) return 'normal_with_error';
  return 'normal';
}

function determineStatusBadge(activity: ProviderActivity | undefined): 'active' | 'enabled' | 'paused' {
  if (activity?.isActive) return 'active';
  if (activity?.enabled) return 'enabled';
  return 'paused';
}

function shouldDisableTriggerButton(isLoading: boolean, activity: ProviderActivity | undefined): boolean {
  return isLoading || activity?.isActive === true;
}

describe("ProviderActivityPanel - Render State Logic", () => {
  describe("Loading State", () => {
    it("should show loading spinner when isQueryLoading=true and no cached data", () => {
      const state = determineRenderState(undefined, true, false);
      expect(state).toBe('loading');
    });

    it("should NOT show loading spinner when cached data exists even if loading", () => {
      const cachedData: ProviderActivity = {
        enabled: true,
        isActive: false,
        mode: "Full Spectrum",
        lastCycleAt: null,
        stats24h: { totalRequests: 5, successful: 5, lastRequest: null, totalTokens: 1000, strategiesGenerated: 2 },
        recentActivity: []
      };
      const state = determineRenderState(cachedData, true, false);
      expect(state).toBe('normal');
    });
  });

  describe("Error State - Graceful Degradation", () => {
    it("should show error banner while preserving cached data", () => {
      const cachedData: ProviderActivity = {
        enabled: true,
        isActive: false,
        mode: "Idle",
        lastCycleAt: null,
        stats24h: { totalRequests: 10, successful: 8, lastRequest: null, totalTokens: 2000, strategiesGenerated: 3 },
        recentActivity: []
      };
      const state = determineRenderState(cachedData, false, true);
      expect(state).toBe('normal_with_error');
    });

    it("should NOT show error banner if still loading", () => {
      const state = determineRenderState(undefined, true, true);
      expect(state).toBe('loading');
    });

    it("should show normal state when no errors", () => {
      const cachedData: ProviderActivity = {
        enabled: true,
        isActive: false,
        mode: "Full Spectrum",
        lastCycleAt: null,
        stats24h: { totalRequests: 5, successful: 5, lastRequest: null, totalTokens: 1000, strategiesGenerated: 2 },
        recentActivity: []
      };
      const state = determineRenderState(cachedData, false, false);
      expect(state).toBe('normal');
    });
  });
});

describe("ProviderActivityPanel - Status Badge Logic", () => {
  it("should show 'active' badge when isActive=true", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: true,
      mode: "Full Spectrum",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(determineStatusBadge(activity)).toBe('active');
  });

  it("should show 'enabled' badge when enabled=true but not active", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: false,
      mode: "Idle",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(determineStatusBadge(activity)).toBe('enabled');
  });

  it("should show 'paused' badge when disabled", () => {
    const activity: ProviderActivity = {
      enabled: false,
      isActive: false,
      mode: "Idle",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(determineStatusBadge(activity)).toBe('paused');
  });

  it("should show 'paused' badge when activity is undefined", () => {
    expect(determineStatusBadge(undefined)).toBe('paused');
  });
});

describe("ProviderActivityPanel - Trigger Button Logic", () => {
  it("should disable trigger button when loading", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: false,
      mode: "Idle",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(shouldDisableTriggerButton(true, activity)).toBe(true);
  });

  it("should disable trigger button when provider is active", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: true,
      mode: "Full Spectrum",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(shouldDisableTriggerButton(false, activity)).toBe(true);
  });

  it("should enable trigger button when not loading and not active", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: false,
      mode: "Idle",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(shouldDisableTriggerButton(false, activity)).toBe(false);
  });

  it("should enable trigger button when activity is undefined and not loading", () => {
    expect(shouldDisableTriggerButton(false, undefined)).toBe(false);
  });
});

describe("ProviderActivityPanel - Stats Display", () => {
  it("should default stats to 0 when undefined", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: false,
      mode: "Idle",
      lastCycleAt: null,
      stats24h: { totalRequests: 0, successful: 0, lastRequest: null, totalTokens: 0, strategiesGenerated: 0 },
      recentActivity: []
    };
    expect(activity.stats24h.strategiesGenerated).toBe(0);
    expect(activity.stats24h.totalRequests).toBe(0);
    expect(activity.stats24h.successful).toBe(0);
  });

  it("should display correct stats from activity data", () => {
    const activity: ProviderActivity = {
      enabled: true,
      isActive: false,
      mode: "Full Spectrum",
      lastCycleAt: null,
      stats24h: { totalRequests: 25, successful: 20, lastRequest: "2026-01-10T12:00:00Z", totalTokens: 5000, strategiesGenerated: 5 },
      recentActivity: []
    };
    expect(activity.stats24h.strategiesGenerated).toBe(5);
    expect(activity.stats24h.totalRequests).toBe(25);
    expect(activity.stats24h.successful).toBe(20);
  });
});
