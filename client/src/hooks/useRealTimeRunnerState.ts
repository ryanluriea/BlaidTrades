/**
 * Real-time runner state hook
 * 
 * Derives runner state directly from heartbeat freshness,
 * bypassing potentially stale health_state in bots table.
 */
import { useMemo } from 'react';
import { HEARTBEAT_THRESHOLDS, GRACE_PERIOD_MS } from '@/lib/healthConstants';

export interface RealTimeRunnerState {
  isHeartbeatFresh: boolean;
  isHeartbeatWarning: boolean;
  isHeartbeatStale: boolean;
  isWithinGracePeriod: boolean;
  heartbeatAgeMs: number | null;
  effectiveState: 'SCANNING' | 'TRADING' | 'STARTING' | 'STALLED' | 'NO_RUNNER';
}

export function useRealTimeRunnerState(
  lastHeartbeat: string | null | undefined,
  activityState: string | undefined,
  promotedAt: string | null | undefined,
  hasRunner: boolean
): RealTimeRunnerState {
  return useMemo(() => {
    const now = Date.now();
    
    // Check grace period
    const promotedAtMs = promotedAt ? new Date(promotedAt).getTime() : null;
    const isWithinGracePeriod = promotedAtMs 
      ? (now - promotedAtMs) < GRACE_PERIOD_MS 
      : false;
    
    // No runner at all
    if (!hasRunner) {
      return {
        isHeartbeatFresh: false,
        isHeartbeatWarning: false,
        isHeartbeatStale: true,
        isWithinGracePeriod,
        heartbeatAgeMs: null,
        effectiveState: isWithinGracePeriod ? 'STARTING' : 'NO_RUNNER',
      };
    }
    
    // No heartbeat yet
    if (!lastHeartbeat) {
      return {
        isHeartbeatFresh: false,
        isHeartbeatWarning: false,
        isHeartbeatStale: true,
        isWithinGracePeriod,
        heartbeatAgeMs: null,
        effectiveState: isWithinGracePeriod ? 'STARTING' : 'STALLED',
      };
    }
    
    const heartbeatAgeMs = now - new Date(lastHeartbeat).getTime();
    const isHeartbeatFresh = heartbeatAgeMs < HEARTBEAT_THRESHOLDS.WARNING_MS;
    const isHeartbeatWarning = heartbeatAgeMs >= HEARTBEAT_THRESHOLDS.WARNING_MS && 
                               heartbeatAgeMs < HEARTBEAT_THRESHOLDS.STALE_MS;
    const isHeartbeatStale = heartbeatAgeMs >= HEARTBEAT_THRESHOLDS.STALE_MS;
    
    // Determine effective state
    let effectiveState: RealTimeRunnerState['effectiveState'];
    
    if (isHeartbeatFresh || isHeartbeatWarning) {
      // Fresh heartbeat = runner is working
      effectiveState = activityState === 'TRADING' ? 'TRADING' : 'SCANNING';
    } else if (isHeartbeatStale) {
      // Stale but within grace period = still starting
      effectiveState = isWithinGracePeriod ? 'STARTING' : 'STALLED';
    } else {
      effectiveState = 'SCANNING';
    }
    
    return {
      isHeartbeatFresh,
      isHeartbeatWarning,
      isHeartbeatStale,
      isWithinGracePeriod,
      heartbeatAgeMs,
      effectiveState,
    };
  }, [lastHeartbeat, activityState, promotedAt, hasRunner]);
}

/**
 * Format heartbeat age for display
 */
export function formatHeartbeatAge(ageMs: number | null): string {
  if (ageMs === null) return 'No heartbeat';
  if (ageMs < 1000) return 'Just now';
  if (ageMs < 60000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}m ago`;
  return `${Math.round(ageMs / 3600000)}h ago`;
}
