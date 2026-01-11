# Trading Bot Platform

## Overview
This project is an algorithmic trading bot management platform designed for multi-stage bot lifecycle management (LAB → PAPER → SHADOW → CANARY → LIVE). It provides a robust, scalable, and institutional-grade solution for developing, testing, and deploying sophisticated trading strategies with autonomous operations, aiming for zero manual intervention. Its core purpose is to enable advanced algorithmic trading with features like autonomous strategy generation, self-healing infrastructure, and comprehensive risk management, positioning it as a leading platform in the quantitative finance sector.

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
The platform employs a modular monolith architecture, utilizing a React frontend (Vite) and an Express.js backend, with PostgreSQL and Drizzle ORM for data persistence. It is designed for high availability and autonomous operations, with an emphasis on institutional-grade resilience and compliance.

**UI/UX Decisions:**
- Dark mode, terminal-style aesthetic with minimal rounded corners.
- Fonts: JetBrains Mono for code, Inter for UI.
- Strategy Lab displays Confidence % and Uniqueness % as badges.

**Technical Implementations & System Design:**
- **Bot Lifecycle Management:** Supports five stages (LAB, PAPER, SHADOW, CANARY, LIVE) with institutional promotion gates and an autonomous promotion engine based on metric analysis.
- **Governance & Compliance:** Features a Maker-Checker approval system for CANARY→LIVE promotions, immutable audit logs, kill switch functionality, and detailed health monitoring.
- **Data Management:** PostgreSQL with Drizzle ORM, three-tier persistent bar caching (Redis → SQLite → Databento API), and real-time P&L infrastructure via WebSockets.
- **Core Features:** Local session-based authentication, RESTful API, bot CRUD, asynchronous job queuing, data isolation, Discord notifications, full backtest executor, autonomy loop, signal fusion, and flexible session architecture.
- **Self-Healing Infrastructure:** Incorporates Circuit Breaker Pattern, Self-Healing Worker, recovery policies, Health Watchdog, audit trails, per-job-type timeouts, and startup schema validation, including an AI Cascade Auto-Recovery system.
- **Production Resilience (Jan 2026):**
    - **Security Headers:** HSTS, CSP, X-Frame-Options, XSS protection, MIME sniffing prevention via middleware.
    - **Configurable Infrastructure:** All DB pool settings (DB_POOL_WEB_MAX, DB_POOL_WORKER_MAX, DB_STATEMENT_TIMEOUT_*, etc.) and WebSocket settings (WS_IDLE_TIMEOUT_MS, WS_THROTTLE_MS, WS_BROADCAST_TTL_MS) are environment-configurable.
    - **Rule Parser Per-Direction Fallback:** Uses structured getArchetypePredicate() for reliable fallback when rule parsing fails for one direction; includes confidence scoring.
    - **Memory Leak Prevention:** TTL-based cleanup for WebSocket broadcast tracking maps.
    - **Idempotency Key System:** In-memory idempotency management (server/idempotency.ts) with TTL-based cleanup to prevent duplicate critical operations.
    - **Graceful Degradation:** Cache fallbacks with staleness warnings (server/graceful-degradation.ts) using configurable CACHE_STALE_WARNING_MS and CACHE_STALE_CRITICAL_MS thresholds.
    - **Circuit Breaker for Backup Service:** Google Drive upload/download operations wrapped with circuit breaker + retry pattern for resilience.
    - **Indicator Validation Layer:** Automatic verification that referenced indicators are properly instantiated in generated QuantConnect code, with auto-addition of missing indicators.
    - **Exit Conditions Pipeline:** Parsed exit conditions from rules_json are now wired into CheckExits() method, enabling signal-based exits alongside stop/target exits.
- **Autonomous Infrastructure:** Designed for zero-manual-intervention operations including Memory Sentinel, Credential Lifecycle Management, Risk Engine Self-Test, Proof-of-Use Integration Tracking, and a Perplexity Deep Research Engine for autonomous strategy generation.
- **ML/RL Intelligence Infrastructure:**
    - **Machine Learning Alpha Models:** Feature engineering (32+ technical indicators), Gradient Boosting Classifier, ML Signal Source, Model Retraining Scheduler with drift detection.
    - **Reinforcement Learning Agents:** DQN Agent, PPO Agent with continuous trading environment.
    - **Portfolio Optimization:** Mean-Variance Optimizer, Correlation Constraints, Risk Metrics.
    - **Smart Execution Algorithms:** TWAP, VWAP, Broker Execution Bridge with stage-based control.
    - **Risk Manager:** VaR calculations, Expected Shortfall, Sector Exposure, Concentration Metrics, and dynamic risk limits with an enforcement engine.
- **Grok Autonomous Learning System:** Closed-loop learning from bot performance feedback for auto-evolution, supported by a Full Spectrum Research Orchestrator for concurrent research.
- **Cloud Readiness:** Containerized with Docker and includes Terraform configurations for AWS (ECS Fargate, Aurora Serverless v2, ElastiCache Redis, ALB) and Render Blueprint for simplified deployments.

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
-   **Google Drive API:** Used for cloud backup and restore functionality.

## Fail-Fast Validators (Institutional Data Integrity)

The platform implements institutional-grade "fail-closed" data integrity patterns. Invalid data halts operations rather than continuing with silent defaults.

**Environment Variables:**
- `MAX_CONTRACTS_TRIALS`: Max contracts per trade for TRIALS stage (default: 10)
- `MAX_CONTRACTS_PAPER`: Max contracts per trade for PAPER stage (default: 20)
- `MAX_CONTRACTS_SHADOW`: Max contracts per trade for SHADOW stage (default: 30)
- `MAX_CONTRACTS_CANARY`: Max contracts per trade for CANARY stage (default: 50)
- `MAX_CONTRACTS_LIVE`: Max contracts per trade for LIVE stage (default: 100)
- `VARIANCE_ALERT_THRESHOLD`: Variance threshold for batch metric alerts (default: 0.001)
- `FALLBACK_ALERT_THRESHOLD`: Fallback rate threshold for alerting (default: 0.05 = 5%)

**Validation Severity Levels:**
- SEV-0: Critical - blocks bot/candidate creation entirely
- SEV-1: High - blocks promotion but allows creation
- SEV-2: Warning - logged but doesn't block operations

**Key Validators (server/fail-fast-validators.ts):**
- `validateRiskConfig`: Ensures stopLoss, takeProfit, maxPositionSize present
- `validatePromotionMetrics`: Blocks promotions with NULL Sharpe/drawdown/winRate
- `validateArchetype`: Requires valid archetype or inference from name
- `validateSessionMode`: Blocks invalid modes, warns on implicit defaults
- `validateSymbol`: Enforces supported symbols with normalization
- `validateTimeframe`: Validates 1m/5m/15m/30m/1h/4h/1d timeframes
- `classifyBacktestError`: Categorizes errors as CRITICAL/RECOVERABLE/WARNING
- `recordBatchMetrics`: Detects near-zero variance (all identical = bug)
- `recordFallback`: Tracks and alerts on high fallback rates

**Wiring Points:**
- Bot creation/update: Routes validate risk config before persistence
- Strategy Lab: Validates archetype/symbol/sessionMode before promotion
- Backtest executor: Classifies errors and halts on CRITICAL
- Matrix worker: Records batch metrics for variance detection
- Discord alerts: Sent when variance or fallback thresholds breached

## Testing Infrastructure

**Unit Tests (server/tests/unit/):**
- `ast-rule-parser.test.ts`: 26 tests covering tokenizer, indicator registry, institutional parse, provenance tracking, and edge cases
- `qc-optimization.test.ts`: 31 tests covering grid generation, deterministic hashing, result ranking, parameter sensitivity, walk-forward analysis, and verification gates
- `qc-monitoring.test.ts`: 13 tests covering parse method recording, verification gate outcomes, walk-forward results, and optimization metrics

**Running Tests:**
```bash
cd server/tests && npx vitest run --config vitest.config.ts
```

**Key Test Coverage:**
- Indicator Registry: 18 indicators (rsi, macd, bb, ema, sma, adx, atr, vwap, stoch, cci, mfi, roc, williams, keltner, donchian, ichimoku, psar, supertrend)
- QC Optimization: Grid search up to 50 combinations, walk-forward analysis with 60% robustness threshold
- Verification Gates: MIN_TRADES (≥30), SHARPE_THRESHOLD (>0), MAX_DRAWDOWN (<25%), WIN_RATE (≥45%), PROFIT_FACTOR (≥1.2)
- Monitoring: Parse method distribution, confidence averaging, verification pass rates, recent verification history (100-record cap)