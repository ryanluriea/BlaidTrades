export interface StageConfig {
  color: string;
  bgColor: string;
  borderColor: string;
  borderLeftColor: string;
  label: string;
  description: string;
  subtitle: string;
  capabilities: string[];
  restrictions: string[];
}

export const STAGE_CONFIG: Record<string, StageConfig> = {
  LAB: {
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    borderLeftColor: "border-l-violet-500",
    label: "LAB",
    description: "Strategy Laboratory",
    subtitle: "Initial research and development phase",
    capabilities: ["Run backtests", "Evolve strategies", "Scan markets"],
    restrictions: ["No live execution", "No broker connection"],
  },
  TRIALS: {
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    borderLeftColor: "border-l-amber-500",
    label: "TRIALS",
    description: "Research & Backtesting",
    subtitle: "Proving strategy viability with historical data",
    capabilities: ["Run backtests", "Evolve strategies", "Scan markets"],
    restrictions: ["No live execution", "No broker connection"],
  },
  PAPER: {
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    borderLeftColor: "border-l-blue-500",
    label: "PAPER",
    description: "Simulated Trading",
    subtitle: "Real-time execution with virtual capital",
    capabilities: ["Live market data", "Simulated orders", "Track P&L"],
    restrictions: ["No real capital at risk", "No broker execution"],
  },
  SIM_LIVE: {
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    borderLeftColor: "border-l-blue-500",
    label: "SIM_LIVE",
    description: "Simulated Live Trading",
    subtitle: "Real-time execution with virtual capital",
    capabilities: ["Live market data", "Simulated orders", "Track P&L"],
    restrictions: ["No real capital at risk", "No broker execution"],
  },
  SHADOW: {
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    borderLeftColor: "border-l-purple-500",
    label: "SHADOW",
    description: "Parallel Validation",
    subtitle: "Live signals, orders built but not sent",
    capabilities: ["Broker connectivity", "Order construction", "Risk checks"],
    restrictions: ["Orders NOT submitted", "No capital at risk"],
  },
  CANARY: {
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    borderLeftColor: "border-l-orange-500",
    label: "CANARY",
    description: "Small Real Position",
    subtitle: "Minimal size live trading with auto-kill",
    capabilities: ["Real broker execution", "Live capital (small)", "Auto-revert on anomaly"],
    restrictions: ["Strict position limits", "Enhanced monitoring"],
  },
  LIVE: {
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    borderLeftColor: "border-l-amber-500",
    label: "LIVE",
    description: "Full Production",
    subtitle: "Live execution with production safeguards",
    capabilities: ["Full broker execution", "Production capital", "All safeguards active"],
    restrictions: [],
  },
};

export function getStageConfig(stage: string | null | undefined): StageConfig {
  return STAGE_CONFIG[stage || "TRIALS"] || STAGE_CONFIG.TRIALS;
}

export function getStageBorderLeftColor(stage: string | null | undefined): string {
  return getStageConfig(stage).borderLeftColor;
}

export function getStageColor(stage: string | null | undefined): string {
  return getStageConfig(stage).color;
}

export function getStageBgColor(stage: string | null | undefined): string {
  return getStageConfig(stage).bgColor;
}

export function getStageBorderColor(stage: string | null | undefined): string {
  return getStageConfig(stage).borderColor;
}

export const STAGE_ORDER = ["LAB", "TRIALS", "PAPER", "SIM_LIVE", "SHADOW", "CANARY", "LIVE"] as const;

export function isStageAtLeast(current: string | null | undefined, threshold: string): boolean {
  const currentIndex = STAGE_ORDER.indexOf((current || "LAB") as typeof STAGE_ORDER[number]);
  const thresholdIndex = STAGE_ORDER.indexOf(threshold as typeof STAGE_ORDER[number]);
  return currentIndex >= thresholdIndex;
}

export function isBeyondTrials(stage: string | null | undefined): boolean {
  return isStageAtLeast(stage, "PAPER");
}
