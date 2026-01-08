import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  sampleSize?: number;
  minRequired?: number;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const CONFIDENCE_CONFIG: Record<ConfidenceLevel, {
  label: string;
  color: string;
  bgColor: string;
  icon: typeof CheckCircle2;
  description: string;
}> = {
  HIGH: {
    label: 'High',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    icon: CheckCircle2,
    description: 'Statistically reliable with adequate sample size',
  },
  MEDIUM: {
    label: 'Medium',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    icon: AlertTriangle,
    description: 'Moderate confidence - consider with caution',
  },
  LOW: {
    label: 'Low',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    icon: AlertTriangle,
    description: 'Low statistical significance - use with extreme caution',
  },
  INSUFFICIENT: {
    label: 'Insufficient',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    icon: HelpCircle,
    description: 'Not enough data for meaningful analysis',
  },
};

export function ConfidenceBadge({ 
  confidence, 
  sampleSize, 
  minRequired = 20,
  className,
  showLabel = false,
  size = 'sm'
}: ConfidenceBadgeProps) {
  const config = CONFIDENCE_CONFIG[confidence];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full cursor-help",
          size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          config.bgColor,
          config.color,
          className
        )}>
          <Icon className={iconSize} />
          {showLabel && <span className="font-medium">{config.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px]">
        <div className="space-y-1">
          <p className="font-medium flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5" />
            {config.label} Confidence
          </p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          {sampleSize !== undefined && (
            <p className="text-xs">
              <span className="text-muted-foreground">Sample size:</span>{' '}
              <span className="font-mono">{sampleSize}</span>
              {minRequired && (
                <span className="text-muted-foreground"> / {minRequired} min</span>
              )}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface StatisticalWarningProps {
  isSignificant: boolean;
  sampleSize?: number;
  minRequired?: number;
  className?: string;
}

export function StatisticalWarning({ 
  isSignificant, 
  sampleSize, 
  minRequired = 20,
  className 
}: StatisticalWarningProps) {
  if (isSignificant) return null;

  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs",
      className
    )}>
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div>
        <span className="font-medium">Limited Statistical Significance</span>
        <span className="text-muted-foreground ml-1">
          — {sampleSize !== undefined ? `${sampleSize} samples` : 'insufficient data'}
          {minRequired && sampleSize !== undefined && sampleSize < minRequired && ` (need ${minRequired})`}
        </span>
      </div>
    </div>
  );
}

// Helper function to determine confidence from sample size
export function getConfidenceFromSamples(
  sampleSize: number,
  thresholds = { high: 60, medium: 30, low: 10 }
): ConfidenceLevel {
  if (sampleSize >= thresholds.high) return 'HIGH';
  if (sampleSize >= thresholds.medium) return 'MEDIUM';
  if (sampleSize >= thresholds.low) return 'LOW';
  return 'INSUFFICIENT';
}

// Helper to convert string confidence to enum
export function parseConfidence(value: string | null | undefined): ConfidenceLevel {
  if (!value) return 'INSUFFICIENT';
  const upper = value.toUpperCase();
  if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' || upper === 'INSUFFICIENT') {
    return upper as ConfidenceLevel;
  }
  return 'INSUFFICIENT';
}
