/**
 * Fitness Function v2 with Sharpe Integration
 * PF/Win-rate weighted fitness for evolution optimization
 * Includes Sharpe as smoothness control (anti-gaming rules)
 */

// Import unified thresholds from shared source of truth
import { UNIFIED_STAGE_THRESHOLDS } from '@shared/graduationGates';

export interface FitnessV2Input {
  profitFactor: number;
  winRate: number;
  maxDrawdownPct: number;
  totalTrades: number;
  expectancy: number;
  sharpe?: number;
  // Quality metrics
  chopEntryRate?: number;
  regimeMismatchRate?: number;
  // Validation split
  trainPF?: number;
  validationPF?: number;
  trainWR?: number;
  validationWR?: number;
  // Per-trade or per-day returns for Sharpe calculation
  returns?: number[];
}

export interface FitnessV2Result {
  score: number; // 0-100
  components: {
    pfScore: number;
    wrScore: number;
    sharpeScore: number;
    ddScore: number;
    stabilityScore: number;
    tradeQualityScore: number;
  };
  penalties: string[];
  cappedAt?: number;
  oosAdjustment?: number;
  rawScore?: number;
  fitnessTrain?: number;
  fitnessValidation?: number;
}

// Primary weights (65% of total) - focus on edge
const PRIMARY_WEIGHTS = {
  profitFactor: 0.35,
  winRate: 0.30,
};

// Secondary weights (35% of total) - smoothness + quality
const SECONDARY_WEIGHTS = {
  sharpe: 0.15,
  drawdown: 0.10,
  stability: 0.07,
  tradeQuality: 0.03,
};

// Graduation thresholds - derived from unified LAB thresholds
// Note: Uses LAB thresholds as baseline for fitness scoring
const labThresholds = UNIFIED_STAGE_THRESHOLDS.LAB;
export const GRADUATION_THRESHOLDS = {
  minTrades: labThresholds.minTrades,           // 50 (unified)
  minPF: labThresholds.minProfitFactor,         // 1.2 (unified)
  minWR: labThresholds.minWinRate / 100,        // 0.35 (converted from 35%)
  maxDD: 5000,                                  // Dollar amount (not percentage)
  minSharpe: labThresholds.minSharpe,           // 0.5 (unified)
  maxChopRate: 0.30,
  maxRegimeMismatchRate: 0.25,
};

/**
 * Normalize a value to 0-1 range
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Compute Sharpe ratio from returns array using SAMPLE std dev (n-1)
 * INSTITUTIONAL STANDARD: Use sample variance for unbiased estimation
 */
export function computeSharpe(returns: number[]): number {
  if (!returns || returns.length < 20) return 0; // Minimum 20 samples
  
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  
  // SAMPLE variance (n-1) - correct for sample data
  const sumSquaredDev = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0);
  const sampleVariance = sumSquaredDev / (n - 1);
  const sampleStdDev = Math.sqrt(sampleVariance);
  
  if (sampleStdDev === 0) return 0;
  
  // Subtract risk-free rate (5% annual / 252 trading days)
  const dailyRiskFree = 0.05 / 252;
  const excessReturn = mean - dailyRiskFree;
  
  // Annualize assuming daily returns
  return (excessReturn / sampleStdDev) * Math.sqrt(252);
}

/**
 * Anti-gaming rule: Sharpe only counts fully if PF >= 1.10 and WR >= 0.38
 */
function getSharpeMultiplier(pf: number, wr: number): number {
  if (pf >= 1.10 && wr >= 0.38) return 1.0;
  if (pf >= 1.0 && wr >= 0.35) return 0.7;
  if (pf >= 0.9 && wr >= 0.32) return 0.4;
  return 0.2; // Sharpe doesn't help much if edge is weak
}

/**
 * Compute Fitness v2 score with Sharpe integration
 */
export function computeFitnessV2(input: FitnessV2Input): FitnessV2Result {
  const {
    profitFactor,
    winRate,
    maxDrawdownPct,
    totalTrades,
    sharpe: inputSharpe,
    chopEntryRate = 0,
    regimeMismatchRate = 0,
    trainPF,
    validationPF,
    trainWR,
    validationWR,
    returns,
  } = input;

  const penalties: string[] = [];
  let cappedAt: number | undefined;

  // Calculate Sharpe from returns if not provided
  const sharpe = inputSharpe ?? (returns ? computeSharpe(returns) : 0);

  // Primary metrics (65%)
  // PF Score: 0.5 = bad, 2.0 = excellent
  const pfNorm = normalize(Math.min(profitFactor, 3), 0.5, 2.0);
  const pfScore = pfNorm * 100 * PRIMARY_WEIGHTS.profitFactor;

  // Win Rate Score: 30% = bad, 60% = excellent
  const wrNorm = normalize(winRate, 30, 60);
  const wrScore = wrNorm * 100 * PRIMARY_WEIGHTS.winRate;

  // Secondary metrics (35%)
  // Sharpe Score with anti-gaming multiplier
  const sharpeMultiplier = getSharpeMultiplier(profitFactor, winRate / 100);
  const sharpeNorm = normalize(Math.min(sharpe, 3), 0, 2);
  const sharpeScore = sharpeNorm * 100 * SECONDARY_WEIGHTS.sharpe * sharpeMultiplier;

  // Drawdown Score: lower is better (0% = perfect, 20% = bad)
  const ddNorm = 1 - normalize(maxDrawdownPct, 0, 20);
  const ddScore = ddNorm * 100 * SECONDARY_WEIGHTS.drawdown;

  // Stability Score: consistency across windows
  let stabilityScore = 50 * SECONDARY_WEIGHTS.stability; // Default
  let validationCollapse = false;
  if (trainPF !== undefined && validationPF !== undefined) {
    const pfCollapse = trainPF > 0 ? (trainPF - validationPF) / trainPF : 0;
    if (pfCollapse > 0.30) {
      // >30% PF collapse = heavy penalty (validation collapse)
      stabilityScore = 0;
      validationCollapse = true;
      penalties.push(`VALIDATION_COLLAPSE: PF dropped ${(pfCollapse * 100).toFixed(0)}%`);
    } else if (pfCollapse > 0.15) {
      stabilityScore = (1 - pfCollapse) * 50 * SECONDARY_WEIGHTS.stability;
      penalties.push(`PF collapsed ${(pfCollapse * 100).toFixed(0)}% in validation`);
    } else {
      stabilityScore = (1 - pfCollapse) * 100 * SECONDARY_WEIGHTS.stability;
    }
  }

  // Trade Quality Score
  let tradeQualityScore = 100 * SECONDARY_WEIGHTS.tradeQuality;
  if (chopEntryRate > GRADUATION_THRESHOLDS.maxChopRate) {
    tradeQualityScore *= (1 - chopEntryRate);
    penalties.push(`High chop entry rate: ${(chopEntryRate * 100).toFixed(0)}%`);
  }
  if (regimeMismatchRate > GRADUATION_THRESHOLDS.maxRegimeMismatchRate) {
    tradeQualityScore *= (1 - regimeMismatchRate);
    penalties.push(`Regime mismatch rate: ${(regimeMismatchRate * 100).toFixed(0)}%`);
  }

  // Hard penalties
  if (totalTrades < GRADUATION_THRESHOLDS.minTrades) {
    cappedAt = 60;
    penalties.push(`Insufficient trades: ${totalTrades}/${GRADUATION_THRESHOLDS.minTrades}`);
  }
  if (maxDrawdownPct > 15) {
    penalties.push(`High drawdown: ${maxDrawdownPct.toFixed(1)}%`);
  }
  if (validationCollapse) {
    cappedAt = Math.min(cappedAt ?? 100, 50); // Heavy penalty for validation collapse
  }

  // Compute raw score
  let rawScore = pfScore + wrScore + sharpeScore + ddScore + stabilityScore + tradeQualityScore;

  // Apply cap if insufficient trades or validation collapse
  if (cappedAt !== undefined) {
    rawScore = Math.min(rawScore, cappedAt);
  }

  // Out-of-sample adjustment (train/validation weighting)
  let oosAdjustment: number | undefined;
  let fitnessTrain: number | undefined;
  let fitnessValidation: number | undefined;
  
  if (trainPF !== undefined && validationPF !== undefined) {
    // Calculate separate train/validation fitness
    const trainPfScore = normalize(Math.min(trainPF, 3), 0.5, 2.0) * 100 * PRIMARY_WEIGHTS.profitFactor;
    const valPfScore = normalize(Math.min(validationPF, 3), 0.5, 2.0) * 100 * PRIMARY_WEIGHTS.profitFactor;
    
    fitnessTrain = trainPfScore + wrScore + sharpeScore + ddScore + stabilityScore + tradeQualityScore;
    fitnessValidation = valPfScore + wrScore * (trainWR && validationWR ? validationWR / trainWR : 1) + 
                        sharpeScore + ddScore + stabilityScore + tradeQualityScore;

    // 70% train + 30% validation weighting
    const blendedScore = fitnessTrain * 0.7 + fitnessValidation * 0.3;
    oosAdjustment = blendedScore - rawScore;
    rawScore = blendedScore;
  }

  return {
    score: Math.round(Math.max(0, Math.min(100, rawScore))),
    components: {
      pfScore: Math.round(pfScore),
      wrScore: Math.round(wrScore),
      sharpeScore: Math.round(sharpeScore),
      ddScore: Math.round(ddScore),
      stabilityScore: Math.round(stabilityScore),
      tradeQualityScore: Math.round(tradeQualityScore),
    },
    penalties,
    cappedAt,
    oosAdjustment: oosAdjustment !== undefined ? Math.round(oosAdjustment) : undefined,
    rawScore: Math.round(rawScore),
    fitnessTrain: fitnessTrain !== undefined ? Math.round(fitnessTrain) : undefined,
    fitnessValidation: fitnessValidation !== undefined ? Math.round(fitnessValidation) : undefined,
  };
}

/**
 * Compute Live Eligibility Score (0-100)
 * Used to determine if a CANDIDATE bot is ready for LIVE
 */
export function computeLiveEligibilityScore(input: {
  candidatePassStreak: number;
  sharpe: number;
  maxDrawdownPct: number;
  validationStrength: number; // fitnessValidation / fitnessTrain ratio
  tradeQualityScore: number;
}): { score: number; breakdown: Record<string, number>; ready: boolean; reasons: string[] } {
  const { candidatePassStreak, sharpe, maxDrawdownPct, validationStrength, tradeQualityScore } = input;
  const reasons: string[] = [];

  // Candidate pass consistency (30%)
  const passScore = Math.min(candidatePassStreak / 3, 1) * 30;
  if (candidatePassStreak < 3) {
    reasons.push(`Need ${3 - candidatePassStreak} more consecutive CANDIDATE passes`);
  }

  // Sharpe/stability (25%)
  const sharpeScore = normalize(Math.min(sharpe, 2), 0, 1.5) * 25;
  if (sharpe < GRADUATION_THRESHOLDS.minSharpe) {
    reasons.push(`Sharpe ${sharpe.toFixed(2)} < ${GRADUATION_THRESHOLDS.minSharpe} required`);
  }

  // Drawdown discipline (20%)
  const ddScore = (1 - normalize(maxDrawdownPct, 0, 15)) * 20;
  if (maxDrawdownPct > 10) {
    reasons.push(`Drawdown ${maxDrawdownPct.toFixed(1)}% > 10% target`);
  }

  // Validation strength (15%)
  const valScore = Math.min(validationStrength, 1) * 15;
  if (validationStrength < 0.85) {
    reasons.push(`Validation strength ${(validationStrength * 100).toFixed(0)}% < 85% required`);
  }

  // Trade quality (10%)
  const qualityScore = (tradeQualityScore / 100) * 10;

  const totalScore = Math.round(passScore + sharpeScore + ddScore + valScore + qualityScore);
  const ready = candidatePassStreak >= 3 && 
                sharpe >= GRADUATION_THRESHOLDS.minSharpe && 
                validationStrength >= 0.85;

  return {
    score: totalScore,
    breakdown: {
      passConsistency: Math.round(passScore),
      sharpeStability: Math.round(sharpeScore),
      drawdownDiscipline: Math.round(ddScore),
      validationStrength: Math.round(valScore),
      tradeQuality: Math.round(qualityScore),
    },
    ready,
    reasons,
  };
}

/**
 * Check retirement eligibility
 */
export function checkRetirementEligibility(input: {
  stage: string;
  retirementLocked: boolean;
  daysSinceImprovement: number;
  tournamentCount: number;
  fitnessV2: number;
  laneMedianFitness: number;
  validationCollapseCount: number;
  chopRateHighCount: number;
  regimeMismatchHighCount: number;
}): { eligible: boolean; reason: string | null } {
  const {
    stage,
    retirementLocked,
    daysSinceImprovement,
    tournamentCount,
    fitnessV2,
    laneMedianFitness,
    validationCollapseCount,
    chopRateHighCount,
    regimeMismatchHighCount,
  } = input;

  // Cannot retire LIVE bots or locked bots
  if (stage === 'LIVE' || retirementLocked) {
    return { eligible: false, reason: null };
  }

  // Condition A: Hard stagnation
  if (daysSinceImprovement >= 14 && 
      tournamentCount >= 5 && 
      fitnessV2 < (laneMedianFitness - 5)) {
    return { 
      eligible: true, 
      reason: `STAGNATION: No improvement for ${daysSinceImprovement} days, fitness ${fitnessV2} below lane median ${laneMedianFitness}`
    };
  }

  // Condition B: Validation failure
  if (validationCollapseCount >= 3) {
    return { 
      eligible: true, 
      reason: `OVERFIT: Validation collapsed in ${validationCollapseCount} of last 5 tournaments`
    };
  }

  // Condition C: Chop addiction / regime blindness
  if (chopRateHighCount >= 3 || regimeMismatchHighCount >= 3) {
    return { 
      eligible: true, 
      reason: `QUALITY: High chop rate (${chopRateHighCount}x) or regime mismatch (${regimeMismatchHighCount}x) across evaluations`
    };
  }

  return { eligible: false, reason: null };
}

/**
 * Get fitness bucket from score
 */
export function getFitnessBucket(score: number): { bucket: string; color: string } {
  if (score >= 80) return { bucket: 'A+', color: 'text-emerald-500' };
  if (score >= 65) return { bucket: 'A', color: 'text-green-500' };
  if (score >= 50) return { bucket: 'B', color: 'text-blue-500' };
  if (score >= 35) return { bucket: 'C', color: 'text-amber-500' };
  return { bucket: 'D', color: 'text-destructive' };
}
