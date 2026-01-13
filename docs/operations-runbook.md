# BlaidTrades Operations Runbook

## Quick Reference

### Health Check Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/healthz` | Liveness probe | `200 OK` |
| `/readyz` | Readiness probe (DB/Redis) | `200` with dependencies status |
| `/api/health` | Detailed health with memory stats | JSON with memory, uptime, build info |
| `/api/version` | Build info | JSON with version, buildSha, environment |
| `/api/system/quick-health` | UI health panel data | JSON with DB/Redis/cache status and self-healing info |
| `POST /api/system/heal-cache` | Manual cache clear (requires auth) | Clears all bots-overview cache entries |

### Key Metrics (Logged Every 60 Seconds)

Look for `[METRICS]` log lines:
```
[METRICS] http_requests=1234 http_errors=5 cache_hits=89 cache_misses=11 hit_rate=89.00% active_bots=15 backtests_running=2
```

### Critical Log Prefixes

| Prefix | Meaning | Action |
|--------|---------|--------|
| `[BOTS_CACHE]` | Redis cache operations | Check Redis connectivity |
| `[bots-overview]` | Main dashboard endpoint | Check for CACHE_HIT/CACHE_MISS |
| `[BACKTEST_EXECUTOR]` | Backtest operations | Monitor for errors |
| `[LIVE_DATA_SERVICE]` | Market data feed | Check Databento connection |
| `[AUTONOMY_LOOP]` | Autonomous operations | Review decisions |

## Troubleshooting

### Dashboard Not Loading (bots-overview slow)

1. Check cache status:
   ```
   grep "CACHE_HIT\|CACHE_MISS" logs
   ```
   - High CACHE_MISS = Redis issue or cold start

2. Check Redis connectivity:
   - Hit `/readyz` endpoint
   - Look for `redis: { ok: false }` in response

3. Check database latency:
   - Look for `dbLatencyMs` in `/readyz` response
   - > 100ms indicates DB pressure

### High Error Rate

1. Check metrics log:
   ```
   grep "\[METRICS\]" logs | tail -5
   ```
   - Compare `http_errors` over time

2. Check for specific errors:
   ```
   grep "SEV-1\|SEV-0\|ERROR" logs
   ```

### Cache Not Working

1. Verify Redis is configured:
   - Check `REDIS_URL` environment variable
   - Hit `/readyz` and verify `redis.ok: true`

2. Check cache hit rate in metrics:
   - `hit_rate=0%` means cache is not being used
   - `hit_rate < 50%` suggests high churn or TTL issues

### Backtests Stuck

1. Check running backtests:
   ```
   grep "\[BACKTEST_EXECUTOR\].*starting" logs | tail -10
   ```

2. Look for completion:
   ```
   grep "\[BACKTEST_EXECUTOR\].*completed" logs | tail -10
   ```

3. Check for timeouts or errors:
   ```
   grep "\[BACKTEST_EXECUTOR\].*ERROR\|TIMEOUT" logs
   ```

## Render Health Checks

Configure in Render dashboard:
- **Health Check Path:** `/healthz`
- **Health Check Interval:** 30 seconds

## Performance Thresholds

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Cache hit rate | > 70% | 50-70% | < 50% |
| DB latency | < 50ms | 50-100ms | > 100ms |
| Redis latency | < 10ms | 10-50ms | > 50ms |
| Memory (heap) | < 1GB | 1-1.5GB | > 1.5GB |

## Correlation IDs

All requests include a correlation ID for tracing:
- Header: `x-correlation-id`
- Log format: `[correlationId=abc123]`

To trace a request through logs:
```
grep "correlationId=YOUR_ID" logs
```

## Self-Healing

The platform includes an automatic self-healing watchdog that:
- Monitors cache hit rate every 2 minutes
- Auto-clears cache when hit rate drops below 30% for 2 consecutive checks
- Logs all healing actions with `[HEALTH_WATCHDOG]` prefix

### Manual Cache Healing

If the dashboard is slow or showing stale data:
1. Click the Systems Status (CPU icon) in the header
2. Scroll to "Infrastructure Health" section
3. Click "Clear Cache" button

Or via API:
```bash
curl -X POST https://your-domain/api/system/heal-cache -H "Cookie: your-session-cookie"
```
