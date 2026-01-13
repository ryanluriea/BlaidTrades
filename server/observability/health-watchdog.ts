/**
 * Self-Healing Health Watchdog
 * 
 * Monitors system health and automatically takes corrective actions
 * when issues are detected (e.g., cache hit rate degradation).
 */

import { metricsRegistry } from './metrics';

interface HealingAction {
  action: string;
  reason: string;
  timestamp: string;
  success: boolean;
}

class HealthWatchdog {
  private lastAction: HealingAction | null = null;
  private healingInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_HIT_RATE_THRESHOLD = 30;
  private readonly CHECK_INTERVAL_MS = 120000;
  private consecutiveLowHitRates = 0;
  private readonly CONSECUTIVE_THRESHOLD = 2;

  getLastAction(): HealingAction | null {
    return this.lastAction;
  }

  async clearAllCaches(): Promise<{ clearedCaches: string[] }> {
    const clearedCaches: string[] = [];
    
    try {
      const { invalidateAllBotsOverviewCache } = await import('../cache/bots-overview-cache');
      await invalidateAllBotsOverviewCache();
      clearedCaches.push('bots-overview');
    } catch (err) {
      console.warn('[HEALTH_WATCHDOG] Failed to clear bots-overview cache:', err);
    }

    this.lastAction = {
      action: 'clear_all_caches',
      reason: 'Manual trigger or auto-heal',
      timestamp: new Date().toISOString(),
      success: clearedCaches.length > 0,
    };

    console.log(`[HEALTH_WATCHDOG] Cleared caches: ${clearedCaches.join(', ') || 'none'}`);
    return { clearedCaches };
  }

  async checkAndHeal(): Promise<void> {
    const summary = metricsRegistry.getSummary();
    const totalRequests = summary.cacheHits + summary.cacheMisses;
    
    if (totalRequests < 20) {
      this.consecutiveLowHitRates = 0;
      return;
    }

    const hitRate = summary.cacheHitRate;
    
    if (hitRate < this.CACHE_HIT_RATE_THRESHOLD) {
      this.consecutiveLowHitRates++;
      console.log(`[HEALTH_WATCHDOG] Low cache hit rate detected: ${hitRate.toFixed(1)}% (consecutive: ${this.consecutiveLowHitRates}/${this.CONSECUTIVE_THRESHOLD})`);
      
      if (this.consecutiveLowHitRates >= this.CONSECUTIVE_THRESHOLD) {
        console.log(`[HEALTH_WATCHDOG] Auto-healing: Clearing caches due to sustained low hit rate`);
        await this.clearAllCaches();
        this.consecutiveLowHitRates = 0;
        
        this.lastAction = {
          action: 'auto_clear_cache',
          reason: `Cache hit rate ${hitRate.toFixed(1)}% below threshold ${this.CACHE_HIT_RATE_THRESHOLD}%`,
          timestamp: new Date().toISOString(),
          success: true,
        };
      }
    } else {
      this.consecutiveLowHitRates = 0;
    }
  }

  start(): void {
    if (this.healingInterval) {
      return;
    }
    
    this.healingInterval = setInterval(() => {
      this.checkAndHeal().catch(err => {
        console.error('[HEALTH_WATCHDOG] Check failed:', err);
      });
    }, this.CHECK_INTERVAL_MS);
    
    console.log(`[HEALTH_WATCHDOG] Started (check interval: ${this.CHECK_INTERVAL_MS / 1000}s, threshold: ${this.CACHE_HIT_RATE_THRESHOLD}%)`);
  }

  stop(): void {
    if (this.healingInterval) {
      clearInterval(this.healingInterval);
      this.healingInterval = null;
      console.log('[HEALTH_WATCHDOG] Stopped');
    }
  }
}

export const healthWatchdog = new HealthWatchdog();
