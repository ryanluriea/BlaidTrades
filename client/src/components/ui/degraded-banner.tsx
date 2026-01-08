import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DegradedBannerProps {
  message?: string;
  trace_id?: string;
  error_code?: string;
  className?: string;
  compact?: boolean;
}

export function DegradedBanner({
  message = "Data temporarily unavailable",
  trace_id,
  error_code,
  className,
  compact = false,
}: DegradedBannerProps) {
  if (compact) {
    return (
      <div
        data-testid="banner-degraded-compact"
        className={cn(
          "flex items-center gap-1.5 text-xs text-amber-500",
          className
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        <span>Degraded</span>
      </div>
    );
  }

  return (
    <div
      data-testid="banner-degraded"
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs",
        className
      )}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{message}</span>
        {(error_code || trace_id) && (
          <span className="text-amber-500/70 ml-2">
            {error_code && `[${error_code}]`}
            {trace_id && ` trace:${trace_id.slice(0, 8)}`}
          </span>
        )}
      </div>
    </div>
  );
}

export function DegradedValue({
  children,
  degraded,
  fallback = "—",
  className,
}: {
  children: React.ReactNode;
  degraded: boolean;
  fallback?: React.ReactNode;
  className?: string;
}) {
  if (degraded) {
    return (
      <span
        data-testid="value-degraded"
        className={cn("text-amber-500/70 italic", className)}
      >
        {fallback}
      </span>
    );
  }
  return <>{children}</>;
}
