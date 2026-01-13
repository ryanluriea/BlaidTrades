/**
 * WebSocket Message Latency Tracker
 * 
 * Tracks latency for real-time data feeds critical to trading operations.
 * 
 * Monitors:
 * - Tick data propagation latency (exchange → client)
 * - P&L update latency
 * - Order status update latency
 * - Research/activity feed latency
 */

interface WSLatencySample {
  timestamp: number;
  latencyMs: number;
  messageType: string;
}

interface WSChannelStats {
  samples: WSLatencySample[];
  totalMessages: number;
  errors: number;
  lastMessageTime: number | null;
}

interface WSPercentiles {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  count: number;
  messagesPerSecond: number;
  errors: number;
}

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SAMPLES = 5000;

class WebSocketTracker {
  private channels: Map<string, WSChannelStats> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    this.startCleanup();
  }
  
  record(channel: string, latencyMs: number, messageType: string = 'data'): void {
    const now = Date.now();
    
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        samples: [],
        totalMessages: 0,
        errors: 0,
        lastMessageTime: null,
      });
    }
    
    const stats = this.channels.get(channel)!;
    stats.totalMessages++;
    stats.lastMessageTime = now;
    
    // Reservoir sampling for memory efficiency
    if (stats.samples.length >= MAX_SAMPLES) {
      const randomIndex = Math.floor(Math.random() * stats.samples.length);
      stats.samples[randomIndex] = { timestamp: now, latencyMs, messageType };
    } else {
      stats.samples.push({ timestamp: now, latencyMs, messageType });
    }
  }
  
  recordError(channel: string): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        samples: [],
        totalMessages: 0,
        errors: 0,
        lastMessageTime: null,
      });
    }
    
    const stats = this.channels.get(channel)!;
    stats.errors++;
  }
  
  getPercentiles(channel: string): WSPercentiles | null {
    const stats = this.channels.get(channel);
    if (!stats || stats.samples.length === 0) {
      return null;
    }
    
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    
    const recentSamples = stats.samples
      .filter(s => s.timestamp >= windowStart)
      .map(s => s.latencyMs)
      .sort((a, b) => a - b);
    
    if (recentSamples.length === 0) {
      return null;
    }
    
    const percentile = (arr: number[], p: number): number => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };
    
    const sum = recentSamples.reduce((a, b) => a + b, 0);
    const windowSeconds = WINDOW_MS / 1000;
    
    return {
      p50: percentile(recentSamples, 50),
      p95: percentile(recentSamples, 95),
      p99: percentile(recentSamples, 99),
      mean: sum / recentSamples.length,
      count: recentSamples.length,
      messagesPerSecond: recentSamples.length / windowSeconds,
      errors: stats.errors,
    };
  }
  
  getAllChannels(): Record<string, WSPercentiles> {
    const result: Record<string, WSPercentiles> = {};
    
    for (const channel of this.channels.keys()) {
      const percentiles = this.getPercentiles(channel);
      if (percentiles) {
        result[channel] = percentiles;
      }
    }
    
    return result;
  }
  
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const windowStart = now - WINDOW_MS;
      
      for (const stats of this.channels.values()) {
        stats.samples = stats.samples.filter(s => s.timestamp >= windowStart);
      }
    }, 60000); // Cleanup every minute
    
    this.cleanupInterval.unref();
  }
  
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  logSummary(): void {
    const channels = this.getAllChannels();
    
    for (const [channel, stats] of Object.entries(channels)) {
      if (stats.count > 0) {
        console.log(
          `[WS_LATENCY] ${channel} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms p99=${stats.p99.toFixed(1)}ms msg/s=${stats.messagesPerSecond.toFixed(1)} errors=${stats.errors}`
        );
      }
    }
  }
}

export const wsTracker = new WebSocketTracker();

let wsLogInterval: NodeJS.Timeout | null = null;

export function startWSTracking(logIntervalMs: number = 60000): void {
  if (wsLogInterval) {
    clearInterval(wsLogInterval);
  }
  
  wsLogInterval = setInterval(() => wsTracker.logSummary(), logIntervalMs);
  wsLogInterval.unref();
  
  console.log('[WS_LATENCY] WebSocket tracking started');
}

export function stopWSTracking(): void {
  if (wsLogInterval) {
    clearInterval(wsLogInterval);
    wsLogInterval = null;
  }
  wsTracker.shutdown();
}
