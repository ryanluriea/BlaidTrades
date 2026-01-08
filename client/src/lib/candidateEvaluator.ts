/**
 * Candidate Graduation Gate Evaluator
 * Hard rules + scoring for bot promotion to CANDIDATE status
 */

export interface CandidateGateInput {
  tradesCount: number;
  profitFactor: number;
  winRate: number;
  maxDrawdown: number;
  expectancy?: number;
  // For stability calculation
  pf60?: number;
  pf120?: number;
  wr60?: number;
  wr120?: number;
}

export interface CandidateGateResult {
  status: 'PASS' | 'FAIL' | 'NEAR_MISS';
  candidateScore: number;
  failedDimensions: string[];
  reasons: {
    dimension: string;
    current: number;
    required: number;
    delta: number;
    passed: boolean;
  }[];
  stability: {
    pfDelta: number | null;
    wrDelta: number | null;
    isStable: boolean;
  };
}

// Hard thresholds for TRAINEE → CANDIDATE graduation
export const CANDIDATE_THRESHOLDS = {
  minTrades: 60,
  minProfitFactor: 1.15,
  minWinRate: 40, // %
  maxDrawdown: 5000, // $
};

// Scoring weights (total = 100)
const SCORE_WEIGHTS = {
  profitFactor: 40,
  winRate: 40,
  drawdown: 10,
  trades: 10,
};

/**
 * Compute score contribution for a metric
 */
function computeMetricScore(
  current: number,
  required: number,
  maxScore: number,
  direction: 'min' | 'max' = 'min'
): number {
  if (direction === 'min') {
    // Higher is better (PF, WR, trades)
    if (current >= required * 1.5) return maxScore;
    if (current >= required * 1.25) return maxScore * 0.9;
    if (current >= required) return maxScore * 0.8;
    if (current >= required * 0.9) return maxScore * 0.5;
    if (current >= required * 0.75) return maxScore * 0.25;
    return 0;
  } else {
    // Lower is better (drawdown)
    if (current <= required * 0.5) return maxScore;
    if (current <= required * 0.75) return maxScore * 0.9;
    if (current <= required) return maxScore * 0.8;
    if (current <= required * 1.1) return maxScore * 0.5;
    return 0;
  }
}

/**
 * Evaluate a bot against candidate graduation gates
 */
export function evaluateCandidateGate(input: CandidateGateInput): CandidateGateResult {
  const { tradesCount, profitFactor, winRate, maxDrawdown } = input;
  const reasons: CandidateGateResult['reasons'] = [];
  const failedDimensions: string[] = [];

  // Check each dimension
  const tradesPassed = tradesCount >= CANDIDATE_THRESHOLDS.minTrades;
  reasons.push({
    dimension: 'Trades',
    current: tradesCount,
    required: CANDIDATE_THRESHOLDS.minTrades,
    delta: tradesCount - CANDIDATE_THRESHOLDS.minTrades,
    passed: tradesPassed,
  });
  if (!tradesPassed) failedDimensions.push(`Trades: need ${CANDIDATE_THRESHOLDS.minTrades - tradesCount} more`);

  const pfPassed = profitFactor >= CANDIDATE_THRESHOLDS.minProfitFactor;
  reasons.push({
    dimension: 'Profit Factor',
    current: profitFactor,
    required: CANDIDATE_THRESHOLDS.minProfitFactor,
    delta: +(profitFactor - CANDIDATE_THRESHOLDS.minProfitFactor).toFixed(2),
    passed: pfPassed,
  });
  if (!pfPassed) failedDimensions.push(`PF needs +${(CANDIDATE_THRESHOLDS.minProfitFactor - profitFactor).toFixed(2)}`);

  const wrPassed = winRate >= CANDIDATE_THRESHOLDS.minWinRate;
  reasons.push({
    dimension: 'Win Rate',
    current: winRate,
    required: CANDIDATE_THRESHOLDS.minWinRate,
    delta: +(winRate - CANDIDATE_THRESHOLDS.minWinRate).toFixed(1),
    passed: wrPassed,
  });
  if (!wrPassed) failedDimensions.push(`WR needs +${(CANDIDATE_THRESHOLDS.minWinRate - winRate).toFixed(1)}%`);

  const ddPassed = maxDrawdown <= CANDIDATE_THRESHOLDS.maxDrawdown;
  reasons.push({
    dimension: 'Max Drawdown',
    current: maxDrawdown,
    required: CANDIDATE_THRESHOLDS.maxDrawdown,
    delta: +(CANDIDATE_THRESHOLDS.maxDrawdown - maxDrawdown).toFixed(0),
    passed: ddPassed,
  });
  if (!ddPassed) failedDimensions.push(`DD exceeds by $${(maxDrawdown - CANDIDATE_THRESHOLDS.maxDrawdown).toFixed(0)}`);

  // Compute candidate score (0-100)
  const pfScore = computeMetricScore(profitFactor, CANDIDATE_THRESHOLDS.minProfitFactor, SCORE_WEIGHTS.profitFactor);
  const wrScore = computeMetricScore(winRate, CANDIDATE_THRESHOLDS.minWinRate, SCORE_WEIGHTS.winRate);
  const ddScore = computeMetricScore(maxDrawdown, CANDIDATE_THRESHOLDS.maxDrawdown, SCORE_WEIGHTS.drawdown, 'max');
  const tradesScore = computeMetricScore(tradesCount, CANDIDATE_THRESHOLDS.minTrades, SCORE_WEIGHTS.trades);

  const candidateScore = Math.round(pfScore + wrScore + ddScore + tradesScore);

  // Compute stability if we have window data
  const stability: CandidateGateResult['stability'] = {
    pfDelta: input.pf60 !== undefined && input.pf120 !== undefined 
      ? +(input.pf120 - input.pf60).toFixed(2) 
      : null,
    wrDelta: input.wr60 !== undefined && input.wr120 !== undefined 
      ? +(input.wr120 - input.wr60).toFixed(1) 
      : null,
    isStable: true,
  };

  // Stability check: large regression between windows is unstable
  if (stability.pfDelta !== null && stability.pfDelta < -0.2) {
    stability.isStable = false;
  }
  if (stability.wrDelta !== null && stability.wrDelta < -5) {
    stability.isStable = false;
  }

  // Determine status
  const allPassed = tradesPassed && pfPassed && wrPassed && ddPassed;
  const nearMissThreshold = 75; // Score >= 75 but not all passed = near miss

  let status: CandidateGateResult['status'];
  if (allPassed) {
    status = 'PASS';
  } else if (candidateScore >= nearMissThreshold) {
    status = 'NEAR_MISS';
  } else {
    status = 'FAIL';
  }

  return {
    status,
    candidateScore,
    failedDimensions,
    reasons,
    stability,
  };
}

/**
 * Get display info for candidate status
 */
export function getCandidateStatusDisplay(status: CandidateGateResult['status']) {
  switch (status) {
    case 'PASS':
      return { label: 'CANDIDATE', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', icon: '✅' };
    case 'NEAR_MISS':
      return { label: 'NEAR MISS', color: 'text-amber-500', bgColor: 'bg-amber-500/10', icon: '🟡' };
    case 'FAIL':
      return { label: 'FAIL', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: '❌' };
  }
}
