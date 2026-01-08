// Canonical CME Instrument Registry for Strategy Lab Discovery Mode
// Single source of truth for futures universes and micro/mini equivalence

export interface CMEInstrument {
  symbol: string;
  name: string;
  exchange: string;
  category: 'INDEX' | 'ENERGY' | 'METALS' | 'FX' | 'RATES' | 'AGRICULTURE';
  type: 'MICRO' | 'MINI' | 'STANDARD';
  tickSize: number;
  tickValue: number;
  multiplier: number;
  equivalentSymbol?: string; // Micro/mini mapping
}

// Complete instrument definitions
export const CME_INSTRUMENTS: Record<string, CMEInstrument> = {
  // Index Futures - Minis
  ES: { symbol: 'ES', name: 'E-mini S&P 500', exchange: 'CME', category: 'INDEX', type: 'MINI', tickSize: 0.25, tickValue: 12.50, multiplier: 50, equivalentSymbol: 'MES' },
  NQ: { symbol: 'NQ', name: 'E-mini Nasdaq-100', exchange: 'CME', category: 'INDEX', type: 'MINI', tickSize: 0.25, tickValue: 5.00, multiplier: 20, equivalentSymbol: 'MNQ' },
  RTY: { symbol: 'RTY', name: 'E-mini Russell 2000', exchange: 'CME', category: 'INDEX', type: 'MINI', tickSize: 0.10, tickValue: 5.00, multiplier: 50, equivalentSymbol: 'M2K' },
  YM: { symbol: 'YM', name: 'E-mini Dow', exchange: 'CBOT', category: 'INDEX', type: 'MINI', tickSize: 1.00, tickValue: 5.00, multiplier: 5, equivalentSymbol: 'MYM' },

  // Index Futures - Micros
  MES: { symbol: 'MES', name: 'Micro E-mini S&P 500', exchange: 'CME', category: 'INDEX', type: 'MICRO', tickSize: 0.25, tickValue: 1.25, multiplier: 5, equivalentSymbol: 'ES' },
  MNQ: { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', exchange: 'CME', category: 'INDEX', type: 'MICRO', tickSize: 0.25, tickValue: 0.50, multiplier: 2, equivalentSymbol: 'NQ' },
  M2K: { symbol: 'M2K', name: 'Micro E-mini Russell 2000', exchange: 'CME', category: 'INDEX', type: 'MICRO', tickSize: 0.10, tickValue: 0.50, multiplier: 5, equivalentSymbol: 'RTY' },
  MYM: { symbol: 'MYM', name: 'Micro E-mini Dow', exchange: 'CBOT', category: 'INDEX', type: 'MICRO', tickSize: 1.00, tickValue: 0.50, multiplier: 0.5, equivalentSymbol: 'YM' },

  // Energy Futures
  CL: { symbol: 'CL', name: 'Crude Oil', exchange: 'NYMEX', category: 'ENERGY', type: 'STANDARD', tickSize: 0.01, tickValue: 10.00, multiplier: 1000, equivalentSymbol: 'MCL' },
  MCL: { symbol: 'MCL', name: 'Micro WTI Crude Oil', exchange: 'NYMEX', category: 'ENERGY', type: 'MICRO', tickSize: 0.01, tickValue: 1.00, multiplier: 100, equivalentSymbol: 'CL' },
  NG: { symbol: 'NG', name: 'Natural Gas', exchange: 'NYMEX', category: 'ENERGY', type: 'STANDARD', tickSize: 0.001, tickValue: 10.00, multiplier: 10000 },

  // Metals Futures
  GC: { symbol: 'GC', name: 'Gold', exchange: 'COMEX', category: 'METALS', type: 'STANDARD', tickSize: 0.10, tickValue: 10.00, multiplier: 100, equivalentSymbol: 'MGC' },
  MGC: { symbol: 'MGC', name: 'Micro Gold', exchange: 'COMEX', category: 'METALS', type: 'MICRO', tickSize: 0.10, tickValue: 1.00, multiplier: 10, equivalentSymbol: 'GC' },
  SI: { symbol: 'SI', name: 'Silver', exchange: 'COMEX', category: 'METALS', type: 'STANDARD', tickSize: 0.005, tickValue: 25.00, multiplier: 5000, equivalentSymbol: 'SIL' },
  SIL: { symbol: 'SIL', name: 'Micro Silver', exchange: 'COMEX', category: 'METALS', type: 'MICRO', tickSize: 0.005, tickValue: 5.00, multiplier: 1000, equivalentSymbol: 'SI' },
  HG: { symbol: 'HG', name: 'Copper', exchange: 'COMEX', category: 'METALS', type: 'STANDARD', tickSize: 0.0005, tickValue: 12.50, multiplier: 25000 },

  // FX Futures
  '6E': { symbol: '6E', name: 'Euro FX', exchange: 'CME', category: 'FX', type: 'STANDARD', tickSize: 0.00005, tickValue: 6.25, multiplier: 125000 },
  '6J': { symbol: '6J', name: 'Japanese Yen', exchange: 'CME', category: 'FX', type: 'STANDARD', tickSize: 0.0000005, tickValue: 6.25, multiplier: 12500000 },
  '6B': { symbol: '6B', name: 'British Pound', exchange: 'CME', category: 'FX', type: 'STANDARD', tickSize: 0.0001, tickValue: 6.25, multiplier: 62500 },
  '6A': { symbol: '6A', name: 'Australian Dollar', exchange: 'CME', category: 'FX', type: 'STANDARD', tickSize: 0.0001, tickValue: 10.00, multiplier: 100000 },

  // Rates Futures
  ZN: { symbol: 'ZN', name: '10-Year T-Note', exchange: 'CBOT', category: 'RATES', type: 'STANDARD', tickSize: 0.015625, tickValue: 15.625, multiplier: 1000 },
  ZB: { symbol: 'ZB', name: '30-Year T-Bond', exchange: 'CBOT', category: 'RATES', type: 'STANDARD', tickSize: 0.03125, tickValue: 31.25, multiplier: 1000 },
  ZF: { symbol: 'ZF', name: '5-Year T-Note', exchange: 'CBOT', category: 'RATES', type: 'STANDARD', tickSize: 0.0078125, tickValue: 7.8125, multiplier: 1000 },
};

// Universe definitions for discovery mode
export const UNIVERSES = {
  CME_CORE: ['ES', 'NQ', 'MES', 'MNQ', 'CL', 'GC', 'SI', '6E', 'ZN', 'ZB'],
  CME_INDEX: ['ES', 'NQ', 'RTY', 'YM'],
  CME_INDEX_MICROS: ['MES', 'MNQ', 'M2K', 'MYM'],
  CME_ENERGY: ['CL', 'NG'],
  CME_ENERGY_MICROS: ['MCL'],
  CME_METALS: ['GC', 'SI', 'HG'],
  CME_METALS_MICROS: ['MGC', 'SIL'],
  CME_FX: ['6E', '6J', '6B', '6A'],
  CME_RATES: ['ZN', 'ZB', 'ZF'],
} as const;

export type UniverseKey = keyof typeof UNIVERSES;

// Equivalence mapping (bidirectional)
export const MICRO_MINI_EQUIVALENTS: Record<string, string> = {
  ES: 'MES', MES: 'ES',
  NQ: 'MNQ', MNQ: 'NQ',
  RTY: 'M2K', M2K: 'RTY',
  YM: 'MYM', MYM: 'YM',
  CL: 'MCL', MCL: 'CL',
  GC: 'MGC', MGC: 'GC',
  SI: 'SIL', SIL: 'SI',
};

// Contract preference types
export type ContractPreference = 'MICROS_ONLY' | 'MINIS_ONLY' | 'BOTH_PREFER_MICROS' | 'BOTH_PREFER_MINIS';

// Helper functions
export function getInstrument(symbol: string): CMEInstrument | undefined {
  return CME_INSTRUMENTS[symbol];
}

export function getEquivalent(symbol: string): string | undefined {
  return MICRO_MINI_EQUIVALENTS[symbol];
}

export function isMicro(symbol: string): boolean {
  return CME_INSTRUMENTS[symbol]?.type === 'MICRO';
}

export function isMini(symbol: string): boolean {
  return CME_INSTRUMENTS[symbol]?.type === 'MINI' || CME_INSTRUMENTS[symbol]?.type === 'STANDARD';
}

export function filterByContractPreference(
  symbols: string[],
  preference: ContractPreference,
  autoMapEquivalents: boolean = true
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const symbol of symbols) {
    const instrument = CME_INSTRUMENTS[symbol];
    if (!instrument) continue;

    const shouldInclude = 
      preference === 'MICROS_ONLY' ? instrument.type === 'MICRO' :
      preference === 'MINIS_ONLY' ? (instrument.type === 'MINI' || instrument.type === 'STANDARD') :
      true; // BOTH modes include all

    if (shouldInclude && !seen.has(symbol)) {
      result.push(symbol);
      seen.add(symbol);

      // Add equivalent if auto-map enabled and preference allows both
      if (autoMapEquivalents && preference.startsWith('BOTH')) {
        const equivalent = MICRO_MINI_EQUIVALENTS[symbol];
        if (equivalent && !seen.has(equivalent)) {
          result.push(equivalent);
          seen.add(equivalent);
        }
      }
    }
  }

  // Sort by preference
  if (preference === 'BOTH_PREFER_MICROS') {
    result.sort((a, b) => {
      const aMicro = isMicro(a);
      const bMicro = isMicro(b);
      if (aMicro && !bMicro) return -1;
      if (!aMicro && bMicro) return 1;
      return 0;
    });
  } else if (preference === 'BOTH_PREFER_MINIS') {
    result.sort((a, b) => {
      const aMini = isMini(a);
      const bMini = isMini(b);
      if (aMini && !bMini) return -1;
      if (!aMini && bMini) return 1;
      return 0;
    });
  }

  return result;
}

export function getUniverseSymbols(
  universe: UniverseKey,
  preference: ContractPreference,
  autoMapEquivalents: boolean = true
): string[] {
  const baseSymbols = UNIVERSES[universe] || UNIVERSES.CME_CORE;
  return filterByContractPreference([...baseSymbols], preference, autoMapEquivalents);
}

// Default timeframes for discovery
export const DISCOVERY_TIMEFRAMES = ['1m', '5m', '15m'];

// Strategy archetype templates for discovery
export const DISCOVERY_ARCHETYPES = [
  'ORB_VARIANTS',
  'VWAP_MEAN_REVERSION',
  'TREND_PULLBACK',
  'BREAKOUT_FAILED_BREAKOUT',
  'VOLATILITY_BANDS',
  'SESSION_BIAS',
  'OPENING_DRIVE',
  'LIQUIDITY_SWEEP',
  'MOMENTUM_BURST',
  'RANGE_BOUND',
] as const;

export type DiscoveryArchetype = typeof DISCOVERY_ARCHETYPES[number];
