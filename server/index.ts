import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { createServer } from "http";
import { startScheduler, pauseHeavyWorkers, resumeHeavyWorkers } from "./scheduler";
import { livePnLWebSocket } from "./websocket-server";
import { researchMonitorWS } from "./research-monitor-ws";
import { validateSchemaAtStartup, warmupDatabase, poolWeb } from "./db";
import { reconcileConfigAtStartup } from "./config-reconciliation";
import bcrypt from "bcryptjs";
import { startMemorySentinel, loadSheddingMiddleware, getInstanceId, registerSchedulerCallbacks, registerCacheEvictionCallback } from "./ops/memorySentinel";
import { trimCacheForMemoryPressure } from "./bar-cache";
import { execSync } from "child_process";
import { requestInstrumentationMiddleware } from "./middleware/request-instrumentation";
import { securityHeaders } from "./security-middleware";
import { storage } from "./storage";

// Check for worker-only mode (for AWS ECS worker tier)
const isWorkerOnlyMode = process.argv.includes("--worker-only") || process.env.WORKER_MODE === "true";

function cleanupStaleTemporaryFiles(): void {
  try {
    const patterns = [
      "/tmp/playwright_*",
      "/tmp/.org.chromium.*",
      "/tmp/tsx-*",
      "/tmp/vite-*"
    ];
    for (const pattern of patterns) {
      try {
        execSync(`rm -rf ${pattern} 2>/dev/null || true`, { stdio: 'ignore' });
      } catch {
      }
    }
    log("[STARTUP] Cleaned up stale temporary files");
  } catch (err) {
    log(`[STARTUP] Temp cleanup skipped: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

cleanupStaleTemporaryFiles();

/**
 * Bootstrap admin account on first deploy when users table is empty
 * Uses ADMIN_EMAIL and ADMIN_PASSWORD environment variables
 */
async function bootstrapAdminAccount(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  if (!adminEmail || !adminPassword) {
    log("[BOOTSTRAP] No ADMIN_EMAIL/ADMIN_PASSWORD set - skipping admin bootstrap");
    return;
  }
  
  try {
    // Check if any users exist
    const result = await poolWeb.query("SELECT COUNT(*) as count FROM users");
    const userCount = parseInt(result.rows[0].count, 10);
    
    if (userCount > 0) {
      log(`[BOOTSTRAP] Users table has ${userCount} users - skipping bootstrap`);
      return;
    }
    
    // Create admin account using ON CONFLICT to handle race conditions in multi-replica deploys
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminUsername = adminEmail.split("@")[0];
    
    const insertResult = await poolWeb.query(
      `INSERT INTO users (id, email, username, password, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [adminEmail, adminUsername, hashedPassword]
    );
    
    if (insertResult.rowCount && insertResult.rowCount > 0) {
      log(`[BOOTSTRAP] SUCCESS: Created admin account: ${adminEmail}`);
      log(`[BOOTSTRAP] You can now log in with the password from ADMIN_PASSWORD env var`);
    } else {
      log(`[BOOTSTRAP] Admin account ${adminEmail} already exists (concurrent create)`);
    }
    
  } catch (error) {
    log(`[BOOTSTRAP] FAILED to create admin account: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

// Start memory sentinel early (doesn't need DB)
startMemorySentinel();
log(`[STARTUP] Memory sentinel started (instance=${getInstanceId()})`);

// Register cache eviction callback for active memory recovery
registerCacheEvictionCallback(trimCacheForMemoryPressure);

// =============================================================================
// Worker-Only Mode: Run scheduler without HTTP server (for AWS ECS worker tier)
// =============================================================================
if (isWorkerOnlyMode) {
  log(`[STARTUP] Starting in WORKER-ONLY mode (no HTTP server)`);
  
  (async () => {
    const dbReady = await warmupDatabase();
    
    if (!dbReady) {
      log(`[STARTUP] FATAL: Database not available - workers cannot start`);
      process.exit(1);
    }
    
    log(`[STARTUP] Database ready - starting scheduler workers`);
    
    // CRITICAL: Ensure system user exists for autonomous operations
    try {
      const systemUser = await storage.ensureSystemUser();
      log(`[STARTUP] System user verified: ${systemUser.email} (id=${systemUser.id})`);
    } catch (err) {
      log(`[STARTUP] FATAL: Failed to ensure system user - workers cannot start: ${err instanceof Error ? err.message : 'unknown'}`);
      process.exit(1);
    }
    
    // Register DB query metrics recorder for production monitoring (worker mode)
    // Must happen BEFORE scheduler starts to capture all queries
    try {
      const [{ registerQueryMetricsRecorder }, { recordQueryMetric }] = await Promise.all([
        import("./db"),
        import("./ops/dbQueryMonitor")
      ]);
      registerQueryMetricsRecorder(recordQueryMetric);
      log(`[STARTUP] DB query metrics recorder registered (worker mode)`);
    } catch (err) {
      log(`[STARTUP] Failed to register DB query metrics: ${(err as Error).message}`);
    }
    
    // Register scheduler callbacks for memory management
    registerSchedulerCallbacks(pauseHeavyWorkers, resumeHeavyWorkers);
    
    // Start the scheduler (backtests, evolution, autonomy workers)
    startScheduler();
    
    log(`[STARTUP] Worker tier running - processing jobs from queue`);
    
    // Keep process alive
    process.on('SIGTERM', () => {
      log(`[WORKER] Received SIGTERM, graceful shutdown`);
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      log(`[WORKER] Received SIGINT, graceful shutdown`);
      process.exit(0);
    });
  })();
} else {
  // =============================================================================
  // API Mode: Full HTTP server with routes (for AWS ECS API tier)
  // =============================================================================
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(securityHeaders); // Security headers (HSTS, CSP, X-Frame-Options, etc.)
  app.use(loadSheddingMiddleware);
  app.use(requestInstrumentationMiddleware);

  (async () => {
    // CRITICAL: Warm up database BEFORE setting up auth
    // This ensures session store uses PostgreSQL instead of MemoryStore
    // MemoryStore loses sessions on restart, breaking "Remember Me" functionality
    // warmupDatabase() has built-in retry logic (3 attempts with exponential backoff)
    const dbReady = await warmupDatabase();
    
    if (dbReady) {
      log(`[STARTUP] Database ready - PostgreSQL session store will be used`);
      
      // Bootstrap admin account on first deploy (when users table is empty)
      await bootstrapAdminAccount();
      
      // CRITICAL: Ensure system user exists for autonomous operations
      // This is the runtime fallback in case pre-deploy seeding failed
      // FAIL-CLOSED: Exit if system user cannot be ensured to prevent degraded operation
      try {
        const systemUser = await storage.ensureSystemUser();
        log(`[STARTUP] System user verified: ${systemUser.email} (id=${systemUser.id})`);
      } catch (err) {
        log(`[STARTUP] FATAL: Failed to ensure system user - cannot start in degraded mode: ${err instanceof Error ? err.message : 'unknown'}`);
        process.exit(1);
      }
    } else {
      log(`[STARTUP] WARNING: Database warmup failed - sessions will use MemoryStore (not persistent)`);
    }
    
    // Now setup auth with database ready (session store will use PostgreSQL if DB is ready)
    setupAuth(app);
    registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      throw err;
    });

    const server = createServer(app);

    // On Replit, always serve static files to avoid Vite client WebSocket issues
    // The Vite dev server's client script causes white screen crashes on Replit's proxy
    const useViteDev = app.get("env") === "development" && !process.env.REPL_ID;
    
    if (useViteDev) {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
    
    // CRITICAL: Initialize WebSocket servers BEFORE server.listen()
    // This ensures the 'upgrade' event handlers are registered before any connections arrive
    // Prevents race condition where clients connect before WebSocket handlers are ready
    livePnLWebSocket.initialize(server);
    researchMonitorWS.initialize(server);
    log(`[STARTUP] WebSocket servers initialized`);

    const port = 5000;
    server.listen(port, "0.0.0.0", () => {
      log(`serving on port ${port}`);
      
      // Register WebSocket metrics with observability dashboard
      import("./ops/observabilityDashboard").then(({ registerWebSocketMetricsProvider }) => {
        registerWebSocketMetricsProvider(() => livePnLWebSocket.getMetrics());
      }).catch(err => {
        log(`[STARTUP] Failed to register WS metrics: ${err.message}`);
      });
      
      // Register DB query metrics recorder for production monitoring
      Promise.all([
        import("./db"),
        import("./ops/dbQueryMonitor")
      ]).then(([{ registerQueryMetricsRecorder }, { recordQueryMetric }]) => {
        registerQueryMetricsRecorder(recordQueryMetric);
        log(`[STARTUP] DB query metrics recorder registered`);
      }).catch(err => {
        log(`[STARTUP] Failed to register DB query metrics: ${err.message}`);
      });
      
      // AUTONOMOUS: Register memory sentinel callbacks for worker pausing
      registerSchedulerCallbacks(pauseHeavyWorkers, resumeHeavyWorkers);
      
      // Run post-startup tasks only if database is ready
      if (dbReady) {
        log(`[STARTUP] Database ready - running post-startup tasks`);
        
        // Load research orchestrator state from DB early to prevent stale defaults
        // Must happen BEFORE any API requests could read orchestrator status
        // AUTONOMOUS: Auto-enable research on startup for 24/7 operation
        (async () => {
          try {
            const { loadOrchestratorState, enableFullSpectrum } = await import('./research-orchestrator');
            await loadOrchestratorState();
            log(`[STARTUP] Research orchestrator state loaded from DB`);
            
            // Auto-enable research for fully autonomous 24/7 operation
            // Research runs whether user is logged in or not
            await enableFullSpectrum(true);
            log(`[STARTUP] Research orchestrator AUTO-ENABLED for autonomous operation`);
          } catch (err) {
            log(`[STARTUP] Failed to load/enable orchestrator: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        })();
        
        // Seed instruments now that database is ready
        (async () => {
          try {
            const { storage } = await import('./storage');
            await storage.seedInstruments();
            log(`[STARTUP] Instruments seeded successfully`);
            
            // INSTITUTIONAL SAFEGUARD: Start periodic runner state cleanup
            // Demotes stale STOPPED/FAILED runners from is_primary_runner = true
            // Runs every 5 minutes to prevent state drift
            const RUNNER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
            setInterval(async () => {
              try {
                const demoted = await storage.demoteStaleRunnerPrimaries();
                if (demoted > 0) {
                  log(`[MAINTENANCE] Demoted ${demoted} stale runner primaries`);
                }
                
                // Also check for stale heartbeats (runners claiming RUNNING but no heartbeat)
                const staleRunners = await storage.getStaleHeartbeatRunners(120000); // 2 min TTL
                if (staleRunners.length > 0) {
                  log(`[MAINTENANCE] Found ${staleRunners.length} runners with stale heartbeats`);
                  for (const runner of staleRunners) {
                    await storage.updateBotInstance(runner.id, { status: 'STALE', isPrimaryRunner: false });
                    log(`[MAINTENANCE] Marked runner ${runner.id} as STALE (bot: ${runner.botId})`);
                  }
                }
              } catch (err) {
                log(`[MAINTENANCE] Runner cleanup error: ${err instanceof Error ? err.message : 'unknown'}`);
              }
            }, RUNNER_CLEANUP_INTERVAL_MS);
            log(`[STARTUP] Runner state cleanup scheduled (every 5 min)`);
            
          } catch (err) {
            log(`[STARTUP] Failed to seed instruments: ${err instanceof Error ? err.message : 'unknown'}`);
          }
          
          // Run schema validation in background (non-blocking) 
          validateSchemaAtStartup().then(result => {
            if (!result.valid) {
              log(`[STARTUP] Schema validation found ${result.errors.length} issue(s) - see logs above`);
            }
          }).catch(err => {
            log(`[STARTUP] Schema validation error: ${err.message}`);
          });
          
          // Run config reconciliation (ensures persisted settings match code defaults)
          reconcileConfigAtStartup().then(result => {
            if (result.errors.length > 0) {
              log(`[STARTUP] Config reconciliation had ${result.errors.length} error(s)`);
            }
          }).catch(err => {
            log(`[STARTUP] Config reconciliation error: ${err.message}`);
          });
          
          // Backfill novelty scores for strategy candidates that are missing them
          // This ensures uniqueness badges display actual values instead of N/A
          import('./strategy-lab-engine').then(async ({ backfillNoveltyScores, migrateQualifyingCandidatesToSentToLab }) => {
            try {
              const result = await backfillNoveltyScores();
              if (result.updated > 0) {
                log(`[STARTUP] Novelty scores backfilled: ${result.updated} updated, ${result.errors} errors`);
              }
            } catch (err) {
              log(`[STARTUP] Novelty backfill error: ${err instanceof Error ? err.message : 'unknown'}`);
            }
            
            // Migrate qualifying PENDING_REVIEW candidates to SENT_TO_LAB
            // This handles backlog from when threshold was too high (95 -> 65)
            try {
              const migrationResult = await migrateQualifyingCandidatesToSentToLab();
              if (migrationResult.promoted > 0) {
                log(`[STARTUP] Candidate migration: ${migrationResult.promoted}/${migrationResult.total} promoted to SENT_TO_LAB`);
              }
            } catch (err) {
              log(`[STARTUP] Candidate migration error: ${err instanceof Error ? err.message : 'unknown'}`);
            }
          }).catch(err => {
            log(`[STARTUP] Failed to import strategy-lab-engine: ${err.message}`);
          });
        })();
      } else {
        log(`[STARTUP] WARNING: Running in degraded mode - DB-dependent features disabled`);
      }
      
      // Start automated scheduler (has its own retry logic for DB operations)
      // In API mode, we also run the scheduler for backward compatibility
      // In production, consider running workers separately for better scaling
      startScheduler();
    });
  })();
}
