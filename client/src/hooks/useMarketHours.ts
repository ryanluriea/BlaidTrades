import { useQuery } from "@tanstack/react-query";

export interface MarketHoursData {
  isOpen: boolean;
  sessionType: 'GLOBEX' | 'RTH' | 'CLOSED' | 'MAINTENANCE';
  exchange: string;
  exchangeTz: string;
  currentTime: string;
  nextOpen: string | null;
  nextClose: string | null;
  reason: string;
  holiday: { name: string; earlyClose?: string } | null;
}

export function useMarketHours(symbol: string = 'ES') {
  return useQuery({
    queryKey: ['market-hours', symbol],
    queryFn: async (): Promise<MarketHoursData> => {
      try {
        const response = await fetch('/api/market-hours');
        if (response.ok) {
          return await response.json();
        }
      } catch {
        // Fall through to local calculation
      }
      return getMarketHours();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

function getMarketHours(): MarketHoursData {
  const now = new Date();
  const chicagoTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day = chicagoTime.getDay();
  const hours = chicagoTime.getHours();
  const minutes = chicagoTime.getMinutes();
  const timeDecimal = hours + minutes / 60;
  
  let isOpen = false;
  let sessionType: 'GLOBEX' | 'RTH' | 'CLOSED' | 'MAINTENANCE' = 'CLOSED';
  let reason = 'Market closed';

  if (day === 0) {
    if (hours >= 17) {
      isOpen = true;
      sessionType = 'GLOBEX';
      reason = 'Sunday Globex session';
    } else {
      reason = 'Weekend - market closed';
    }
  } else if (day === 6) {
    reason = 'Weekend - market closed';
  } else if (day === 5) {
    if (timeDecimal < 16) {
      isOpen = true;
      if (timeDecimal >= 8.5 && timeDecimal < 15.25) {
        sessionType = 'RTH';
        reason = 'Regular Trading Hours';
      } else {
        sessionType = 'GLOBEX';
        reason = 'Globex session';
      }
    } else {
      reason = 'Friday close - weekend';
    }
  } else {
    if (timeDecimal >= 17 || timeDecimal < 16) {
      isOpen = true;
      if (timeDecimal >= 8.5 && timeDecimal < 15.25) {
        sessionType = 'RTH';
        reason = 'Regular Trading Hours';
      } else if (timeDecimal >= 16 && timeDecimal < 17) {
        sessionType = 'MAINTENANCE';
        reason = 'Daily maintenance window';
      } else {
        sessionType = 'GLOBEX';
        reason = 'Globex session';
      }
    } else {
      sessionType = 'MAINTENANCE';
      reason = 'Daily maintenance (4:00-5:00 PM CT)';
    }
  }

  return {
    isOpen,
    sessionType,
    exchange: 'CME',
    exchangeTz: 'America/Chicago',
    currentTime: now.toISOString(),
    nextOpen: null,
    nextClose: null,
    reason,
    holiday: null,
  };
}
