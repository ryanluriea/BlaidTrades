# Trading Bot Platform

## Overview
This project is an algorithmic trading bot management platform designed for multi-stage bot lifecycle management (LAB → PAPER → SHADOW → CANARY → LIVE). It aims to provide a robust, scalable, and institutional-grade solution for developing, testing, and deploying sophisticated trading strategies with autonomous operations, targeting zero manual intervention. Key capabilities include autonomous strategy generation, self-healing infrastructure, and comprehensive risk management, positioning it as a leading platform in quantitative finance.

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
The platform utilizes a modular monolith architecture with a React frontend (Vite) and an Express.js backend, backed by PostgreSQL and Drizzle ORM. It emphasizes high availability, autonomous operations, and institutional-grade resilience and compliance.

**UI/UX Decisions:**
- Dark mode, terminal-style aesthetic with minimal rounded corners.
- Fonts: JetBrains Mono for code, Inter for UI.
- Strategy Lab displays Confidence % and Uniqueness % as badges.

**Technical Implementations & System Design:**
- **Bot Lifecycle Management:** Supports five stages (LAB, PAPER, SHADOW, CANARY, LIVE) with institutional promotion gates and an autonomous promotion engine.
- **Governance & Compliance:** Features a Maker-Checker approval system, immutable audit logs, kill switch functionality, and detailed health monitoring.
- **Data Management:** PostgreSQL with Drizzle ORM, three-tier persistent bar caching, and real-time P&L infrastructure via WebSockets.
- **Core Features:** Local session-based authentication, RESTful API, bot CRUD, asynchronous job queuing, data isolation, Discord notifications, full backtest executor, autonomy loop, signal fusion, and flexible session architecture.
- **Self-Healing Infrastructure:** Incorporates Circuit Breaker Pattern, Self-Healing Worker, recovery policies, Health Watchdog, audit trails, per-job-type timeouts, and startup schema validation, including an AI Cascade Auto-Recovery system.
- **Production Resilience:** Includes security headers, configurable infrastructure settings, rule parser per-direction fallback with confidence scoring, canonical archetype normalization, memory leak prevention, idempotency key system, graceful degradation with cache fallbacks, circuit breaker for backup services, indicator validation layer, exit conditions pipeline, auto-promotion risk defaults, session mode alias normalization, and ensuring fresh QC metrics fetching and bot creation schema alignment.
- **Autonomous Infrastructure:** Designed for zero-manual-intervention operations including Memory Sentinel, Credential Lifecycle Management, Risk Engine Self-Test, Proof-of-Use Integration Tracking, and a Perplexity Deep Research Engine for autonomous strategy generation.
- **ML/RL Intelligence Infrastructure:**
    - **Machine Learning Alpha Models:** Feature engineering (32+ technical indicators), Gradient Boosting Classifier, ML Signal Source, Model Retraining Scheduler with drift detection.
    - **Reinforcement Learning Agents:** DQN Agent, PPO Agent with continuous trading environment.
    - **Portfolio Optimization:** Mean-Variance Optimizer, Correlation Constraints, Risk Metrics.
    - **Smart Execution Algorithms:** TWAP, VWAP, Broker Execution Bridge with stage-based control.
    - **Risk Manager:** VaR calculations, Expected Shortfall, Sector Exposure, Concentration Metrics, and dynamic risk limits with an enforcement engine.
- **Grok Autonomous Learning System:** Closed-loop learning from bot performance feedback for auto-evolution, supported by a Full Spectrum Research Orchestrator for concurrent research.
- **Cloud Readiness:** Containerized with Docker and includes Terraform configurations for AWS (ECS Fargate, Aurora Serverless v2, ElastiCache Redis, ALB) and Render Blueprint.
- **Institutional Latency & Execution Infrastructure:** Features a worker thread pool for offloading CPU-intensive tasks, latency tracker for monitoring, FIX Protocol Adapter for industry-standard connectivity, execution quality metrics (TCA, fill ratio, implementation shortfall, market impact), and enhanced TWAP/VWAP execution algorithms. API endpoints are available for observability.
- **Institutional Tick Data Infrastructure:** Includes a high-performance tick ingestion service with nanosecond precision timestamps, dedicated tables for trade ticks, quote ticks, and order book snapshots, gap detection and logging, and ingestion metrics. API endpoints are provided for institutional data audit.
- **Fail-Fast Validators:** Implements "fail-closed" data integrity patterns with validation severity levels (SEV-0, SEV-1, SEV-2) for risk configuration, promotion metrics, archetypes, session modes, symbols, timeframes, backtest errors, batch metrics, and fallback rates.
- **Database Migrations:** Utilizes an idempotent pre-deploy migration script (`scripts/migrate-enums.ts`) to safely add missing PostgreSQL enum values.
- **Testing Infrastructure:** Comprehensive unit tests cover AST rule parser, QC optimization (grid generation, result ranking, parameter sensitivity, walk-forward analysis, verification gates), and QC monitoring (parse method recording, verification gate outcomes, optimization metrics).
- **QC Badge Hydration:** QC verification status is batch-fetched and hydrated directly on strategy candidates during API response, ensuring TRIALS candidates show QC badges even when older than the 200-verification limit. Frontend prioritizes hydrated state over separate QC verifications fetch.

## Recent Changes (January 2026)
- **Production Stabilization (Jan 12):**
  - Optimized health-summary endpoint from 6.4s to ~2s using CTEs instead of correlated subqueries
  - Fixed legacy database host warning (now shows `replit_managed=true` for Replit internal hosts)
  - Removed deprecation warning spam for user_id query param fallback
  - Improved Redis connection reliability with 10s timeout and exponential backoff retry strategy
  - Updated IndexedDB persister with once-per-session debug logging to reduce browser console spam
  - Fixed self-healing worker: Removed non-existent `resolved_by` column references from alerts UPDATE queries (replaced with `updated_at = NOW()`)
  - Fixed bot_instances DELETE timeout: Implemented batch deletion (LIMIT 50, MAX_BATCHES 10) to prevent FK check timeouts on large trade_logs table
- **QC Badge Fix for Trials:** Added QC verification hydration to `/api/strategy-lab/candidates` endpoint using DISTINCT ON query for most recent verification per candidate. Frontend updated to use hydrated `qcVerification.badgeState` with fallback to fetched verifications.
- **BigInt Serialization Fix:** Fixed tick ingestion to pass native `bigint` values (not strings) to Drizzle schema columns using `mode: "bigint"`. Added defensive typeof checks for sequenceId coercion.
- **Production User ID Fix (Jan 12):** Fixed `seed-system-users.ts` to use correct `password` column (not `password_hash`), removed non-existent `role` column, and added comprehensive FK migration using information_schema to discover ALL columns referencing users.id (user_id, requested_by, reviewed_by, validated_by, tested_by, signed_off_by, etc.). Updates existing user's ID to match canonical `DEFAULT_USER_ID` in a transaction with rollback. This resolves empty bots page and missing QC badges in production.

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