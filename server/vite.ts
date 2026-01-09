import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// HMR configuration for Replit's proxied environment
function getHmrConfig(server: any) {
  // Completely disable HMR on Replit to avoid WebSocket connection issues
  if (process.env.REPL_ID) {
    return false;
  }
  // Local development: Use default HMR with server
  return { server };
}

export async function setupVite(app: Express, server: any) {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: getHmrConfig(server),
    },
    appType: "custom",
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Suppress pre-transform errors for /api paths (these are API routes, not files)
        if (msg.includes("/api/") && msg.includes("Pre-transform error")) {
          return;
        }
        viteLogger.error(msg, options);
      },
    },
  });

  app.use(vite.middlewares);
  app.use("/{*splat}", async (req, res, next) => {
    const url = req.originalUrl;
    
    // Skip API routes - they should be handled by Express routes, not Vite
    if (url.startsWith("/api/")) {
      return next();
    }
    
    // Skip WebSocket paths - they should be handled by the HTTP upgrade event
    if (url.startsWith("/ws/")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(__dirname, "..", "client", "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = await vite.transformIndexHtml(url, template);
      
      
      res.status(200).set({ 
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
      // HTML files should never be cached
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        // JS/CSS with hashed filenames can be cached long-term
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
  
  // CRITICAL: Exclude WebSocket paths from catch-all route
  // WebSocket upgrade requests must reach the HTTP server's 'upgrade' event handler
  // If we respond with index.html, the WebSocket handshake fails with "Invalid frame header"
  app.use("/{*splat}", (req, res, next) => {
    const url = req.originalUrl || req.url;
    
    // Skip WebSocket paths - let them fall through to the HTTP upgrade handler
    if (url.startsWith("/ws/")) {
      return next();
    }
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
