# /bots Page QA Audit Report
Generated: 2025-12-16

## A) DATABASE INTEGRITY TESTS

| Test | Result | Details |
|------|--------|---------|
| GENERATION_TRUTH | **FAIL** | 0/20 bots have correct current_generation_id. All point to gen 1-3 while max is 400-500+ |
| BACKTEST_TRUTH | PASS | 20/20 bots have valid latest completed session or null |
| UNIT_SANITY | PASS | 1,134 sessions - all max_drawdown_pct [0-100], max_drawdown_usd ≥0, win_rate [0-100] |
| ORPHAN_GENERATIONS | PASS | 0 orphan records |
| ORPHAN_BACKTESTS | PASS | 0 orphan records |
| ORPHAN_BOT_INSTANCES | PASS | 0 orphan records |

### Generation Truth Issue Detail
- All 20 bots have stale `current_generation_id` pointing to initial generations
- Example: Nova-Wave has current_gen=3 but max_gen=525
- Root cause: Evolution system creates generations but never updates `bots.current_generation_id`
- **Impact**: UI relies on `bots-list-sql` which fetches max generation directly, so display is correct
- **Fix required**: Update evolution-engine to set `current_generation_id` on new generations

## B) API PERFORMANCE

### Endpoint Status
| Endpoint | Status | Notes |
|----------|--------|-------|
| bots-list-sql | ✅ Working | 200 response, ~13s |
| bots-overview | ⚠️ Timeout | Statement timeout on bot_jobs query |

### bots-overview Issues
- Error: "PostgresError: canceling statement due to statement timeout"
- Error: "Cannot read properties of undefined (reading 'push')"
- bot_jobs table: 10,184 rows (all within last 7 days)

### Performance (bots-list-sql)
- Unable to run 50x test due to timeout issues
- Observed response: ~13 seconds for 20 bots

### Indexes Present (bot_jobs)
- `idx_bot_jobs_bot_id` ✅
- `idx_bot_jobs_bot_started` ✅
- `idx_bot_jobs_bot_started_created` ✅
- `idx_bot_jobs_queue_order` ✅
- `idx_bot_jobs_status_created` ✅

## C) FRONTEND NETWORK AUDIT

### Request Analysis
| Request Type | Count | Status |
|--------------|-------|--------|
| bots-list-sql (edge function) | 1 | ✅ 200 |
| PostgREST /rest/v1/* | 2 | ⚠️ 503 (transient PGRST002) |
| bots-overview | 0 | Not called (timeout issues) |

### Findings
- ✅ Primary data from single `bots-list-sql` call
- ⚠️ Some PostgREST calls still happening (user_table_prefs, bots health check)
- ⚠️ PGRST002 schema cache errors (transient, self-healing)
- ✅ No per-bot REST calls observed for core data

## D) MANUAL SMOKE CHECKLIST

| Test | Result |
|------|--------|
| Hard refresh 20x | ⚠️ Some 503 errors, recovers with retry |
| Tab switching | ✅ Works when data loads |
| Drawer expansion | ✅ No network storms |
| 2FA blocking | ✅ Non-blocking (5s timeout) |

## E) CRON JOBS STATUS

### Current State: ALL ACTIVE (12 jobs)

| Job Name | Schedule | Active |
|----------|----------|--------|
| bqs-compute-periodic | */30 9-16 * * 1-5 | ✅ |
| daily-bot-snapshots | 0 2 * * * | ✅ |
| daily-production-scorecard | 0 6 * * * | ✅ |
| graduation-evaluation-daily | 0 3 * * 2-6 | ✅ |
| morning-briefing-weekdays | 30 13 * * 1-5 | ✅ |
| night-report-weekdays | 0 23 * * 1-5 | ✅ |
| production-scorecard-daily | 0 6 * * * | ✅ |
| readiness-audit-daily-8am | 55 13 * * * | ✅ |
| tournament-daily-major | 0 4 * * * | ✅ |
| tournament-incremental | 0 */2 * * * | ✅ |
| weekly-archetype-certification | 0 6 * * 0 | ✅ |
| weekly-chaos-test | 0 3 * * 0 | ✅ |

**Note**: Contrary to docs/CRON_JOBS_PAUSED.md, all cron jobs are currently ACTIVE.

---

## SUMMARY

### Blocking Issues
1. **GENERATION_TRUTH FAIL** - Data integrity issue (cosmetic, UI works around it)
2. **bots-overview timeout** - Edge function times out on large bot_jobs table

### Non-Blocking Issues
1. Transient PGRST002 errors (self-healing)
2. Cron jobs active (monitor for stability)

### Recommended Actions
1. Fix evolution-engine to update `bots.current_generation_id`
2. Add index for bot_jobs query: `CREATE INDEX idx_bot_jobs_bot_created ON bot_jobs(bot_id, created_at DESC)`
3. Monitor cron job execution for errors
