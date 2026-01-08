import { useQuery } from "@tanstack/react-query";

export interface EconomicEvent {
  id: string;
  source: string;
  event_name: string;
  event_type: string | null;
  country: string | null;
  currency: string | null;
  impact_level: "LOW" | "MEDIUM" | "HIGH" | null;
  scheduled_at: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  unit: string | null;
  change: number | null;
  change_percent: number | null;
  raw_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Map API response (camelCase) to interface (snake_case)
function mapEventFromApi(apiEvent: Record<string, unknown>): EconomicEvent {
  return {
    id: apiEvent.id as string,
    source: apiEvent.source as string,
    event_name: (apiEvent.eventName || apiEvent.event_name || 'Unnamed Event') as string,
    event_type: (apiEvent.eventType || apiEvent.event_type || null) as string | null,
    country: (apiEvent.country || null) as string | null,
    currency: (apiEvent.currency || null) as string | null,
    impact_level: (apiEvent.impactLevel || apiEvent.impact_level || null) as "LOW" | "MEDIUM" | "HIGH" | null,
    scheduled_at: (apiEvent.scheduledAt || apiEvent.scheduled_at) as string,
    actual: (apiEvent.actual ?? null) as number | null,
    forecast: (apiEvent.forecast ?? null) as number | null,
    previous: (apiEvent.previous ?? null) as number | null,
    unit: (apiEvent.unit || null) as string | null,
    change: (apiEvent.change ?? null) as number | null,
    change_percent: (apiEvent.changePercent ?? apiEvent.change_percent ?? null) as number | null,
    raw_json: (apiEvent.rawJson || apiEvent.raw_json || {}) as Record<string, unknown>,
    created_at: (apiEvent.createdAt || apiEvent.created_at || '') as string,
    updated_at: (apiEvent.updatedAt || apiEvent.updated_at || '') as string,
  };
}

async function fetchEconomicEvents(filters: {
  fromDate?: string;
  toDate?: string;
  impactLevel?: string;
  impactLevels?: string[];
  country?: string;
} = {}): Promise<EconomicEvent[]> {
  const params = new URLSearchParams();
  if (filters.fromDate) params.append('from', filters.fromDate);
  if (filters.toDate) params.append('to', filters.toDate);
  if (filters.impactLevel) params.append('impact', filters.impactLevel);
  if (filters.impactLevels?.length) params.append('impacts', filters.impactLevels.join(','));
  if (filters.country) params.append('country', filters.country);

  try {
    const response = await fetch(`/api/economic-events?${params.toString()}`);
    if (response.ok) {
      const result = await response.json();
      const rawEvents = result.data || [];
      return rawEvents.map(mapEventFromApi);
    }
  } catch {
    // API not available yet
  }
  return [];
}

export function useEconomicEvents(options?: {
  fromDate?: string;
  toDate?: string;
  impactLevel?: "LOW" | "MEDIUM" | "HIGH";
  country?: string;
}) {
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  
  const fromDate = options?.fromDate || today;
  const toDate = options?.toDate || tomorrow;

  return useQuery({
    queryKey: ["economic-events", fromDate, toDate, options?.impactLevel, options?.country],
    queryFn: async () => {
      return await fetchEconomicEvents({
        fromDate,
        toDate,
        impactLevel: options?.impactLevel,
        country: options?.country,
      });
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
  });
}

export function useTodayHighImpactEvents() {
  const today = new Date().toISOString().split("T")[0];
  
  return useQuery({
    queryKey: ["economic-events-today-high-impact"],
    queryFn: async () => {
      return await fetchEconomicEvents({
        fromDate: today,
        toDate: today,
        impactLevels: ["HIGH", "MEDIUM"],
      });
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
  });
}

// Like TradingView - show past 3 days + next 7 days so user can scroll back to see passed events
export function useUpcomingHighImpactEvents() {
  const today = new Date();
  const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  
  return useQuery({
    queryKey: ["economic-events-timeline", threeDaysAgo, weekAhead],
    queryFn: async () => {
      return await fetchEconomicEvents({
        fromDate: threeDaysAgo,
        toDate: weekAhead,
        impactLevels: ["HIGH", "MEDIUM"],
      });
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
  });
}

export function useUpcomingBlockingEvents(windowMinutesBefore = 5, windowMinutesAfter = 10) {
  return useQuery({
    queryKey: ["blocking-macro-events", windowMinutesBefore, windowMinutesAfter],
    queryFn: async (): Promise<EconomicEvent[]> => {
      const now = new Date();
      const windowStart = new Date(now.getTime() - windowMinutesBefore * 60 * 1000);
      const windowEnd = new Date(now.getTime() + windowMinutesAfter * 60 * 1000);

      try {
        const params = new URLSearchParams({
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
          impact: 'HIGH',
        });
        const response = await fetch(`/api/economic-events?${params.toString()}`);
        if (response.ok) {
          const result = await response.json();
          return result.data || [];
        }
      } catch {
        // API not available
      }
      return [];
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  });
}

export function useFetchEconomicCalendar() {
  const fetchCalendar = async (from?: string, to?: string): Promise<any> => {
    try {
      const params = new URLSearchParams();
      if (from) params.append('from', from);
      if (to) params.append('to', to);
      
      const response = await fetch(`/api/economic-calendar/fetch?${params.toString()}`, {
        method: 'POST',
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // API not available
    }
    return { success: false };
  };

  return { fetchCalendar };
}
