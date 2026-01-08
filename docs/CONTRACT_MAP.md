# BlaidAgent Contract Map - Single Source of Truth

**Version**: 1.0  
**Generated**: 2025-12-16  
**Purpose**: Document authoritative data sources, response contracts, and field mappings

---

## A) GLOBAL ROUTE INVENTORY

### Route: `/bots` (Main Landing Page)
| Property | Value |
|----------|-------|
| **Primary Endpoint** | `bots-overview` (edge function) |
| **Tables Touched** | `bots`, `backtest_sessions`, `bot_generations`, `bot_instances`, `bot_jobs`, `bot_improvement_state` |
| **Request Type** | Single batched POST (NO per-row queries) |
| **Latency Budget** | p50: 400ms, p95: 1000ms (cold), p95: 400ms (warm cache) |
| **Can Block Render** | Yes (shows loading skeleton) |
| **Cache TTL** | 15s fresh, 60s stale-while-revalidate |

### Route: `/bots/:id` (Bot Detail)
| Property | Value |
|----------|-------|
| **Primary Endpoint** | `bot-history`, direct PostgREST to `bots`, `bot_generations` |
| **Tables Touched** | `bots`, `bot_generations`, `backtest_sessions`, `bot_instances`, `trade_logs` |
| **Latency Budget** | p50: 500ms, p95: 1200ms |
| **Can Block Render** | Yes |

### Route: `/training` / `/backtests` (Autonomy)
| Property | Value |
|----------|-------|
| **Primary Endpoints** | `backtest_sessions` (PostgREST), `bot_jobs` (PostgREST) |
| **Tables Touched** | `backtest_sessions`, `bot_jobs`, `scheduler_state` |
| **Latency Budget** | p50: 600ms, p95: 1200ms |

### Route: `/accounts` 
| Property | Value |
|----------|-------|
| **Primary Endpoint** | `accounts` (PostgREST) + `bot_instances` (batched) |
| **Tables Touched** | `accounts`, `bot_instances`, `trade_logs` |
| **Latency Budget** | p50: 400ms, p95: 1000ms |

### Route: `/system-status`
| Property | Value |
|----------|-------|
| **Primary Endpoints** | `system_events`, `integrations`, `data_provider_status` |
| **Tables Touched** | `system_events`, `integrations`, `data_provider_status`, `alerts` |
| **Latency Budget** | p50: 500ms, p95: 1000ms |

### Route: `/settings`
| Property | Value |
|----------|-------|
| **Primary Endpoint** | `app_settings` (PostgREST) |
| **Tables Touched** | `app_settings` |
| **Latency Budget** | p50: 200ms, p95: 500ms |

---

## B) BOTS-OVERVIEW RESPONSE CONTRACT

### Request
```typescript
POST /functions/v1/bots-overview
Headers: Authorization: Bearer <token>
Query Params: ?limit=50&offset=0
```

### Response Schema
```typescript
interface BotsOverviewResponse {
  success: boolean;
  data: {
    bots: BotOverview[];
    perBot: Record<string, PerBotData>;
    alertsCount: number;
    integrationsSummary: IntegrationsSummary;
    generatedAt: string;  // ISO timestamp
    version: string;      // "v7"
    source: "db" | "cache" | "stale";
  };
}
```

### Field Mapping: UI → API → DB

| UI Field | API Field | DB Source | Policy | Unit |
|----------|-----------|-----------|--------|------|
| Generation Badge | `generation` | `MAX(bot_generations.generation_number) WHERE bot_id=?` | Latest by number | Integer |
| Trades Count | `session_trades` | `backtest_sessions.total_trades` | Latest COMPLETED session | Integer |
| Win Rate | `session_win_rate_pct` | `backtest_sessions.win_rate` | Latest COMPLETED session | Percent (0-100) |
| Max DD (%) | `session_max_dd_pct` | `backtest_sessions.max_drawdown_pct` | Latest COMPLETED session | Percent |
| Max DD ($) | `session_max_dd_usd` | `backtest_sessions.max_drawdown` | Latest COMPLETED session | USD |
| Profit Factor | `session_profit_factor` | `backtest_sessions.profit_factor` | Latest COMPLETED session | Ratio |
| Sharpe | `session_sharpe` | `backtest_sessions.sharpe_ratio` | Latest COMPLETED session | Number (null → "—") |
| Backtests Count | `backtests_completed` | `COUNT(*) FROM backtest_sessions WHERE status='completed'` | Aggregate | Integer |
| BQS Score | `bqs_latest` | `bots.bqs_latest` | Stored aggregate | 0-100 |
| Priority Score | `priority_score` | `bots.priority_score` | Stored aggregate | 0-100 |
| Health State | `health_state` | `bots.health_state` | Stored state | OK/WARN/DEGRADED |

### perBot Field Mapping

| UI Field | API Field | DB Source |
|----------|-----------|-----------|
| Runner Status | `instanceStatus.status` | `bot_instances.status WHERE is_primary_runner=true` |
| Activity State | `instanceStatus.activityState` | `bot_instances.activity_state` |
| Last Heartbeat | `instanceStatus.lastHeartbeatAt` | `bot_instances.last_heartbeat_at` |
| Account Name | `instanceStatus.accountName` | `accounts.name` (joined) |
| Backtest Jobs Running | `jobs.backtestRunning` | `COUNT(bot_jobs WHERE job_type='BACKTEST' AND status='RUNNING')` |
| Evolve Jobs Running | `jobs.evolveRunning` | `COUNT(bot_jobs WHERE job_type='EVOLVE' AND status='RUNNING')` |
| Evolve Started At | `jobs.evolveStartedAt` | `MIN(bot_jobs.started_at WHERE job_type='EVOLVE' AND status='RUNNING')` |
| Improvement Status | `improvementState.status` | `bot_improvement_state.status` |
| Attempts Used | `improvementState.attemptsUsed` | `bot_improvement_state.attempts_used` |
| Last Improvement | `improvementState.lastImprovementAt` | `bot_improvement_state.last_improvement_at` |
| Why Not Promoted | `improvementState.whyNotPromoted` | `bot_improvement_state.why_not_promoted` |

---

## C) SOURCE-OF-TRUTH RULES

### Rule 1: LAB Bot Metrics
**Policy**: Metrics for LAB bots come from the **LATEST COMPLETED** `backtest_sessions` row (ordered by `completed_at DESC`), NOT from aggregated `bots.*` columns.

```sql
-- AUTHORITATIVE: Latest session metrics
SELECT total_trades, win_rate, max_drawdown_pct, profit_factor, sharpe_ratio
FROM backtest_sessions
WHERE bot_id = ? AND status = 'completed'
ORDER BY completed_at DESC NULLS LAST
LIMIT 1;
```

### Rule 2: Generation Number
**Policy**: UI shows `MAX(generation_number)` from `bot_generations`, NOT `bots.current_generation_id` (which may be stale).

```sql
-- AUTHORITATIVE: Max generation
SELECT MAX(generation_number) as generation
FROM bot_generations
WHERE bot_id = ?;
```

### Rule 3: Backtest Count
**Policy**: Count of **completed** sessions only.

```sql
-- AUTHORITATIVE: Completed count
SELECT COUNT(*) as backtests_completed
FROM backtest_sessions
WHERE bot_id = ? AND status = 'completed';
```

### Rule 4: Units Convention
| Field | Unit | Display Rule |
|-------|------|--------------|
| `win_rate` | Percent (0-100) | Show as "45.2%" |
| `max_drawdown_pct` | Percent | Show as "5.3%" |
| `max_drawdown` | USD | Show as "$1,234" |
| `sharpe_ratio` | Float | If null, show "—" not "0.0" |
| `profit_factor` | Ratio | If null or 0, show "—" |

---

## D) INVARIANTS (Must Be True)

1. **No N+1 Queries**: `/bots` list uses exactly ONE primary data request
2. **Provenance Attached**: Every metric includes `metrics_source` and `metrics_asof`
3. **Cache Headers Present**: All edge functions return `x-request-id`, `x-duration-ms`, `x-cache`
4. **Null Display**: Null numeric values show "—", never "0" or "0.0"
5. **Generation Correctness**: Displayed generation = MAX(generation_number) in DB
6. **Backtest Count Correctness**: Displayed count = COUNT(completed sessions)

---

## E) PERFORMANCE BUDGETS

| Route | Cold p50 | Cold p95 | Warm p50 | Warm p95 |
|-------|----------|----------|----------|----------|
| `/bots` | 600ms | 1000ms | 150ms | 400ms |
| `/bots/:id` | 500ms | 1200ms | 200ms | 600ms |
| `/training` | 600ms | 1200ms | 200ms | 600ms |
| `/accounts` | 400ms | 1000ms | 150ms | 400ms |
| `/system-status` | 500ms | 1000ms | 150ms | 400ms |
| `/settings` | 200ms | 500ms | 100ms | 200ms |

---

## F) RESPONSE HEADERS CONTRACT

All edge functions MUST return:
```
x-request-id: <uuid>      // For correlation
x-duration-ms: <number>   // Total processing time
x-db-ms: <number>         // Database query time (optional)
x-cache: HIT|MISS|STALE   // Cache status
x-row-count: <number>     // Rows returned (optional)
```
