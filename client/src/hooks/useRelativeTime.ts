import { useState, useEffect, useCallback } from "react";

/**
 * Parse date string, normalizing PostgreSQL timestamps to UTC
 * PostgreSQL timestamps like "2025-12-28 14:42:00.000" lack timezone info
 * and must be treated as UTC, not local time
 */
function parseAsUTC(dateStr: string): Date {
  let normalized = dateStr.replace(" ", "T");
  // Only append Z if no timezone marker exists (no +/-, or - is before position 10 meaning it's a date separator)
  if (!normalized.includes("+") && !normalized.includes("Z") && !normalized.includes("-", 10)) {
    normalized += "Z";
  }
  return new Date(normalized);
}

function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return "unknown";
  
  let d: Date;
  if (typeof date === "string") {
    d = parseAsUTC(date);
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return "invalid date";
  
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

export function useRelativeTime(date: string | Date | null | undefined): string {
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(date));
  
  useEffect(() => {
    setRelativeTime(formatRelativeTime(date));
    
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(date));
    }, 30000);
    
    return () => clearInterval(interval);
  }, [date]);
  
  return relativeTime;
}

export function useRelativeTimeFormatter(): {
  formatTimeAgo: (date: string | Date | null | undefined) => string;
  tick: number;
} {
  const [tick, setTick] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 10000);
    
    return () => clearInterval(interval);
  }, []);
  
  const formatTimeAgo = useCallback((date: string | Date | null | undefined) => {
    return formatRelativeTime(date);
  }, [tick]);
  
  return { formatTimeAgo, tick };
}

export { formatRelativeTime };
