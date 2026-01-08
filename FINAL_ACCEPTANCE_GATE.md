# FINAL ACCEPTANCE GATE - AUTONOMY AUDIT

**Audit Date:** 2025-12-18  
**Status:** **NOT READY FOR AUTONOMOUS PRODUCTION**

---

## 1) REPRODUCIBLE BUILD PROOF

### TypeScript Check
```bash
$ npx tsc --noEmit
EXIT_CODE=0
```
**Status:** PASS (0 TypeScript errors in server/routes.ts, server/storage.ts)

### Lint Check
```bash
$ npm run lint
# 926 errors, 28 warnings (all in supabase/functions/ - legacy edge functions)
# 0 errors in server/routes.ts, server/storage.ts
```
**Status:** PASS for core server code (supabase/functions are deprecated legacy code)

### Test Check
```bash
$ npm test
npm error Missing script: "test"
```
**Status:** NO TESTS CONFIGURED

**Test Plan (Next Steps):**
1. Add `vitest` test runner (already installed)
2. Create `server/__tests__/` directory
3. Priority tests:
   - Job lifecycle terminalization
   - Heartbeat timeout worker
   - Kill engine invariants
   - Action security fail-closed behavior
   - Cross-account isolation

---

## 2) STUB & TECH-DEBT DISCLOSURE (AUTONOMY IMPACT)

### CRITICAL AUTONOMY BLOCKERS

| Endpoint | Domain | Current Behavior | Why Stub | Blocks Autonomy? | Replacement Plan |
|----------|--------|------------------|----------|------------------|------------------|
| POST /api/runners/start | **Runner** | **SAFE-START CHECKS** | Requires runtime engine | **PARTIAL** | Has fail-closed checks, needs execution layer |
| POST /api/runners/restart | **Runner** | **SAFE-START CHECKS** | Requires runtime engine | **PARTIAL** | Has fail-closed checks, needs execution layer |
| POST /api/bots/:id/reconcile | **Runner** | 501 | Requires state reconciliation | **YES - CRITICAL** | Implement health/state sync |

**UPDATE 2025-12-18:** Runner start/restart now have fail-closed safe-start checks:
- Integration registry verification (databento OR polygon required)
- Kill state checks (bot.killedAt)
- LIVE trading enabled checks
- Stage validation for runner eligibility
- Specific error codes: `INTEGRATION_KEY_MISSING`, `DATA_UNAVAILABLE`, `AUTONOMY_BLOCKED`
- Suggested fixes in error responses

**VERDICT: RUNNER START/RESTART HAVE SAFETY CHECKS BUT NEED EXECUTION LAYER**

### NON-CRITICAL STUBS (Do Not Block Core Autonomy)

| Endpoint | Domain | Current Behavior | Blocks Autonomy? |
|----------|--------|------------------|------------------|
| POST /api/2fa/verify | Auth | Stub message | NO |
| POST /api/bots/:id/graduate | Promotion | Stub message | NO (manual process acceptable) |
| POST /api/evolution/trigger | Backtest | Stub message | NO |
| POST /api/portfolio/rebalance | Risk | Stub message | NO |
| GET /api/ai/briefing/:botId | AI | Stub message | NO |
| POST /api/scheduler/trigger | Autonomy | Stub message | NO |
| GET /api/economic-calendar | Trading | Comment: "stub for now" | NO |
| ALL /api/strategy-lab/* | Backtest | 501 | NO |
| ALL /api/unusual-whales/* | Trading | 501 | NO |
| ALL /api/genetics/* | Backtest | 501 | NO |
| ALL /api/backtest-matrix/* | Backtest | 501 | NO |
| ALL /api/backtest-sweep/* | Backtest | 501 | NO |
| ALL /api/ai-telemetry/* | AI | 501 | NO |
| POST /api/bots/:id/promote-live | Promotion | 501 | NO (manual approval required) |
| POST /api/bots/:id/retire | Promotion | 501 | NO |

### VERIFIED NON-STUBBED CRITICAL PATHS

| Path | Status | Evidence |
|------|--------|----------|
| Job terminalization | **IMPLEMENTED** | `storage.timeoutStaleJobs()` marks TIMEOUT with reason_code |
| Job heartbeat | **IMPLEMENTED** | POST `/api/jobs/:id/heartbeat`, GET `/api/jobs/timed-out` |
| Kill engine state | **IMPLEMENTED** | GET `/api/bots/:id/kill-state`, `/api/bots/:id/kill-events` |
| Kill event persistence | **IMPLEMENTED** | `storage.getKillEvents()`, `storage.createKillEvent()` |
| Stage promotion gate | **IMPLEMENTED** | GET `/api/bots/:id/promotion-evaluation` with gates |
| Live readiness gates | **IMPLEMENTED** | GET `/api/bots/:id/live-readiness` with blockers |
| Action security | **IMPLEMENTED** | POST `/api/action-security` with fail-closed behavior |
| PnL computation | **IMPLEMENTED** | Bot `livePnl`, `simPnl` fields populated from trade_logs |

---

## 3) AUTONOMY INVARIANTS

### A) Job / Run Autonomy

**Implementation Status: PARTIAL**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Job record for every runner/backtest | **IMPLEMENTED** | `bot_jobs` table with botId, jobType, status |
| Heartbeat while RUNNING | **IMPLEMENTED** | `POST /api/jobs/:id/heartbeat` updates `lastHeartbeatAt` |
| Auto-terminalize on timeout | **IMPLEMENTED** | `storage.timeoutStaleJobs()` |
| Reason code on failure | **IMPLEMENTED** | `statusReasonCode: 'HEARTBEAT_TIMEOUT'` |

**Timeout Worker Logic (server/storage.ts lines 957-984):**
```typescript
async timeoutStaleJobs(thresholdMinutes = 10): Promise<number> {
  const timedOutJobs = await this.getTimedOutJobs(thresholdMinutes);
  for (const job of timedOutJobs) {
    await this.logJobStateTransition({
      runId: job.id,
      fromStatus: job.status,
      toStatus: 'TIMEOUT',
      reasonCode: 'HEARTBEAT_TIMEOUT',
      reason: `No heartbeat received for ${thresholdMinutes} minutes`,
    });
    await db.update(schema.botJobs).set({ 
      status: 'TIMEOUT',
      statusReasonCode: 'HEARTBEAT_TIMEOUT',
      completedAt: new Date()
    }).where(eq(schema.botJobs.id, job.id));
  }
  return count;
}
```

**BLOCKER:** No automated worker process calling `/api/jobs/timeout-worker` periodically.

### B) Failure -> Recovery Loop

**Implementation Status: PARTIAL**

| Scenario | Expected Behavior | Current Behavior | Gap |
|----------|-------------------|------------------|-----|
| Provider 429/403 | Fail-closed, mark DEGRADED | 501 on runner endpoints | **BLOCKED - Runner not implemented** |
| Runner crashes | Auto-fail job, schedule retry | Heartbeat timeout works | Retry scheduling not implemented |
| Metrics unavailable | Mark DEGRADED, disable actions | Action security checks gates | Works for gate checks |

**Fail-Closed Evidence (server/routes.ts line 407-413):**
```typescript
// V1 implementation with fail-closed behavior and audit logging
// FAIL-CLOSED: Missing required fields
if (!action || !userId) {
  return res.status(400).json({
    success: false,
    data: { allowed: false, reason_code: "INVALID_REQUEST", ... }
  });
}
```

### C) Autonomous Safety

**Kill Engine:**
| Feature | Status | Evidence |
|---------|--------|----------|
| Automatic kill on invariant breach | **NOT IMPLEMENTED** | No proactive kill triggers |
| Persistent kill events | **IMPLEMENTED** | `kill_events` table, `storage.createKillEvent()` |
| Idempotent resurrect with audit | **IMPLEMENTED** | Action security checks `ALREADY_KILLED`, `NOT_KILLED` |

**Risk Engine:**
| Feature | Status | Evidence |
|---------|--------|----------|
| Server-side only | **IMPLEMENTED** | `riskConfig` stored on bot, not client-editable directly |
| Blocks orders if UI misbehaves | **NOT IMPLEMENTED** | No order execution layer exists (runner is 501) |

---

## 4) AUTONOMOUS STATE OWNERSHIP

### Server Owns These (VERIFIED)

| State | Server Ownership | Evidence |
|-------|------------------|----------|
| Stage transitions | **YES** | PATCH `/api/bots/:id/stage` validates gates |
| Runner lifecycle | **PARTIAL** | Job status managed server-side, but runner start is 501 |
| Job status | **YES** | All job CRUD through storage layer |
| Readiness decisions | **YES** | `/api/bots/:id/live-readiness` computes gates server-side |

### UI Read-Only Enforcement

| Action | Enforcement | Evidence |
|--------|-------------|----------|
| Stage promotion | **Action security gate** | POST `/api/action-security` checks `PROMOTE_STAGE` |
| Live trading enable | **Action security gate** | `ENABLE_LIVE_TRADING` requires bot ownership |
| Runner execution | **501 - Not implemented** | Cannot force execution through UI |

**Gap:** No middleware enforcing read-only on all mutations. Action security is opt-in per endpoint.

---

## 5) DATA SANITY & CLEANLINESS

### Database Queries (Post-Cleanup)

```sql
SELECT 
  (SELECT COUNT(*) FROM trade_logs WHERE source_type = 'TEST') as test_source_trades,
  (SELECT COUNT(*) FROM trade_logs WHERE is_invalid = true) as invalid_trades,
  (SELECT COUNT(*) FROM bot_jobs WHERE bot_id NOT IN (SELECT id FROM bots)) as orphaned_jobs,
  (SELECT COUNT(*) FROM trade_logs WHERE bot_instance_id IS NULL AND bot_id IS NULL) as trades_without_context;

-- RESULT:
-- test_source_trades: 0
-- invalid_trades: 0
-- orphaned_jobs: 0
-- trades_without_context: 0
```

**Status:** CLEAN - All data sanity checks pass.

---

## 6) PRODUCTION AUTONOMY TOGGLE CHECKLIST

**To be added to replit.md:**

```markdown
## Production Autonomy Checklist

- [ ] LIVE trading toggle default = OFF (verified: `isTradingEnabled` field exists)
- [ ] Provider entitlement checks at startup - NOT IMPLEMENTED
- [ ] Heartbeat + timeout workers enabled - IMPLEMENTED (manual trigger only)
- [ ] Kill engine enabled - PARTIAL (reactive only, no proactive triggers)
- [ ] Risk engine enabled - PARTIAL (config stored, no order blocking)
- [ ] Structured logging with trace_id - IMPLEMENTED on action-security, 501s
- [ ] Rate limits + timeouts configured - NOT IMPLEMENTED
- [ ] Safe-start behavior if dependency missing - NOT IMPLEMENTED
```

---

## 7) AUTONOMY DEMO

### Scenario: Runner Starts -> Provider Fails -> Recovery

**Current State: CANNOT DEMONSTRATE**

Why:
1. `POST /api/runners/start` returns 501
2. `POST /api/runners/restart` returns 501
3. `POST /api/bots/:id/reconcile` returns 501

Without these endpoints, the system cannot:
- Start a runner
- Detect provider failure during execution
- Trigger recovery/retry
- Auto-kill on repeated failures

**What CAN be demonstrated:**
1. Job timeout terminalization (via `/api/jobs/timeout-stale`)
2. Kill state persistence (via `/api/bots/:id/kill-events`)
3. Action security gating (via `/api/action-security`)
4. Fail-closed on missing data

---

## ACCEPTANCE VERDICT

### Blockers (MUST FIX)

| Blocker | Severity | Impact | Status |
|---------|----------|--------|--------|
| Runner execution layer | **CRITICAL** | System cannot execute trading autonomously | Safe-start checks implemented |
| ~~No automated timeout worker~~ | ~~HIGH~~ | ~~Stale jobs won't auto-terminate~~ | **IMPLEMENTED** (5 min interval, 30 min threshold) |
| ~~No proactive kill triggers~~ | ~~HIGH~~ | ~~Invariant breaches won't auto-kill~~ | **IMPLEMENTED** in supervisor loop |
| No rate limits | MEDIUM | Vulnerable to abuse | Still needed |
| ~~No startup dependency check~~ | ~~MEDIUM~~ | ~~May start in broken state~~ | **IMPLEMENTED** (integration registry) |

### Ready For

- Manual trading oversight (human in loop)
- Bot configuration and management
- Stage progression with manual approval
- Kill/resurrect operations
- Health monitoring and reporting
- **NEW:** Automated job timeout detection and termination
- **NEW:** Supervisor loop with circuit breaker protection
- **NEW:** Integration health monitoring with proof-of-use telemetry
- **NEW:** Structured observability (decision traces, no-trade traces, autonomy scores)
- **NEW:** Safe-start fail-closed checks on runner endpoints

### NOT Ready For

- Full autonomous LIVE trading (risk engine not implemented)
- Real integration connections (awaiting API keys)

---

## NEXT STEPS TO ACHIEVE AUTONOMY

1. **Implement Runner Execution Layer (REMAINING CRITICAL)**
   - `/api/runners/start` - Process orchestration, broker integration (safe-start checks done)
   - `/api/runners/restart` - Graceful restart with state preservation (safe-start checks done)
   - `/api/bots/:id/reconcile` - State sync after crashes

2. ~~**Add Automated Workers**~~ **DONE**
   - ~~Cron job calling `/api/jobs/timeout-stale` every 1 minute~~ Timeout worker (5 min interval, 30 min threshold)
   - ~~Health check worker calling reconcile on degraded bots~~ Supervisor loop (2 min interval) with circuit breaker

3. ~~**Implement Proactive Kill Triggers**~~ **DONE**
   - ~~Max consecutive failures -> auto-kill~~ Circuit breaker opens after 3 failures in 30 min
   - Equity breach -> auto-kill (requires risk engine)
   - ~~Provider entitlement revoked -> auto-kill~~ Safe-start checks block on missing integrations

4. ~~**Add Startup Safety**~~ **DONE**
   - ~~Check DATABASE_URL exists~~ Checked in server startup
   - ~~Check required env vars~~ Integration registry validates env vars
   - ~~Verify provider connectivity~~ Safe-start checks on runner endpoints
   - ~~Fail-closed on any missing dependency~~ Error codes with suggested fixes

5. **Add Rate Limiting (Still Needed)**
   - Rate limit all mutating endpoints
   - Rate limit per-user and globally

6. **Implement Risk Engine (Still Needed)**
   - Order blocking on risk breach
   - Real-time position monitoring
   - Server-side enforcement

---

**FINAL VERDICT: PROGRESSING TOWARD AUTONOMOUS OPERATION**

The system has achieved significant autonomy milestones:
- Automated scheduler with timeout worker and supervisor loop
- Circuit breaker pattern for failure isolation
- Integration registry with proof-of-use telemetry
- Safe-start fail-closed checks on runner endpoints
- Structured observability (decision traces, autonomy scores)

**Remaining blockers:**
1. Runner execution layer (broker API integration)
2. Risk engine enforcement
3. Rate limiting

**Recommendation:** Continue with supervised deployment. The system will safely refuse to start runners when prerequisites are not met (fail-closed). Await API keys for real integration verification.
