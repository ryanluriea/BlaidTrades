import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, Shield, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type TournamentTier = "TOP_10" | "SAFE" | "AT_RISK" | "CYCLE_OUT" | "WAITLIST" | "UNRANKED";

interface TournamentBadgeProps {
  tier: TournamentTier;
  rank?: number;
  score?: number;
  waitlistPosition?: number;
  showTooltip?: boolean;
  size?: "sm" | "md";
}

const TIER_CONFIG: Record<TournamentTier, {
  label: string;
  icon: typeof Trophy;
  className: string;
  description: string;
}> = {
  TOP_10: {
    label: "Top 10%",
    icon: Trophy,
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    description: "Elite performer - protected from cycling",
  },
  SAFE: {
    label: "Safe",
    icon: Shield,
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    description: "Stable position in the fleet",
  },
  AT_RISK: {
    label: "At Risk",
    icon: AlertTriangle,
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    description: "Needs improvement to avoid cycling",
  },
  CYCLE_OUT: {
    label: "Cycle Out",
    icon: XCircle,
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    description: "Scheduled for replacement",
  },
  WAITLIST: {
    label: "Waitlist",
    icon: Clock,
    className: "bg-muted text-muted-foreground border-border",
    description: "Waiting for slot to open",
  },
  UNRANKED: {
    label: "Unranked",
    icon: Shield,
    className: "bg-muted/50 text-muted-foreground/60 border-border/50",
    description: "Not yet ranked in tournament",
  },
};

export function TournamentBadge({
  tier,
  rank,
  score,
  waitlistPosition,
  showTooltip = true,
  size = "sm",
}: TournamentBadgeProps) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono",
        config.className,
        size === "sm" ? "text-[9px] px-1.5 py-0" : "text-[10px] px-2 py-0.5"
      )}
      data-testid={`tournament-badge-${tier.toLowerCase()}`}
    >
      <Icon className={cn(size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
      {tier === "WAITLIST" && waitlistPosition ? (
        <span>#{waitlistPosition}</span>
      ) : rank ? (
        <span>#{rank}</span>
      ) : (
        <span>{config.label}</span>
      )}
    </Badge>
  );
  
  if (!showTooltip) return badge;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="space-y-1">
          <p className="font-medium text-xs">{config.label}</p>
          <p className="text-[10px] text-muted-foreground">{config.description}</p>
          {score !== undefined && (
            <p className="text-[10px] text-muted-foreground">
              Score: {score.toFixed(1)}/100
            </p>
          )}
          {rank && (
            <p className="text-[10px] text-muted-foreground">
              Rank: #{rank}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact tournament tier indicator for table rows
 */
export function TournamentTierDot({
  tier,
  className,
}: {
  tier: TournamentTier;
  className?: string;
}) {
  const colorMap: Record<TournamentTier, string> = {
    TOP_10: "bg-amber-400",
    SAFE: "bg-emerald-400",
    AT_RISK: "bg-yellow-400",
    CYCLE_OUT: "bg-red-400",
    WAITLIST: "bg-muted-foreground",
    UNRANKED: "bg-muted-foreground/40",
  };
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            colorMap[tier],
            className
          )}
          data-testid={`tournament-dot-${tier.toLowerCase()}`}
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span className="text-xs">{TIER_CONFIG[tier].label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
