/**
 * QC Result Normalizer
 * Compares QuantConnect backtest results with local BlaidAgent metrics
 * to determine verification badge state
 * 
 * Badge semantics (QC Pre-Trial Gate):
 * - QC_PASSED: Strategy eligible for Trial promotion
 * - QC_FAILED: Strategy not eligible (hard failure)
 * - QC_INCONCLUSIVE: Strategy not eligible (insufficient data)
 */

import type { QCBacktestMetrics } from "./index";

// New badge states aligned with QC Pre-Trial Gate spec
export type QCBadgeState = "QC_PASSED" | "QC_FAILED" | "QC_INCONCLUSIVE" | "QC_QUEUED" | "QC_RUNNING" | "QC_REQUIRED" | "NONE";

// Legacy badge states for backward compatibility during transition
export type LegacyBadgeState = "VERIFIED" | "DIVERGENT" | "INCONCLUSIVE" | "FAILED" | "QUEUED" | "RUNNING" | "NONE";

export interface LocalMetrics {
  netPnl: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  profitFactor: number | null;
  backtestDays?: number; // Duration of backtest in days
}

export interface NormalizationResult {
  badgeState: QCBadgeState;
  qcScore: number;
  divergenceDetails: DivergenceDetails | null;
  confidenceBoost: number;
  failureReasons?: string[];
  qcGatePassed: boolean; // Explicit gate flag for Trial eligibility
}

export interface DivergenceDetails {
  pnlDivergence: number;
  winRateDivergence: number;
  tradeDivergence: number;
  sharpeDivergence: number | null;
  divergenceLevel: "LOW" | "MEDIUM" | "HIGH";
  primaryDivergenceReason: string;
}

// QC Pre-Trial Gate thresholds (deterministic rubric)
// NOTE: MIN_TRADES lowered to 15 to accommodate conservative strategies
// (e.g., RSI<20/RSI>80 triggers ~15-20 times in 90 days on 5m chart)
const QC_GATE_THRESHOLDS = {
  // Hard requirements for QC_PASSED (all must pass)
  MIN_TRADES: 15,  // Lowered from 30 - conservative strategies generate fewer signals
  MIN_DAYS: 60,
  MIN_PROFIT_FACTOR: 1.10,
  MAX_DRAWDOWN_PCT: 0.25, // 25% max drawdown
  
  // Divergence thresholds (for comparing local vs QC)
  VERIFIED_PNL_DIVERGENCE: 0.15,
  VERIFIED_WINRATE_DIVERGENCE: 0.10,
  VERIFIED_TRADE_DIVERGENCE: 0.20,
  DIVERGENT_PNL_DIVERGENCE: 0.50,
  DIVERGENT_WINRATE_DIVERGENCE: 0.25,
  DIVERGENT_TRADE_DIVERGENCE: 0.40,
  
  // Confidence scoring (QC is small quality factor, max +5 points)
  MAX_CONFIDENCE_BOOST: 5,
  QC_WEIGHT: 0.05,
  PASSED_BASE_BOOST: 5,
  INCONCLUSIVE_BOOST: 0, // No boost for inconclusive
};

// Legacy thresholds for backward compatibility
const THRESHOLDS = {
  VERIFIED_PNL_DIVERGENCE: 0.15,
  VERIFIED_WINRATE_DIVERGENCE: 0.10,
  VERIFIED_TRADE_DIVERGENCE: 0.20,
  DIVERGENT_PNL_DIVERGENCE: 0.50,
  DIVERGENT_WINRATE_DIVERGENCE: 0.25,
  DIVERGENT_TRADE_DIVERGENCE: 0.40,
  MIN_TRADES_FOR_VERIFICATION: 10,
  MAX_CONFIDENCE_BOOST: 12,
  VERIFIED_BASE_BOOST: 8,
  INCONCLUSIVE_BOOST: 2,
};

function calculateDivergence(local: number, qc: number): number {
  if (local === 0 && qc === 0) return 0;
  if (local === 0) return qc === 0 ? 0 : 1;
  return Math.abs(local - qc) / Math.abs(local);
}

function calculateQCScore(qcMetrics: QCBacktestMetrics): number {
  let score = 50;
  
  // Normalize maxDrawdown: QC returns percentage (1.6 = 1.6%), convert to decimal
  // Safety: if < 0.01, assume already normalized
  const normalizedDrawdown = qcMetrics.maxDrawdown >= 0.01 
    ? qcMetrics.maxDrawdown / 100 
    : qcMetrics.maxDrawdown;
  
  if (qcMetrics.netProfit > 0) score += 15;
  if (qcMetrics.profitFactor > 1.2) score += 10;
  if (qcMetrics.sharpeRatio > 1.0) score += 10;
  if (qcMetrics.winRate > 0.5) score += 5;
  if (normalizedDrawdown < 0.10) score += 10;
  else if (normalizedDrawdown < 0.20) score += 5;
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Deterministic QC Pass/Fail Rubric (QC Pre-Trial Gate)
 * All hard requirements must pass for QC_PASSED
 */
function evaluateQCGate(
  qcMetrics: QCBacktestMetrics,
  localMetrics: LocalMetrics,
  traceId: string
): { passed: boolean; failureReasons: string[]; isInconclusive: boolean } {
  const failureReasons: string[] = [];
  let isInconclusive = false;
  
  // Check minimum trades (insufficient = inconclusive, not failed)
  if (qcMetrics.totalTrades < QC_GATE_THRESHOLDS.MIN_TRADES) {
    console.log(`[QC_GATE] trace_id=${traceId} INCONCLUSIVE: trades=${qcMetrics.totalTrades} < ${QC_GATE_THRESHOLDS.MIN_TRADES}`);
    isInconclusive = true;
    failureReasons.push(`Insufficient trades: ${qcMetrics.totalTrades} < ${QC_GATE_THRESHOLDS.MIN_TRADES} required`);
  }
  
  // Check minimum test duration (if available)
  if (localMetrics.backtestDays !== undefined && localMetrics.backtestDays < QC_GATE_THRESHOLDS.MIN_DAYS) {
    console.log(`[QC_GATE] trace_id=${traceId} INCONCLUSIVE: days=${localMetrics.backtestDays} < ${QC_GATE_THRESHOLDS.MIN_DAYS}`);
    isInconclusive = true;
    failureReasons.push(`Insufficient test duration: ${localMetrics.backtestDays} < ${QC_GATE_THRESHOLDS.MIN_DAYS} days required`);
  }
  
  // Check profit factor (hard failure)
  if (qcMetrics.profitFactor < QC_GATE_THRESHOLDS.MIN_PROFIT_FACTOR) {
    console.log(`[QC_GATE] trace_id=${traceId} FAILED: profitFactor=${qcMetrics.profitFactor.toFixed(2)} < ${QC_GATE_THRESHOLDS.MIN_PROFIT_FACTOR}`);
    failureReasons.push(`Profit factor too low: ${qcMetrics.profitFactor.toFixed(2)} < ${QC_GATE_THRESHOLDS.MIN_PROFIT_FACTOR} required`);
  }
  
  // Check max drawdown (hard failure)
  // CRITICAL FIX: QC returns maxDrawdown as percentage (e.g., 1.6 = 1.6%, 0.8 = 0.8%, 25 = 25%)
  // Our threshold is expressed as a decimal (0.25 = 25%)
  // QC always uses percentage format in their statistics API
  // To convert: divide by 100 (1.6 → 0.016, 25 → 0.25)
  // Safety check: if value is unreasonably small (<0.001), assume it's already normalized
  const normalizedDrawdown = qcMetrics.maxDrawdown >= 0.01 
    ? qcMetrics.maxDrawdown / 100 
    : qcMetrics.maxDrawdown;
  
  if (normalizedDrawdown > QC_GATE_THRESHOLDS.MAX_DRAWDOWN_PCT) {
    console.log(`[QC_GATE] trace_id=${traceId} FAILED: maxDrawdown=${(normalizedDrawdown * 100).toFixed(1)}% > ${(QC_GATE_THRESHOLDS.MAX_DRAWDOWN_PCT * 100).toFixed(0)}%`);
    failureReasons.push(`Max drawdown too high: ${(normalizedDrawdown * 100).toFixed(1)}% > ${(QC_GATE_THRESHOLDS.MAX_DRAWDOWN_PCT * 100).toFixed(0)}% limit`);
  }
  
  // Determine if passed (no failures and not inconclusive)
  const hasHardFailures = failureReasons.some(r => 
    r.includes("Profit factor") || r.includes("Max drawdown")
  );
  const passed = !hasHardFailures && !isInconclusive;
  
  return { passed, failureReasons, isInconclusive };
}

export function normalizeResults(
  qcMetrics: QCBacktestMetrics,
  localMetrics: LocalMetrics,
  traceId: string
): NormalizationResult {
  console.log(`[QC_NORMALIZE] trace_id=${traceId} comparing metrics`);
  
  // Evaluate deterministic QC gate
  const gateResult = evaluateQCGate(qcMetrics, localMetrics, traceId);
  const qcScore = calculateQCScore(qcMetrics);
  
  // If inconclusive (insufficient data), return early
  if (gateResult.isInconclusive && !gateResult.failureReasons.some(r => r.includes("Profit factor") || r.includes("Max drawdown"))) {
    console.log(`[QC_NORMALIZE] trace_id=${traceId} QC_INCONCLUSIVE: insufficient sample size`);
    return {
      badgeState: "QC_INCONCLUSIVE",
      qcScore,
      divergenceDetails: null,
      confidenceBoost: QC_GATE_THRESHOLDS.INCONCLUSIVE_BOOST,
      failureReasons: gateResult.failureReasons,
      qcGatePassed: false,
    };
  }
  
  // If hard failures, return failed
  if (!gateResult.passed) {
    console.log(`[QC_NORMALIZE] trace_id=${traceId} QC_FAILED: ${gateResult.failureReasons.join("; ")}`);
    return {
      badgeState: "QC_FAILED",
      qcScore,
      divergenceDetails: null,
      confidenceBoost: 0,
      failureReasons: gateResult.failureReasons,
      qcGatePassed: false,
    };
  }
  
  // Check if we have real local metrics to compare (non-zero values)
  const hasLocalMetrics = localMetrics.totalTrades > 0 || localMetrics.netPnl !== 0;
  
  let divergenceDetails: DivergenceDetails | null = null;
  
  // Only perform divergence checks if we have real local metrics to compare
  if (hasLocalMetrics) {
    const pnlDivergence = calculateDivergence(localMetrics.netPnl, qcMetrics.netProfit);
    const winRateDivergence = Math.abs(localMetrics.winRate - qcMetrics.winRate);
    const tradeDivergence = calculateDivergence(localMetrics.totalTrades, qcMetrics.totalTrades);
    
    let sharpeDivergence: number | null = null;
    if (localMetrics.sharpeRatio !== null) {
      sharpeDivergence = calculateDivergence(localMetrics.sharpeRatio, qcMetrics.sharpeRatio);
    }
    
    let divergenceLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    let primaryDivergenceReason = "";
    
    if (pnlDivergence > QC_GATE_THRESHOLDS.DIVERGENT_PNL_DIVERGENCE) {
      divergenceLevel = "HIGH";
      primaryDivergenceReason = `P&L divergence: ${(pnlDivergence * 100).toFixed(1)}%`;
    } else if (winRateDivergence > QC_GATE_THRESHOLDS.DIVERGENT_WINRATE_DIVERGENCE) {
      divergenceLevel = "HIGH";
      primaryDivergenceReason = `Win rate divergence: ${(winRateDivergence * 100).toFixed(1)}%`;
    } else if (tradeDivergence > QC_GATE_THRESHOLDS.DIVERGENT_TRADE_DIVERGENCE * 2) {
      divergenceLevel = "HIGH";
      primaryDivergenceReason = `Trade count divergence: ${(tradeDivergence * 100).toFixed(1)}%`;
    } else if (pnlDivergence > QC_GATE_THRESHOLDS.VERIFIED_PNL_DIVERGENCE ||
               winRateDivergence > QC_GATE_THRESHOLDS.VERIFIED_WINRATE_DIVERGENCE ||
               tradeDivergence > QC_GATE_THRESHOLDS.VERIFIED_TRADE_DIVERGENCE) {
      divergenceLevel = "MEDIUM";
      primaryDivergenceReason = "Minor divergences detected";
    }
    
    divergenceDetails = {
      pnlDivergence,
      winRateDivergence,
      tradeDivergence,
      sharpeDivergence,
      divergenceLevel,
      primaryDivergenceReason,
    };
    
    let badgeState: QCBadgeState;
    let confidenceBoost: number;
    
    if (divergenceLevel === "HIGH") {
      // High divergence means QC results don't match local - fail
      badgeState = "QC_FAILED";
      confidenceBoost = 0;
      console.log(`[QC_NORMALIZE] trace_id=${traceId} QC_FAILED: ${primaryDivergenceReason}`);
      return {
        badgeState,
        qcScore,
        divergenceDetails,
        confidenceBoost,
        failureReasons: [primaryDivergenceReason],
        qcGatePassed: false,
      };
    } else if (divergenceLevel === "MEDIUM") {
      // Medium divergence is inconclusive
      badgeState = "QC_INCONCLUSIVE";
      confidenceBoost = QC_GATE_THRESHOLDS.INCONCLUSIVE_BOOST;
      console.log(`[QC_NORMALIZE] trace_id=${traceId} QC_INCONCLUSIVE: ${primaryDivergenceReason}`);
      return {
        badgeState,
        qcScore,
        divergenceDetails,
        confidenceBoost,
        failureReasons: [primaryDivergenceReason],
        qcGatePassed: false,
      };
    }
  } else {
    // No local metrics to compare - skip divergence checks entirely
    // Gate is purely based on QC metrics meeting the hard requirements
    console.log(`[QC_NORMALIZE] trace_id=${traceId} skipping divergence checks (no local metrics)`);
  }
  
  // All checks passed - QC_PASSED!
  const passedBadgeState: QCBadgeState = "QC_PASSED";
  // Confidence boost is capped at +5 points per spec
  const qcQualityScore = qcScore / 100; // Normalize to 0-1
  const passedConfidenceBoost = Math.min(
    QC_GATE_THRESHOLDS.MAX_CONFIDENCE_BOOST,
    QC_GATE_THRESHOLDS.PASSED_BASE_BOOST * qcQualityScore
  );
  console.log(`[QC_NORMALIZE] trace_id=${traceId} QC_PASSED: boost=${passedConfidenceBoost.toFixed(1)} qcScore=${qcScore}`);
  
  return {
    badgeState: passedBadgeState,
    qcScore,
    divergenceDetails,
    confidenceBoost: passedConfidenceBoost,
    qcGatePassed: true,
  };
}

export function calculateConfidenceWithBoost(
  currentConfidence: number,
  badgeState: QCBadgeState,
  confidenceBoost: number
): number {
  // Only boost confidence for QC_PASSED (new) or VERIFIED (legacy)
  if (badgeState !== "QC_PASSED") {
    return currentConfidence;
  }
  
  const boostedConfidence = currentConfidence + confidenceBoost;
  // Round to integer - database column is INTEGER type
  return Math.round(Math.min(100, Math.max(0, boostedConfidence)));
}

// Legacy badge state conversion for backward compatibility
export function legacyToNewBadgeState(legacy: LegacyBadgeState): QCBadgeState {
  switch (legacy) {
    case "VERIFIED": return "QC_PASSED";
    case "DIVERGENT": return "QC_FAILED";
    case "INCONCLUSIVE": return "QC_INCONCLUSIVE";
    case "FAILED": return "QC_FAILED";
    case "QUEUED": return "QC_QUEUED";
    case "RUNNING": return "QC_RUNNING";
    case "NONE": return "NONE";
    default: return "NONE";
  }
}

export function newToLegacyBadgeState(newState: QCBadgeState): LegacyBadgeState {
  switch (newState) {
    case "QC_PASSED": return "VERIFIED";
    case "QC_FAILED": return "DIVERGENT";
    case "QC_INCONCLUSIVE": return "INCONCLUSIVE";
    case "QC_QUEUED": return "QUEUED";
    case "QC_RUNNING": return "RUNNING";
    case "QC_REQUIRED": return "NONE";
    case "NONE": return "NONE";
    default: return "NONE";
  }
}

export function shouldInvalidateVerification(
  previousHash: string,
  currentHash: string
): boolean {
  return previousHash !== currentHash;
}
