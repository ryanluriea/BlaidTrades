import { Trophy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface EliteMetrics {
  sharpeRatio?: number | null;
  winRate?: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  netPnl?: number | null;
  totalTrades?: number | null;
  stage?: string | null;
}

export interface StrategyCandidateEliteMetrics {
  confidenceScore: number;
  noveltyScore?: number | null;
  disposition: string;
  linkedBotSharpe?: number | null;
  linkedBotWinRate?: number | null;
  linkedBotProfitFactor?: number | null;
  linkedBotMaxDrawdown?: number | null;
  linkedBotNetPnl?: number | null;
  linkedBotTrades?: number | null;
  linkedBotStage?: string | null;
}

export interface EliteStatus {
  isElite: boolean;
  criteriaMet: string[];
  score: number;
}

const ELITE_THRESHOLDS = {
  sharpeRatio: 1.5,
  winRate: 55,
  profitFactor: 1.8,
  maxDrawdownPct: 15,
  minTrades: 30,
  confidenceScore: 80,
  noveltyScore: 70,
};

export function calculateEliteStatus(metrics: EliteMetrics): EliteStatus {
  const criteriaMet: string[] = [];
  
  if (metrics.sharpeRatio != null && metrics.sharpeRatio >= ELITE_THRESHOLDS.sharpeRatio) {
    criteriaMet.push(`Sharpe ${metrics.sharpeRatio.toFixed(2)} ≥ ${ELITE_THRESHOLDS.sharpeRatio}`);
  }
  
  if (metrics.winRate != null && metrics.winRate >= ELITE_THRESHOLDS.winRate) {
    criteriaMet.push(`Win Rate ${metrics.winRate.toFixed(1)}% ≥ ${ELITE_THRESHOLDS.winRate}%`);
  }
  
  if (metrics.profitFactor != null && metrics.profitFactor >= ELITE_THRESHOLDS.profitFactor) {
    criteriaMet.push(`Profit Factor ${metrics.profitFactor.toFixed(2)} ≥ ${ELITE_THRESHOLDS.profitFactor}`);
  }
  
  if (metrics.maxDrawdownPct != null && metrics.maxDrawdownPct <= ELITE_THRESHOLDS.maxDrawdownPct && metrics.maxDrawdownPct > 0) {
    criteriaMet.push(`Max DD ${metrics.maxDrawdownPct.toFixed(1)}% ≤ ${ELITE_THRESHOLDS.maxDrawdownPct}%`);
  }
  
  if (metrics.netPnl != null && metrics.netPnl > 0 && 
      metrics.totalTrades != null && metrics.totalTrades >= ELITE_THRESHOLDS.minTrades) {
    criteriaMet.push(`Profitable over ${metrics.totalTrades} trades`);
  }
  
  const stageBonus = metrics.stage && ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(metrics.stage);
  if (stageBonus) {
    criteriaMet.push(`Stage: ${metrics.stage}`);
  }
  
  return {
    isElite: criteriaMet.length >= 3,
    criteriaMet,
    score: criteriaMet.length,
  };
}

export function calculateStrategyCandidateEliteStatus(metrics: StrategyCandidateEliteMetrics): EliteStatus {
  const criteriaMet: string[] = [];
  
  if (metrics.confidenceScore >= ELITE_THRESHOLDS.confidenceScore) {
    criteriaMet.push(`Confidence ${metrics.confidenceScore}% ≥ ${ELITE_THRESHOLDS.confidenceScore}%`);
  }
  
  if (metrics.noveltyScore != null && metrics.noveltyScore >= ELITE_THRESHOLDS.noveltyScore) {
    criteriaMet.push(`Novelty ${metrics.noveltyScore}% ≥ ${ELITE_THRESHOLDS.noveltyScore}%`);
  }
  
  if (metrics.disposition === "SENT_TO_LAB") {
    criteriaMet.push("Promoted to LAB");
  }
  
  if (metrics.linkedBotSharpe != null && metrics.linkedBotSharpe >= ELITE_THRESHOLDS.sharpeRatio) {
    criteriaMet.push(`Bot Sharpe ${metrics.linkedBotSharpe.toFixed(2)} ≥ ${ELITE_THRESHOLDS.sharpeRatio}`);
  }
  
  if (metrics.linkedBotWinRate != null && metrics.linkedBotWinRate >= ELITE_THRESHOLDS.winRate) {
    criteriaMet.push(`Bot Win Rate ${metrics.linkedBotWinRate.toFixed(1)}% ≥ ${ELITE_THRESHOLDS.winRate}%`);
  }
  
  if (metrics.linkedBotProfitFactor != null && metrics.linkedBotProfitFactor >= ELITE_THRESHOLDS.profitFactor) {
    criteriaMet.push(`Bot PF ${metrics.linkedBotProfitFactor.toFixed(2)} ≥ ${ELITE_THRESHOLDS.profitFactor}`);
  }
  
  if (metrics.linkedBotMaxDrawdown != null && metrics.linkedBotMaxDrawdown <= ELITE_THRESHOLDS.maxDrawdownPct && metrics.linkedBotMaxDrawdown > 0) {
    criteriaMet.push(`Bot Max DD ${metrics.linkedBotMaxDrawdown.toFixed(1)}% ≤ ${ELITE_THRESHOLDS.maxDrawdownPct}%`);
  }
  
  if (metrics.linkedBotNetPnl != null && metrics.linkedBotNetPnl > 0 && 
      metrics.linkedBotTrades != null && metrics.linkedBotTrades >= ELITE_THRESHOLDS.minTrades) {
    criteriaMet.push(`Bot Profitable over ${metrics.linkedBotTrades} trades`);
  }
  
  const stageBonus = metrics.linkedBotStage && ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(metrics.linkedBotStage);
  if (stageBonus) {
    criteriaMet.push(`Bot Stage: ${metrics.linkedBotStage}`);
  }
  
  return {
    isElite: criteriaMet.length >= 3,
    criteriaMet,
    score: criteriaMet.length,
  };
}

interface InlineEliteBadgeProps {
  metrics: EliteMetrics;
  size?: "sm" | "md";
}

export function InlineEliteBadge({ metrics, size = "sm" }: InlineEliteBadgeProps) {
  const status = calculateEliteStatus(metrics);
  
  if (!status.isElite) return null;
  
  return <EliteBadgeDisplay status={status} size={size} />;
}

interface StrategyCandidateEliteBadgeProps {
  metrics: StrategyCandidateEliteMetrics;
  size?: "sm" | "md";
}

export function StrategyCandidateEliteBadge({ metrics, size = "sm" }: StrategyCandidateEliteBadgeProps) {
  const status = calculateStrategyCandidateEliteStatus(metrics);
  
  if (!status.isElite) return null;
  
  return <EliteBadgeDisplay status={status} size={size} />;
}

interface EliteBadgeDisplayProps {
  status: EliteStatus;
  size: "sm" | "md";
}

function EliteBadgeDisplay({ status, size }: EliteBadgeDisplayProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className="inline-flex items-center justify-center shrink-0"
            data-testid="badge-elite-bot"
          >
            <Trophy className={cn(iconSize, "text-amber-400")} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          <div className="space-y-1">
            <p className="font-semibold text-amber-400 flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" />
              Elite Profit Potential
            </p>
            <p className="text-xs text-muted-foreground">
              Meets {status.score} elite criteria:
            </p>
            <ul className="text-xs space-y-0.5">
              {status.criteriaMet.map((criteria, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="text-emerald-400">✓</span>
                  <span>{criteria}</span>
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
