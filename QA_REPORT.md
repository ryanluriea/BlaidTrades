# BlaidAgent QA Report

**Date:** 2025-12-12  
**Status:** ✅ READY FOR TESTING

---

## 1. Structural Verification

### 1.1 Database Tables (23 total) ✅

| Table | Status | Notes |
|-------|--------|-------|
| profiles | ✅ | User profiles (linked to auth.users) |
| user_roles | ✅ | Admin/user roles |
| bots | ✅ | Core bot definitions |
| bot_generations | ✅ | Evolution history |
| bot_instances | ✅ | Runtime instances with mode column |
| bot_snapshots | ✅ | Export/import data |
| bot_stall_events | ✅ | Stall detection |
| bot_tests | ✅ | Health tests |
| accounts | ✅ | Trading accounts with risk_tier, supports VIRTUAL/SIM/LIVE types |
| instrument_registry | ✅ | 6 instruments (ES, MES, NQ, MNQ, CL, GC) |
| backtest_sessions | ✅ | Historical tests |
| trade_logs | ✅ | Closed/open trades |
| orders | ✅ | Order management |
| execution_fills | ✅ | Fill records |
| signals | ✅ | Trading signals |
| bias_feed_events | ✅ | Bias visualization |
| system_events | ✅ | Logging |
| data_provider_status | ✅ | Provider health |
| ai_ops_briefings | ✅ | Morning/Night reports |
| app_settings | ✅ | Prompts and config |
| strategy_archetypes | ✅ | 8 archetypes |
| portfolio_allocations | ✅ | Rebalancing |
| promotion_logs | ✅ | Promotion history |

### 1.2 Frontend Routes (7 required) ✅

| Route | Status | Content |
|-------|--------|---------|
| /dashboard | ✅ | Stats, active bots, briefings |
| /bots | ✅ | Bot list, create, detail pages |
| /backtests | ✅ | Backtest list, run, detail |
| /accounts | ✅ | Account list, detail with equity |
| /training | ✅ | Evolution ladder, graduation |
| /system-status | ✅ | 7 tabs (Sources, Events, Signals, Costs, Self-Healing, Bot Tests, AI Ops) |
| /settings | ✅ | 7 tabs (General, Data, Brokers, Risk, Labs, Appearance, Prompts) |

### 1.3 Edge Functions (15 total) ✅

| Function | Status | Purpose |
|----------|--------|---------|
| health | ✅ | DB/table health checks |
| create-starter-bots | ✅ | 5 starter bots |
| run-backtest | ✅ | Backtest execution (uses contract_size) |
| sim-execute-order | ✅ | SIM/SHADOW order execution |
| promote-bot | ✅ | Promotion with criteria |
| graduation-evaluate | ✅ | Bulk graduation |
| evolution-engine | ✅ | Bot evolution |
| rebalance-portfolio | ✅ | Portfolio rebalancing |
| generate-ai-briefing | ✅ | Morning/Night reports |
| pnl-calculator | ✅ | Accurate PnL calculation |
| bot-snapshot-export | ✅ | Botpack export |
| bot-snapshot-import | ✅ | Botpack import |
| trades-reconcile | ✅ | Order/fill/trade reconciliation |
| broker-ironbeam | ✅ | Broker stub |
| broker-tradovate | ✅ | Broker stub |

---

## 2. Critical Bugs Fixed

### 2.1 PnL Calculation Bug ✅ FIXED
**Issue:** PnL was calculated as `price_diff * quantity` instead of `price_diff * contract_size * quantity`  
**Fixed in:** `sim-execute-order`, `run-backtest`  
**Formula now:** 
- LONG: `(exit_price - entry_price) * contract_size * quantity - fees`
- SHORT: `(entry_price - exit_price) * contract_size * quantity - fees`

### 2.2 Mode Support Bug ✅ FIXED
**Issue:** sim-execute-order only supported SIM_LIVE mode  
**Fixed:** Now supports both SIM_LIVE and SHADOW modes

### 2.3 Starter Bots Count ✅ FIXED
**Issue:** Only 4 starter bots, spec requires 5  
**Fixed:** Added Microtrend Flow bot

### 2.4 Missing Bias Events ✅ FIXED
**Issue:** Starter bots created without sample bias events  
**Fixed:** Now creates 3 sample bias events per bot

---

## 3. Mode Verification

### Mode State Machine ✅
```
BACKTEST_ONLY → SIM_LIVE → SHADOW → LIVE
```

### Mode Separation ✅
- `bot_instances.mode` stores instance mode
- `trade_logs` linked via `bot_instance_id`
- Queries can filter by joining to bot_instances
- SIM and SHADOW use sim engine (never call real brokers)
- LIVE routes to broker adapters (stubs ready)

---

## 4. Promotion Criteria ✅

| Target Mode | Min Trades | Win Rate | Profit Factor | Max DD | Expectancy |
|-------------|------------|----------|---------------|--------|------------|
| SIM_LIVE | 20 | 45% | 1.1 | 15% | $10 |
| SHADOW | 50 | 48% | 1.2 | 12% | $15 |
| LIVE | 100 | 50% | 1.3 | 10% | $20 |

- LIVE requires manual approval unless force=true
- All promotions logged to `promotion_logs` and `system_events`

---

## 5. Strategy Archetypes (8) ✅

1. Trend Follower
2. Mean Reversion
3. ORB Breakout
4. VWAP Bias
5. Microtrend Flow
6. Regime Switching
7. Hybrid Trend-Volume
8. Breakout Retest

---

## 6. Starter BotPack (5 bots) ✅

1. TrendFollower ES
2. MeanReversion NQ
3. ORB Breakout
4. VWAP Bias Scalper
5. Microtrend Flow

Each bot includes:
- strategy_config and risk_config
- Initial generation
- Sample bias_feed_events

---

## 7. Prompts Stored in app_settings ✅

| Prompt Key | Purpose |
|------------|---------|
| starter_pack_prompt | Bot generation guidance |
| evolution_prompt | Evolution/mutation logic |
| graduation_prompt | Graduation criteria |
| rebalancer_prompt | Portfolio rebalancing rules |
| risk_tiers_prompt | Risk tier definitions |
| readiness_test_prompt | Trading readiness checks |

---

## 8. Scheduled Jobs (pg_cron) ✅

| Job | Schedule | Function |
|-----|----------|----------|
| Morning Briefing | 8:30 AM ET weekdays | generate-ai-briefing |
| Night Report | 6:00 PM ET weekdays | generate-ai-briefing |
| Graduation Eval | 10:00 PM ET daily | graduation-evaluate |

---

## 9. Security ✅

- All tables have RLS policies
- User data isolated by `user_id`
- Auth required for all protected routes
- Broker credentials stored securely
- 1 minor warning: Leaked password protection disabled (optional)

---

## 10. Known Limitations (Non-Blockers)

1. **Broker Adapters**: Ironbeam/Tradovate are stubs - require real API integration for LIVE trading
2. **Data Providers**: Databento/Polygon not integrated - uses simulated price data
3. **Session Isolation Tests**: Need user to run manual tests with multiple backtests
4. **Users Table**: Uses Supabase auth.users + profiles table (as designed)

---

## 11. Test Checklist

To fully validate, user should:

- [ ] Create account and login
- [ ] Click "Get Starter BotPack" on dashboard
- [ ] Verify 5 bots created with bias events
- [ ] Run backtest on at least one bot
- [ ] Check backtest detail shows equity curve
- [ ] Try to promote bot (should fail without enough trades)
- [ ] Check System Status > AI Ops > Generate Morning Brief
- [ ] Export a bot as botpack
- [ ] Import the botpack as new bot
- [ ] Run trade reconciliation in System Status

---

## 12. Accounts Module (Enhanced)

### 12.1 Account Types ✅
| Type | Description |
|------|-------------|
| VIRTUAL | Fully internal sandbox for testing, tournaments, multi-bot simulation |
| SIM | Paper trading accounts for realistic simulation |
| LIVE | Broker-connected accounts (Ironbeam/Tradovate) |

### 12.2 Bot ↔ Account Linking ✅
- Multiple bots can share the same account via `bot_instances`
- Each `bot_instance` links: bot_id, account_id, mode, status
- PnL is computed at account level from trade_logs filtered by account_id
- Bot-level PnL = trades filtered by bot_instance_id
- Risk limits enforced at account level

### 12.3 Accounts UI ✅
- `/accounts` shows table with: name, type, provider, risk tier, balances, max drawdown, P&L, linked bots count
- `/accounts/:id` shows: stats, today PnL, linked bots tab, open positions, trade history, equity curve, risk profile
- Create Account dialog supports VIRTUAL/SIM/LIVE types with risk tier selection
- Attach bot dialog allows attaching bots to VIRTUAL or SIM accounts

---

## 13. Conclusion

**BlaidAgent is READY for user testing.** All 7 routes, 15 edge functions, 23 tables, 8 archetypes, and 5 starter bots are implemented. Critical PnL calculation bug has been fixed to use contract_size from instrument_registry.

The system correctly implements:
- BACKTEST/SIM/SHADOW/LIVE mode separation
- VIRTUAL/SIM/LIVE account types with bot↔account linking
- Multiple bots can share a single virtual account
- Promotion criteria with logging
- Evolution and graduation engines
- Portfolio rebalancing
- AI Ops briefings
- Botpack export/import
- Trade reconciliation

**Next Steps:**
1. User testing with real workflow
2. Wire up real broker APIs when ready for LIVE trading
3. Integrate real data providers (Databento/Polygon)
