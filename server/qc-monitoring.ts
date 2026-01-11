/**
 * INSTITUTIONAL QC MONITORING
 * 
 * Centralized monitoring and logging for:
 * - Parse method tracking (AST_PARSER | HEURISTIC | ARCHETYPE_FALLBACK)
 * - Verification gate outcomes
 * - Walk-forward analysis results
 * - Optimization run metrics
 * - Provenance chain audit trail
 */

import type { InstitutionalVerification, WalkForwardSummary, OptimizationSummary } from './providers/quantconnect/qcOptimization';
import type { ProvenanceRecord } from './providers/quantconnect/ruleParser';

export type ParseMethod = 'AST_PARSER' | 'HEURISTIC' | 'ARCHETYPE_FALLBACK';

export interface ParseMethodMetrics {
  method: ParseMethod;
  confidence: number;
  indicatorCount: number;
  parseTimeMs: number;
  candidateId?: string;
  botId?: string;
  provenance?: ProvenanceRecord;
}

export interface VerificationGateMetrics {
  botId: string;
  candidateId?: string;
  gatesPassed: number;
  gatesTotal: number;
  overallScore: number;
  recommendation: string;
  failedGates: string[];
  timestamp: string;
}

export interface MonitoringMetrics {
  parseMethodCounts: Record<ParseMethod, number>;
  avgConfidenceByMethod: Record<ParseMethod, number>;
  verificationPassRate: number;
  walkForwardPassRate: number;
  totalProcessed: number;
  lastUpdated: string;
}

const parseMethodStats: Map<ParseMethod, { count: number; totalConfidence: number }> = new Map([
  ['AST_PARSER', { count: 0, totalConfidence: 0 }],
  ['HEURISTIC', { count: 0, totalConfidence: 0 }],
  ['ARCHETYPE_FALLBACK', { count: 0, totalConfidence: 0 }],
]);

const recentVerifications: VerificationGateMetrics[] = [];
const MAX_RECENT_VERIFICATIONS = 100;

let totalVerificationsPassed = 0;
let totalVerificationsRun = 0;
let totalWalkForwardPassed = 0;
let totalWalkForwardRun = 0;

export function recordParseMethod(metrics: ParseMethodMetrics): void {
  const stats = parseMethodStats.get(metrics.method)!;
  stats.count++;
  stats.totalConfidence += metrics.confidence;
  parseMethodStats.set(metrics.method, stats);
  
  const logPrefix = `[QC_PARSE_MONITOR]`;
  const provenanceInfo = metrics.provenance 
    ? ` provenance=${metrics.provenance.inputHash.slice(0, 8)}` 
    : '';
  
  console.log(
    `${logPrefix} method=${metrics.method} confidence=${metrics.confidence}% indicators=${metrics.indicatorCount} ` +
    `time=${metrics.parseTimeMs}ms${provenanceInfo}` +
    (metrics.candidateId ? ` candidate=${metrics.candidateId.slice(0, 8)}` : '') +
    (metrics.botId ? ` bot=${metrics.botId}` : '')
  );
}

export function recordVerificationGate(verification: InstitutionalVerification): void {
  const failedGates = verification.gates
    .filter(g => !g.passed)
    .map(g => g.name);
  
  const metrics: VerificationGateMetrics = {
    botId: verification.botId,
    candidateId: verification.candidateId,
    gatesPassed: verification.gates.filter(g => g.passed).length,
    gatesTotal: verification.gates.length,
    overallScore: verification.overallScore,
    recommendation: verification.recommendation,
    failedGates,
    timestamp: verification.timestamp,
  };
  
  recentVerifications.push(metrics);
  if (recentVerifications.length > MAX_RECENT_VERIFICATIONS) {
    recentVerifications.shift();
  }
  
  totalVerificationsRun++;
  if (verification.overallPassed) {
    totalVerificationsPassed++;
  }
  
  const logPrefix = `[QC_VERIFICATION_MONITOR]`;
  console.log(
    `${logPrefix} bot=${verification.botId} ` +
    `gates=${metrics.gatesPassed}/${metrics.gatesTotal} ` +
    `score=${metrics.overallScore.toFixed(1)} ` +
    `recommendation=${metrics.recommendation}` +
    (failedGates.length > 0 ? ` failed=[${failedGates.join(',')}]` : '')
  );
  
  if (verification.recommendation === 'REJECT') {
    console.warn(
      `${logPrefix} REJECT bot=${verification.botId} ` +
      `failed_gates=[${failedGates.join(',')}] ` +
      `provenance_rules=${verification.provenanceChain.rulesHash.slice(0, 8)}`
    );
  }
}

export function recordWalkForwardResult(summary: WalkForwardSummary, botId: string): void {
  totalWalkForwardRun++;
  if (summary.recommendation === 'PROMOTE') {
    totalWalkForwardPassed++;
  }
  
  const logPrefix = `[QC_WALKFORWARD_MONITOR]`;
  console.log(
    `${logPrefix} bot=${botId} ` +
    `windows=${summary.aggregateMetrics.windowsPassed}/${summary.aggregateMetrics.totalWindows} ` +
    `robustness=${summary.robustnessScore.toFixed(1)}% ` +
    `is_sharpe=${summary.aggregateMetrics.avgInSampleSharpe.toFixed(2)} ` +
    `oos_sharpe=${summary.aggregateMetrics.avgOutOfSampleSharpe.toFixed(2)} ` +
    `degradation=${summary.aggregateMetrics.avgDegradation.toFixed(1)}% ` +
    `recommendation=${summary.recommendation} ` +
    `provenance=${summary.provenanceHash}`
  );
}

export function recordOptimizationResult(summary: OptimizationSummary, botId: string): void {
  const logPrefix = `[QC_OPTIMIZATION_MONITOR]`;
  
  const topParams = summary.bestResult 
    ? JSON.stringify(summary.bestResult.parameters).slice(0, 50) 
    : 'none';
  
  console.log(
    `${logPrefix} bot=${botId} ` +
    `combinations=${summary.completedCombinations}/${summary.totalCombinations} ` +
    `status=${summary.status} ` +
    `best_sharpe=${summary.bestResult?.metrics.sharpe.toFixed(2) || 'N/A'} ` +
    `top_params=${topParams}`
  );
  
  if (Object.keys(summary.parameterSensitivity).length > 0) {
    const sensitivities = Object.entries(summary.parameterSensitivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v.toFixed(1)}%`)
      .join(' ');
    
    console.log(`${logPrefix} bot=${botId} sensitivity: ${sensitivities}`);
  }
}

export function getMonitoringMetrics(): MonitoringMetrics {
  const parseMethodCounts: Record<ParseMethod, number> = {
    AST_PARSER: parseMethodStats.get('AST_PARSER')!.count,
    HEURISTIC: parseMethodStats.get('HEURISTIC')!.count,
    ARCHETYPE_FALLBACK: parseMethodStats.get('ARCHETYPE_FALLBACK')!.count,
  };
  
  const avgConfidenceByMethod: Record<ParseMethod, number> = {} as any;
  for (const [method, stats] of parseMethodStats.entries()) {
    avgConfidenceByMethod[method] = stats.count > 0 
      ? Math.round(stats.totalConfidence / stats.count) 
      : 0;
  }
  
  const totalProcessed = Object.values(parseMethodCounts).reduce((a, b) => a + b, 0);
  
  return {
    parseMethodCounts,
    avgConfidenceByMethod,
    verificationPassRate: totalVerificationsRun > 0 
      ? (totalVerificationsPassed / totalVerificationsRun) * 100 
      : 0,
    walkForwardPassRate: totalWalkForwardRun > 0 
      ? (totalWalkForwardPassed / totalWalkForwardRun) * 100 
      : 0,
    totalProcessed,
    lastUpdated: new Date().toISOString(),
  };
}

export function getRecentVerifications(limit: number = 20): VerificationGateMetrics[] {
  return recentVerifications.slice(-limit);
}

export function getParseMethodDistribution(): { method: ParseMethod; count: number; avgConfidence: number; percentage: number }[] {
  const total = Array.from(parseMethodStats.values()).reduce((a, s) => a + s.count, 0);
  
  return Array.from(parseMethodStats.entries()).map(([method, stats]) => ({
    method,
    count: stats.count,
    avgConfidence: stats.count > 0 ? Math.round(stats.totalConfidence / stats.count) : 0,
    percentage: total > 0 ? Math.round((stats.count / total) * 100) : 0,
  }));
}

export function logMonitoringSummary(): void {
  const metrics = getMonitoringMetrics();
  const distribution = getParseMethodDistribution();
  
  console.log(`[QC_MONITORING_SUMMARY] ============================================`);
  console.log(`[QC_MONITORING_SUMMARY] Total processed: ${metrics.totalProcessed}`);
  console.log(`[QC_MONITORING_SUMMARY] Parse method distribution:`);
  for (const d of distribution) {
    console.log(`[QC_MONITORING_SUMMARY]   ${d.method}: ${d.count} (${d.percentage}%) avg_confidence=${d.avgConfidence}%`);
  }
  console.log(`[QC_MONITORING_SUMMARY] Verification pass rate: ${metrics.verificationPassRate.toFixed(1)}%`);
  console.log(`[QC_MONITORING_SUMMARY] Walk-forward pass rate: ${metrics.walkForwardPassRate.toFixed(1)}%`);
  console.log(`[QC_MONITORING_SUMMARY] ============================================`);
}

export function resetMetrics(): void {
  parseMethodStats.set('AST_PARSER', { count: 0, totalConfidence: 0 });
  parseMethodStats.set('HEURISTIC', { count: 0, totalConfidence: 0 });
  parseMethodStats.set('ARCHETYPE_FALLBACK', { count: 0, totalConfidence: 0 });
  recentVerifications.length = 0;
  totalVerificationsPassed = 0;
  totalVerificationsRun = 0;
  totalWalkForwardPassed = 0;
  totalWalkForwardRun = 0;
}
