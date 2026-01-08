# Data Reconciliation SQL Suite

Run these queries to verify UI data matches DB truth.

## 1. Generation Reconciliation

```sql
-- Verify: UI generation = MAX(generation_number)
-- PASS if ui_generation = db_max_generation for all rows
SELECT 
  b.id,
  b.name,
  b.stage,
  -- What UI shows (from bots-overview which uses MAX)
  (SELECT MAX(generation_number) FROM bot_generations WHERE bot_id = b.id) as ui_generation,
  -- Ground truth
  (SELECT MAX(generation_number) FROM bot_generations WHERE bot_id = b.id) as db_max_generation,
  -- STALE: current_generation_id points to different row
  b.current_generation_id,
  (SELECT generation_number FROM bot_generations WHERE id = b.current_generation_id) as current_pointer_gen,
  -- VERDICT
  CASE 
    WHEN (SELECT MAX(generation_number) FROM bot_generations WHERE bot_id = b.id) =
         (SELECT generation_number FROM bot_generations WHERE id = b.current_generation_id)
    THEN 'PASS - pointer matches max'
    ELSE 'INFO - pointer stale but UI uses MAX'
  END as verdict
FROM bots b
WHERE b.archived_at IS NULL
ORDER BY b.updated_at DESC
LIMIT 20;
```

## 2. Backtest Count Reconciliation

```sql
-- Verify: UI backtests_completed = COUNT(completed sessions)
SELECT 
  b.id,
  b.name,
  (SELECT COUNT(*) FROM backtest_sessions WHERE bot_id = b.id AND status = 'completed') as db_count,
  -- This should match what bots-overview returns
  'PASS if matches bots-overview.backtests_completed' as verdict
FROM bots b
WHERE b.archived_at IS NULL
ORDER BY b.updated_at DESC
LIMIT 20;
```

## 3. Session Metrics Reconciliation

```sql
-- Verify: UI metrics = LATEST COMPLETED session metrics
WITH latest_sessions AS (
  SELECT DISTINCT ON (bot_id)
    bot_id,
    id as session_id,
    total_trades,
    win_rate,
    max_drawdown_pct,
    max_drawdown,
    profit_factor,
    sharpe_ratio,
    completed_at
  FROM backtest_sessions
  WHERE status = 'completed'
  ORDER BY bot_id, completed_at DESC NULLS LAST
)
SELECT 
  b.id,
  b.name,
  ls.total_trades as db_session_trades,
  ls.win_rate as db_session_win_rate,
  ls.max_drawdown_pct as db_session_max_dd_pct,
  ls.max_drawdown as db_session_max_dd_usd,
  ls.profit_factor as db_session_pf,
  ls.sharpe_ratio as db_session_sharpe,
  ls.completed_at as session_completed_at
FROM bots b
LEFT JOIN latest_sessions ls ON ls.bot_id = b.id
WHERE b.archived_at IS NULL
ORDER BY b.updated_at DESC
LIMIT 20;
```

## 4. Improvement State Reconciliation

```sql
-- Verify: UI improvement fields match bot_improvement_state
SELECT 
  bis.bot_id,
  b.name,
  bis.status as db_status,
  bis.attempts_used as db_attempts_used,
  bis.last_improvement_at as db_last_improvement_at,
  bis.consecutive_failures as db_consecutive_failures,
  bis.why_not_promoted as db_why_not_promoted
FROM bot_improvement_state bis
JOIN bots b ON b.id = bis.bot_id
WHERE b.archived_at IS NULL
ORDER BY bis.updated_at DESC
LIMIT 20;
```

## 5. Per-Bot Data Reconciliation (Runner Status)

```sql
-- Verify: UI runner status matches primary bot_instance
SELECT 
  bi.bot_id,
  b.name,
  b.stage,
  bi.id as instance_id,
  bi.status as db_instance_status,
  bi.activity_state as db_activity_state,
  bi.last_heartbeat_at as db_last_heartbeat,
  bi.is_primary_runner,
  -- Age calculation
  EXTRACT(EPOCH FROM (NOW() - bi.last_heartbeat_at)) as heartbeat_age_seconds,
  -- Stall detection (>60s = stale)
  CASE 
    WHEN bi.last_heartbeat_at IS NULL THEN 'NO_HEARTBEAT'
    WHEN EXTRACT(EPOCH FROM (NOW() - bi.last_heartbeat_at)) > 60 THEN 'STALE'
    ELSE 'FRESH'
  END as heartbeat_status
FROM bot_instances bi
JOIN bots b ON b.id = bi.bot_id
WHERE bi.is_primary_runner = true
  AND b.archived_at IS NULL
ORDER BY b.updated_at DESC
LIMIT 20;
```

## 6. Job Counts Reconciliation

```sql
-- Verify: UI job counts match bot_jobs aggregates
SELECT 
  b.id,
  b.name,
  COUNT(*) FILTER (WHERE bj.job_type = 'BACKTEST' AND bj.status = 'RUNNING') as backtest_running,
  COUNT(*) FILTER (WHERE bj.job_type = 'BACKTEST' AND bj.status = 'QUEUED') as backtest_queued,
  COUNT(*) FILTER (WHERE bj.job_type = 'EVOLVE' AND bj.status = 'RUNNING') as evolve_running,
  COUNT(*) FILTER (WHERE bj.job_type = 'EVOLVE' AND bj.status = 'QUEUED') as evolve_queued,
  MIN(bj.started_at) FILTER (WHERE bj.job_type = 'EVOLVE' AND bj.status = 'RUNNING') as evolve_started_at
FROM bots b
LEFT JOIN bot_jobs bj ON bj.bot_id = b.id AND bj.status IN ('RUNNING', 'QUEUED')
WHERE b.archived_at IS NULL
GROUP BY b.id, b.name
ORDER BY b.updated_at DESC
LIMIT 20;
```

## 7. Full Reconciliation Report (All Fields)

```sql
-- COMPREHENSIVE: All UI fields vs DB truth
WITH latest_sessions AS (
  SELECT DISTINCT ON (bot_id)
    bot_id,
    total_trades,
    win_rate,
    max_drawdown_pct,
    max_drawdown,
    profit_factor,
    sharpe_ratio,
    completed_at
  FROM backtest_sessions
  WHERE status = 'completed'
  ORDER BY bot_id, completed_at DESC NULLS LAST
),
job_counts AS (
  SELECT 
    bot_id,
    COUNT(*) FILTER (WHERE job_type = 'BACKTEST' AND status = 'RUNNING') as bt_running,
    COUNT(*) FILTER (WHERE job_type = 'BACKTEST' AND status = 'QUEUED') as bt_queued,
    COUNT(*) FILTER (WHERE job_type = 'EVOLVE' AND status = 'RUNNING') as ev_running,
    COUNT(*) FILTER (WHERE job_type = 'EVOLVE' AND status = 'QUEUED') as ev_queued
  FROM bot_jobs
  WHERE status IN ('RUNNING', 'QUEUED')
  GROUP BY bot_id
),
primary_instances AS (
  SELECT DISTINCT ON (bot_id)
    bot_id,
    id as instance_id,
    status,
    activity_state,
    last_heartbeat_at,
    mode,
    account_id
  FROM bot_instances
  WHERE is_primary_runner = true
  ORDER BY bot_id, updated_at DESC
)
SELECT 
  b.id,
  b.name,
  b.stage,
  -- Generation
  (SELECT MAX(generation_number) FROM bot_generations WHERE bot_id = b.id) as generation,
  -- Backtest count
  (SELECT COUNT(*) FROM backtest_sessions WHERE bot_id = b.id AND status = 'completed') as backtests_completed,
  -- Session metrics
  ls.total_trades as session_trades,
  ls.win_rate as session_win_rate_pct,
  ls.max_drawdown_pct as session_max_dd_pct,
  ls.max_drawdown as session_max_dd_usd,
  ls.profit_factor as session_profit_factor,
  ls.sharpe_ratio as session_sharpe,
  -- Instance
  pi.status as instance_status,
  pi.activity_state,
  pi.last_heartbeat_at,
  -- Jobs
  COALESCE(jc.bt_running, 0) as backtest_running,
  COALESCE(jc.bt_queued, 0) as backtest_queued,
  COALESCE(jc.ev_running, 0) as evolve_running,
  COALESCE(jc.ev_queued, 0) as evolve_queued,
  -- Improvement
  bis.status as improvement_status,
  bis.attempts_used,
  bis.last_improvement_at,
  bis.consecutive_failures
FROM bots b
LEFT JOIN latest_sessions ls ON ls.bot_id = b.id
LEFT JOIN job_counts jc ON jc.bot_id = b.id
LEFT JOIN primary_instances pi ON pi.bot_id = b.id
LEFT JOIN bot_improvement_state bis ON bis.bot_id = b.id
WHERE b.archived_at IS NULL
ORDER BY b.updated_at DESC
LIMIT 20;
```

---

## Running the Reconciliation

1. Execute each query above
2. For each bot, compare UI values with DB values
3. PASS = values match, FAIL = mismatch

### Acceptance Criteria
- Generation: UI = MAX(generation_number) ✓
- Backtests: UI = COUNT(completed) ✓
- Session metrics: UI = latest completed session ✓
- Improvement state: UI matches bot_improvement_state ✓
- Runner status: UI matches primary bot_instance ✓
- Job counts: UI matches aggregated bot_jobs ✓
