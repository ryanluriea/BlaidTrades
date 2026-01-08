# Strategy Lab Autonomy Contract

This document defines the invariants, SLAs, and behaviors that must hold true for Strategy Lab to operate correctly.

## Invariants

### 1. Session Progress
- A RUNNING session must either progress or emit a blocker code within **2 minutes**
- No session can remain in RUNNING status without activity for more than 2 minutes
- `last_activity_at` must be updated on every task completion

### 2. Task SLAs
| Task Type | Max Duration | Heartbeat | Max Attempts |
|-----------|--------------|-----------|--------------|
| DISCOVER_UNIVERSE | 60s | N/A | 3 |
| OPEN_WEB_RESEARCH | 180s | N/A | 3 |
| CLOSED_WORLD_SYNTHESIS | 120s | N/A | 3 |
| STRATEGY_DESIGN | 120s | N/A | 3 |
| PARAMETERIZATION | 90s | N/A | 3 |
| VALIDATION_PLAN | 60s | N/A | 3 |
| BACKTEST_SUBMIT | 60s | N/A | 3 |
| RESULTS_ANALYSIS | 120s | N/A | 3 |
| REGIME_BREAKDOWN | 180s | N/A | 3 |
| RISK_MODELING | 90s | N/A | 3 |
| EXPORT_STRATEGY | 30s | N/A | 3 |

### 3. Watchdog Behavior
- Tasks RUNNING beyond SLA × 2 are automatically requeued
- `attempts` counter is incremented on each requeue
- `error_code = STUCK_TASK_REQUEUED` is set
- Exponential backoff applied via `locked_until`
- Tasks exceeding max attempts are marked FAILED with `error_code = TASK_DEAD_LETTERED`

### 4. Cost Logging
- **100% of LLM calls must log costs**
- Every `strategy_lab_cost_events` row must include:
  - `session_id`
  - `task_id`
  - `provider`
  - `model`
  - `purpose`
  - `tokens_in`, `tokens_out`
  - `cost_usd`
  - `latency_ms`

### 5. Citation Tracking
- All OPEN_WEB_RESEARCH tasks must store citations/URLs
- `strategy_lab_sources` must be populated with:
  - `source_type`
  - `title`
  - `url` (when applicable)
  - `reliability_score`
  - `excerpt_json`

### 6. Export Reproducibility
- Every exported strategy must have:
  - Complete `ruleset` JSON
  - `risk_model` template
  - `regime_profile` if applicable
  - Audit trail linking to source session/candidate

## Status Machine

```
Session States:
DRAFT → RUNNING → PAUSED → RUNNING → COMPLETED
                ↓
              FAILED

Task States:
QUEUED → RUNNING → SUCCEEDED
                 → FAILED
                 → CANCELED
```

## Play/Pause Semantics

### PLAY
1. Set session status = RUNNING
2. Set `started_at` if null
3. Queue initial DISCOVER_UNIVERSE task if no tasks exist
4. Update `last_activity_at`

### PAUSE
1. Set session status = PAUSED
2. Set `paused_at` = now()
3. Cancel all QUEUED tasks (not RUNNING)
4. Running tasks complete naturally

## Regression Checklist

Run before each deploy:

- [ ] No session stuck in RUNNING > 2 minutes without activity
- [ ] No task stuck in RUNNING > SLA × 2
- [ ] All cost events have non-null `cost_usd`
- [ ] All OPEN_WEB_RESEARCH tasks have sources
- [ ] All exported candidates have complete `ruleset`
- [ ] Dispatcher runs every minute
- [ ] Watchdog runs every minute
- [ ] Provider fallbacks work correctly
- [ ] UI shows real-time progress updates

## Error Codes

| Code | Meaning | Remediation |
|------|---------|-------------|
| STUCK_TASK_REQUEUED | Task exceeded SLA, requeued | Automatic retry |
| TASK_DEAD_LETTERED | Max attempts exceeded | Manual review required |
| WORKER_ERROR | Worker crashed | Check logs, retry |
| AI_CALL_FAILED | LLM API error | Check provider status |
| NO_CANDIDATES | No candidates to process | Check synthesis step |
| EXPORT_FAILED | Export to LAB failed | Check bot creation |

## Monitoring Metrics

- `strategy_lab_sessions.status` distribution
- `strategy_lab_tasks.status` distribution
- Average task latency by type
- Cost per session
- Stuck task count (RUNNING > SLA × 2)
- Dead letter queue depth
- Provider fallback rate
