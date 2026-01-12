import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import MemoryStore from "memorystore";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";
import connectPgSimple from "connect-pg-simple";
import { RedisStore } from "connect-redis";
import { poolWeb, isDatabaseWarmedUp } from "./db";
import { authRateLimit, twoFactorRateLimit, csrfProtection } from "./security-middleware";
import { getRedisClient, isRedisConfigured } from "./redis";

const PgStore = connectPgSimple(session);
const MemorySessionStore = MemoryStore(session);

// Redis client for session store (initialized once)
let redisSessionClient: Awaited<ReturnType<typeof getRedisClient>> = null;

/**
 * SEV-1: Create adaptive session store with priority:
 * 1. Redis (shared across instances - ideal for Render/multi-instance deployments)
 * 2. PostgreSQL (shared but higher latency)
 * 3. MemoryStore (local only - last resort)
 */
async function createSessionStoreAsync(): Promise<session.Store> {
  // Priority 1: Try Redis (best for multi-instance deployments like Render)
  if (isRedisConfigured()) {
    try {
      redisSessionClient = await getRedisClient();
      if (redisSessionClient && redisSessionClient.isOpen) {
        console.log("[AUTH] Using Redis session store (multi-instance safe)");
        return new RedisStore({
          client: redisSessionClient,
          prefix: "sess:",
          ttl: 7 * 24 * 60 * 60, // 7 days in seconds
        });
      }
    } catch (err) {
      console.warn("[AUTH] Redis session store failed, falling back:", err);
    }
  }

  // Priority 2: Try PostgreSQL
  if (isDatabaseWarmedUp()) {
    console.log("[AUTH] Using PostgreSQL session store");
    return new PgStore({
      pool: poolWeb,
      tableName: "session",
      createTableIfMissing: true,
    });
  }
  
  // Priority 3: MemoryStore (last resort - sessions won't persist across instances)
  console.warn("[AUTH] Using MemoryStore for sessions (sessions will not persist across restarts or instances)");
  return new MemorySessionStore({
    checkPeriod: 86400000, // prune expired entries every 24h
  });
}

// Synchronous fallback for initial setup (will be replaced by async version)
function createSessionStore(): session.Store {
  // Check if database is warmed up at startup
  if (!isDatabaseWarmedUp()) {
    console.warn("[AUTH] Database not available - using MemoryStore for sessions (sessions will not persist across restarts)");
    return new MemorySessionStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    });
  }
  
  console.log("[AUTH] Using PostgreSQL session store");
  return new PgStore({
    pool: poolWeb,
    tableName: "session",
    createTableIfMissing: true,
  });
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    email: string;
    username?: string;
    twoFactorPending?: boolean;
    csrfToken?: string;
  }
}

const TEMP_TOKEN_TTL_MINUTES = 5;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createTempToken(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TEMP_TOKEN_TTL_MINUTES * 60 * 1000);
  
  await storage.createAuthTempToken({
    userId,
    tokenHash,
    purpose: "2FA_LOGIN",
    ip,
    userAgent,
    expiresAt,
  });
  
  return token;
}

export async function validateTempToken(token: string): Promise<{ userId: string; purpose: string; error?: string; ip?: string; userAgent?: string } | null> {
  const tokenHash = hashToken(token);
  const result = await storage.validateAuthTempToken(tokenHash);
  
  if (!result) return null;
  
  if (result.expired) {
    return { userId: result.userId, purpose: result.purpose, error: "TOKEN_EXPIRED", ip: result.ip, userAgent: result.userAgent };
  }
  
  if (result.consumed) {
    return { userId: result.userId, purpose: result.purpose, error: "TOKEN_CONSUMED", ip: result.ip, userAgent: result.userAgent };
  }
  
  return { userId: result.userId, purpose: result.purpose, ip: result.ip, userAgent: result.userAgent };
}

export async function consumeTempToken(token: string): Promise<{ userId: string; email: string; username?: string } | null> {
  const tokenHash = hashToken(token);
  return storage.consumeAuthTempToken(tokenHash);
}

setInterval(async () => {
  try {
    // SEV-1: Skip cleanup if database circuit is open
    const { isCircuitOpen, openCircuit } = await import("./db");
    if (isCircuitOpen()) {
      return; // Silently skip during DB outage
    }
    
    const cleaned = await storage.cleanupExpiredTempTokens();
    if (cleaned > 0) {
      console.log(`[AUTH] Cleaned up ${cleaned} expired temp tokens`);
    }
  } catch (error) {
    // SEV-1: Reopen circuit on database connection errors (check full error chain)
    const errorStr = String(error);
    if (errorStr.includes('Connection terminated') || errorStr.includes('timeout') || errorStr.includes('connection')) {
      const { openCircuit } = await import("./db");
      openCircuit();
      // Silent - don't spam logs during outage
    } else {
      console.error("[AUTH] Error cleaning up temp tokens:", error);
    }
  }
}, 60 * 1000);

export async function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET;
  
  if (!sessionSecret) {
    console.error("[AUTH] CRITICAL: SESSION_SECRET environment variable is not set!");
    console.error("[AUTH] Please set SESSION_SECRET in your environment variables.");
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be configured in production");
    }
    console.warn("[AUTH] Using insecure fallback for development only");
  }
  
  const isProduction = process.env.NODE_ENV === "production";
  
  // Trust proxy for Replit's reverse proxy
  app.set("trust proxy", 1);
  
  // Initialize session store asynchronously (Redis → PostgreSQL → MemoryStore)
  const sessionStore = await createSessionStoreAsync();
  
  app.use(
    session({
      secret: sessionSecret || "dev-only-insecure-secret-" + crypto.randomBytes(16).toString("hex"),
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        secure: isProduction, // Enforce HTTPS in production
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: isProduction ? "strict" : "lax", // Stricter in production
      },
    })
  );

  app.post("/api/auth/register", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password, username } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: "User with this email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        username: username || email.split("@")[0],
      });

      // Security: Regenerate session to prevent session fixation attacks
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          console.error("Session regeneration error:", regenerateErr);
          return res.status(500).json({ error: "Failed to create secure session" });
        }
        
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.username = user.username || undefined;
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ error: "Failed to save session" });
          }
          res.status(201).json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              username: user.username,
            },
          });
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.post("/api/auth/login", authRateLimit, async (req: Request, res: Response) => {
    try {
      // SEV-1: Check if database is available before attempting login
      const { isCircuitOpen } = await import("./db");
      if (isCircuitOpen()) {
        return res.status(503).json({ 
          error: "System is in maintenance mode. Please try again in a few minutes.",
          code: "DB_UNAVAILABLE"
        });
      }
      
      const { email, password, rememberMe } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      
      // Remember Me: Extend session to 30 days, otherwise use default 7 days
      const sessionMaxAge = rememberMe 
        ? 30 * 24 * 60 * 60 * 1000  // 30 days
        : 7 * 24 * 60 * 60 * 1000;  // 7 days

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (user.twoFactorEnabled) {
        const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
        const userAgent = req.headers["user-agent"] || undefined;
        const tempToken = await createTempToken(user.id, clientIp, userAgent);
        console.log(`[AUTH] 2FA required for user ${user.id}, temp_token issued`);
        return res.json({
          success: true,
          requires_2fa: true,
          temp_token: tempToken,
          user: {
            id: user.id,
            email: user.email,
          },
        });
      }

      // Security: Regenerate session to prevent session fixation attacks
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          console.error("Session regeneration error:", regenerateErr);
          return res.status(500).json({ error: "Failed to create secure session" });
        }
        
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.username = user.username || undefined;
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
        
        // Apply Remember Me session duration
        if (req.session.cookie) {
          req.session.cookie.maxAge = sessionMaxAge;
        }

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ error: "Failed to save session" });
          }
          console.log(`[AUTH] User ${user.id} logged in (rememberMe=${!!rememberMe}, maxAge=${sessionMaxAge / (24 * 60 * 60 * 1000)} days)`);
          res.json({
            success: true,
            requires_2fa: false,
            user: {
              id: user.id,
              email: user.email,
              username: user.username,
            },
          });
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      // SEV-1: Reopen circuit on database connection errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Connection terminated') || errorMessage.includes('timeout')) {
        const { openCircuit } = await import("./db");
        openCircuit();
        return res.status(503).json({ 
          error: "Database temporarily unavailable. Please try again in a few moments.",
          code: "DB_UNAVAILABLE"
        });
      }
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.json({ user: null });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.json({ user: null });
      }

      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
        csrfToken: req.session.csrfToken,
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.get("/api/auth/csrf-token", (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }
    
    res.json({ csrfToken: req.session.csrfToken });
  });

  // Profile management endpoints (industry standard)
  // CSRF protection applied to all state-changing endpoints
  
  // Update username/display name
  app.put("/api/auth/profile", csrfProtection, async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { username } = req.body;
      
      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username is required" });
      }

      if (username.length < 2 || username.length > 50) {
        return res.status(400).json({ error: "Username must be between 2 and 50 characters" });
      }

      // Check for invalid characters
      if (!/^[a-zA-Z0-9_\-\s]+$/.test(username)) {
        return res.status(400).json({ error: "Username can only contain letters, numbers, spaces, underscores, and hyphens" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.updateUserProfile(user.id, { username: username.trim() });
      
      // Update session
      req.session.username = username.trim();

      res.json({ 
        success: true, 
        message: "Profile updated successfully",
        user: {
          id: user.id,
          email: user.email,
          username: username.trim(),
        }
      });
    } catch (error) {
      console.error("[AUTH] Profile update error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Change password (requires current password - industry standard)
  app.put("/api/auth/password", csrfProtection, authRateLimit, async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: "All password fields are required" });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: "New passwords do not match" });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters" });
      }

      // Password strength validation (industry standard)
      const hasUpperCase = /[A-Z]/.test(newPassword);
      const hasLowerCase = /[a-z]/.test(newPassword);
      const hasNumbers = /\d/.test(newPassword);
      
      if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
        return res.status(400).json({ 
          error: "Password must contain at least one uppercase letter, one lowercase letter, and one number" 
        });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(user.id, hashedPassword);

      console.log(`[AUTH] Password changed for user ${user.id}`);

      res.json({ 
        success: true, 
        message: "Password changed successfully. Please log in again on other devices." 
      });
    } catch (error) {
      console.error("[AUTH] Password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Change email (requires current password - industry standard)
  app.put("/api/auth/email", csrfProtection, authRateLimit, async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { newEmail, currentPassword } = req.body;

      if (!newEmail || !currentPassword) {
        return res.status(400).json({ error: "New email and current password are required" });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ error: "Please enter a valid email address" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Password is incorrect" });
      }

      // Check if email is already in use
      const existingUser = await storage.getUserByEmail(newEmail.toLowerCase());
      if (existingUser && existingUser.id !== user.id) {
        return res.status(409).json({ error: "This email is already in use" });
      }

      await storage.updateUserEmail(user.id, newEmail.toLowerCase());
      
      // Update session
      req.session.email = newEmail.toLowerCase();

      console.log(`[AUTH] Email changed for user ${user.id}: ${user.email} -> ${newEmail}`);

      res.json({ 
        success: true, 
        message: "Email updated successfully",
        user: {
          id: user.id,
          email: newEmail.toLowerCase(),
          username: user.username,
        }
      });
    } catch (error) {
      console.error("[AUTH] Email change error:", error);
      res.status(500).json({ error: "Failed to change email" });
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}
