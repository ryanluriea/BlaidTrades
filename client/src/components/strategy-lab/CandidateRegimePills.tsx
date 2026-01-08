import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, AlertTriangle, Newspaper, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

const REGIME_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  TREND: { icon: TrendingUp, color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Trend" },
  RANGE: { icon: Waves, color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Range" },
  VOL_EXP: { icon: Activity, color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Vol Expansion" },
  VOL_CONT: { icon: TrendingDown, color: "bg-violet-500/20 text-violet-400 border-violet-500/30", label: "Vol Contraction" },
  MR: { icon: Activity, color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", label: "Mean Reversion" },
  NEWS: { icon: Newspaper, color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "News Sensitive" },
  BREAKOUT: { icon: AlertTriangle, color: "bg-rose-500/20 text-rose-400 border-rose-500/30", label: "Breakout" },
};

interface CandidateRegimePillsProps {
  regimes: string[];
  className?: string;
  maxShow?: number;
}

export function CandidateRegimePills({ regimes, className, maxShow = 3 }: CandidateRegimePillsProps) {
  if (!regimes || regimes.length === 0) {
    return (
      <Badge variant="outline" className="text-[9px] h-5 text-muted-foreground">
        No regime profile
      </Badge>
    );
  }

  const displayRegimes = regimes.slice(0, maxShow);
  const remaining = regimes.length - maxShow;

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {displayRegimes.map((regime) => {
        const config = REGIME_CONFIG[regime.toUpperCase()] || {
          icon: Activity,
          color: "bg-muted text-muted-foreground",
          label: regime,
        };
        const Icon = config.icon;

        return (
          <Badge
            key={regime}
            variant="outline"
            className={cn("text-[9px] h-5 gap-1", config.color)}
          >
            <Icon className="h-2.5 w-2.5" />
            {config.label}
          </Badge>
        );
      })}
      {remaining > 0 && (
        <Badge variant="outline" className="text-[9px] h-5 text-muted-foreground">
          +{remaining}
        </Badge>
      )}
    </div>
  );
}
