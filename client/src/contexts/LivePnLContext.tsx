/**
 * Shared LivePnL Context Provider
 * 
 * This provider manages a SINGLE WebSocket connection for all bot rows,
 * preventing the scalability issue of one socket per BotTableRow.
 * 
 * Architecture:
 * - Provider creates single WebSocket connection at app level
 * - Individual components subscribe via useLivePnLContext hook
 * - Subscriptions are automatically managed when components mount/unmount
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";

interface LivePnLUpdate {
  type: "LIVE_PNL_UPDATE";
  botId: string;
  unrealizedPnl: number;
  currentPrice: number;
  entryPrice: number;
  side: "LONG" | "SHORT";
  timestamp: number;
  /** INSTITUTIONAL SAFETY: Explicit flag indicating position is actively held.
   * Client MUST check this flag before displaying position duration.
   * Only true when there's a verified active position. */
  livePositionActive?: boolean;
  /** Sequence number for ordering - higher numbers are more recent */
  updateSequence?: number;
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

interface LivePnLContextValue {
  updates: Map<string, LivePnLUpdate>;
  heartbeats: Map<string, HeartbeatUpdate>;
  isConnected: boolean;
  isReconnecting: boolean;  // True when socket disconnected but auto-reconnect pending
  subscribe: (botIds: string[]) => void;
  unsubscribe: (botIds: string[]) => void;
  getUpdate: (botId: string) => LivePnLUpdate | null;
  getHeartbeat: (botId: string) => HeartbeatUpdate | null;
}

const LivePnLContext = createContext<LivePnLContextValue | null>(null);

export function LivePnLProvider({ children }: { children: ReactNode }) {
  const [updates, setUpdates] = useState<Map<string, LivePnLUpdate>>(new Map());
  const [heartbeats, setHeartbeats] = useState<Map<string, HeartbeatUpdate>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);  // Track reconnect state
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedBots = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  /** Track last seen sequence per bot to reject out-of-order packets */
  const lastSequenceRef = useRef<Map<string, number>>(new Map());
  /** Heartbeat interval for keeping connection alive (Replit proxy fix) */
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live-pnl`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[LIVE_PNL_PROVIDER] WebSocket connected");
        setIsConnected(true);
        setIsReconnecting(false);  // Successfully reconnected
        reconnectAttemptsRef.current = 0;
        
        // CRITICAL: Reset sequence tracking on reconnect
        // Server restarts reset updateSequence to 0, so we must clear our watermarks
        // Otherwise all new packets would be rejected as "stale"
        lastSequenceRef.current.clear();
        console.log("[LIVE_PNL_PROVIDER] Reset sequence tracking for fresh server baseline");
        
        // REPLIT PROXY FIX: Send immediate ping to keep connection alive
        // Replit's proxy can terminate idle connections quickly
        try {
          ws.send(JSON.stringify({ type: "PING" }));
        } catch (e) {
          // Ignore send errors on initial ping
        }
        
        // REPLIT PROXY FIX: Start periodic heartbeat (every 25 seconds)
        // This prevents Replit's proxy from terminating idle connections
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "PING" }));
            } catch (e) {
              // Ignore send errors
            }
          }
        }, 25000);
        
        // Flush queued subscriptions on open
        if (subscribedBots.current.size > 0) {
          ws.send(JSON.stringify({
            type: "SUBSCRIBE",
            botIds: Array.from(subscribedBots.current),
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "LIVE_PNL_UPDATE") {
            const update = data as LivePnLUpdate;
            const botId = update.botId;
            
            // INSTITUTIONAL SAFETY: Reject out-of-order packets using sequence numbers
            if (update.updateSequence !== undefined) {
              const lastSeq = lastSequenceRef.current.get(botId) || 0;
              if (update.updateSequence <= lastSeq) {
                // Stale packet - ignore it
                console.log(`[LIVE_PNL_PROVIDER] Ignoring stale packet seq=${update.updateSequence} < ${lastSeq} for bot=${botId.slice(0,8)}`);
                return;
              }
              lastSequenceRef.current.set(botId, update.updateSequence);
            }
            
            setUpdates((prev) => {
              const next = new Map(prev);
              next.set(botId, update);
              return next;
            });
          } else if (data.type === "HEARTBEAT_UPDATE") {
            setHeartbeats((prev) => {
              const next = new Map(prev);
              next.set(data.botId, data as HeartbeatUpdate);
              return next;
            });
          } else if (data.type === "STAGE_CHANGE") {
            const stageChange = data as StageChangeUpdate;
            const isPromotion = stageChange.changeType === "PROMOTION";
            const reasonText = stageChange.reason ? ` (${stageChange.reason})` : "";
            
            toast({
              title: isPromotion ? "Bot Promoted" : "Bot Demoted",
              description: `${stageChange.botName}: ${stageChange.fromStage} → ${stageChange.toStage}${reasonText}`,
              variant: isPromotion ? "default" : "destructive",
              duration: Infinity, // Persistent - requires manual dismiss
            });
          }
        } catch (error) {
          console.error("[LIVE_PNL_PROVIDER] Failed to parse message:", error);
        }
      };

      ws.onclose = (event) => {
        console.log(`[LIVE_PNL_PROVIDER] WebSocket closed code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`);
        setIsConnected(false);
        setIsReconnecting(true);  // Mark as reconnecting to preserve cached data
        wsRef.current = null;
        
        // Clear heartbeat interval on disconnect
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        
        // NOTE: Do NOT clear the updates Map here - preserve cached P&L values during reconnect
        // This allows the stabilized position logic to trust cached WebSocket data over REST
        
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = (error) => {
        console.error("[LIVE_PNL_PROVIDER] WebSocket error:", error);
      };
    } catch (error) {
      console.error("[LIVE_PNL_PROVIDER] Failed to create WebSocket:", error);
    }
  }, []);

  const subscribe = useCallback((botIds: string[]) => {
    const newBots = botIds.filter(id => !subscribedBots.current.has(id));
    if (newBots.length === 0) return;
    
    newBots.forEach((id) => subscribedBots.current.add(id));
    
    if (wsRef.current?.readyState === WebSocket.OPEN && newBots.length > 0) {
      wsRef.current.send(JSON.stringify({
        type: "SUBSCRIBE",
        botIds: newBots,
      }));
    }
  }, []);

  const unsubscribe = useCallback((botIds: string[]) => {
    botIds.forEach((id) => subscribedBots.current.delete(id));
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "UNSUBSCRIBE",
        botIds,
      }));
    }
  }, []);

  const getUpdate = useCallback((botId: string): LivePnLUpdate | null => {
    return updates.get(botId) || null;
  }, [updates]);

  const getHeartbeat = useCallback((botId: string): HeartbeatUpdate | null => {
    return heartbeats.get(botId) || null;
  }, [heartbeats]);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return (
    <LivePnLContext.Provider value={{ updates, heartbeats, isConnected, isReconnecting, subscribe, unsubscribe, getUpdate, getHeartbeat }}>
      {children}
    </LivePnLContext.Provider>
  );
}

export function useLivePnLContext(): LivePnLContextValue {
  const context = useContext(LivePnLContext);
  if (!context) {
    throw new Error("useLivePnLContext must be used within a LivePnLProvider");
  }
  return context;
}

export function useBotLivePnL(botId: string | undefined): LivePnLUpdate | null {
  const { updates, subscribe, unsubscribe } = useLivePnLContext();
  
  // CRITICAL FIX: Do NOT gate subscription on isConnected
  // Subscribe immediately - the context queues bot IDs and flushes on socket open
  // This prevents unsubscribing during reconnects which causes stale REST data to show
  useEffect(() => {
    if (botId) {
      subscribe([botId]);
      return () => unsubscribe([botId]);
    }
  }, [botId, subscribe, unsubscribe]);
  
  if (!botId) return null;
  return updates.get(botId) || null;
}

export interface RealTimeHeartbeat {
  lastHeartbeatAt: string;
  activityState: string | null;
  hasRunner: boolean;
  timestamp: number;
}

export function useBotHeartbeat(botId: string | undefined): RealTimeHeartbeat | null {
  const { heartbeats, subscribe, unsubscribe } = useLivePnLContext();
  
  useEffect(() => {
    if (botId) {
      subscribe([botId]);
      return () => unsubscribe([botId]);
    }
  }, [botId, subscribe, unsubscribe]);
  
  if (!botId) return null;
  const heartbeat = heartbeats.get(botId);
  if (!heartbeat) return null;
  
  return {
    lastHeartbeatAt: heartbeat.lastHeartbeatAt,
    activityState: heartbeat.activityState,
    hasRunner: heartbeat.hasRunner,
    timestamp: heartbeat.timestamp,
  };
}

/**
 * STABILIZED LIVE P&L HOOK
 * 
 * CRITICAL FIX for flicker issue (-$255 → -$5):
 * 
 * The problem: WebSocket sends accurate P&L, but after 5s of no updates,
 * REST data (which may be from an older snapshot) overwrites the fresh WS value.
 * 
 * The solution: While position is open, NEVER let REST overwrite WebSocket/cache
 * values. The WebSocket value persists until position closes or a very long
 * timeout (5 minutes) occurs.
 * 
 * Priority order:
 * 1. Fresh WebSocket data (received within 2 minutes) - ALWAYS wins
 * 2. Cached WebSocket data (while position is open) - persists indefinitely
 * 3. REST data - ONLY used when no WS data exists and position just opened
 * 
 * This prevents the flickering issue where stale REST data briefly overwrites
 * accurate WebSocket P&L during React Query refetches.
 */
interface StabilizedLivePnLResult {
  unrealizedPnl: number | null;
  source: 'websocket' | 'rest' | 'cache';
  timestamp: number;
}

export function useStabilizedLivePnL(
  botId: string | undefined,
  restPnl: number | null | undefined,
  hasOpenPosition: boolean,
  accountId?: string | null,
): StabilizedLivePnLResult {
  const { updates, subscribe, unsubscribe } = useLivePnLContext();
  
  // Subscribe to WebSocket updates
  useEffect(() => {
    if (botId && hasOpenPosition) {
      subscribe([botId]);
      return () => unsubscribe([botId]);
    }
  }, [botId, hasOpenPosition, subscribe, unsubscribe]);
  
  // Cache ref to prevent regression to stale values
  // Tracks both timestamp and value to detect real changes
  const cacheRef = useRef<{
    unrealizedPnl: number | null;
    wsTimestamp: number;  // Last WebSocket update time
    hasEverReceivedWs: boolean; // Track if we've ever gotten WS data for this position
    accountId: string | null; // Track account to reset on change
    positionOpenedAt: number; // When position was detected open
    lastRestPnl: number | null; // Track last REST value to detect changes
    lastRestSeen: number; // When we last saw a different REST value
  }>({
    unrealizedPnl: null,
    wsTimestamp: 0,
    hasEverReceivedWs: false,
    accountId: null,
    positionOpenedAt: 0,
    lastRestPnl: null,
    lastRestSeen: 0,
  });
  
  const now = Date.now();
  
  // CRITICAL: Reset cache when account attempt changes (e.g., after blown account recovery)
  if (accountId && cacheRef.current.accountId !== accountId) {
    cacheRef.current = {
      unrealizedPnl: null,
      wsTimestamp: 0,
      hasEverReceivedWs: false,
      accountId: accountId,
      positionOpenedAt: now,
      lastRestPnl: null,
      lastRestSeen: 0,
    };
  }
  
  // Track when position opens (reset state)
  if (hasOpenPosition && cacheRef.current.positionOpenedAt === 0) {
    cacheRef.current.positionOpenedAt = now;
  } else if (!hasOpenPosition) {
    // Position closed - reset everything
    cacheRef.current = {
      unrealizedPnl: null,
      wsTimestamp: 0,
      hasEverReceivedWs: false,
      accountId: cacheRef.current.accountId,
      positionOpenedAt: 0,
      lastRestPnl: null,
      lastRestSeen: 0,
    };
    return {
      unrealizedPnl: null,
      source: 'cache',
      timestamp: 0,
    };
  }
  
  const wsUpdate = botId ? updates.get(botId) : undefined;
  
  // CASE 1: We have fresh WebSocket data - ALWAYS prefer it and cache it
  // Fresh = received within 2 minutes
  const WS_FRESH_WINDOW = 120000; // 2 minutes
  if (wsUpdate && (now - wsUpdate.timestamp) < WS_FRESH_WINDOW) {
    cacheRef.current = {
      ...cacheRef.current,
      unrealizedPnl: wsUpdate.unrealizedPnl,
      wsTimestamp: wsUpdate.timestamp,
      hasEverReceivedWs: true,
    };
    return {
      unrealizedPnl: wsUpdate.unrealizedPnl,
      source: 'websocket',
      timestamp: wsUpdate.timestamp,
    };
  }
  
  // Track if REST value changed (indicates new data from server)
  const restValueChanged = restPnl !== null && restPnl !== cacheRef.current.lastRestPnl;
  if (restValueChanged) {
    cacheRef.current.lastRestPnl = restPnl;
    cacheRef.current.lastRestSeen = now;
  }
  
  // CASE 2: We have cached WebSocket value - use it, but allow REST takeover after timeout
  if (cacheRef.current.hasEverReceivedWs && cacheRef.current.unrealizedPnl !== null) {
    const cacheAge = now - cacheRef.current.wsTimestamp;
    
    // Use cache if it's less than 2 minutes old
    // After 2 minutes, allow REST to take over if it has genuinely new data
    const WS_CACHE_GRACE = 120000; // 2 minutes grace for cached WS data
    
    if (cacheAge < WS_CACHE_GRACE) {
      // Cache is fresh enough - use it, ignore REST
      return {
        unrealizedPnl: cacheRef.current.unrealizedPnl,
        source: 'cache',
        timestamp: cacheRef.current.wsTimestamp,
      };
    }
    
    // Cache is stale (>2 min) - allow REST to update if it changed recently
    // This handles WebSocket outage scenarios
    if (restPnl !== null && restValueChanged) {
      cacheRef.current.unrealizedPnl = restPnl;
      cacheRef.current.wsTimestamp = now; // Treat REST as new timestamp
      return {
        unrealizedPnl: restPnl,
        source: 'rest',
        timestamp: now,
      };
    }
    
    // No new REST data - continue showing stale cache rather than nothing
    return {
      unrealizedPnl: cacheRef.current.unrealizedPnl,
      source: 'cache',
      timestamp: cacheRef.current.wsTimestamp,
    };
  }
  
  // CASE 3: No WebSocket data yet - use REST to seed initial value
  if (restPnl !== null && restPnl !== undefined) {
    cacheRef.current.unrealizedPnl = restPnl;
    cacheRef.current.lastRestPnl = restPnl;
    cacheRef.current.lastRestSeen = now;
    return {
      unrealizedPnl: restPnl,
      source: 'rest',
      timestamp: now,
    };
  }
  
  // CASE 4: No data at all - return null
  return {
    unrealizedPnl: null,
    source: 'cache',
    timestamp: 0,
  };
}
