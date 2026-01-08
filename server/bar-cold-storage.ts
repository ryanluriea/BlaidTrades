import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface ColdBar {
  ts_event: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ColdStorageStats {
  symbol: string;
  totalBars: number;
  oldestTs: number | null;
  newestTs: number | null;
  fileSizeMb: number;
}

const COLD_STORAGE_DIR = './data';
const COLD_STORAGE_FILE = 'bar-cold-storage.db';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(COLD_STORAGE_DIR)) {
      fs.mkdirSync(COLD_STORAGE_DIR, { recursive: true });
    }
    
    const dbPath = path.join(COLD_STORAGE_DIR, COLD_STORAGE_FILE);
    db = new Database(dbPath);
    
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS bars (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        ts_event INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume INTEGER NOT NULL,
        PRIMARY KEY (symbol, timeframe, ts_event)
      );
      
      CREATE INDEX IF NOT EXISTS idx_bars_symbol_tf_ts 
      ON bars(symbol, timeframe, ts_event DESC);
      
      CREATE TABLE IF NOT EXISTS metadata (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        last_updated INTEGER NOT NULL,
        bar_count INTEGER NOT NULL,
        oldest_ts INTEGER,
        newest_ts INTEGER,
        PRIMARY KEY (symbol, timeframe)
      );
    `);
    
    console.log('[COLD_STORAGE] SQLite database initialized at', dbPath);
  }
  return db;
}

export function storeBars(
  symbol: string,
  timeframe: string,
  bars: ColdBar[]
): number {
  if (bars.length === 0) return 0;
  
  const database = getDb();
  
  const insertStmt = database.prepare(`
    INSERT OR REPLACE INTO bars (symbol, timeframe, ts_event, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = database.transaction((barsToInsert: ColdBar[]) => {
    let inserted = 0;
    for (const bar of barsToInsert) {
      insertStmt.run(symbol, timeframe, bar.ts_event, bar.open, bar.high, bar.low, bar.close, bar.volume);
      inserted++;
    }
    return inserted;
  });
  
  const insertedCount = insertMany(bars);
  
  const stats = database.prepare(`
    SELECT COUNT(*) as count, MIN(ts_event) as oldest, MAX(ts_event) as newest
    FROM bars WHERE symbol = ? AND timeframe = ?
  `).get(symbol, timeframe) as { count: number; oldest: number; newest: number };
  
  database.prepare(`
    INSERT OR REPLACE INTO metadata (symbol, timeframe, last_updated, bar_count, oldest_ts, newest_ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(symbol, timeframe, Date.now(), stats.count, stats.oldest, stats.newest);
  
  console.log(`[COLD_STORAGE] Stored ${insertedCount} bars for ${symbol}/${timeframe} (total: ${stats.count})`);
  
  return insertedCount;
}

export function getBars(
  symbol: string,
  timeframe: string,
  startTs?: number,
  endTs?: number,
  limit?: number
): ColdBar[] {
  const database = getDb();
  
  let query = `SELECT ts_event, open, high, low, close, volume FROM bars WHERE symbol = ? AND timeframe = ?`;
  const params: (string | number)[] = [symbol, timeframe];
  
  if (startTs !== undefined) {
    query += ` AND ts_event >= ?`;
    params.push(startTs);
  }
  
  if (endTs !== undefined) {
    query += ` AND ts_event <= ?`;
    params.push(endTs);
  }
  
  query += ` ORDER BY ts_event ASC`;
  
  if (limit !== undefined) {
    query += ` LIMIT ?`;
    params.push(limit);
  }
  
  const rows = database.prepare(query).all(...params) as ColdBar[];
  return rows;
}

export function getBarCount(symbol: string, timeframe: string): number {
  const database = getDb();
  const result = database.prepare(`
    SELECT COUNT(*) as count FROM bars WHERE symbol = ? AND timeframe = ?
  `).get(symbol, timeframe) as { count: number };
  return result.count;
}

export function getBarRange(symbol: string, timeframe: string): { oldest: number | null; newest: number | null } {
  const database = getDb();
  const result = database.prepare(`
    SELECT MIN(ts_event) as oldest, MAX(ts_event) as newest FROM bars WHERE symbol = ? AND timeframe = ?
  `).get(symbol, timeframe) as { oldest: number | null; newest: number | null };
  return result;
}

export interface ColdStorageSummary {
  totalEntries: number;
  totalBars: number;
  fileSizeMb: number;
  entries: ColdStorageStats[];
}

export function getStorageStats(): ColdStorageStats[] {
  const database = getDb();
  
  const dbPath = path.join(COLD_STORAGE_DIR, COLD_STORAGE_FILE);
  let fileSizeMb = 0;
  try {
    const stats = fs.statSync(dbPath);
    fileSizeMb = stats.size / (1024 * 1024);
  } catch {}
  
  const rows = database.prepare(`
    SELECT symbol, timeframe, bar_count, oldest_ts, newest_ts
    FROM metadata
    ORDER BY symbol, timeframe
  `).all() as { symbol: string; timeframe: string; bar_count: number; oldest_ts: number | null; newest_ts: number | null }[];
  
  const totalBars = rows.reduce((sum, r) => sum + r.bar_count, 0);
  
  return rows.map(row => ({
    symbol: `${row.symbol}/${row.timeframe}`,
    totalBars: row.bar_count,
    oldestTs: row.oldest_ts,
    newestTs: row.newest_ts,
    // Estimate per-entry file size proportionally based on bar count
    fileSizeMb: totalBars > 0 ? (row.bar_count / totalBars) * fileSizeMb : 0,
  }));
}

export function getStorageSummary(): ColdStorageSummary {
  const entries = getStorageStats();
  const dbPath = path.join(COLD_STORAGE_DIR, COLD_STORAGE_FILE);
  let fileSizeMb = 0;
  try {
    const stats = fs.statSync(dbPath);
    fileSizeMb = stats.size / (1024 * 1024);
  } catch {}
  
  return {
    totalEntries: entries.length,
    totalBars: entries.reduce((sum, e) => sum + e.totalBars, 0),
    fileSizeMb,
    entries,
  };
}

export function deleteBars(
  symbol: string,
  timeframe: string,
  beforeTs?: number
): number {
  const database = getDb();
  
  let deleteCount = 0;
  if (beforeTs !== undefined) {
    const result = database.prepare(`
      DELETE FROM bars WHERE symbol = ? AND timeframe = ? AND ts_event < ?
    `).run(symbol, timeframe, beforeTs);
    deleteCount = result.changes;
  } else {
    const result = database.prepare(`
      DELETE FROM bars WHERE symbol = ? AND timeframe = ?
    `).run(symbol, timeframe);
    deleteCount = result.changes;
    
    database.prepare(`DELETE FROM metadata WHERE symbol = ? AND timeframe = ?`).run(symbol, timeframe);
  }
  
  console.log(`[COLD_STORAGE] Deleted ${deleteCount} bars for ${symbol}/${timeframe}`);
  return deleteCount;
}

export function aggregateBars(
  symbol: string,
  sourceTimeframe: string,
  targetTimeframe: string,
  barsPerCandle: number
): number {
  const database = getDb();
  
  const sourceBars = getBars(symbol, sourceTimeframe);
  if (sourceBars.length < barsPerCandle) {
    console.log(`[COLD_STORAGE] Not enough bars for aggregation: ${sourceBars.length} < ${barsPerCandle}`);
    return 0;
  }
  
  const aggregated: ColdBar[] = [];
  for (let i = 0; i <= sourceBars.length - barsPerCandle; i += barsPerCandle) {
    const chunk = sourceBars.slice(i, i + barsPerCandle);
    if (chunk.length === barsPerCandle) {
      aggregated.push({
        ts_event: chunk[0].ts_event,
        open: chunk[0].open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, b) => sum + b.volume, 0),
      });
    }
  }
  
  return storeBars(symbol, targetTimeframe, aggregated);
}

export function vacuumDatabase(): void {
  const database = getDb();
  database.exec('VACUUM');
  console.log('[COLD_STORAGE] Database vacuumed');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[COLD_STORAGE] Database closed');
  }
}
