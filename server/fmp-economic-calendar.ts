import { InsertEconomicEvent } from "@shared/schema";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health";

interface FMPEconomicEvent {
  event: string;
  date: string;
  country: string;
  actual: number | null;
  previous: number | null;
  change: number | null;
  changePercentage: number | null;
  estimate: number | null;
  impact: string;
  unit?: string;
}

interface FetchResult {
  success: boolean;
  eventsCount: number;
  error?: string;
  dateRange?: { from: string; to: string };
}

function mapImpactLevel(impact: string): string | null {
  const normalized = impact?.toLowerCase() || '';
  if (normalized.includes('high')) return 'HIGH';
  if (normalized.includes('medium')) return 'MEDIUM';
  if (normalized.includes('low')) return 'LOW';
  return null;
}

function mapCountryToCurrency(country: string): string | null {
  const countryMap: Record<string, string> = {
    'US': 'USD',
    'EU': 'EUR',
    'GB': 'GBP',
    'JP': 'JPY',
    'CA': 'CAD',
    'AU': 'AUD',
    'CH': 'CHF',
    'CN': 'CNY',
    'NZ': 'NZD',
  };
  return countryMap[country?.toUpperCase()] || null;
}

export async function fetchFMPEconomicCalendar(
  fromDate: string,
  toDate: string,
  apiKey: string
): Promise<{ events: InsertEconomicEvent[]; error?: string }> {
  // Use stable API endpoint (v4) instead of legacy v3
  const url = `https://financialmodelingprep.com/stable/economic-calendar?from=${fromDate}&to=${toDate}&apikey=${apiKey}`;
  
  console.log(`[FMP_CALENDAR] Fetching from=${fromDate} to=${toDate}`);
  const startTime = Date.now();
  
  try {
    const response = await fetch(url);
    const latencyMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[FMP_CALENDAR] API error: ${response.status} ${response.statusText}`, errorBody.slice(0, 200));
      recordProviderFailure("FMP", `API error: ${response.status} ${response.statusText}`);
      return { 
        events: [], 
        error: `FMP API error: ${response.status} ${response.statusText}` 
      };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      const errorMsg = (data as Record<string, unknown>)?.["Error Message"];
      recordProviderFailure("FMP", typeof errorMsg === 'string' ? errorMsg : "Unexpected response format");
      return { 
        events: [], 
        error: typeof errorMsg === 'string' ? errorMsg : "Unexpected FMP response format" 
      };
    }
    
    const events: InsertEconomicEvent[] = data
      .filter((e: FMPEconomicEvent) => e.event && e.date)
      .map((e: FMPEconomicEvent) => ({
        source: "FMP",
        eventName: e.event,
        eventType: categorizeEvent(e.event),
        country: e.country || null,
        currency: mapCountryToCurrency(e.country),
        impactLevel: mapImpactLevel(e.impact),
        scheduledAt: new Date(e.date),
        actual: e.actual,
        forecast: e.estimate,
        previous: e.previous,
        unit: e.unit || null,
        change: e.change,
        changePercent: e.changePercentage,
        rawJson: e,
      }));
    
    // Record success with latency
    recordProviderSuccess("FMP", latencyMs);
    
    return { events };
  } catch (error) {
    recordProviderFailure("FMP", error instanceof Error ? error.message : "Unknown fetch error");
    return { 
      events: [], 
      error: error instanceof Error ? error.message : "Unknown fetch error" 
    };
  }
}

function categorizeEvent(eventName: string): string {
  const name = eventName.toLowerCase();
  
  if (name.includes('gdp')) return 'GDP';
  if (name.includes('employment') || name.includes('payroll') || name.includes('jobless') || name.includes('unemployment')) return 'EMPLOYMENT';
  if (name.includes('cpi') || name.includes('inflation') || name.includes('ppi')) return 'INFLATION';
  if (name.includes('rate') && (name.includes('interest') || name.includes('federal') || name.includes('bank'))) return 'INTEREST_RATE';
  if (name.includes('trade') || name.includes('export') || name.includes('import')) return 'TRADE';
  if (name.includes('retail') || name.includes('consumer') || name.includes('spending')) return 'CONSUMER';
  if (name.includes('manufacturing') || name.includes('industrial') || name.includes('pmi')) return 'MANUFACTURING';
  if (name.includes('housing') || name.includes('home') || name.includes('building')) return 'HOUSING';
  if (name.includes('earnings') || name.includes('profit')) return 'EARNINGS';
  if (name.includes('sentiment') || name.includes('confidence')) return 'SENTIMENT';
  
  return 'OTHER';
}

export async function refreshEconomicCalendar(
  storage: { upsertEconomicEvents: (events: InsertEconomicEvent[]) => Promise<number> }
): Promise<FetchResult> {
  const apiKey = process.env.FMP_API_KEY;
  
  if (!apiKey) {
    return { success: false, eventsCount: 0, error: "FMP_API_KEY not configured" };
  }
  
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(now.getDate() - 7);
  
  const toDate = new Date(now);
  toDate.setDate(now.getDate() + 30);
  
  const from = fromDate.toISOString().split('T')[0];
  const to = toDate.toISOString().split('T')[0];
  
  const { events, error } = await fetchFMPEconomicCalendar(from, to, apiKey);
  
  if (error) {
    return { success: false, eventsCount: 0, error, dateRange: { from, to } };
  }
  
  const insertedCount = await storage.upsertEconomicEvents(events);
  
  return { 
    success: true, 
    eventsCount: insertedCount, 
    dateRange: { from, to } 
  };
}
