import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Send, Eye, Copy, X, TrendingUp, TrendingDown, Target, BarChart3, 
  AlertTriangle, CheckCircle2, Loader2, Hash
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CandidateRegimePills } from "./CandidateRegimePills";
import { CandidateConfidenceBadge } from "./CandidateConfidenceBadge";
import { CandidateCostBadge } from "./CandidateCostBadge";
import { CandidateEvidenceTooltip } from "./CandidateEvidenceTooltip";

interface Candidate {
  id: string;
  name?: string;
  description?: string;
  rank?: number | null;
  status: string;
  deployability_score?: number;
  regime_tags?: string[];
  contract_preference?: string;
  instruments?: unknown;
  expected_metrics_json?: {
    trades_per_week?: { min: number; max: number };
    max_dd_pct?: { min: number; max: number };
    profit_factor?: { min: number; max: number };
    robustness?: number;
  };
  ai_usage_json?: unknown[];
  cost_usd?: number;
  evidence_json?: {
    sources?: unknown[];
    hypothesis_count?: number;
  };
  reasoning_json?: {
    why_ranked?: string;
    why_exists?: string;
  };
  capital_sim_json?: {
    recommended_contract?: string;
    base_contracts_by_capital?: Record<string, number>;
    survivability_score?: number;
  };
  blueprint?: {
    name?: string;
    archetype?: string;
    symbol_candidates?: string[];
    entry_rules?: string;
    exit_rules?: string;
  };
  scores?: {
    viability_score?: number;
    estimated_pf?: number;
    estimated_win_rate?: number;
    estimated_max_dd?: number;
    robustness_score?: number;
  };
}

interface StrategyCandidateCardProps {
  candidate: Candidate;
  onSendToLab: () => void;
  onViewDetails: () => void;
  onClone?: () => void;
  onReject?: () => void;
  isExporting?: boolean;
  className?: string;
}

export function StrategyCandidateCard({
  candidate,
  onSendToLab,
  onViewDetails,
  onClone,
  onReject,
  isExporting,
  className,
}: StrategyCandidateCardProps) {
  const name = candidate.name || candidate.blueprint?.name || `Candidate ${candidate.rank || '?'}`;
  const deployScore = candidate.deployability_score || candidate.scores?.viability_score || 0;
  const regimes = candidate.regime_tags || [];
  const metrics = candidate.expected_metrics_json || {};
  const scores = candidate.scores || {};
  const aiUsage = (candidate.ai_usage_json || []) as { provider: string }[];
  const cost = candidate.cost_usd || 0;
  const evidence = candidate.evidence_json || {};
  const capitalSim = candidate.capital_sim_json || {};
  const isSent = candidate.status === 'SENT_TO_LAB' || candidate.status === 'EXPORTED';
  const isReady = candidate.status === 'READY' || candidate.status === 'FINALIST';

  // Get unique providers from AI usage
  const providers = [...new Set(aiUsage.map(u => u.provider).filter(Boolean))];

  return (
    <Card className={cn(
      "relative transition-all hover:border-primary/50",
      isSent && "opacity-60",
      className
    )}>
      <CardContent className="p-4">
        {/* Header: Rank + Name + Status */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {candidate.rank && (
              <Badge variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center text-xs font-bold shrink-0">
                #{candidate.rank}
              </Badge>
            )}
            <div className="min-w-0">
              <h4 className="text-sm font-semibold truncate">{name}</h4>
              {candidate.blueprint?.archetype && (
                <p className="text-[10px] text-muted-foreground truncate">
                  {candidate.blueprint.archetype}
                </p>
              )}
            </div>
          </div>
          <CandidateConfidenceBadge score={deployScore} showLabel={false} />
        </div>

        {/* Contract + Universe */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {candidate.contract_preference && (
            <Badge variant="outline" className="text-[9px] h-5">
              {candidate.contract_preference.replace(/_/g, ' ')}
            </Badge>
          )}
          {candidate.blueprint?.symbol_candidates && candidate.blueprint.symbol_candidates.length > 0 && (
            <Badge variant="outline" className="text-[9px] h-5">
              {candidate.blueprint.symbol_candidates.slice(0, 3).join(', ')}
              {candidate.blueprint.symbol_candidates.length > 3 && '...'}
            </Badge>
          )}
          {capitalSim.recommended_contract && (
            <Badge variant="secondary" className="text-[9px] h-5 gap-1">
              <Target className="h-2.5 w-2.5" />
              {capitalSim.recommended_contract}
            </Badge>
          )}
        </div>

        {/* Regime Pills */}
        <CandidateRegimePills regimes={regimes} className="mb-3" />

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
          <MetricRow
            icon={BarChart3}
            label="Trades/wk"
            value={metrics.trades_per_week 
              ? `${metrics.trades_per_week.min}-${metrics.trades_per_week.max}`
              : scores.viability_score ? `~${Math.round(scores.viability_score / 4)}` : '—'
            }
            source="EST"
          />
          <MetricRow
            icon={TrendingDown}
            label="Max DD"
            value={metrics.max_dd_pct 
              ? `${metrics.max_dd_pct.min}-${metrics.max_dd_pct.max}%`
              : scores.estimated_max_dd ? `${scores.estimated_max_dd}%` : '—'
            }
            source="EST"
            warn={scores.estimated_max_dd && scores.estimated_max_dd > 15}
          />
          <MetricRow
            icon={TrendingUp}
            label="Profit Factor"
            value={metrics.profit_factor 
              ? `${metrics.profit_factor.min.toFixed(1)}-${metrics.profit_factor.max.toFixed(1)}`
              : scores.estimated_pf ? scores.estimated_pf.toFixed(2) : '—'
            }
            source="EST"
          />
          <MetricRow
            icon={CheckCircle2}
            label="Robustness"
            value={metrics.robustness 
              ? `${metrics.robustness}%`
              : scores.robustness_score ? `${scores.robustness_score}%` : '—'
            }
            source="WF"
          />
        </div>

        {/* AI + Cost Strip */}
        <div className="flex items-center justify-between mb-3 py-2 border-y border-border/50">
          <div className="flex items-center gap-2">
            {providers.length > 0 ? (
              <div className="flex items-center gap-1">
                {providers.slice(0, 3).map((p) => (
                  <Badge key={p} variant="outline" className="text-[9px] h-5 capitalize">
                    {p}
                  </Badge>
                ))}
                {providers.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{providers.length - 3}</span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground">No AI used</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CandidateEvidenceTooltip evidence={evidence as { sources?: { title: string }[]; hypothesis_count?: number }} />
            <CandidateCostBadge costUsd={cost} aiUsage={aiUsage as { provider: string }[]} />
          </div>
        </div>

        {/* Sizing Preview */}
        {capitalSim.base_contracts_by_capital && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-[10px] text-muted-foreground mb-3 cursor-help">
                  Sizing: {capitalSim.recommended_contract || 'MES'} 1-2 (at 10k) → scale at 50k
                </p>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium mb-1">Capital → Contracts</p>
                {Object.entries(capitalSim.base_contracts_by_capital).map(([cap, contracts]) => (
                  <div key={cap} className="flex justify-between gap-4">
                    <span>${Number(cap).toLocaleString()}</span>
                    <span>{contracts} contracts</span>
                  </div>
                ))}
                {capitalSim.survivability_score !== undefined && (
                  <p className="mt-1 pt-1 border-t border-border/50">
                    Survivability: {capitalSim.survivability_score}%
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={onSendToLab}
            disabled={isExporting || isSent}
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1" />
            )}
            {isSent ? 'Sent' : 'Send to LAB'}
          </Button>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={onViewDetails}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {onClone && (
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={onClone}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          {onReject && !isSent && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={onReject}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({ 
  icon: Icon, 
  label, 
  value, 
  source,
  warn 
}: { 
  icon: typeof TrendingUp; 
  label: string; 
  value: string; 
  source: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3 w-3", warn ? "text-amber-400" : "text-muted-foreground")} />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-medium", warn && "text-amber-400")}>{value}</span>
      <Badge variant="outline" className="text-[8px] h-4 px-1 ml-auto">
        {source}
      </Badge>
    </div>
  );
}
