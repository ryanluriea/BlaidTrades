// Strategy naming convention utilities

const EDGE_TYPES: Record<string, string> = {
  'mean_reversion': 'MR',
  'vwap_reversion': 'VWAP_MR',
  'trend_following': 'TREND',
  'trend_continuation': 'TREND_CONT',
  'momentum': 'MOM',
  'orb': 'ORB',
  'opening_range': 'ORB',
  'breakout': 'BRKOUT',
  'fade': 'FADE',
  'scalp': 'SCALP',
  'range': 'RANGE',
  'volatility': 'VOL',
};

const REGIME_TYPES: Record<string, string> = {
  'trend': 'TREND',
  'range': 'RANGE',
  'volatile': 'VOL',
  'low_vol': 'LOWVOL',
  'high_vol': 'HIVOL',
  'choppy': 'CHOP',
  'breakout': 'BRKOUT',
};

const SESSION_TYPES: Record<string, string> = {
  'rth': 'RTH',
  'eth': 'ETH',
  'overnight': 'ON',
  'all': 'ALL',
  'asian': 'ASIA',
  'london': 'LON',
  'ny': 'NY',
};

export interface StrategyNames {
  humanName: string;
  systemCodename: string;
}

export function generateStrategyNames(params: {
  archetype?: string;
  instrument?: string;
  regime?: string;
  session?: string;
  version?: number;
  edgeDescription?: string;
}): StrategyNames {
  const { archetype = '', instrument = 'MES', regime = '', session = 'RTH', version = 1, edgeDescription = '' } = params;

  // Parse archetype for edge type
  const archetypeLower = archetype.toLowerCase();
  let edgeCode = 'CUSTOM';
  let edgeHuman = 'Custom Edge';

  for (const [key, code] of Object.entries(EDGE_TYPES)) {
    if (archetypeLower.includes(key)) {
      edgeCode = code;
      edgeHuman = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  // Parse regime
  const regimeLower = (regime || '').toLowerCase();
  let regimeCode = '';
  let regimeHuman = '';

  for (const [key, code] of Object.entries(REGIME_TYPES)) {
    if (regimeLower.includes(key)) {
      regimeCode = code;
      regimeHuman = key.charAt(0).toUpperCase() + key.slice(1);
      break;
    }
  }

  // Parse session
  const sessionLower = (session || '').toLowerCase();
  let sessionCode = 'RTH';
  let sessionHuman = 'RTH';

  for (const [key, code] of Object.entries(SESSION_TYPES)) {
    if (sessionLower.includes(key)) {
      sessionCode = code;
      sessionHuman = code;
      break;
    }
  }

  // Generate human name
  const humanParts: string[] = [];
  if (sessionHuman) humanParts.push(sessionHuman);
  if (edgeHuman) humanParts.push(edgeHuman);
  if (regimeHuman) humanParts.push(regimeHuman);
  humanParts.push('—');
  humanParts.push(instrument);

  const humanName = humanParts.filter(Boolean).join(' ');

  // Generate system codename
  const codenameParts = [edgeCode];
  if (regimeCode) codenameParts.push(regimeCode);
  codenameParts.push(sessionCode);
  codenameParts.push(instrument.toUpperCase());
  codenameParts.push(`v${version}`);

  const systemCodename = codenameParts.join('_');

  return { humanName, systemCodename };
}

export function formatHumanName(name: string): string {
  // Clean up auto-generated names to be more readable
  return name
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function isValidCodename(codename: string): boolean {
  // Validate system codename format: EDGE_REGIME_SESSION_INSTRUMENT_vN
  const pattern = /^[A-Z0-9]+(_[A-Z0-9]+)*_v\d+$/;
  return pattern.test(codename);
}

export function incrementVersion(codename: string): string {
  const match = codename.match(/_v(\d+)$/);
  if (match) {
    const currentVersion = parseInt(match[1], 10);
    return codename.replace(/_v\d+$/, `_v${currentVersion + 1}`);
  }
  return `${codename}_v1`;
}
