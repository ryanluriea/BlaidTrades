/**
 * QC Health Banner
 * Displays a banner when QuantConnect API is degraded or offline
 * Shows status, failure rate, and bypass policy information
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, WifiOff, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface QCHealthData {
  status: "QC_HEALTHY" | "QC_DEGRADED" | "QC_OFFLINE";
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorMessage: string | null;
  failureRateLastHour: number;
  totalCallsLastHour: number;
  bypassPolicy: {
    allowBypass: boolean;
    reason: string;
    manualOverrideRequired: boolean;
  };
}

export function QCHealthBanner() {
  const { data: healthData, isLoading } = useQuery<{ success: boolean; data: QCHealthData }>({
    queryKey: ["/api/qc/health"],
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (isLoading || !healthData?.success || !healthData.data) {
    return null;
  }

  const { status, consecutiveFailures, failureRateLastHour, lastErrorMessage, bypassPolicy } = healthData.data;

  if (status === "QC_HEALTHY") {
    return null;
  }

  const isOffline = status === "QC_OFFLINE";
  const failureRatePct = Math.round(failureRateLastHour * 100);

  return (
    <Alert 
      variant={isOffline ? "destructive" : "default"} 
      className={`mb-4 ${isOffline ? "" : "border-amber-500/50 bg-amber-500/10"}`}
      data-testid="banner-qc-health"
    >
      {isOffline ? (
        <WifiOff className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      )}
      <AlertTitle className="flex items-center gap-2">
        {isOffline ? "QC API Offline" : "QC API Degraded"}
        <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />
      </AlertTitle>
      <AlertDescription className="mt-1 space-y-1">
        <p className="text-sm">
          {isOffline 
            ? `QuantConnect API is offline (${consecutiveFailures} consecutive failures).`
            : `QuantConnect API experiencing issues (${failureRatePct}% failure rate).`
          }
        </p>
        {lastErrorMessage && (
          <p className="text-xs text-muted-foreground font-mono truncate max-w-lg">
            Last error: {lastErrorMessage}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {bypassPolicy.reason}
        </p>
        {bypassPolicy.manualOverrideRequired && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Manual override available for urgent promotions.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
