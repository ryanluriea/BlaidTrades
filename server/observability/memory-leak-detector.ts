/**
 * Generational Memory Leak Detector
 * 
 * Tracks memory usage patterns to detect slow leaks that
 * the Memory Sentinel might miss.
 * 
 * Features:
 * - Generational tracking (short/medium/long term)
 * - Trend analysis with linear regression
 * - Automatic heap snapshot suggestions
 * - Integration with Memory Sentinel
 */

interface MemorySample {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

interface MemoryTrend {
  slope: number;       // Bytes per second
  correlation: number; // R-squared
  prediction: number;  // Predicted heap at +1 hour
  status: 'STABLE' | 'GROWING' | 'LEAKING';
}

interface LeakDetectorStats {
  shortTerm: MemoryTrend;   // Last 5 minutes
  mediumTerm: MemoryTrend;  // Last 30 minutes
  longTerm: MemoryTrend;    // Last 2 hours
  currentHeapMB: number;
  peakHeapMB: number;
  gcSuggested: boolean;
  snapshotSuggested: boolean;
  leakConfidence: number;
}

const SHORT_TERM_MS = 5 * 60 * 1000;      // 5 minutes
const MEDIUM_TERM_MS = 30 * 60 * 1000;    // 30 minutes
const LONG_TERM_MS = 2 * 60 * 60 * 1000;  // 2 hours
const SAMPLE_INTERVAL_MS = 10000;          // 10 seconds
const MAX_SAMPLES = 720;                   // 2 hours at 10s intervals

const LEAK_THRESHOLD_BYTES_PER_SEC = 50000; // 50KB/s growth = likely leak
const CORRELATION_THRESHOLD = 0.7;           // Strong correlation

class MemoryLeakDetector {
  private samples: MemorySample[] = [];
  private peakHeap: number = 0;
  private sampleInterval: NodeJS.Timeout | null = null;
  private alertCallbacks: Array<(stats: LeakDetectorStats) => void> = [];
  
  start(): void {
    if (this.sampleInterval) return;
    
    this.takeSample();
    
    this.sampleInterval = setInterval(() => {
      this.takeSample();
    }, SAMPLE_INTERVAL_MS);
    
    this.sampleInterval.unref();
    
    console.log('[MEMORY_LEAK] Detector started (sample_interval=10s, window=2h)');
  }
  
  stop(): void {
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }
  }
  
  private takeSample(): void {
    const mem = process.memoryUsage();
    const now = Date.now();
    
    const sample: MemorySample = {
      timestamp: now,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
    };
    
    this.samples.push(sample);
    
    // Update peak
    if (mem.heapUsed > this.peakHeap) {
      this.peakHeap = mem.heapUsed;
    }
    
    // Trim old samples
    const cutoff = now - LONG_TERM_MS;
    while (this.samples.length > MAX_SAMPLES || (this.samples.length > 0 && this.samples[0].timestamp < cutoff)) {
      this.samples.shift();
    }
    
    // Check for leaks periodically
    if (this.samples.length >= 30) { // At least 5 minutes of data
      const stats = this.getStats();
      if (stats.leakConfidence > 0.8) {
        this.triggerAlert(stats);
      }
    }
  }
  
  private computeTrend(windowMs: number): MemoryTrend {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    const windowSamples = this.samples.filter(s => s.timestamp >= cutoff);
    
    if (windowSamples.length < 5) {
      return { slope: 0, correlation: 0, prediction: 0, status: 'STABLE' };
    }
    
    // Linear regression on heapUsed vs time
    const n = windowSamples.length;
    const startTime = windowSamples[0].timestamp;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    for (const sample of windowSamples) {
      const x = (sample.timestamp - startTime) / 1000; // Seconds
      const y = sample.heapUsed;
      
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // R-squared correlation
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    
    for (const sample of windowSamples) {
      const x = (sample.timestamp - startTime) / 1000;
      const predicted = meanY + slope * (x - sumX / n);
      ssRes += Math.pow(sample.heapUsed - predicted, 2);
      ssTot += Math.pow(sample.heapUsed - meanY, 2);
    }
    
    const correlation = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    
    // Predict heap at +1 hour
    const currentHeap = windowSamples[windowSamples.length - 1].heapUsed;
    const prediction = currentHeap + slope * 3600; // +1 hour in seconds
    
    // Determine status
    let status: 'STABLE' | 'GROWING' | 'LEAKING' = 'STABLE';
    
    if (slope > LEAK_THRESHOLD_BYTES_PER_SEC && correlation > CORRELATION_THRESHOLD) {
      status = 'LEAKING';
    } else if (slope > LEAK_THRESHOLD_BYTES_PER_SEC / 2) {
      status = 'GROWING';
    }
    
    return { slope, correlation, prediction, status };
  }
  
  getStats(): LeakDetectorStats {
    const shortTerm = this.computeTrend(SHORT_TERM_MS);
    const mediumTerm = this.computeTrend(MEDIUM_TERM_MS);
    const longTerm = this.computeTrend(LONG_TERM_MS);
    
    const currentHeap = this.samples.length > 0 
      ? this.samples[this.samples.length - 1].heapUsed 
      : 0;
    
    // Calculate leak confidence
    let leakConfidence = 0;
    
    // Weight: long-term trends are most important
    if (longTerm.status === 'LEAKING') leakConfidence += 0.5;
    if (mediumTerm.status === 'LEAKING') leakConfidence += 0.3;
    if (shortTerm.status === 'LEAKING') leakConfidence += 0.2;
    
    // Boost confidence if all trends agree
    if (longTerm.status === 'LEAKING' && mediumTerm.status === 'LEAKING' && shortTerm.status === 'LEAKING') {
      leakConfidence = Math.min(1, leakConfidence + 0.2);
    }
    
    // Suggest GC if heap is high and growing
    const heapLimit = (process.memoryUsage().heapTotal / (1024 * 1024)) * 0.8;
    const currentHeapMB = currentHeap / (1024 * 1024);
    const gcSuggested = currentHeapMB > heapLimit && shortTerm.slope > 0;
    
    // Suggest heap snapshot if leak is likely
    const snapshotSuggested = leakConfidence > 0.7;
    
    return {
      shortTerm,
      mediumTerm,
      longTerm,
      currentHeapMB: Math.round(currentHeapMB * 10) / 10,
      peakHeapMB: Math.round(this.peakHeap / (1024 * 1024) * 10) / 10,
      gcSuggested,
      snapshotSuggested,
      leakConfidence: Math.round(leakConfidence * 100) / 100,
    };
  }
  
  onAlert(callback: (stats: LeakDetectorStats) => void): void {
    this.alertCallbacks.push(callback);
  }
  
  private triggerAlert(stats: LeakDetectorStats): void {
    console.error(
      `[MEMORY_LEAK] Potential leak detected! confidence=${(stats.leakConfidence * 100).toFixed(0)}% heap=${stats.currentHeapMB}MB growth=${(stats.longTerm.slope / 1024).toFixed(1)}KB/s`
    );
    
    for (const callback of this.alertCallbacks) {
      try {
        callback(stats);
      } catch (err) {
        console.error('[MEMORY_LEAK] Alert callback error:', err);
      }
    }
  }
  
  logSummary(): void {
    const stats = this.getStats();
    
    const statusIcon = stats.leakConfidence > 0.7 ? 'LEAK' : 
                       stats.leakConfidence > 0.4 ? 'WARN' : 'OK';
    
    console.log(
      `[MEMORY_LEAK] status=${statusIcon} heap=${stats.currentHeapMB}MB peak=${stats.peakHeapMB}MB ` +
      `short=${(stats.shortTerm.slope / 1024).toFixed(1)}KB/s ` +
      `medium=${(stats.mediumTerm.slope / 1024).toFixed(1)}KB/s ` +
      `long=${(stats.longTerm.slope / 1024).toFixed(1)}KB/s ` +
      `confidence=${(stats.leakConfidence * 100).toFixed(0)}%`
    );
  }
}

export const memoryLeakDetector = new MemoryLeakDetector();

let leakLogInterval: NodeJS.Timeout | null = null;

export function startLeakDetection(logIntervalMs: number = 60000): void {
  memoryLeakDetector.start();
  
  if (leakLogInterval) {
    clearInterval(leakLogInterval);
  }
  
  leakLogInterval = setInterval(() => memoryLeakDetector.logSummary(), logIntervalMs);
  leakLogInterval.unref();
}

export function stopLeakDetection(): void {
  memoryLeakDetector.stop();
  
  if (leakLogInterval) {
    clearInterval(leakLogInterval);
    leakLogInterval = null;
  }
}
