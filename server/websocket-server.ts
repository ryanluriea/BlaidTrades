/**
 * WebSocket Server for Real-Time LIVE P&L Updates
 * 
 * Broadcasts unrealized P&L updates to connected clients whenever
 * market prices change for bots with open positions.
 * 
 * Features:
 * - Throttled updates (100ms) to prevent UI overwhelm
 * - Per-bot subscription support
 * - Automatic cleanup on client disconnect
 * - Session-based authentication (INSTITUTIONAL SECURITY)
 * - Generation/account reconciliation for data integrity
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse as parseCookie } from "cookie";
import { poolWeb } from "./db";
import crypto from "crypto";
import { log } from "./vite";

interface LivePnLUpdate {
  type: "LIVE_PNL_UPDATE";
  botId: string;
  /** Unrealized P&L in dollars. null when position is closed. */
  unrealizedPnl: number | null;
  /** Current mark price. null when position is closed or mark unavailable. */
  currentPrice: number | null;
  /** Entry price of position. null when position is closed. */
  entryPrice: number | null;
  side?: "LONG" | "SHORT" | null;
  timestamp: number;
  generationId?: number;
  accountAttemptId?: string;
  /** INSTITUTIONAL SAFETY: Explicit flag indicating position is actively held. 
   * Client MUST check this flag before displaying position duration.
   * Only set to true when there's a verified active position. */
  livePositionActive?: boolean;
  /** Sequence number for ordering - higher numbers are more recent */
  updateSequence?: number;
  /** Mark timestamp for freshness validation. Must be within 15s for valid display. */
  markTimestamp?: number;
  /** Whether the mark price is fresh (<=15s old). false = show "Awaiting live mark" */
  markFresh?: boolean;
  /** Position quantity (contracts). null when no position. */
  positionQuantity?: number | null;
  /** Position side alias. null when no position. */
  positionSide?: "LONG" | "SHORT" | null;
  /** Stop loss price. null when no position or stop not set. */
  stopPrice?: number | null;
  /** Take profit target price. null when no position or target not set. */
  targetPrice?: number | null;
  /** ISO timestamp when position was opened. null when no position. */
  positionOpenedAt?: string | null;
  /** Reason code for entry signal. null when no position. */
  entryReasonCode?: string | null;
  /** Current session state (ACTIVE, CLOSED, NO_TRADE_WINDOW). */
  sessionState?: string;
  /** Whether runner is sleeping (market closed). */
  isSleeping?: boolean;
  /** Current runner state. */
  runnerState?: string;
  /** Current activity state (SCANNING, IDLE, etc). */
  activityState?: string;
}

interface HeartbeatUpdate {
  type: "HEARTBEAT_UPDATE";
  botId: string;
  lastHeartbeatAt: string;
  activityState: string | null;
  hasRunner: boolean;
  timestamp: number;
}

interface StageChangeUpdate {
  type: "STAGE_CHANGE";
  botId: string;
  botName: string;
  fromStage: string;
  toStage: string;
  changeType: "PROMOTION" | "DEMOTION";
  reason?: string;
  timestamp: number;
}

interface SubscribeMessage {
  type: "SUBSCRIBE" | "UNSUBSCRIBE" | "AUTH";
  botIds?: string[];
  sessionId?: string;
}

interface ClientState {
  subscribedBots: Set<string>;
  ws: WebSocket;
  userId?: string;
  authenticated: boolean;
  lastActivity: number;
  /** Session ID for periodic re-validation */
  sessionId?: string;
  /** Timestamp when session was last validated */
  lastSessionValidation: number;
  /** Connection timestamp for audit */
  connectedAt: number;
}

interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
  /** Raw session ID for periodic re-validation */
  sessionId?: string;
}

class LivePnLWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private lastBroadcast: Map<string, number> = new Map();
  // Configurable via environment variables for production tuning
  private readonly THROTTLE_MS = parseInt(process.env.WS_THROTTLE_MS || "100", 10);
  private readonly SESSION_CHECK_INTERVAL_MS = parseInt(process.env.WS_SESSION_CHECK_MS || "60000", 10);
  private readonly IDLE_TIMEOUT_MS = parseInt(process.env.WS_IDLE_TIMEOUT_MS || "300000", 10); // 5 min default
  private readonly BROADCAST_MAP_TTL_MS = parseInt(process.env.WS_BROADCAST_TTL_MS || "300000", 10); // 5 min TTL for lastBroadcast cleanup
  private readonly REQUIRE_AUTH = process.env.WS_REQUIRE_AUTH !== "false";
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private broadcastCleanupInterval: NodeJS.Timeout | null = null;
  /** Global sequence counter for ordering updates - monotonically increasing */
  private updateSequence: number = 0;

  initialize(server: Server): void {
    if (this.wss) {
      console.log("[WS_SERVER] Already initialized");
      return;
    }

    // Use noServer mode to manually handle upgrade events
    // This ensures WebSocket upgrade happens BEFORE Express can intercept the request
    this.wss = new WebSocketServer({ 
      noServer: true,
      // Disable per-message deflate compression for Replit proxy compatibility
      perMessageDeflate: false
    });
    
    // Manually handle HTTP upgrade event for /ws/live-pnl path
    server.on("upgrade", (request, socket, head) => {
      const pathname = request.url || "";
      if (pathname === "/ws/live-pnl" || pathname.startsWith("/ws/live-pnl?")) {
        log(`[WS_SERVER] Handling upgrade for ${pathname}`);
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          log(`[WS_SERVER] Upgrade complete, emitting connection`);
          this.wss!.emit("connection", ws, request);
        });
      }
      // Other paths will be handled by other upgrade handlers (e.g., research-monitor-ws)
    });
    
    log("[WS_SERVER] LivePnL WebSocket initialized with noServer mode");

    this.wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
      const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
      console.log(`[WS_SERVER] Client connected from ${clientIp}`);
      
      const authResult = await this.authenticateFromRequest(req);
      
      const now = Date.now();
      this.clients.set(ws, {
        subscribedBots: new Set(),
        ws,
        userId: authResult.userId,
        authenticated: authResult.valid,
        lastActivity: now,
        sessionId: authResult.sessionId,
        lastSessionValidation: now,
        connectedAt: now,
      });

      if (this.REQUIRE_AUTH && !authResult.valid) {
        console.log(`[WS_SERVER] Client ${clientIp} not authenticated: ${authResult.error}`);
        ws.send(JSON.stringify({ 
          type: "AUTH_REQUIRED", 
          message: "Authentication required. Please log in.",
          error: authResult.error 
        }));
      } else {
        ws.send(JSON.stringify({ 
          type: "CONNECTED", 
          message: "Live P&L WebSocket ready",
          authenticated: authResult.valid,
          userId: authResult.userId?.slice(0, 8) 
        }));
      }

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as SubscribeMessage;
          this.handleMessage(ws, message);
        } catch (error) {
          console.error("[WS_SERVER] Invalid message:", error);
        }
      });

      ws.on("close", (code, reason) => {
        console.log(`[WS_SERVER] Client disconnected code=${code} reason=${reason?.toString() || 'none'}`);
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[WS_SERVER] Client error:", error);
        this.clients.delete(ws);
      });

      ws.on("pong", () => {
        const client = this.clients.get(ws);
        if (client) {
          client.lastActivity = Date.now();
        }
      });
    });

    this.startSessionCheck();

    console.log(`[WS_SERVER] Live P&L WebSocket server initialized on /ws/live-pnl (auth=${this.REQUIRE_AUTH ? "required" : "optional"})`);
  }

  /**
   * Verify signed session cookie using HMAC-SHA256
   * Session cookies from express-session are in format: s:SID.SIGNATURE
   */
  private verifySessionSignature(signedCookie: string): { valid: boolean; sid?: string } {
    const sessionSecret = process.env.SESSION_SECRET || process.env.REPL_ID || "default-secret";
    
    if (!signedCookie.startsWith("s:")) {
      return { valid: false };
    }
    
    const value = signedCookie.slice(2);
    const dotIndex = value.lastIndexOf(".");
    
    if (dotIndex === -1) {
      return { valid: false };
    }
    
    const sid = value.slice(0, dotIndex);
    const providedSig = value.slice(dotIndex + 1);
    
    const expectedSig = crypto
      .createHmac("sha256", sessionSecret)
      .update(sid)
      .digest("base64")
      .replace(/=+$/, "");
    
    const sigBuffer = Buffer.from(providedSig);
    const expectedBuffer = Buffer.from(expectedSig);
    
    if (sigBuffer.length !== expectedBuffer.length) {
      console.warn("[WS_SERVER] SESSION_SIGNATURE_MISMATCH: length mismatch");
      return { valid: false };
    }
    
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      console.warn("[WS_SERVER] SESSION_SIGNATURE_MISMATCH: signature invalid");
      return { valid: false };
    }
    
    return { valid: true, sid };
  }
  
  private async authenticateFromRequest(req: IncomingMessage): Promise<AuthResult> {
    try {
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        return { valid: false, error: "NO_COOKIES" };
      }

      const cookies = parseCookie(cookieHeader);
      const sessionCookie = cookies["connect.sid"];
      
      if (!sessionCookie) {
        return { valid: false, error: "NO_SESSION_COOKIE" };
      }

      // INSTITUTIONAL SECURITY: Verify session signature before trusting SID
      const sigResult = this.verifySessionSignature(sessionCookie);
      
      if (!sigResult.valid || !sigResult.sid) {
        console.warn("[WS_SERVER] SEV-1 INVALID_SESSION_SIGNATURE - potential session forgery attempt");
        return { valid: false, error: "INVALID_SIGNATURE" };
      }
      
      const rawSid = sigResult.sid;

      const result = await poolWeb.query(
        `SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
        [rawSid]
      );

      if (result.rows.length === 0) {
        return { valid: false, error: "SESSION_EXPIRED", sessionId: rawSid };
      }

      const sess = result.rows[0].sess;
      const userId = sess?.userId;

      if (!userId) {
        return { valid: false, error: "NO_USER_ID", sessionId: rawSid };
      }

      return { valid: true, userId, sessionId: rawSid };
    } catch (error) {
      console.error("[WS_SERVER] Auth error:", error);
      return { valid: false, error: "AUTH_ERROR" };
    }
  }
  
  /**
   * Re-validate session is still valid in database
   * Returns false if session has been invalidated/expired
   */
  private async validateSessionStillValid(sessionId: string): Promise<boolean> {
    try {
      const result = await poolWeb.query(
        `SELECT 1 FROM session WHERE sid = $1 AND expire > NOW()`,
        [sessionId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error("[WS_SERVER] Session re-validation error:", error);
      return false;
    }
  }

  private startSessionCheck(): void {
    if (this.sessionCheckInterval) return;
    
    // Start broadcast map TTL cleanup to prevent memory leaks
    this.startBroadcastCleanup();

    this.sessionCheckInterval = setInterval(async () => {
      const now = Date.now();
      const clientsToRemove: WebSocket[] = [];
      
      for (const [ws, client] of this.clients.entries()) {
        // Check 1: Idle timeout (configurable via WS_IDLE_TIMEOUT_MS env var)
        if (now - client.lastActivity > this.IDLE_TIMEOUT_MS) {
          console.log(`[WS_SERVER] IDLE_TIMEOUT user=${client.userId?.slice(0,8) || "anon"} idle=${Math.round((now - client.lastActivity) / 1000)}s`);
          clientsToRemove.push(ws);
          continue;
        }
        
        // Check 2: Session re-validation (configurable via WS_SESSION_CHECK_MS env var)
        if (client.authenticated && client.sessionId && 
            (now - client.lastSessionValidation > this.SESSION_CHECK_INTERVAL_MS)) {
          const stillValid = await this.validateSessionStillValid(client.sessionId);
          
          if (!stillValid) {
            console.warn(`[WS_SERVER] SESSION_INVALIDATED user=${client.userId?.slice(0,8)} - disconnecting`);
            try {
              ws.send(JSON.stringify({ 
                type: "SESSION_EXPIRED", 
                message: "Your session has expired. Please log in again." 
              }));
            } catch (e) { /* ignore send errors */ }
            clientsToRemove.push(ws);
            continue;
          }
          
          client.lastSessionValidation = now;
        }
        
        // Ping to keep connection alive
        try {
          ws.ping();
        } catch (e) {
          clientsToRemove.push(ws);
        }
      }
      
      // Clean up disconnected/invalidated clients
      for (const ws of clientsToRemove) {
        try {
          ws.terminate();
        } catch (e) { /* ignore */ }
        this.clients.delete(ws);
      }
    }, this.SESSION_CHECK_INTERVAL_MS);
  }

  private handleMessage(ws: WebSocket, message: SubscribeMessage & { type: string }): void {
    const client = this.clients.get(ws);
    if (!client) return;

    client.lastActivity = Date.now();
    
    // Handle PING immediately without auth check (keep-alive)
    if (message.type === "PING") {
      try {
        ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
      } catch (e) {
        // Ignore send errors
      }
      return;
    }

    if (this.REQUIRE_AUTH && !client.authenticated) {
      ws.send(JSON.stringify({ 
        type: "ERROR", 
        message: "Authentication required before subscribing" 
      }));
      return;
    }

    if (message.type === "SUBSCRIBE" && Array.isArray(message.botIds)) {
      message.botIds.forEach((botId) => client.subscribedBots.add(botId));
      console.log(`[WS_SERVER] Client subscribed to ${message.botIds.length} bots (user=${client.userId?.slice(0,8) || "anon"})`);
      ws.send(JSON.stringify({ type: "SUBSCRIBED", botIds: message.botIds }));
    } else if (message.type === "UNSUBSCRIBE" && Array.isArray(message.botIds)) {
      message.botIds.forEach((botId) => client.subscribedBots.delete(botId));
      console.log(`[WS_SERVER] Client unsubscribed from ${message.botIds.length} bots`);
      ws.send(JSON.stringify({ type: "UNSUBSCRIBED", botIds: message.botIds }));
    }
  }

  broadcastLivePnL(update: Omit<LivePnLUpdate, "type" | "timestamp" | "updateSequence">): void {
    if (!this.wss || this.clients.size === 0) return;

    const now = Date.now();
    const lastTime = this.lastBroadcast.get(update.botId) || 0;
    
    if (now - lastTime < this.THROTTLE_MS) {
      return;
    }
    
    this.lastBroadcast.set(update.botId, now);
    
    // Increment global sequence for ordering
    this.updateSequence++;

    const message: LivePnLUpdate = {
      type: "LIVE_PNL_UPDATE",
      ...update,
      timestamp: now,
      updateSequence: this.updateSequence,
    };

    const payload = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.subscribedBots.has(update.botId) && client.ws.readyState === WebSocket.OPEN) {
        if (this.REQUIRE_AUTH && !client.authenticated) {
          return;
        }
        try {
          client.ws.send(payload);
        } catch (error) {
          console.error("[WS_SERVER] Failed to send to client:", error);
        }
      }
    });
  }

  broadcastLivePnLWithReconciliation(update: {
    botId: string;
    unrealizedPnl: number;
    currentPrice: number;
    entryPrice: number;
    side: "LONG" | "SHORT";
    generationId?: number;
    accountAttemptId?: string;
  }): void {
    this.broadcastLivePnL(update);
  }

  broadcastAll(updates: Array<Omit<LivePnLUpdate, "type" | "timestamp">>): void {
    updates.forEach((update) => this.broadcastLivePnL(update));
  }

  broadcastHeartbeat(update: Omit<HeartbeatUpdate, "type" | "timestamp">): void {
    if (!this.wss || this.clients.size === 0) return;

    const message: HeartbeatUpdate = {
      type: "HEARTBEAT_UPDATE",
      ...update,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.subscribedBots.has(update.botId) && client.ws.readyState === WebSocket.OPEN) {
        if (this.REQUIRE_AUTH && !client.authenticated) {
          return;
        }
        try {
          client.ws.send(payload);
        } catch (error) {
          console.error("[WS_SERVER] Failed to send heartbeat to client:", error);
        }
      }
    });
  }

  broadcastHeartbeatBatch(updates: Array<Omit<HeartbeatUpdate, "type" | "timestamp">>): void {
    updates.forEach((update) => this.broadcastHeartbeat(update));
  }

  /**
   * Broadcast stage change notifications (promotions/demotions) to all subscribed clients.
   * These are NOT throttled as they are rare, important events.
   */
  broadcastStageChange(update: Omit<StageChangeUpdate, "type" | "timestamp">): void {
    if (!this.wss || this.clients.size === 0) return;

    const message: StageChangeUpdate = {
      type: "STAGE_CHANGE",
      ...update,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(message);

    log(`[WS_SERVER] Broadcasting stage change: ${update.botName} ${update.fromStage} → ${update.toStage} (${update.changeType})`);

    // Broadcast to ALL authenticated clients (not just those subscribed to this bot)
    // Stage changes are important enough to notify everyone
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        if (this.REQUIRE_AUTH && !client.authenticated) {
          return;
        }
        try {
          client.ws.send(payload);
        } catch (error) {
          console.error("[WS_SERVER] Failed to send stage change to client:", error);
        }
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getAuthenticatedClientCount(): number {
    let count = 0;
    this.clients.forEach((client) => {
      if (client.authenticated) count++;
    });
    return count;
  }

  getSubscriptionCount(botId: string): number {
    let count = 0;
    this.clients.forEach((client) => {
      if (client.subscribedBots.has(botId)) count++;
    });
    return count;
  }

  getTotalSubscriptions(): number {
    let total = 0;
    this.clients.forEach((client) => {
      total += client.subscribedBots.size;
    });
    return total;
  }

  getMetrics(): {
    connectedClients: number;
    authenticatedClients: number;
    subscriptionsTotal: number;
    messagesSent24h: number;
    lastBroadcastAt: string | null;
  } {
    return {
      connectedClients: this.clients.size,
      authenticatedClients: this.getAuthenticatedClientCount(),
      subscriptionsTotal: this.getTotalSubscriptions(),
      messagesSent24h: 0,
      lastBroadcastAt: this.lastBroadcast.size > 0 
        ? new Date(Math.max(...this.lastBroadcast.values())).toISOString()
        : null,
    };
  }

  /**
   * Periodically clean up stale entries in lastBroadcast map to prevent memory leaks
   * Entries older than BROADCAST_MAP_TTL_MS are removed
   */
  private startBroadcastCleanup(): void {
    if (this.broadcastCleanupInterval) return;
    
    this.broadcastCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, timestamp] of this.lastBroadcast.entries()) {
        if (now - timestamp > this.BROADCAST_MAP_TTL_MS) {
          this.lastBroadcast.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[WS_SERVER] BROADCAST_CLEANUP removed ${cleaned} stale entries, remaining=${this.lastBroadcast.size}`);
      }
    }, 60_000); // Run cleanup every minute
  }

  shutdown(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    if (this.broadcastCleanupInterval) {
      clearInterval(this.broadcastCleanupInterval);
      this.broadcastCleanupInterval = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    this.lastBroadcast.clear();
  }
}

export const livePnLWebSocket = new LivePnLWebSocketServer();
