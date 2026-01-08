import { useAppSettings } from "./useSettings";
import { formatInTimeZone } from "date-fns-tz";
import { formatDistanceToNow } from "date-fns";

const DEFAULT_TIMEZONE = "America/New_York";

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

function toDateObject(date: Date | string | number): Date {
  if (date instanceof Date) return date;
  if (typeof date === "number") return new Date(date);
  // String: normalize PostgreSQL format to UTC
  return parseAsUTC(date);
}

export function useTimezone() {
  const { data: settings } = useAppSettings();
  
  const timezone = (settings?.general as Record<string, any>)?.timezone || DEFAULT_TIMEZONE;

  const formatInTimezone = (
    date: Date | string | number | null | undefined,
    formatStr: string = "MMM d, yyyy h:mm a"
  ): string => {
    if (!date) return "";
    try {
      const dateObj = toDateObject(date);
      if (isNaN(dateObj.getTime())) return "";
      return formatInTimeZone(dateObj, timezone, formatStr);
    } catch {
      return "";
    }
  };

  const formatRelative = (
    date: Date | string | number | null | undefined
  ): string => {
    if (!date) return "";
    try {
      const dateObj = toDateObject(date);
      if (isNaN(dateObj.getTime())) return "";
      return formatDistanceToNow(dateObj, { addSuffix: true });
    } catch {
      return "";
    }
  };

  const formatTime = (
    date: Date | string | number | null | undefined
  ): string => {
    return formatInTimezone(date, "h:mm a");
  };

  const formatDate = (
    date: Date | string | number | null | undefined
  ): string => {
    return formatInTimezone(date, "MMM d, yyyy");
  };

  const formatDateTime = (
    date: Date | string | number | null | undefined
  ): string => {
    return formatInTimezone(date, "MMM d, yyyy h:mm a");
  };

  const formatShortDateTime = (
    date: Date | string | number | null | undefined
  ): string => {
    return formatInTimezone(date, "M/d h:mm a");
  };

  const getTimezoneAbbr = (): string => {
    try {
      const now = new Date();
      return formatInTimeZone(now, timezone, "zzz");
    } catch {
      return "ET";
    }
  };

  return {
    timezone,
    formatInTimezone,
    formatRelative,
    formatTime,
    formatDate,
    formatDateTime,
    formatShortDateTime,
    getTimezoneAbbr,
  };
}

function toDateObjectStandalone(date: Date | string | number): Date {
  if (date instanceof Date) return date;
  if (typeof date === "number") return new Date(date);
  return parseAsUTC(date);
}

export function formatInUserTimezone(
  date: Date | string | number | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  formatStr: string = "MMM d, yyyy h:mm a"
): string {
  if (!date) return "";
  try {
    const dateObj = toDateObjectStandalone(date);
    if (isNaN(dateObj.getTime())) return "";
    return formatInTimeZone(dateObj, timezone, formatStr);
  } catch {
    return "";
  }
}
