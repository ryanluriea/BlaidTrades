/**
 * Ironbeam Contract Roll and Entitlement Tests
 * 
 * Tests for contract roll detection, per-symbol entitlement tracking,
 * and subscription state management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockSubscriptionState {
  subscriptionSucceeded: boolean;
  subscribedStreamId: string | null;
  subscribedFrontMonth: string | null;
  entitlementFailedSymbols: Set<string>;
  subscribedSymbols: Set<string>;
}

function createMockState(): MockSubscriptionState {
  return {
    subscriptionSucceeded: false,
    subscribedStreamId: null,
    subscribedFrontMonth: null,
    entitlementFailedSymbols: new Set(),
    subscribedSymbols: new Set(),
  };
}

function shouldResubscribe(
  state: MockSubscriptionState, 
  currentStreamId: string, 
  currentFrontMonth: string
): { resubscribe: boolean; reason: string } {
  if (!state.subscriptionSucceeded) {
    return { resubscribe: true, reason: 'no_active_subscription' };
  }
  
  if (state.subscribedStreamId !== currentStreamId) {
    return { resubscribe: true, reason: 'stream_id_changed' };
  }
  
  if (state.subscribedFrontMonth !== currentFrontMonth) {
    return { resubscribe: true, reason: 'contract_roll' };
  }
  
  return { resubscribe: false, reason: 'subscription_current' };
}

function filterValidInstruments(
  instruments: string[],
  entitlementFailedSymbols: Set<string>
): string[] {
  return instruments.filter(i => !entitlementFailedSymbols.has(i));
}

function shouldStopRetry(
  entitlementFailedSymbols: Set<string>,
  totalSymbolCount: number
): boolean {
  return entitlementFailedSymbols.size >= totalSymbolCount;
}

describe('Ironbeam Contract Roll Detection', () => {
  let state: MockSubscriptionState;

  beforeEach(() => {
    state = createMockState();
  });

  it('should require subscription when no active subscription exists', () => {
    const result = shouldResubscribe(state, 'stream-123', 'H26');
    expect(result.resubscribe).toBe(true);
    expect(result.reason).toBe('no_active_subscription');
  });

  it('should skip subscription when stream and front month match', () => {
    state.subscriptionSucceeded = true;
    state.subscribedStreamId = 'stream-123';
    state.subscribedFrontMonth = 'H26';

    const result = shouldResubscribe(state, 'stream-123', 'H26');
    expect(result.resubscribe).toBe(false);
    expect(result.reason).toBe('subscription_current');
  });

  it('should detect contract roll when front month changes', () => {
    state.subscriptionSucceeded = true;
    state.subscribedStreamId = 'stream-123';
    state.subscribedFrontMonth = 'H26';

    const result = shouldResubscribe(state, 'stream-123', 'M26');
    expect(result.resubscribe).toBe(true);
    expect(result.reason).toBe('contract_roll');
  });

  it('should detect stream ID change requiring resubscription', () => {
    state.subscriptionSucceeded = true;
    state.subscribedStreamId = 'stream-123';
    state.subscribedFrontMonth = 'H26';

    const result = shouldResubscribe(state, 'stream-456', 'H26');
    expect(result.resubscribe).toBe(true);
    expect(result.reason).toBe('stream_id_changed');
  });
});

describe('Per-Symbol Entitlement Tracking', () => {
  it('should filter out entitlement-failed symbols', () => {
    const instruments = ['ESH26', 'NQH26', 'CLH26', 'GCH26'];
    const failedSymbols = new Set(['CLH26']);

    const valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toEqual(['ESH26', 'NQH26', 'GCH26']);
    expect(valid).not.toContain('CLH26');
  });

  it('should return all instruments when none have failed', () => {
    const instruments = ['ESH26', 'NQH26', 'CLH26'];
    const failedSymbols = new Set<string>();

    const valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toEqual(instruments);
  });

  it('should return empty array when all instruments have failed', () => {
    const instruments = ['ESH26', 'NQH26'];
    const failedSymbols = new Set(['ESH26', 'NQH26']);

    const valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toEqual([]);
  });

  it('should handle partial entitlement failures correctly', () => {
    const instruments = ['ESH26', 'NQH26', 'CLH26', 'GCH26'];
    const failedSymbols = new Set(['ESH26', 'GCH26']);

    const valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toHaveLength(2);
    expect(valid).toContain('NQH26');
    expect(valid).toContain('CLH26');
  });
});

describe('Retry Stop Conditions', () => {
  it('should not stop retry when some symbols are valid', () => {
    const failedSymbols = new Set(['ESH26']);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(false);
  });

  it('should stop retry when all symbols have failed', () => {
    const failedSymbols = new Set(['ESH26', 'NQH26', 'CLH26', 'GCH26']);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(true);
  });

  it('should stop retry when failed count exceeds total (edge case)', () => {
    const failedSymbols = new Set(['ESH26', 'NQH26', 'CLH26', 'GCH26', 'SIH26']);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(true);
  });

  it('should not stop retry when no symbols have failed', () => {
    const failedSymbols = new Set<string>();
    expect(shouldStopRetry(failedSymbols, 4)).toBe(false);
  });
});

describe('Contract Roll Entitlement Reset', () => {
  let state: MockSubscriptionState;

  beforeEach(() => {
    state = createMockState();
  });

  it('should clear entitlement failures on contract roll', () => {
    state.subscriptionSucceeded = true;
    state.subscribedStreamId = 'stream-123';
    state.subscribedFrontMonth = 'H26';
    state.entitlementFailedSymbols.add('ESH26');
    state.entitlementFailedSymbols.add('NQH26');

    const result = shouldResubscribe(state, 'stream-123', 'M26');
    expect(result.reason).toBe('contract_roll');

    if (result.reason === 'contract_roll') {
      state.entitlementFailedSymbols.clear();
      state.subscriptionSucceeded = false;
    }

    expect(state.entitlementFailedSymbols.size).toBe(0);
    expect(state.subscriptionSucceeded).toBe(false);
  });

  it('should preserve entitlement failures when no contract roll', () => {
    state.subscriptionSucceeded = true;
    state.subscribedStreamId = 'stream-123';
    state.subscribedFrontMonth = 'H26';
    state.entitlementFailedSymbols.add('ESH26');

    const result = shouldResubscribe(state, 'stream-123', 'H26');
    expect(result.reason).toBe('subscription_current');

    expect(state.entitlementFailedSymbols.size).toBe(1);
  });
});

describe('Mixed Entitlement Scenarios', () => {
  it('should handle progressive entitlement failures', () => {
    const instruments = ['ESH26', 'NQH26', 'CLH26', 'GCH26'];
    const failedSymbols = new Set<string>();

    let valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toHaveLength(4);

    failedSymbols.add('ESH26');
    valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toHaveLength(3);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(false);

    failedSymbols.add('NQH26');
    failedSymbols.add('CLH26');
    valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toHaveLength(1);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(false);

    failedSymbols.add('GCH26');
    valid = filterValidInstruments(instruments, failedSymbols);
    expect(valid).toHaveLength(0);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(true);
  });

  it('should handle credential change clearing entitlement failures', () => {
    const failedSymbols = new Set(['ESH26', 'NQH26']);
    expect(failedSymbols.size).toBe(2);

    failedSymbols.clear();

    expect(failedSymbols.size).toBe(0);
    expect(shouldStopRetry(failedSymbols, 4)).toBe(false);
  });
});
