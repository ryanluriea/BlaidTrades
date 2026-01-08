/**
 * BacktestStatusBadge - Shows ONLY problem states
 * 
 * RULE: No positive status badges - only show problems
 * 
 * Shows:
 * - 🟡 Stale (amber) - completed but older than threshold
 * - ⏳ Running (blue pulse) - backtest in progress
 * - 📋 Queued (gray) - waiting to run
 * - 🔴 Failing (red) - last attempt failed
 * 
 * Does NOT show:
 * - ❌ Fresh - positive state, no badge needed
 */
import { CheckCircle2, AlertTriangle, Clock, Loader2, AlertCircle, List } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type BacktestStatus = 'fresh' | 'stale' | 'running' | 'queued' | 'failing';

interface BacktestStatusBadgeProps {
  status: BacktestStatus;
  completedAt?: string | null;
  ageSeconds?: number | null;
  failedAt?: string | null;
  failedReason?: string | null;
  failedCount?: number;
  className?: string;
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "N/A";
  // Handle clock skew: if timestamp is in the future or very recent, show "just now"
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BacktestStatusBadge({
  status,
  completedAt,
  ageSeconds,
  failedAt,
  failedReason,
  failedCount = 0,
  className,
}: BacktestStatusBadgeProps) {
  // RULE: No positive status badges - "fresh" is a positive state, don't show it
  if (status === 'fresh') {
    return null;
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'stale':
        return {
          icon: Clock,
          label: ageSeconds != null ? formatAge(ageSeconds) : 'Stale',
          color: 'text-amber-500',
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/30',
          tooltip: ageSeconds != null ? `Backtest data is stale (completed ${formatAge(ageSeconds)})` : 'No recent backtest data',
        };
      case 'running':
        return {
          icon: Loader2,
          label: 'Running',
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/30',
          tooltip: 'Backtest in progress...',
          animate: true,
        };
      case 'queued':
        return {
          icon: List,
          label: 'Queued',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/50',
          borderColor: 'border-muted-foreground/30',
          tooltip: 'Backtest queued, waiting to run',
        };
      case 'failing':
        return {
          icon: AlertCircle,
          label: failedCount > 1 ? `${failedCount} fails` : 'Failed',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
          tooltip: failedReason || 'Backtest failed',
        };
      default:
        return {
          icon: AlertTriangle,
          label: 'Unknown',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/50',
          borderColor: 'border-muted-foreground/30',
          tooltip: 'Unknown backtest status',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-help",
            config.bgColor,
            config.borderColor,
            config.color,
            className
          )}
        >
          <Icon 
            className={cn(
              "h-3 w-3",
              config.animate && "animate-spin"
            )} 
          />
          <span className="hidden sm:inline">{config.label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{config.tooltip}</p>
          {completedAt && status !== 'failing' && (
            <p className="text-xs text-muted-foreground">
              Last success: {new Date(completedAt).toLocaleString()}
            </p>
          )}
          {failedAt && status === 'failing' && (
            <p className="text-xs text-muted-foreground">
              Failed: {new Date(failedAt).toLocaleString()}
            </p>
          )}
          {failedReason && status === 'failing' && (
            <p className="text-xs text-destructive/80 font-mono">
              {failedReason}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
