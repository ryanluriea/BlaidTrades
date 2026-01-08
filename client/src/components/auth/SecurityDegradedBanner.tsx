import React, { useState } from "react";
import { AlertTriangle, ShieldAlert, RefreshCw, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSecurityGate } from "@/contexts/SecurityGateContext";
import { copyDebugBundle } from "@/lib/debugBundle";

export function SecurityDegradedBanner({ className }: { className?: string }) {
  const { 
    limitedMode, 
    lastRestError, 
    clearLimitedMode, 
    restDisabledUntil,
    restFailCount,
    isCheckingHealth,
    checkHealth,
    getDebugInfo,
    lastHealthyAt,
  } = useSecurityGate();

  const [showDebug, setShowDebug] = useState(false);

  if (!limitedMode) return null;

  const now = Date.now();
  const isCircuitOpen = restDisabledUntil && restDisabledUntil > now;
  const remainingSeconds = isCircuitOpen ? Math.ceil((restDisabledUntil - now) / 1000) : 0;

  const handleCheckHealth = async () => {
    const healthy = await checkHealth();
    if (healthy) {
      // Will auto-clear via the checkHealth function
    }
  };

  const debugInfo = getDebugInfo();

  return (
    <div
      className={cn(
        "w-full border-b border-amber-500/30 bg-amber-500/10",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-7xl px-4 lg:px-6 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5" />
            <div className="text-xs">
              <div className="font-medium text-foreground">
                {isCircuitOpen 
                  ? `Circuit Breaker OPEN — ${remainingSeconds}s remaining`
                  : "REST API Degraded — Limited Mode"
                }
              </div>
              <div className="text-muted-foreground">
                {isCircuitOpen 
                  ? "REST calls paused. Will auto-retry when cooldown expires."
                  : "Read-only access enabled. Some features may be unavailable."
                }
                {lastRestError && (
                  <span className="ml-1">
                    ({lastRestError.endpoint} • {lastRestError.code ?? lastRestError.status ?? "error"})
                  </span>
                )}
                <span className="ml-1 text-muted-foreground/70">
                  Failures: {restFailCount}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckHealth}
              disabled={isCheckingHealth}
              className="gap-1"
            >
              <RefreshCw className={cn("h-3 w-3", isCheckingHealth && "animate-spin")} />
              {isCheckingHealth ? "Checking..." : "Check Health"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={clearLimitedMode}
              className="gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyDebugBundle({
                failingEndpoint: lastRestError?.endpoint ?? "security_gate",
                failingStatus: lastRestError?.status,
                failingError: lastRestError?.message,
                ...debugInfo,
              })}
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Debug
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
            >
              {showDebug ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {showDebug && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs font-mono overflow-auto max-h-32">
            <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
