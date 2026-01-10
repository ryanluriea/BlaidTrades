# Trading Bot Platform

## Overview
This project is an algorithmic trading bot management platform for multi-stage bot lifecycle management (LAB → PAPER → SHADOW → CANARY → LIVE). It provides a robust, scalable, and institutional-grade solution for developing, testing, and deploying sophisticated trading strategies with autonomous operations, aiming for zero manual intervention.

## User Preferences
- I prefer dark mode trading terminal aesthetic.
- I like JetBrains Mono for code and Inter for UI.
- I prefer minimal rounded corners (terminal style).
- I want iterative development.
- Ask before making major changes.
- Backend/server, shared/schema, and hooks are allowed for SEV-1 stabilization and institutional audit features.
- Do not make changes to the `scripts/` or `.github/` folders.
- Do not make changes to any file with PnL/risk calculations.
- UI components and pages changes should go to `ui-lovable` branch.
- Backend, database schema, trading logic, and configuration changes should go to `dev` branch.

## System Architecture
The platform employs a modular monolith architecture, utilizing a React frontend (Vite) and an Express.js backend, with PostgreSQL and Drizzle ORM for data persistence.

**UI/UX Decisions:**
- Dark mode, terminal-style aesthetic with minimal rounded corners.
- Fonts: JetBrains Mono for code, Inter for UI.
- Strategy Lab displays Confidence % and Uniqueness % as badges.

**Technical Implementations & System Design:**
- **Bot Lifecycle Management:** Supports five stages (LAB, PAPER, SHADOW, CANARY, LIVE) with institutional promotion gates.
- **Governance Approval System (Maker-Checker):** Dual-control approval for CANARY→LIVE promotions, recorded for audit.
- **Data Management:** PostgreSQL with Drizzle ORM, critical metric storage, and a three-tier persistent bar caching system (Redis → SQLite → Databento API).
- **Core Features:** Local session-based authentication, RESTful API, bot CRUD, asynchronous job queuing, data isolation, health monitoring, Discord notifications, full backtest executor, autonomy loop, signal fusion, flexible session architecture, and real-time provider health monitoring.
- **Market Hours Enforcement:** Comprehensive handling of CME futures market hours.
- **Self-Healing Infrastructure:** Incorporates Circuit Breaker Pattern, Self-Healing Worker, recovery policies, Health Watchdog, audit trails, per-job-type timeouts, and startup schema validation.
- **Live Metrics Calculations:** Uses PostgreSQL window functions for `liveMaxDrawdownPct` and `dailyPnl`.
- **Stage-Based Metrics Policy:** Defines authoritative mapping of stage to metric source with backend normalization and frontend display of `stageMetrics`.
- **Institutional Metric Formulas:** Implements industry-standard calculations for Sharpe Ratio, Max Drawdown, Profit Factor, Expectancy, and Win Rate.
- **Real-Time P&L Infrastructure:** Utilizes a WebSocket server for throttled, per-bot real-time P&L updates.
- **Blown Account Recovery System:** Tracks and handles account blowing events.
- **Autonomous Infrastructure:** Designed for zero-manual-intervention operations including: Memory Sentinel, Credential Lifecycle Management, AI Cascade Auto-Recovery, Risk Engine Self-Test, Proof-of-Use Integration Tracking.
    - **Strategy Lab Perplexity Deep Research Engine:** Autonomous strategy generation with confidence scoring and disposition logic, configurable Research Depths (CONTINUOUS_SCAN, FOCUSED_BURST, FRONTIER_RESEARCH).
    - **QC Error Recovery Worker and QC Evolution Scoring** for failed QuantConnect verifications.
    - **Grok Autonomous Learning System:** Closed-loop learning from bot performance feedback for auto-evolution.
    - **Full Spectrum Research Orchestrator:** Concurrent research across three Grok modes with staggered scheduling, priority queuing, semantic fingerprinting, and rate limiting.
- **ML/RL Intelligence Infrastructure:**
    - **Machine Learning Alpha Models:** Feature engineering (32+ technical indicators), Gradient Boosting Classifier, ML Signal Source, Model Retraining Scheduler with drift detection.
    - **Reinforcement Learning Agents:** DQN Agent, PPO Agent with continuous trading environment.
    - **Portfolio Optimization:** Mean-Variance Optimizer, Correlation Constraints, Risk Metrics.
    - **Smart Execution Algorithms:** TWAP, VWAP, Broker Execution Bridge with stage-based control, global simulation override, and auth-gated real execution.
    - **Risk Manager:** VaR calculations, Expected Shortfall, Sector Exposure, Concentration Metrics, Risk Limits.

## External Dependencies
-   **PostgreSQL:** Primary database.
-   **Drizzle ORM:** Database interaction.
-   **React:** Frontend library.
-   **Vite:** Frontend build tool.
-   **Express.js:** Backend web framework.
-   **shadcn/ui:** UI component library.
-   **React Query:** Frontend data fetching.
-   **bcrypt:** Password hashing.
-   **Databento:** Real-time and historical CME futures data.
-   **Unusual Whales:** Options flow analysis.
-   **FRED:** Federal Reserve economic data.
-   **News APIs:** Multi-provider aggregation (Finnhub, NewsAPI, Marketaux).
-   **AI/LLM Services:** Multi-provider cascade (Groq → OpenAI → Anthropic → Gemini → xAI → OpenRouter).
-   **Broker APIs:** Live trading execution (Ironbeam, Tradovate).
-   **Redis:** Optional cache for performance enhancements.

## Cloud Migration (AWS) - 2026-01-08

### Infrastructure Created
The platform is now containerized and ready for AWS deployment with enterprise-grade infrastructure:

```
infrastructure/aws/
├── main.tf              # VPC, Aurora Serverless v2, ElastiCache, ECR, ECS, ALB
├── ecs-services.tf      # Task definitions, services, auto-scaling, secrets
├── terraform.tfvars.example
└── README.md            # Deployment documentation

Dockerfile               # Multi-stage API server build
Dockerfile.worker        # Optimized worker tier build  
docker-compose.yml       # Local testing environment
.dockerignore
.env.docker.example
```

### Architecture Separation
- **API Tier**: Express.js server with routes, authentication, WebSocket
- **Worker Tier**: Dedicated backtest/evolution workers (WORKER_MODE=true)
- **Database**: Supports both DATABASE_URL (Replit) and DB_HOST/DB_PASSWORD (AWS) formats
- **Read Replicas**: Automatic routing to Aurora reader endpoint when available

### Target AWS Services
| Component | Service | Scaling |
|-----------|---------|---------|
| API | ECS Fargate | 2-10 tasks, CPU/memory auto-scale |
| Workers | ECS Fargate | 2-10 tasks, CPU auto-scale |
| Database | Aurora Serverless v2 | 0.5-16 ACU auto-scale |
| Cache | ElastiCache Redis | 1-2 nodes |
| Load Balancer | ALB | Automatic |
| Secrets | Secrets Manager | Per-service injection |

### Migration Readiness
- [x] Codebase is modular (Express + React + Drizzle ORM)
- [x] Database uses standard Postgres (easily portable)
- [x] Redis already integrated for caching
- [x] Environment variables properly isolated
- [x] Worker tier separation (WORKER_MODE in server/index.ts)
- [x] Docker containerization ready
- [x] Terraform infrastructure templates (AWS)
- [x] Render Blueprint ready (render.yaml)
- [x] Database supports AWS-style env vars (DB_HOST, DB_PASSWORD)
- [ ] WebSocket service extraction (future enhancement)
- [ ] Frontend CDN deployment (Vercel - optional)

### Render Deployment (Recommended - Simpler than AWS)
```
render.yaml                      # Render Blueprint - auto-detected
infrastructure/render/README.md  # Deployment guide
```
Estimated cost: $110-300/month for production with auto-scaling.

## Recent Changes

### 2026-01-10: Autonomous Trading Infrastructure Complete
**Major autonomous systems implementation across 18 phases:**

**Phase 1-3: Core Infrastructure**
- **Promotion Engine** (`server/promotion-engine.ts`): Automated metric-based gates for LAB→PAPER→SHADOW→CANARY→LIVE transitions with automatic demotion on performance degradation
- **Governance Approval** (`server/governance-approval.ts`): Maker-checker dual approval workflow for CANARY→LIVE with 24h expiration
- **Risk Enforcement** (`server/risk-enforcement.ts`): VaR limits, drawdown gates (WARNING at 10%, SOFT_BLOCK at 15%, HARD_BLOCK at 20%), daily loss limits, blown account recovery

**Phase 4: Execution Bridges**
- **Ironbeam Execution** (`server/ironbeam-live-client.ts`): Added submitOrder, getOrderStatus, cancelOrder, getPositions with stage gating (simulation for PAPER/SHADOW, real for CANARY/LIVE)
- **TWAP/VWAP Algorithms** (`server/execution-algorithms.ts`): Smart order execution with time/volume weighting, slippage tracking, active execution management

**Phase 5: Signal Generation**
- **AI Signal Cascade** (`server/ai-signal-cascade.ts`): 6 LLM providers (Groq→OpenAI→Anthropic→Gemini→xAI→OpenRouter) with health tracking, automatic failover, signal aggregation

**Phase 6: Learning Systems**
- **Grok Feedback Loop** (`server/grok-feedback-collector.ts`): Performance feedback recording, winning/losing pattern extraction, auto-evolution from trade outcomes
- **Scheduler Integration** (`server/scheduler.ts`): New workers - Promotion (30min), Governance Expiration (1hr), Risk Enforcement (5min)

### 2026-01-10: Google Drive Per-User OAuth Complete
- **Per-User OAuth Architecture**: All backup operations now use user-specific OAuth tokens from `user_google_drive_tokens` table
- **User-Scoped Functions**: `listBackupsForUser(userId)`, `deleteBackupForUser(userId, backupId)`, `downloadBackupForUser(userId, backupId)`, `uploadBackupForUser(userId, filename, data)`, `isGoogleDriveConnectedForUser(userId)`
- **Backup Scheduler**: Loops through all users, checks individual connections, performs per-user retention cleanup with cache invalidation
- **Routes Updated**: `/api/cloud-backup/list`, `/api/cloud-backup/:backupId` DELETE, `/api/cloud-backup/status` all pass userId
- **Migration file**: `migrations/0001_add_user_google_drive_tokens.sql`
- **Production Deployment Note**: Run `npm run db:push` against production DATABASE_URL before enabling Google Drive backup

### 2026-01-10: Industry-Standard Resilience Improvements
- **Google Drive Retry/Backoff**: Added exponential backoff with jitter for all Google Drive API calls (`server/google-drive-client.ts`)
  - Rate limit (429) and server errors (5xx) automatically retry up to 3 times
  - Auth errors (401/403) fail immediately without retry
  - Non-retriable 4xx errors fail fast to avoid wasting quota
- **Extended Timeouts**: Dashboard timeout increased to 30s for production latency tolerance
- **Detailed Logging**: Timing metrics for OAuth token retrieval, folder operations, and backup listing

### Industry-Standard Compliance Summary
The platform includes the following institutional-grade features:
- **Kill Switch**: `/api/system/power` endpoint for emergency halt of all trading
- **Immutable Audit Log**: Blockchain-style hash chain in `institutional-governance.ts` with sequence numbers and tamper detection
- **Risk Limits**: Per-bot, per-symbol, and total exposure limits in `institutional-risk.ts` with VaR calculations
- **Health Monitoring**: `/api/health` endpoint with memory metrics, determinism tests, and session stability checks
- **Maker-Checker Governance**: Dual-control approval workflow for CANARY→LIVE promotions