/**
 * MetricsHealthTooltip - Institutional Metrics Health Indicator
 * 
 * Shows autonomous health verification for bot metrics including:
 * - Generation Scope verification (pass/fail for TRIALS stage)
 * - Metrics Source tracking
 * - Data Freshness status
 * - Evidence Threshold (50 trades minimum for TRIALS)
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";

interface MetricsHealthTooltipProps {
  stage: string;
  metricsStatus?: "AVAILABLE" | "AWAITING_EVIDENCE" | "PRIOR_GENERATION" | null;
  totalTrades?: number;
  generationNumber?: number;
  metricsSource?: string;
  sessionId?: string;
  lastUpdated?: string;
  children?: React.ReactNode;
}

const MIN_TRADES_TRIALS = 50;

export function MetricsHealthTooltip({
  stage,
  metricsStatus,
  totalTrades = 0,
  generationNumber,
  metricsSource,
  sessionId,
  lastUpdated,
  children,
}: MetricsHealthTooltipProps) {
  const isLabStage = stage === 'TRIALS';
  
  const generationScopePass = !isLabStage || metricsStatus === "AVAILABLE";
  const evidenceThresholdPass = !isLabStage || totalTrades >= MIN_TRADES_TRIALS;
  const hasMetrics = metricsStatus === "AVAILABLE";
  
  const overallHealth = generationScopePass && evidenceThresholdPass && hasMetrics 
    ? "HEALTHY" 
    : metricsStatus === "AWAITING_EVIDENCE" 
    ? "PENDING" 
    : "WARNING";

  const HealthIcon = overallHealth === "HEALTHY" 
    ? CheckCircle 
    : overallHealth === "PENDING" 
    ? AlertTriangle 
    : XCircle;
    
  const iconColor = overallHealth === "HEALTHY" 
    ? "text-green-500" 
    : overallHealth === "PENDING" 
    ? "text-yellow-500" 
    : "text-red-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children || (
          <Badge variant="outline" className="gap-1 cursor-help" data-testid="badge-metrics-health">
            <HealthIcon className={`w-3 h-3 ${iconColor}`} />
            <span className="text-xs">Metrics</span>
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="w-72 p-3" data-testid="tooltip-metrics-health">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Info className="w-4 h-4 text-muted-foreground" />
            Metrics Health Check
          </div>
          
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Generation Scope</span>
              <span className="flex items-center gap-1">
                {generationScopePass ? (
                  <>
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>Current Gen</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3 text-red-500" />
                    <span>Prior Gen</span>
                  </>
                )}
              </span>
            </div>
            
            {isLabStage && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Evidence ({MIN_TRADES_TRIALS} min)</span>
                <span className="flex items-center gap-1">
                  {evidenceThresholdPass ? (
                    <>
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      <span>{totalTrades} trades</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3 h-3 text-yellow-500" />
                      <span>{totalTrades}/{MIN_TRADES_TRIALS}</span>
                    </>
                  )}
                </span>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge 
                variant={metricsStatus === "AVAILABLE" ? "default" : "secondary"} 
                className="text-[10px] h-5"
              >
                {metricsStatus || "UNKNOWN"}
              </Badge>
            </div>
            
            {generationNumber != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Generation</span>
                <span>Gen {generationNumber}</span>
              </div>
            )}
            
            {metricsSource && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Source</span>
                <span className="truncate max-w-[120px]">{metricsSource}</span>
              </div>
            )}
            
            {lastUpdated && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Updated</span>
                <span>{new Date(lastUpdated).toLocaleDateString()}</span>
              </div>
            )}
          </div>
          
          {isLabStage && !evidenceThresholdPass && (
            <div className="text-[10px] text-muted-foreground border-t pt-2 mt-2">
              TRIALS bots need {MIN_TRADES_TRIALS} trades before promotion gates can be evaluated.
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
