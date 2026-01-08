# Query Performance Documentation

**Generated:** 2024-12-16  
**Version:** v1.0

## Overview

This document contains performance analysis for critical database queries used by BlaidAgent endpoints.

## Performance Budgets

| Endpoint | p50 Target | p95 Target | p99 Target |
|----------|------------|------------|------------|
| bots-overview | 400ms | 1000ms | 1500ms |
| production-readiness-audit | 500ms | 1500ms | 2000ms |
| accounts list | 300ms | 800ms | 1200ms |
| backtest-sessions list | 400ms | 1000ms | 1500ms |

## Critical Queries

### 1. bots-overview - Main Bot List Query

```sql
-- Step 1: Base bots query (uses idx_bots_user_updated)
SELECT id, name, description, stage, mode, status, 
       is_trading_enabled, evolution_mode, created_at, updated_at,
       strategy_config, live_total_trades, live_pnl, live_win_rate,
       health_state, health_reason_code, bqs_latest, 
       priority_score, priority_bucket
FROM bots
WHERE user_id = $1 
  AND archived_at IS NULL
ORDER BY updated_at DESC
LIMIT 50 OFFSET 0;
```

**Expected Plan:**
```
Limit  (cost=0.28..12.45 rows=50 width=500)
  ->  Index Scan using idx_bots_user_updated on bots  (cost=0.28..100.00 rows=500 width=500)
        Index Cond: (user_id = $1)
        Filter: (archived_at IS NULL)
```

**Index Required:** `idx_bots_user_updated (user_id, updated_at DESC)`

### 2. Latest Completed Backtest Sessions

```sql
-- Gets latest completed session per bot (uses idx_backtest_sessions_bot_completed)
SELECT bot_id, total_trades, net_pnl, win_rate, sharpe_ratio, 
       max_drawdown_pct, max_drawdown, profit_factor, completed_at
FROM backtest_sessions
WHERE bot_id = ANY($1)
  AND status = 'completed'
ORDER BY completed_at DESC;
```

**Expected Plan:**
```
Index Scan using idx_backtest_sessions_bot_completed on backtest_sessions
  Index Cond: (bot_id = ANY($1) AND status = 'completed')
  Sort Key: completed_at DESC
```

**Index Required:** `idx_backtest_sessions_bot_completed (bot_id, status, completed_at DESC)`

### 3. Backtest Count Query

```sql
-- Counts completed backtests per bot (uses idx_backtest_sessions_bot_status)
SELECT bot_id
FROM backtest_sessions
WHERE bot_id = ANY($1)
  AND status = 'completed';
```

**Expected Plan:**
```
Index Only Scan using idx_backtest_sessions_bot_status on backtest_sessions
  Index Cond: (bot_id = ANY($1) AND status = 'completed')
```

**Index Required:** `idx_backtest_sessions_bot_status (bot_id, status)`

### 4. Latest Generation Query

```sql
-- Gets latest generation per bot (uses idx_bot_generations_bot_gen)
SELECT bot_id, generation_number, version_major, version_minor
FROM bot_generations
WHERE bot_id = ANY($1)
ORDER BY generation_number DESC;
```

**Expected Plan:**
```
Index Scan using idx_bot_generations_bot_gen on bot_generations
  Index Cond: (bot_id = ANY($1))
  Sort Key: generation_number DESC
```

**Index Required:** `idx_bot_generations_bot_gen (bot_id, generation_number DESC)`

### 5. Primary Instance Query

```sql
-- Gets primary runner instance per bot (uses idx_bot_instances_bot_status)
SELECT bot_id, id, status, activity_state, last_heartbeat_at, mode, account_id
FROM bot_instances
WHERE bot_id = ANY($1)
  AND is_primary_runner = true
ORDER BY updated_at DESC;
```

**Expected Plan:**
```
Index Scan using idx_bot_instances_bot_primary on bot_instances
  Index Cond: (bot_id = ANY($1) AND is_primary_runner = true)
```

**Index Required:** `idx_bot_instances_bot_primary (bot_id, is_primary_runner)`

### 6. Active Jobs Query

```sql
-- Gets running/queued jobs (uses idx_bot_jobs_bot_status)
SELECT bot_id, job_type, status, started_at
FROM bot_jobs
WHERE bot_id = ANY($1)
  AND status IN ('RUNNING', 'QUEUED');
```

**Expected Plan:**
```
Index Scan using idx_bot_jobs_bot_status on bot_jobs
  Index Cond: (bot_id = ANY($1) AND status = ANY('{RUNNING,QUEUED}'))
```

**Index Required:** `idx_bot_jobs_bot_status (bot_id, status)`

## Index Recommendations

The following indexes should exist for optimal performance:

```sql
-- Bots table
CREATE INDEX IF NOT EXISTS idx_bots_user_updated 
  ON bots(user_id, updated_at DESC) 
  WHERE archived_at IS NULL;

-- Backtest sessions
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_bot_completed 
  ON backtest_sessions(bot_id, status, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_sessions_bot_status 
  ON backtest_sessions(bot_id, status);

-- Bot generations
CREATE INDEX IF NOT EXISTS idx_bot_generations_bot_gen 
  ON bot_generations(bot_id, generation_number DESC);

-- Bot instances
CREATE INDEX IF NOT EXISTS idx_bot_instances_bot_primary 
  ON bot_instances(bot_id, is_primary_runner) 
  WHERE is_primary_runner = true;

CREATE INDEX IF NOT EXISTS idx_bot_instances_bot_status 
  ON bot_instances(bot_id, status);

-- Bot jobs
CREATE INDEX IF NOT EXISTS idx_bot_jobs_bot_status 
  ON bot_jobs(bot_id, status);

-- Bot improvement state
CREATE INDEX IF NOT EXISTS idx_bot_improvement_state_bot 
  ON bot_improvement_state(bot_id);
```

## Query Optimization Notes

### Avoiding N+1 Queries

The `bots-overview` endpoint uses **parallel sub-queries** instead of complex JOINs:

1. Fetch base bots (single query)
2. Parallel fetch: sessions, counts, generations, instances, jobs, improvement state
3. Client-side aggregation

This approach:
- Avoids query planner confusion from complex JOINs
- Allows each sub-query to use optimal indexes
- Enables parallel execution
- Results in predictable performance

### Caching Strategy

The endpoint implements **stale-while-revalidate** caching:

- Cache TTL: 15 seconds (fresh)
- Stale TTL: 60 seconds (will return stale + refresh in background)
- Cache key: `overview:v7:{userId}:{limit}:{offset}`

Response headers indicate cache status:
- `x-cache: HIT` - Fresh cache hit
- `x-cache: STALE` - Stale data returned, background refresh triggered
- `x-cache: MISS` - Database query executed
- `x-cache: ERROR-FALLBACK` - Error occurred, returning any available cache

## Performance Monitoring

### Response Headers

All critical endpoints include performance headers:

| Header | Description |
|--------|-------------|
| `x-request-id` | Unique request identifier for tracing |
| `x-duration-ms` | Total request duration in milliseconds |
| `x-db-ms` | Database query time in milliseconds |
| `x-row-count` | Number of rows returned |
| `x-cache` | Cache status (HIT/MISS/STALE/ERROR-FALLBACK) |

### Logging Format

Server logs include performance data:

```
[bots-overview] abc123 DB 650ms db=450ms rows=20
[bots-overview] abc123 CACHE_HIT 5ms
[bots-overview] abc123 CACHE_STALE 8ms
```

## Troubleshooting

### Slow Queries

1. Check `x-db-ms` header for database time
2. Review Supabase Dashboard → SQL → Query Performance
3. Run `EXPLAIN ANALYZE` on slow queries
4. Verify indexes exist and are being used

### High Cache Miss Rate

1. Check cache TTL settings
2. Verify cache key uniqueness
3. Monitor memory usage (cache may be evicted)

### N+1 Query Detection

1. Check network tab for multiple sequential requests
2. Review `x-row-count` header
3. Verify batched queries are being used

## Benchmarks

### Recent Performance (2024-12-16)

| Metric | Value |
|--------|-------|
| bots-overview p50 | ~450ms |
| bots-overview p95 | ~850ms |
| Cache hit rate | ~70% |
| Avg rows returned | 20 |
