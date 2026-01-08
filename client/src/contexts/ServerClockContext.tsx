/**
 * ServerClockContext - Provides accurate server-relative time
 * 
 * Solves clock skew between client and server by:
 * 1. Capturing serverTime from API responses
 * 2. Computing offset between server and client clocks
 * 3. Providing a ticking "now" that uses the corrected time
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

interface ServerClockContextValue {
  /** Get current time adjusted for server clock offset */
  getServerNow: () => number;
  /** Update the clock offset when receiving a serverTime from API */
  updateFromServerTime: (serverTimeIso: string) => void;
  /** Current server-adjusted timestamp (updates every second) */
  serverNow: number;
  /** The computed offset in milliseconds (serverTime - clientTime) */
  clockOffset: number;
}

const ServerClockContext = createContext<ServerClockContextValue | null>(null);

export function ServerClockProvider({ children }: { children: React.ReactNode }) {
  const [clockOffset, setClockOffset] = useState(0);
  const [serverNow, setServerNow] = useState(Date.now());
  const offsetRef = useRef(0);

  const updateFromServerTime = useCallback((serverTimeIso: string) => {
    if (!serverTimeIso) return;
    const serverTime = new Date(serverTimeIso).getTime();
    const clientTime = Date.now();
    const newOffset = serverTime - clientTime;
    
    // Only update if the offset has changed significantly (more than 1 second)
    if (Math.abs(newOffset - offsetRef.current) > 1000) {
      offsetRef.current = newOffset;
      setClockOffset(newOffset);
    }
  }, []);

  const getServerNow = useCallback(() => {
    return Date.now() + offsetRef.current;
  }, []);

  // Tick every second to update serverNow for components that need live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setServerNow(Date.now() + offsetRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ServerClockContext.Provider value={{ getServerNow, updateFromServerTime, serverNow, clockOffset }}>
      {children}
    </ServerClockContext.Provider>
  );
}

export function useServerClock() {
  const context = useContext(ServerClockContext);
  if (!context) {
    // Return a fallback that uses client time if context is not available
    return {
      getServerNow: () => Date.now(),
      updateFromServerTime: () => {},
      serverNow: Date.now(),
      clockOffset: 0,
    };
  }
  return context;
}

/**
 * Parse date string, normalizing PostgreSQL timestamps to UTC
 * PostgreSQL timestamps like "2025-12-28 14:42:00.000" lack timezone info
 * and must be treated as UTC, not local time
 */
function parseAsUTC(dateStr: string): Date {
  let normalized = dateStr.replace(" ", "T");
  if (!normalized.includes("+") && !normalized.includes("Z") && !normalized.includes("-", 10)) {
    normalized += "Z";
  }
  return new Date(normalized);
}

/**
 * Format relative time using server-adjusted clock
 * @param dateStr ISO date string from server
 * @param serverNow Current server-adjusted timestamp
 */
export function formatRelativeTimeWithClock(dateStr: string | null | undefined, serverNow: number): string {
  if (!dateStr) return "";
  const targetTime = parseAsUTC(dateStr).getTime();
  const seconds = Math.floor((serverNow - targetTime) / 1000);
  
  // Handle clock skew: if timestamp appears future, show "just now"
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
