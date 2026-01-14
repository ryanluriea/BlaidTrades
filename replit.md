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
- **Bot Lifecycle Management:** Supports five stages with institutional promotion gates and an autonomous promotion engine.
- **Governance & Compliance:** Features a Maker-Checker approval system, immutable audit logs, kill switch functionality, and detailed health monitoring.
- **Data Management:** PostgreSQL with Drizzle ORM, three-tier persistent bar caching, and real-time P&L infrastructure via WebSockets.
- **Core Features:** Local session-based authentication, RESTful API, bot CRUD, asynchronous job queuing, data isolation, Discord notifications, full backtest executor, autonomy loop, signal fusion, and flexible session architecture.
- **Self-Healing Infrastructure:** Incorporates Circuit Breaker Pattern, Self-Healing Worker, recovery policies, Health Watchdog, audit trails, per-job-type timeouts, and startup schema validation, including an AI Cascade Auto-Recovery system.
- **Production Resilience:** Includes security headers, configurable infrastructure settings, rule parser per-direction fallback with confidence scoring, canonical archetype normalization, memory leak prevention, idempotency key system, graceful degradation with cache fallbacks, circuit breaker for backup services, indicator validation layer, exit conditions pipeline, auto-promotion risk defaults, session mode alias normalization, ensuring fresh QC metrics fetching, bot creation schema alignment, and graceful degradation for `/api/bots-overview` with partial data and observability.
- **Autonomous Infrastructure:** Designed for zero-manual-intervention operations including Memory Sentinel, Credential Lifecycle Management, Risk Engine Self-Test, Proof-of-Use Integration Tracking, and a Perplexity Deep Research Engine for autonomous strategy generation.
- **ML/RL Intelligence Infrastructure:**
    - **Machine Learning Alpha Models:** Feature engineering (32+ technical indicators), Gradient Boosting Classifier, ML Signal Source, Model Retraining Scheduler with drift detection.
    - **Reinforcement Learning Agents:** DQN Agent, PPO Agent with continuous trading environment.
    - **Portfolio Optimization:** Mean-Variance Optimizer, Correlation Constraints, Risk Metrics.
    - **Smart Execution Algorithms:** TWAP, VWAP, Broker Execution Bridge with stage-based control.
    - **Risk Manager:** VaR calculations, Expected Shortfall, Sector Exposure, Concentration Metrics, and dynamic risk limits with an enforcement engine.
- **Grok Autonomous Learning System:** Closed-loop learning from bot performance feedback for auto-evolution, supported by a Full Spectrum Research Orchestrator for concurrent research.
- **Cloud Readiness:** Containerized with Docker and includes Terraform configurations for AWS (ECS Fargate, Aurora Serverless v2, ElastiCache Redis, ALB) and Render Blueprint.
- **Institutional Latency & Execution Infrastructure:** Features a worker thread pool, latency tracker, FIX Protocol Adapter, execution quality metrics, and enhanced TWAP/VWAP execution algorithms.
- **Institutional Tick Data Infrastructure:** Includes a high-performance tick ingestion service with nanosecond precision timestamps, dedicated tables for trade ticks, quote ticks, and order book snapshots, gap detection and logging, and ingestion metrics.
- **Fail-Fast Validators:** Implements "fail-closed" data integrity patterns with validation severity levels (SEV-0, SEV-1, SEV-2) for critical configurations and metrics.
- **Database Migrations:** Utilizes an idempotent pre-deploy migration script to safely add missing PostgreSQL enum values.
- **Testing Infrastructure:** Comprehensive unit tests cover AST rule parser, QC optimization (grid generation, result ranking, parameter sensitivity, walk-forward analysis, verification gates), and QC monitoring.
- **QC Badge Hydration:** QC verification status is batch-fetched and hydrated directly on strategy candidates during API response.
- **Redis Integration:** Implements Redis-backed caching for `/api/bots-overview` and rate limiting with memory fallback.
- **Observability:** Includes Prometheus metrics endpoint, OpenTelemetry-compatible tracing, structured logging, and institutional-grade monitoring:
    - **Latency Tracker:** P50/P90/P95/P99 percentile tracking with Algorithm R reservoir sampling (5-minute window, 10,000 samples per endpoint).
    - **Event Loop Monitor:** Real-time lag detection with GC pause tracking and reversible hooks.
    - **WebSocket Latency:** Message-level latency tracking for live P&L streams.
    - **Memory Leak Detector:** Generational detection with short/medium/long-term growth rate analysis (10s/5min/2h windows).
    - **RED Metrics Dashboard:** Rate/Errors/Duration per endpoint with trend analysis.
    - **SLO Compliance:** Error budget tracking with warning/critical thresholds.
    - **Disaster Recovery Tracker:** RTO/RPO tracking with component-level status.
    - **Observability Endpoints:** `/api/observability/red-metrics`, `slo-status`, `broker-health`, `event-loop`, `memory-leak`, `dr-status`, `audit-integrity`, `idempotency-stats`.
- **Idempotency Middleware:** Mutation endpoint protection with 10,000 record cap, 1MB response limit, LRU eviction, and large-response deletion for fail-safe semantics.
- **Security:** Input sanitization module, HMAC-signed internal auth tokens for autonomous worker requests (QC auto-promotion uses `X-Internal-Auth` header with timestamp + signature, 5-minute expiry, BlaidAgent user fetched server-side).
- **Monitoring:** Periodic metrics logging, health endpoints (`/healthz`, `/readyz`, `/api/health`), and a self-healing health watchdog for cache management.
- **Fleet Governor:** Automated fleet size management with performance-based demotion to enforce bot cap limits, configurable per-stage caps and demotion settings.
- **Regime Resurrection Detector:** Autonomous service that brings archived bots back to life when market regimes favor their archetype, based on archetype-to-regime affinity mapping.
- **Schema-First Archetype Classification:** Archetypes are stored explicitly on the bots table, eliminating fragile name-based inference.
- **Loading Performance Optimizations:** Fully optimistic AuthContext, cold/warm start optimizations, 5-minute verification cache, `ProtectedRoute` pattern, disabled `refetchOnWindowFocus`, persistent themed wrapper, and AuthContext session state caching.
- **Progressive Data Loading:** Primary data loads first, secondary metrics defer via `requestIdleCallback` for Bots and Strategy Lab pages, with configured query client caching and global error boundaries.
- **Cache Warming Infrastructure:** Background scheduler pre-computes bots-overview data for active users with a 3-minute refresh interval (bandwidth-optimized), batched parallel processing, and connection pool rebalancing. Also includes Redis-backed cache for `/api/strategy-lab/candidates`. TTLs: bots-overview (3min fresh/5min stale), strategy-lab (5min fresh/8min stale). User-triggered mutations still invalidate instantly.
- **Redis Monitoring:** `/api/redis/metrics` endpoint exposes connection status, latency, memory usage, key count, ops/second, and connected clients. Redis section in System Health panel for real-time monitoring.
- **Institutional Cache Infrastructure (Netflix/Spotify Patterns):**
    - **Schema Versioning:** `CACHE_SCHEMA_VERSION` in `cacheInfrastructure.ts` auto-invalidates IndexedDB cache on structure changes.
    - **Zod Validation Before Hydration:** Validates cached data against schemas before React Query hydration, preventing malformed data from reaching components.
    - **Cache Metrics Tracking:** Hit/miss/failure rates, hydration latency tracked via `window.__cacheInfra` for production debugging.
    - **Quarantine Queue:** Failed hydrations stored for debugging without crashing the application.
    - **Remote Kill-Switch:** `GET/POST /api/system/cache-control` allows Ops to disable client caching without redeploy. Durable persistence via PostgreSQL `system_settings` table with Redis cache layer.
    - **Fail-Closed Behavior:** Database unavailability returns HTTP 503, triggering client-side fail-safe that skips IndexedDB hydration.
    - **Strategy Lab Cache Exclusion:** Strategy Lab queries excluded from IndexedDB persistence to prevent black-screen crashes from stale cached data.
- **Bot Generations Unique Constraint:** Added unique constraint on `(bot_id, generation_number)` to `bot_generations` table for `ON CONFLICT` inserts.
- **CSP Google Fonts Fix:** Added `https://fonts.googleapis.com` to CSP `style-src` directive for proper font loading.

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