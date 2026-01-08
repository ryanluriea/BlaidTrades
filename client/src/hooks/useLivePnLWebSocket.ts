/**
 * Real-Time LIVE P&L WebSocket Hook
 * 
 * Subscribes to real-time unrealized P&L updates via WebSocket.
 * Updates are throttled server-side (100ms) to prevent UI overwhelm.
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface LivePnLUpdate {
  type: "LIVE_PNL_UPDATE";
  botId: string;
  unrealizedPnl: number;
  currentPrice: number;
  entryPrice: number;
  side: "LONG" | "SHORT";
  timestamp: number;
}

interface UseLivePnLWebSocketResult {
  updates: Map<string, LivePnLUpdate>;
  isConnected: boolean;
  subscribe: (botIds: string[]) => void;
  unsubscribe: (botIds: string[]) => void;
}

export function useLivePnLWebSocket(initialBotIds: string[] = []): UseLivePnLWebSocketResult {
  const [updates, setUpdates] = useState<Map<string, LivePnLUpdate>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedBots = useRef<Set<string>>(new Set(initialBotIds));
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live-pnl`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        
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
            setUpdates((prev) => {
              const next = new Map(prev);
              next.set(data.botId, data as LivePnLUpdate);
              return next;
            });
          }
        } catch (error) {
          console.error("[WS_HOOK] Failed to parse message:", error);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = (error) => {
        console.error("[WS_HOOK] WebSocket error:", error);
      };
    } catch (error) {
      console.error("[WS_HOOK] Failed to create WebSocket:", error);
    }
  }, []);

  const subscribe = useCallback((botIds: string[]) => {
    botIds.forEach((id) => subscribedBots.current.add(id));
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "SUBSCRIBE",
        botIds,
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

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  useEffect(() => {
    if (initialBotIds.length > 0 && isConnected) {
      subscribe(initialBotIds);
    }
  }, [initialBotIds, isConnected, subscribe]);

  return { updates, isConnected, subscribe, unsubscribe };
}

export function useBotLivePnL(botId: string | undefined): LivePnLUpdate | null {
  const { updates, subscribe, unsubscribe } = useLivePnLWebSocket();
  
  // CRITICAL FIX: Do NOT gate subscription on isConnected
  // Subscribe immediately - the hook queues bot IDs and flushes on socket open
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
