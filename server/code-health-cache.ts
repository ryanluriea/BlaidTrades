// Singleton cache for code health data
// Uses filesystem for true persistence across hot reloads and restarts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

interface CodeHealthCacheData {
  data: any;
  timestamp: number;
}

export const CODE_HEALTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Use os.tmpdir() for cross-platform compatibility
const CACHE_DIR = tmpdir();
const CACHE_FILE = join(CACHE_DIR, 'code-health-cache.json');

// In-memory cache for fast access within same process
let memoryCache: CodeHealthCacheData | null = null;

function readFromDisk(): CodeHealthCacheData | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const content = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeToDisk(cache: CodeHealthCacheData): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch (err) {
    console.warn('[CODE_HEALTH_CACHE] Failed to write cache to disk:', err);
  }
}

export const codeHealthCache = {
  get(): CodeHealthCacheData | null {
    if (memoryCache) return memoryCache;
    const diskCache = readFromDisk();
    if (diskCache) {
      memoryCache = diskCache;
    }
    return memoryCache;
  },
  
  set(data: any): void {
    const cache = {
      data,
      timestamp: Date.now(),
    };
    memoryCache = cache;
    writeToDisk(cache);
  },
  
  isValid(): boolean {
    const cache = this.get();
    if (!cache) return false;
    return (Date.now() - cache.timestamp) < CODE_HEALTH_CACHE_TTL;
  },
  
  getAge(): number {
    const cache = this.get();
    if (!cache) return 0;
    return Math.round((Date.now() - cache.timestamp) / 1000);
  },
};
