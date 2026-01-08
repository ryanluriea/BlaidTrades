import { computeGraduationStatus, type BotMetricsInput } from "@/lib/graduationGates";
import { RatingDots } from "./RatingDots";

interface RunnerStatusInfo {
  isRunning: boolean;
  isIdle?: boolean;
  lastEvaluation?: string | null;
  lastHeartbeat?: string | null;
  lastBarClose?: number | null;
  startedAt?: string | null;
  serverNow?: number;
}

interface PromotionProgressBarProps {
  stage: string;
  healthState: 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN';
  rollup30: {
    trades: number;
    winRate: number | null;
    sharpe: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    maxDdPct: number | null;
    activeDays: number;
    lastTradeAt: string | null;
  } | null;
  lastBacktestCompletedAt: string | null;
  lastBacktestStatus: string | null;
  totalTrades?: number;
  /** Whether bot currently has backtest jobs running */
  isBacktesting?: boolean;
  className?: string;
  /** Vertical layout for sidebar placement */
  vertical?: boolean;
  /** Runner status info to display in tooltip */
  runnerStatus?: RunnerStatusInfo;
  /** Large dots (8px) for horizontal full-width display */
  large?: boolean;
}

export function PromotionProgressBar({
  stage,
  healthState,
  rollup30,
  lastBacktestCompletedAt,
  lastBacktestStatus,
  totalTrades = 0,
  isBacktesting = false,
  className,
  vertical = false,
  runnerStatus,
  large = false,
}: PromotionProgressBarProps) {
  // Build metrics input for graduation gates
  const metrics: BotMetricsInput = {
    totalTrades: rollup30?.trades ?? totalTrades ?? 0,
    winRate: rollup30?.winRate ?? null,
    profitFactor: rollup30?.profitFactor ?? null,
    maxDrawdownPct: rollup30?.maxDdPct ?? null,
    expectancy: rollup30?.expectancy ?? null,
    sharpe: rollup30?.sharpe ?? null,
    pnl: 0, // Not used in gates
  };

  // Compute gate-based graduation status with stage-specific thresholds
  const status = computeGraduationStatus(metrics, stage);

  return (
    <RatingDots
      gatesPassed={status.gatesPassed}
      gatesTotal={status.gatesTotal}
      isEligible={status.isEligible}
      healthState={healthState}
      gates={status.gates}
      blockers={status.blockers}
      stage={stage}
      className={className}
      vertical={vertical}
      runnerStatus={runnerStatus}
      large={large}
    />
  );
}
