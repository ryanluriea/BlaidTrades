import { useValueChange } from "@/hooks/useValueChange";
import { cn } from "@/lib/utils";

interface FlashValueProps {
  value: number | string | null | undefined;
  children: React.ReactNode;
  className?: string;
  flashDuration?: number;
}

/**
 * Wraps a metric display and applies a brief flash animation when the value changes
 * Industry-standard trading terminal behavior - individual cells flash, not entire rows
 */
export function FlashValue({ 
  value, 
  children, 
  className,
  flashDuration = 600 
}: FlashValueProps) {
  const isChanged = useValueChange(value, flashDuration);
  
  return (
    <div className={cn(
      "contents",
      isChanged && "[&>*]:animate-metric-flash",
      className
    )}>
      {children}
    </div>
  );
}

interface StaleMetricWrapperProps {
  isStale: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps metrics that are from a prior generation (stale)
 * Dims the metrics and can show a "Prior Gen" indicator
 */
export function StaleMetricWrapper({
  isStale,
  children,
  className,
}: StaleMetricWrapperProps) {
  if (!isStale) {
    return <>{children}</>;
  }
  
  return (
    <div className={cn(
      "relative",
      isStale && "opacity-50",
      className
    )}>
      {children}
    </div>
  );
}
