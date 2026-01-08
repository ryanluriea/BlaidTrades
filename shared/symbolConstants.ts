export type SymbolClass = 'STANDARD' | 'MICRO';

export interface SymbolPair {
  standard: string;
  micro: string;
}

export const SYMBOL_PAIRS: SymbolPair[] = [
  { standard: 'ES', micro: 'MES' },
  { standard: 'NQ', micro: 'MNQ' },
  { standard: 'YM', micro: 'MYM' },
  { standard: 'RTY', micro: 'M2K' },
  { standard: 'CL', micro: 'MCL' },
  { standard: 'GC', micro: 'MGC' },
];

export const STANDARD_SYMBOLS = SYMBOL_PAIRS.map(p => p.standard);
export const MICRO_SYMBOLS = SYMBOL_PAIRS.map(p => p.micro);
export const ALL_SYMBOLS = [...STANDARD_SYMBOLS, ...MICRO_SYMBOLS];

export function extractBaseAndSuffix(symbol: string): { base: string; suffix: string } {
  const match = symbol.match(/^([A-Z0-9]+?)([A-Z]\d{1,2}|\d{4}|[A-Z]\d{4})?$/);
  if (!match) return { base: symbol, suffix: '' };
  
  for (const pair of SYMBOL_PAIRS) {
    if (symbol.startsWith(pair.micro)) {
      return { base: pair.micro, suffix: symbol.slice(pair.micro.length) };
    }
    if (symbol.startsWith(pair.standard)) {
      return { base: pair.standard, suffix: symbol.slice(pair.standard.length) };
    }
  }
  
  return { base: symbol, suffix: '' };
}

export function getSymbolClass(symbol: string): SymbolClass {
  const { base } = extractBaseAndSuffix(symbol);
  if (MICRO_SYMBOLS.includes(base)) return 'MICRO';
  return 'STANDARD';
}

export function convertSymbol(symbol: string, toClass: SymbolClass): string | null {
  const { base, suffix } = extractBaseAndSuffix(symbol);
  
  const pair = SYMBOL_PAIRS.find(p => p.standard === base || p.micro === base);
  if (!pair) return null;
  
  const currentClass = pair.micro === base ? 'MICRO' : 'STANDARD';
  if (currentClass === toClass) return symbol;
  
  const newBase = toClass === 'MICRO' ? pair.micro : pair.standard;
  return newBase + suffix;
}

export function getCounterpart(symbol: string): string | null {
  const currentClass = getSymbolClass(symbol);
  return convertSymbol(symbol, currentClass === 'MICRO' ? 'STANDARD' : 'MICRO');
}

export function getBasePair(symbol: string): SymbolPair | null {
  const { base } = extractBaseAndSuffix(symbol);
  return SYMBOL_PAIRS.find(p => p.standard === base || p.micro === base) || null;
}
