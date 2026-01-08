import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { createServer } from "http";
import { startScheduler, pauseHeavyWorkers, resumeHeavyWorkers } from "./scheduler";
import { livePnLWebSocket } from "./websocket-server";
import { validateSchemaAtStartup, warmupDatabase } from "./db";
import { startMemorySentinel, loadSheddingMiddleware, getInstanceId, registerSchedulerCallbacks, registerCacheEvictionCallback } from "./ops/memorySentinel";
import { trimCacheForMemoryPressure } from "./bar-cache";
import { execSync } from "child_process";
import { requestInstrumentationMiddleware } from "./middleware/request-instrumentation";

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

    const port = 5000;
    server.listen(port, "0.0.0.0", () => {
      log(`serving on port ${port}`);
      
      // Initialize WebSocket server for real-time LIVE P&L updates
      livePnLWebSocket.initialize(server);
      
      // AUTONOMOUS: Register memory sentinel callbacks for worker pausing
      registerSchedulerCallbacks(pauseHeavyWorkers, resumeHeavyWorkers);
      
      // Run post-startup tasks only if database is ready
      if (dbReady) {
        log(`[STARTUP] Database ready - running post-startup tasks`);
        
        // Seed instruments now that database is ready
        (async () => {
          try {
            const { storage } = await import('./storage');
            await storage.seedInstruments();
            log(`[STARTUP] Instruments seeded successfully`);
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
