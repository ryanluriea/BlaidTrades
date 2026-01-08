# BlaidAgent Repository Ownership

## Source of Truth

| Environment | Role |
|-------------|------|
| **GitHub** | Canonical source of truth for all code |
| **Replit** | Primary development + runtime environment |
| **Lovable** | UI-generation only (component scaffolding) |

## Editing Rules

### Replit + Human Review Only
These files/directories can ONLY be modified through Replit or direct human review:
- `server/**` - All backend routes, storage, auth
- `shared/**` - Database schemas, types, shared logic
- `packages/core/**` - Risk engine, PnL calculations, fills logic
- `workers/**` - Bot runners, backtests, schedulers
- Database migrations and schemas
- Environment handling, auth, security, secrets
- Any trading/financial calculation logic

### Lovable UI-Only Allowed
Lovable may ONLY change these paths:
- `client/src/components/**` - UI components
- `client/src/pages/**` - UI-only page layouts
- `client/src/styles/**` - Styling
- `client/src/lib/utils.ts` - UI utilities only

### Lovable NEVER Changes
- `server/**` - Backend routes and logic
- `shared/schema.ts` - Database schema
- `client/src/hooks/**` - Data fetching hooks (contain business logic)
- `client/src/lib/queryClient.ts` - API client configuration
- Any file with trading/financial calculations
- Any "fake/mock price" fallback behavior

## Merge Rules

1. All Lovable changes must land via `ui-lovable` branch
2. PRs from `ui-lovable` must pass UI guard checks
3. Backend changes require human review on `dev` or `main`
4. Never merge UI changes that touch backend files

## Critical Business Rules

1. **No Fake Data**: Never fabricate prices, fills, PnL, timestamps, or trades
2. **Fail Closed**: If provider data is missing, mark as DEGRADED/BLOCKED - never invent values
3. **Single Source of Truth**: PnL, equity, positions derived from canonical ledger only
4. **No Silent Failures**: All errors must be logged, surfaced to UI, and written to audit trail
5. **Test Data Isolation**: Trades with `is_invalid=true` or `source_type='TEST'` never affect live metrics

## Data Source of Truth

### PnL Calculations
- **Authoritative Source**: Backend `live_pnl` and `session_pnl_usd` fields in bot records
- **Frontend Display Only**: Components should display backend-provided PnL values
- **Frontend Computation Allowed**: Only for visualization (equity curves, charts) - never for authoritative display
- **Never Duplicate**: Do not recalculate PnL on frontend when backend provides it

### Trade Data
- **Filter Required**: All trade queries MUST filter `is_invalid=false` AND `source_type != 'TEST'`
- **Database Columns**: `trade_logs.is_invalid` and `trade_logs.source_type` exist for this purpose
- **Violation Impact**: Test trades polluting live metrics = Sev-1 incident

### Job Staleness
- **Timeout Rule**: Jobs RUNNING > 30 minutes without heartbeat should be marked FAILED
- **Schema Support**: `bot_jobs.last_heartbeat_at` and `bot_jobs.updated_at` available
- **UI Requirement**: Stale/stuck jobs must show warning banner

## Environment Setup

1. Copy `.env.example` to `.env` (never commit `.env`)
2. Add secrets via Replit Secrets panel
3. Run `npm run preflight` to validate environment
4. Run `npm run dev` to start development server
