import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingDown, AlertTriangle, Shield, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlphaDecay, getDecayLevelColor, getRecommendationColor } from "@/hooks/useAlphaDecay";

interface AlphaDecayBadgeProps {
  botId: string;
  showDetails?: boolean;
  className?: string;
}

export function AlphaDecayBadge({ botId, showDetails = false, className }: AlphaDecayBadgeProps) {
  const { data, isLoading } = useAlphaDecay(botId);

  if (isLoading || !data) {
    return null;
  }

  const { decayLevel, decayDetected, metrics, recommendation, reasons } = data;

  if (!decayDetected && decayLevel === "NONE") {
    if (!showDetails) return null;
    return (
      <Badge 
        variant="outline" 
        className={cn("text-[10px] gap-1", className)}
        data-testid="badge-alpha-stable"
      >
        <Shield className="w-3 h-3 text-green-400" />
        Stable
      </Badge>
    );
  }

  const levelColor = getDecayLevelColor(decayLevel);
  const recColor = getRecommendationColor(recommendation);

  const DecayIcon = decayLevel === "CRITICAL" || decayLevel === "SEVERE" 
    ? AlertTriangle 
    : TrendingDown;

  const badge = (
    <Badge 
      className={cn("text-[10px] gap-1 border", levelColor, className)}
      data-testid="badge-alpha-decay"
    >
      <DecayIcon className="w-3 h-3" />
      {decayLevel}
    </Badge>
  );

  if (!showDetails) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1.5">
            <div className="font-medium text-xs">Alpha Decay Detected</div>
            <div className={cn("text-[10px]", recColor)}>
              Recommendation: {recommendation.replace("_", " ")}
            </div>
            {reasons.length > 0 && (
              <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                {reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}

interface AlphaDecayDetailProps {
  botId: string;
  className?: string;
}

export function AlphaDecayDetail({ botId, className }: AlphaDecayDetailProps) {
  const { data, isLoading, isError } = useAlphaDecay(botId);

  if (isLoading) {
    return (
      <div className={cn("p-3 rounded-md bg-muted/30 animate-pulse", className)}>
        <div className="h-4 w-24 bg-muted rounded" />
      </div>
    );
  }

  if (isError || !data) {
    return null;
  }

  const { decayLevel, decayDetected, metrics, recommendation, reasons } = data;
  const levelColor = getDecayLevelColor(decayLevel);
  const recColor = getRecommendationColor(recommendation);

  return (
    <div 
      className={cn("p-3 rounded-md border space-y-3", levelColor, className)}
      data-testid="panel-alpha-decay-detail"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" />
          <span className="text-sm font-medium">Alpha Decay</span>
        </div>
        <Badge className={cn("text-[10px]", levelColor)} data-testid="badge-decay-level">
          {decayLevel}
        </Badge>
      </div>

      {decayDetected && (
        <>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sharpe Decay</span>
              <span className="font-mono">{(metrics.sharpeDecay * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Win Rate Decay</span>
              <span className="font-mono">{(metrics.winRateDecay * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consec Losses</span>
              <span className="font-mono">{metrics.consecLosses}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trade Density</span>
              <span className="font-mono">{(metrics.tradeDensity * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className={cn("text-xs font-medium", recColor)}>
            Recommendation: {recommendation.replace("_", " ")}
          </div>

          {reasons.length > 0 && (
            <ul className="text-[10px] text-muted-foreground space-y-0.5">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-muted-foreground/60">-</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!decayDetected && (
        <div className="text-xs text-muted-foreground">
          No significant decay detected. Strategy performance is stable.
        </div>
      )}
    </div>
  );
}
