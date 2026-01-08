import { cn } from "@/lib/utils";

// Smart number formatting: 1500 → "1.5k", 2300000 → "2.3M"
// Always removes decimals for cleaner display
function formatSmartNumber(value: number): string {
  const abs = Math.abs(value);
  
  if (abs >= 1_000_000) {
    return (abs / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (abs >= 1_000) {
    return (abs / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  
  // No decimals for clean display
  return Math.round(abs).toLocaleString("en-US");
}

interface PnlDisplayProps {
  value: number;
  showSign?: boolean;
  currency?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  compact?: boolean;
  smart?: boolean; // Enable smart shortform (1.5k, 2.3M)
  precision?: number; // Decimal places (0 = whole dollars, 2 = show cents like $4.50)
}

export function PnlDisplay({
  value,
  showSign = true,
  currency = "$",
  size = "md",
  className,
  compact = false,
  smart = false,
  precision = 0, // Default: whole dollars for backward compatibility
}: PnlDisplayProps) {
  const isPositive = value > 0;
  const isZero = value === 0;

  // Format with specified precision (0 = whole dollars, 2 = cents like $4.50)
  const formattedValue = smart 
    ? formatSmartNumber(value)
    : precision > 0
      ? Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision })
      : Math.round(Math.abs(value)).toLocaleString("en-US");

  const sizeClasses = {
    sm: "text-xs",  // Match other metrics (MetricWithTarget uses text-xs)
    md: "text-base",
    lg: "text-xl",
  };

  return (
    <span
      className={cn(
        "font-mono", // No font-semibold - match other metric values
        sizeClasses[size],
        isPositive && "text-profit",
        !isPositive && !isZero && "text-loss",
        isZero && "text-muted-foreground",
        className
      )}
    >
      {showSign && !isZero && (isPositive ? "+" : "-")}
      {currency}
      {formattedValue}
    </span>
  );
}
interface PnlPercentProps {
  value: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PnlPercent({ value, size = "md", className }: PnlPercentProps) {
  const isPositive = value > 0;
  const isZero = value === 0;

  const formattedValue = Math.abs(value).toFixed(2);

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <span
      className={cn(
        "font-mono",
        sizeClasses[size],
        isPositive && "text-profit",
        !isPositive && !isZero && "text-loss",
        isZero && "text-muted-foreground",
        className
      )}
    >
      {!isZero && (isPositive ? "+" : "-")}
      {formattedValue}%
    </span>
  );
}
