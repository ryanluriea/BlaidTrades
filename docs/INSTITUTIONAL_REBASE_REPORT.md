# Institutional Rebase Report
Generated: 2025-12-17 (Updated)

## COMPLETED

### 1. Generation Data Integrity ✅
- **Fixed**: All 20 bots now have `current_generation_id` pointing to MAX generation
- **SQL Used**: `UPDATE bots b SET current_generation_id = (SELECT bg.id FROM bot_generations bg WHERE bg.bot_id = b.id ORDER BY bg.generation_number DESC LIMIT 1)`
- **Verification**: GENERATION_TRUTH test now PASS (20/20)

### 2. /bots Page Architecture ✅
- **Single Source**: `useBotsOverview` hook → `bots-overview` edge function
- **No per-bot REST calls** on main bot list
- **Contract with explicit units**: `session_max_dd_pct` (%), `session_max_dd_usd` ($), `session_pnl_usd` ($)

### 3. Response Contract (bots-overview)
```typescript
interface BotOverview {
  // Identity
  id: string; name: string; stage: string; symbol: string | null;
  
  // Generation from MAX(bot_generations.generation_number)
  generation: number; version_major: number; version_minor: number;
  
  // Metrics from LATEST COMPLETED backtest_session (for LAB)
  session_trades: number;
  session_pnl_usd: number | null;        // DOLLARS
  session_win_rate_pct: number | null;   // PERCENT (0-100)
  session_max_dd_pct: number | null;     // PERCENT
  session_max_dd_usd: number | null;     // DOLLARS
  session_profit_factor: number | null;
  
  // Backtest count
  backtests_completed: number;
  
  // Health & priority
  health_state: string | null;
  bqs_latest: number | null;
  priority_score: number | null;
}
```

### 4. bot_jobs Index ✅
- **Created**: `idx_bot_jobs_bot_created_desc` and `idx_bot_jobs_status_type`
- **Query performance**: Improved for job queue operations

### 5. Sub-View Refactors ✅
- **FleetView**: Already uses `useBotsOverview` only - no changes needed
- **EvolutionView**: Already uses `useBotsOverview` only - no changes needed

### 6. Databento Parser Fix ✅
- **Issue**: `ts_event` was undefined because it's inside `hd` (header) object
- **Fixed**: Now checks `record.hd?.ts_event || record.ts_event || record.ts_recv`
- **Price scaling**: Detects fixed-point (1e9 scale) vs raw prices dynamically

### 7. Autonomy Loops & Cron Jobs ✅
- **Added cron jobs for**:
  - `evolution-engine` (every 5 min)
  - `capital-allocator` (every 5 min)
  - `priority-compute` (every 5 min)
  - `bqs-compute` (every 5 min)
  - `job-processor` (every minute)
  - `backtest-matrix-runner` auto-schedule and process (every 5 min)
- **Active loops**: autonomy-watchdog, backtest-scheduler, job-dispatcher, job-watchdog, promotion-engine

### 8. Matrix Backtest System ✅
- **Fixed**: Matrix cells now properly sync with backtest_sessions
- **Fixed**: Instrument extraction from `strategy_config->>'instrument'`
- **Fixed**: Pending cell processing with rate limit handling
- **Status**: 4 completed, 83 pending (processing), 2 running, 1 failed

## CRON JOBS STATUS (All Active)

| Job Name | Schedule | Description |
|----------|----------|-------------|
| autonomy-watchdog-every-minute | * * * * * | System health monitoring |
| backtest-scheduler-dblocal | */5 * * * * | Schedule backtests for LAB bots |
| bqs-compute-5m | */5 * * * * | Bot Quality Score computation |
| capital-allocator-5m | */5 * * * * | Capital allocation by priority |
| evolution-engine-5m | */5 * * * * | Bot evolution and mutations |
| job-dispatcher-dblocal | * * * * * | Job queue dispatch |
| job-processor-edge | * * * * * | Process queued jobs |
| job-watchdog-dblocal | * * * * * | Detect stalled jobs |
| kill-engine-every-2min | */2 * * * * | Emergency kill switches |
| matrix-auto-schedule-5m | */5 * * * * | Auto-schedule matrix runs |
| matrix-process-runner-5m | */5 * * * * | Process matrix cells |
| priority-compute-5m | */5 * * * * | Priority score computation |
| promotion-engine-5m | */5 * * * * | Automatic promotions |

## ACCEPTANCE CHECKLIST

| Requirement | Status |
|-------------|--------|
| No REST for critical /bots data | ✅ PASS |
| No N+1 queries on main list | ✅ PASS |
| One backend contract per page | ✅ PASS |
| Metrics traceable to DB | ✅ PASS |
| Non-critical systems non-blocking | ✅ PASS (2FA 5s timeout) |
| Explicit units | ✅ PASS |
| Latest-session vs aggregate explicit | ✅ PASS |
| bot_jobs indexes created | ✅ PASS |
| Autonomy loops cron jobs | ✅ PASS |
| Matrix backtest processing | ✅ PASS |

## SYSTEM HEALTH

- **Job Processing**: 5742 completed, 10 queued, 1 running in last 24h
- **Matrix Cells**: 4 completed, ~83 pending (processing via rate-limited Databento)
- **Priority Scores**: All 20 bots scored and assigned buckets
