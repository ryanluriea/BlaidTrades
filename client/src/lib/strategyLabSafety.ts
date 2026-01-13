type AnyCandidate = {
  regimeAdjustment?: unknown;
  scores?: unknown;
  qcVerification?: unknown;
  blueprint?: unknown;
  linkedBot?: unknown;
  reasoning_json?: unknown;
  evidence_json?: unknown;
  capital_sim_json?: unknown;
  expected_metrics_json?: unknown;
  ai_usage_json?: unknown;
  [key: string]: unknown;
};

function isValidObject(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
}

export interface SafeRegimeAdjustment {
  regimeMatch: string | null;
  originalScore: number;
  adjustedScore: number;
  regimeBonus: number;
  reason: string;
  currentRegime: string;
  isValid: boolean;
}

export function getSafeRegimeAdjustment(candidate: AnyCandidate): SafeRegimeAdjustment {
  const ra = candidate?.regimeAdjustment;
  
  if (!isValidObject(ra)) {
    return {
      regimeMatch: null,
      originalScore: 0,
      adjustedScore: 0,
      regimeBonus: 0,
      reason: '',
      currentRegime: 'Unknown',
      isValid: false,
    };
  }

  const regimeMatch = typeof ra.regimeMatch === 'string' ? ra.regimeMatch : null;
  
  return {
    regimeMatch,
    originalScore: typeof ra.originalScore === 'number' ? ra.originalScore : 0,
    adjustedScore: typeof ra.adjustedScore === 'number' ? ra.adjustedScore : 0,
    regimeBonus: typeof ra.regimeBonus === 'number' ? ra.regimeBonus : 0,
    reason: typeof ra.reason === 'string' ? ra.reason : '',
    currentRegime: typeof ra.currentRegime === 'string' ? ra.currentRegime : 'Unknown',
    isValid: regimeMatch !== null,
  };
}

export interface SafeScores {
  viability_score: number;
  estimated_pf: number;
  estimated_win_rate: number;
  estimated_max_dd: number;
  robustness_score: number;
  estimated_trades_month: number;
  aggregate?: {
    profit_factor: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    total_trades: number;
  };
  isValid: boolean;
}

export function getSafeScores(candidate: AnyCandidate): SafeScores {
  const scores = candidate?.scores;
  
  if (!isValidObject(scores)) {
    return {
      viability_score: 0,
      estimated_pf: 0,
      estimated_win_rate: 0,
      estimated_max_dd: 0,
      robustness_score: 0,
      estimated_trades_month: 0,
      aggregate: undefined,
      isValid: false,
    };
  }

  const aggregate = isValidObject(scores.aggregate) ? {
    profit_factor: typeof (scores.aggregate as Record<string, unknown>).profit_factor === 'number' 
      ? (scores.aggregate as Record<string, unknown>).profit_factor as number : 0,
    sharpe_ratio: typeof (scores.aggregate as Record<string, unknown>).sharpe_ratio === 'number' 
      ? (scores.aggregate as Record<string, unknown>).sharpe_ratio as number : 0,
    max_drawdown: typeof (scores.aggregate as Record<string, unknown>).max_drawdown === 'number' 
      ? (scores.aggregate as Record<string, unknown>).max_drawdown as number : 0,
    win_rate: typeof (scores.aggregate as Record<string, unknown>).win_rate === 'number' 
      ? (scores.aggregate as Record<string, unknown>).win_rate as number : 0,
    total_trades: typeof (scores.aggregate as Record<string, unknown>).total_trades === 'number' 
      ? (scores.aggregate as Record<string, unknown>).total_trades as number : 0,
  } : undefined;

  return {
    viability_score: typeof scores.viability_score === 'number' ? scores.viability_score : 0,
    estimated_pf: typeof scores.estimated_pf === 'number' ? scores.estimated_pf : 0,
    estimated_win_rate: typeof scores.estimated_win_rate === 'number' ? scores.estimated_win_rate : 0,
    estimated_max_dd: typeof scores.estimated_max_dd === 'number' ? scores.estimated_max_dd : 0,
    robustness_score: typeof scores.robustness_score === 'number' ? scores.robustness_score : 0,
    estimated_trades_month: typeof scores.estimated_trades_month === 'number' ? scores.estimated_trades_month : 0,
    aggregate,
    isValid: true,
  };
}

export interface SafeQcVerification {
  status: string | null;
  lastRunAt: string | null;
  score: number;
  isValid: boolean;
}

export function getSafeQcVerification(candidate: AnyCandidate): SafeQcVerification {
  const qc = candidate?.qcVerification;
  
  if (!isValidObject(qc)) {
    return {
      status: null,
      lastRunAt: null,
      score: 0,
      isValid: false,
    };
  }

  return {
    status: typeof qc.status === 'string' ? qc.status : null,
    lastRunAt: typeof qc.lastRunAt === 'string' ? qc.lastRunAt : null,
    score: typeof qc.score === 'number' ? qc.score : 0,
    isValid: typeof qc.status === 'string',
  };
}

export interface SafeBlueprint {
  name: string;
  archetype: string;
  symbol_candidates: string[];
  timeframe_candidates: string[];
  entry_rules: string;
  exit_rules: string;
  failure_modes: string[];
  isValid: boolean;
}

export function getSafeBlueprint(candidate: AnyCandidate): SafeBlueprint {
  const bp = candidate?.blueprint;
  
  if (!isValidObject(bp)) {
    return {
      name: '',
      archetype: 'Custom',
      symbol_candidates: [],
      timeframe_candidates: [],
      entry_rules: '',
      exit_rules: '',
      failure_modes: [],
      isValid: false,
    };
  }

  return {
    name: typeof bp.name === 'string' ? bp.name : '',
    archetype: typeof bp.archetype === 'string' ? bp.archetype : 'Custom',
    symbol_candidates: Array.isArray(bp.symbol_candidates) ? bp.symbol_candidates.filter((s): s is string => typeof s === 'string') : [],
    timeframe_candidates: Array.isArray(bp.timeframe_candidates) ? bp.timeframe_candidates.filter((s): s is string => typeof s === 'string') : [],
    entry_rules: typeof bp.entry_rules === 'string' ? bp.entry_rules : '',
    exit_rules: typeof bp.exit_rules === 'string' ? bp.exit_rules : '',
    failure_modes: Array.isArray(bp.failure_modes) ? bp.failure_modes.filter((s): s is string => typeof s === 'string') : [],
    isValid: true,
  };
}

export interface SafeLinkedBot {
  id: string | null;
  name: string;
  stage: string;
  isValid: boolean;
}

export function getSafeLinkedBot(candidate: AnyCandidate): SafeLinkedBot {
  const bot = candidate?.linkedBot;
  
  if (!isValidObject(bot)) {
    return {
      id: null,
      name: '',
      stage: '',
      isValid: false,
    };
  }

  return {
    id: typeof bot.id === 'string' ? bot.id : null,
    name: typeof bot.name === 'string' ? bot.name : '',
    stage: typeof bot.stage === 'string' ? bot.stage : '',
    isValid: typeof bot.id === 'string',
  };
}

export interface SafeReasoning {
  why_exists: string;
  why_ranked: string;
  what_to_test: string[];
  failure_modes: string[];
  data_signals: string[];
  regime_match: string;
  risk_filters: string[];
  what_invalidates: string;
  adversarial_critique: string[];
  isValid: boolean;
}

export function getSafeReasoning(candidate: AnyCandidate): SafeReasoning {
  const r = candidate?.reasoning_json;
  
  if (!isValidObject(r)) {
    return {
      why_exists: '',
      why_ranked: '',
      what_to_test: [],
      failure_modes: [],
      data_signals: [],
      regime_match: '',
      risk_filters: [],
      what_invalidates: '',
      adversarial_critique: [],
      isValid: false,
    };
  }

  return {
    why_exists: typeof r.why_exists === 'string' ? r.why_exists : '',
    why_ranked: typeof r.why_ranked === 'string' ? r.why_ranked : '',
    what_to_test: Array.isArray(r.what_to_test) ? r.what_to_test.filter((s): s is string => typeof s === 'string') : [],
    failure_modes: Array.isArray(r.failure_modes) ? r.failure_modes.filter((s): s is string => typeof s === 'string') : [],
    data_signals: Array.isArray(r.data_signals) ? r.data_signals.filter((s): s is string => typeof s === 'string') : [],
    regime_match: typeof r.regime_match === 'string' ? r.regime_match : '',
    risk_filters: Array.isArray(r.risk_filters) ? r.risk_filters.filter((s): s is string => typeof s === 'string') : [],
    what_invalidates: typeof r.what_invalidates === 'string' ? r.what_invalidates : '',
    adversarial_critique: Array.isArray(r.adversarial_critique) ? r.adversarial_critique.filter((s): s is string => typeof s === 'string') : [],
    isValid: true,
  };
}

export interface SafeEvidence {
  sources: Array<{ title: string; url?: string; excerpt?: string }>;
  hypotheses: string[];
  hypothesis_count: number;
  isValid: boolean;
}

export function getSafeEvidence(candidate: AnyCandidate): SafeEvidence {
  const e = candidate?.evidence_json;
  
  if (!isValidObject(e)) {
    return {
      sources: [],
      hypotheses: [],
      hypothesis_count: 0,
      isValid: false,
    };
  }

  const sources = Array.isArray(e.sources) 
    ? e.sources.filter((s): s is { title: string; url?: string; excerpt?: string } => 
        isValidObject(s) && typeof (s as Record<string, unknown>).title === 'string'
      ).map(s => ({
        title: typeof s.title === 'string' ? s.title : '',
        url: typeof s.url === 'string' ? s.url : undefined,
        excerpt: typeof s.excerpt === 'string' ? s.excerpt : undefined,
      }))
    : [];

  return {
    sources,
    hypotheses: Array.isArray(e.hypotheses) ? e.hypotheses.filter((s): s is string => typeof s === 'string') : [],
    hypothesis_count: typeof e.hypothesis_count === 'number' ? e.hypothesis_count : sources.length,
    isValid: true,
  };
}

export interface SafeCapitalSim {
  recommended_contract: string;
  base_contracts_by_capital: Record<string, number>;
  sizing_by_capital: Array<{ capital: number; contracts: number; expected_dd_pct: number }>;
  survivability_score: number | null;
  scale_plan: string;
  isValid: boolean;
}

export function getSafeCapitalSim(candidate: AnyCandidate): SafeCapitalSim {
  const cs = candidate?.capital_sim_json;
  
  if (!isValidObject(cs)) {
    return {
      recommended_contract: 'MES',
      base_contracts_by_capital: {},
      sizing_by_capital: [],
      survivability_score: null,
      scale_plan: '',
      isValid: false,
    };
  }

  const base_contracts_by_capital: Record<string, number> = {};
  if (isValidObject(cs.base_contracts_by_capital)) {
    for (const [key, value] of Object.entries(cs.base_contracts_by_capital as Record<string, unknown>)) {
      if (typeof value === 'number') {
        base_contracts_by_capital[key] = value;
      }
    }
  }

  const sizing_by_capital = Array.isArray(cs.sizing_by_capital)
    ? cs.sizing_by_capital.filter((s): s is { capital: number; contracts: number; expected_dd_pct: number } =>
        isValidObject(s) && 
        typeof (s as Record<string, unknown>).capital === 'number' &&
        typeof (s as Record<string, unknown>).contracts === 'number'
      ).map(s => ({
        capital: s.capital,
        contracts: s.contracts,
        expected_dd_pct: typeof s.expected_dd_pct === 'number' ? s.expected_dd_pct : 0,
      }))
    : [];

  return {
    recommended_contract: typeof cs.recommended_contract === 'string' ? cs.recommended_contract : 'MES',
    base_contracts_by_capital,
    sizing_by_capital,
    survivability_score: typeof cs.survivability_score === 'number' ? cs.survivability_score : null,
    scale_plan: typeof cs.scale_plan === 'string' ? cs.scale_plan : '',
    isValid: true,
  };
}

export interface SafeExpectedMetrics {
  trades_per_week: { min: number; max: number } | null;
  max_dd_pct: { min: number; max: number } | null;
  profit_factor: { min: number; max: number } | null;
  robustness: number | null;
  robustness_score: number | null;
  isValid: boolean;
}

export function getSafeExpectedMetrics(candidate: AnyCandidate): SafeExpectedMetrics {
  const m = candidate?.expected_metrics_json;
  
  if (!isValidObject(m)) {
    return {
      trades_per_week: null,
      max_dd_pct: null,
      profit_factor: null,
      robustness: null,
      robustness_score: null,
      isValid: false,
    };
  }

  const parseMinMax = (val: unknown): { min: number; max: number } | null => {
    if (!isValidObject(val)) return null;
    const obj = val as Record<string, unknown>;
    if (typeof obj.min === 'number' && typeof obj.max === 'number') {
      return { min: obj.min, max: obj.max };
    }
    return null;
  };

  return {
    trades_per_week: parseMinMax(m.trades_per_week),
    max_dd_pct: parseMinMax(m.max_dd_pct),
    profit_factor: parseMinMax(m.profit_factor),
    robustness: typeof m.robustness === 'number' ? m.robustness : null,
    robustness_score: typeof m.robustness_score === 'number' ? m.robustness_score : null,
    isValid: true,
  };
}

export interface SafeAiUsage {
  provider: string;
  model: string;
  tokens: number;
  cost_usd: number;
  step: string;
}

export function getSafeAiUsage(candidate: AnyCandidate): SafeAiUsage[] {
  const usage = candidate?.ai_usage_json;
  
  if (!Array.isArray(usage)) {
    return [];
  }

  return usage.filter((u): u is SafeAiUsage => 
    isValidObject(u) && typeof (u as Record<string, unknown>).provider === 'string'
  ).map(u => ({
    provider: typeof u.provider === 'string' ? u.provider : '',
    model: typeof u.model === 'string' ? u.model : '',
    tokens: typeof u.tokens === 'number' ? u.tokens : 0,
    cost_usd: typeof u.cost_usd === 'number' ? u.cost_usd : 0,
    step: typeof u.step === 'string' ? u.step : '',
  }));
}

export function normalizeCandidate<T extends AnyCandidate>(candidate: T): T {
  if (!candidate || typeof candidate !== 'object') {
    return candidate;
  }

  const normalized = { ...candidate };

  const fieldsToCheck = [
    'regimeAdjustment',
    'scores', 
    'qcVerification',
    'blueprint',
    'linkedBot',
    'reasoning_json',
    'evidence_json',
    'capital_sim_json',
    'expected_metrics_json',
  ];

  for (const field of fieldsToCheck) {
    const value = normalized[field];
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.keys(value as object).length === 0) {
        normalized[field] = null;
      }
    }
  }

  return normalized;
}

export function normalizeCandidateArray<T extends AnyCandidate>(candidates: T[]): T[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.map(normalizeCandidate);
}
