/**
 * Stage Policies - Single Source of Truth
 * 
 * Defines performance grade, promotion eligibility, and execution mode
 * for each lifecycle stage. Enforced server-side on all stage transitions.
 */

// ============= CANONICAL ENUMS =============

export type PerformanceGrade = "SANDBOX" | "VALID" | "REAL";
export type PromotionEligibility = "DISABLED" | "ELIGIBLE";
export type PromotionState = "READY" | "PENDING_AUDIT" | "BLOCKED";
export type ExecutionModeCanonical = "INTERNAL_SANDBOX" | "INTERNAL_PAPER" | "BROKER_LIVE";
export type LifecycleStage = "TRIALS" | "PAPER" | "SHADOW" | "CANARY" | "LIVE" | "DEGRADED";

// ============= STAGE POLICY MAP =============

export interface StagePolicy {
  performanceGrade: PerformanceGrade;
  promotionEligibility: PromotionEligibility;
  executionMode: ExecutionModeCanonical;
  label: string;
  description: string;
}

export const STAGE_POLICIES: Record<LifecycleStage, StagePolicy> = {
  TRIALS: {
    performanceGrade: "SANDBOX",
    promotionEligibility: "DISABLED",
    executionMode: "INTERNAL_SANDBOX",
    label: "Trials",
    description: "Experimental sandbox for strategy testing & evolution. Results are NOT performance-valid.",
  },
  PAPER: {
    performanceGrade: "VALID",
    promotionEligibility: "ELIGIBLE",
    executionMode: "INTERNAL_PAPER",
    label: "Paper",
    description: "Performance-accurate paper trading with realistic execution. Eligible for promotion after audit.",
  },
  SHADOW: {
    performanceGrade: "VALID",
    promotionEligibility: "ELIGIBLE",
    executionMode: "INTERNAL_PAPER",
    label: "Shadow",
    description: "Shadow trading - mirrors live behavior with sim fills. Dress rehearsal before live.",
  },
  CANARY: {
    performanceGrade: "VALID",
    promotionEligibility: "ELIGIBLE",
    executionMode: "INTERNAL_PAPER",
    label: "Canary",
    description: "Canary deployment - limited real trading with tighter risk caps.",
  },
  LIVE: {
    performanceGrade: "REAL",
    promotionEligibility: "ELIGIBLE",
    executionMode: "BROKER_LIVE",
    label: "Live",
    description: "Live trading - real broker execution with real capital.",
  },
  DEGRADED: {
    performanceGrade: "SANDBOX",
    promotionEligibility: "DISABLED",
    executionMode: "INTERNAL_SANDBOX",
    label: "Degraded",
    description: "Bot is degraded due to errors or violations. Promotion blocked until resolved.",
  },
};

// ============= ACCOUNT SOURCE INFO =============

export interface AccountSourceInfo {
  value: "VIRTUAL" | "SIM" | "BROKER";
  title: string;
  subtitle: string;
  bullets: string[];
  performanceBadge: string;
  promotionBadge: string;
}

export const ACCOUNT_SOURCE_OPTIONS: AccountSourceInfo[] = [
  {
    value: "VIRTUAL",
    title: "Virtual (Sandbox)",
    subtitle: "Experimental sandbox for strategy testing & evolution.",
    bullets: [
      "May use live or historical data (configurable)",
      "Results are NOT performance-valid",
      "Not eligible for promotion by default",
      "Can allow synthetic fills/scenarios (optional)",
    ],
    performanceBadge: "SANDBOX",
    promotionBadge: "DISABLED",
  },
  {
    value: "SIM",
    title: "Simulation (Paper)",
    subtitle: "Performance-accurate paper trading with realistic execution.",
    bullets: [
      "Uses live market data (or replay with timestamped feed)",
      "Enforces capital + risk rules",
      "Simulates latency + slippage",
      "Eligible for promotion after audit",
    ],
    performanceBadge: "VALID",
    promotionBadge: "ELIGIBLE",
  },
  {
    value: "BROKER",
    title: "Live (Broker Connected)",
    subtitle: "Trades on a real broker account with real fills.",
    bullets: [
      "Requires verified broker connection",
      "Uses broker balance + real execution",
      "Protected by kill-switch + safety gates",
    ],
    performanceBadge: "REAL",
    promotionBadge: "N/A",
  },
];

// ============= HELPER FUNCTIONS =============

export function getStagePolicy(stage: string): StagePolicy {
  return STAGE_POLICIES[stage as LifecycleStage] || STAGE_POLICIES.TRIALS;
}

export function isPromotionEligible(stage: string): boolean {
  const policy = getStagePolicy(stage);
  return policy.promotionEligibility === "ELIGIBLE";
}

export function getPerformanceGrade(stage: string): PerformanceGrade {
  return getStagePolicy(stage).performanceGrade;
}

export function getPromotionEligibility(stage: string): PromotionEligibility {
  return getStagePolicy(stage).promotionEligibility;
}

// ============= PROMOTION REASON CODES =============

export interface PromotionBlockReason {
  code: string;
  title: string;
  detail: string;
  severity: "error" | "warning" | "info";
}

export const PROMOTION_REASON_CODES: Record<string, Omit<PromotionBlockReason, "severity"> & { severity: "error" | "warning" | "info" }> = {
  VIRTUAL_NOT_ELIGIBLE: {
    code: "VIRTUAL_NOT_ELIGIBLE",
    title: "Virtual bots can't be promoted",
    detail: "Virtual (Sandbox) results are not performance-valid. Move the bot to Simulation (Paper) first.",
    severity: "error",
  },
  DEGRADED_HEALTH: {
    code: "DEGRADED_HEALTH",
    title: "Bot health is degraded",
    detail: "Resolve health issues before promotion. Check for stale data, risk violations, or execution errors.",
    severity: "error",
  },
  NO_METRICS: {
    code: "NO_METRICS",
    title: "No performance metrics available",
    detail: "Run backtests or paper trades to generate performance metrics before promotion.",
    severity: "error",
  },
  INSUFFICIENT_TRADES: {
    code: "INSUFFICIENT_TRADES",
    title: "Not enough trades",
    detail: "Complete more trades to build a statistically significant track record.",
    severity: "warning",
  },
  INSUFFICIENT_DAYS: {
    code: "INSUFFICIENT_DAYS",
    title: "Not enough active days",
    detail: "Trade for more days to demonstrate consistency across different market conditions.",
    severity: "warning",
  },
  LOW_SHARPE: {
    code: "LOW_SHARPE",
    title: "Sharpe ratio too low",
    detail: "Improve risk-adjusted returns before promotion.",
    severity: "warning",
  },
  LOW_PROFIT_FACTOR: {
    code: "LOW_PROFIT_FACTOR",
    title: "Profit factor too low",
    detail: "Gross profits must exceed gross losses by the required ratio.",
    severity: "warning",
  },
  HIGH_DRAWDOWN: {
    code: "HIGH_DRAWDOWN",
    title: "Drawdown exceeds limit",
    detail: "Maximum drawdown is too high. Reduce position sizes or improve exit strategy.",
    severity: "warning",
  },
  NO_RECENT_ACTIVITY: {
    code: "NO_RECENT_ACTIVITY",
    title: "No recent trading activity",
    detail: "Bot has been inactive. Resume trading before promotion.",
    severity: "warning",
  },
  STALE_BACKTEST: {
    code: "STALE_BACKTEST",
    title: "Backtest is outdated",
    detail: "Run a fresh backtest to validate current strategy configuration.",
    severity: "warning",
  },
  NO_BROKER_CONNECTION: {
    code: "NO_BROKER_CONNECTION",
    title: "No verified broker connection",
    detail: "Connect and verify a broker account before promoting to LIVE.",
    severity: "error",
  },
  LIVE_REQUIRES_APPROVAL: {
    code: "LIVE_REQUIRES_APPROVAL",
    title: "Manual approval required",
    detail: "Promotion to LIVE requires manual approval. Complete the audit checklist.",
    severity: "info",
  },
  PENDING_AUDIT: {
    code: "PENDING_AUDIT",
    title: "Audit pending",
    detail: "Complete the promotion audit checklist to proceed.",
    severity: "info",
  },
};

// ============= PROMOTION CTA ACTIONS =============

export interface PromotionCTA {
  label: string;
  action: string;
  variant?: "default" | "outline" | "destructive";
}

export const PROMOTION_CTAS: Record<string, PromotionCTA> = {
  CONVERT_TO_PAPER: {
    label: "Convert to Simulation (Paper)",
    action: "CONVERT_TO_PAPER",
    variant: "default",
  },
  OPEN_AUDIT: {
    label: "Open Audit Checklist",
    action: "OPEN_AUDIT",
    variant: "outline",
  },
  RUN_BACKTEST: {
    label: "Run Backtest",
    action: "RUN_BACKTEST",
    variant: "outline",
  },
  VIEW_HEALTH: {
    label: "View Health Issues",
    action: "VIEW_HEALTH",
    variant: "outline",
  },
  CONNECT_BROKER: {
    label: "Connect Broker",
    action: "CONNECT_BROKER",
    variant: "default",
  },
};
