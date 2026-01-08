import { useState } from "react";
import { cn } from "@/lib/utils";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { HealthDrawer } from "./HealthDrawer";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, XCircle, Circle, WifiOff } from "lucide-react";

export function HealthPill() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: health, isLoading, isError } = useHealthSummary();

  const isDegraded = isError || (!isLoading && !health);

  const getStatusStyles = (status: string | undefined) => {
    if (isDegraded) {
      return { color: "text-amber-400", bg: "bg-amber-500/20", Icon: WifiOff };
    }
    switch (status) {
      case "GREEN":
        return { color: "text-emerald-400", bg: "bg-emerald-500/20", Icon: CheckCircle2 };
      case "YELLOW":
        return { color: "text-yellow-400", bg: "bg-yellow-500/20", Icon: AlertTriangle };
      case "RED":
        return { color: "text-destructive", bg: "bg-destructive/20", Icon: XCircle };
      default:
        return { color: "text-muted-foreground", bg: "bg-muted", Icon: Circle };
    }
  };

  const styles = getStatusStyles(health?.overall);
  const Icon = styles.Icon;

  const getTooltipMessage = () => {
    if (isLoading) return "Loading...";
    if (isDegraded) return "Health data unavailable";
    return "System Health";
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setDrawerOpen(true)}
            className={cn(
              "p-1.5 rounded-full transition-colors hover:opacity-80",
              styles.bg
            )}
            data-testid="button-health-pill"
          >
            <Icon className={cn("w-4 h-4", styles.color)} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">
            {getTooltipMessage()} {"\u2022"} Click for details
          </p>
        </TooltipContent>
      </Tooltip>

      <ErrorBoundary 
        onReset={() => setDrawerOpen(false)}
        fallback={null}
      >
        <HealthDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </ErrorBoundary>
    </>
  );
}
