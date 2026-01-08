import { useState } from "react";
import { useSecurityGate } from "@/contexts/SecurityGateContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, RotateCcw, Bug, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export function RestHealthDebugPanel() {
  const { 
    limitedMode, 
    restFailCount, 
    restDisabledUntil, 
    lastRestError,
    lastHealthyAt,
    isCheckingHealth,
    clearLimitedMode,
    checkHealth,
    getDebugInfo 
  } = useSecurityGate();

  const [showDebug, setShowDebug] = useState(false);

  const now = Date.now();
  const isCircuitOpen = restDisabledUntil && restDisabledUntil > now;
  const remainingCooldown = isCircuitOpen ? Math.ceil((restDisabledUntil - now) / 1000) : 0;

  const handleCheckHealth = async () => {
    const healthy = await checkHealth();
    if (!healthy) {
      console.warn("Health check failed - REST still degraded");
    }
  };

  // Only show if in limited mode or has recent errors
  if (!limitedMode && !lastRestError) {
    return null;
  }

  return (
    <Card className="border-destructive/50 bg-destructive/5 mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCircuitOpen ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : limitedMode ? (
              <AlertTriangle className="h-4 w-4 text-warning" />
            ) : (
              <CheckCircle className="h-4 w-4 text-success" />
            )}
            REST API Status
          </div>
          <div className="flex items-center gap-2">
            {/* RULE: Only show badge when there's a problem - no "OK" badges */}
            {(isCircuitOpen || limitedMode) && (
              <Badge variant={isCircuitOpen ? "destructive" : "outline"}>
                {isCircuitOpen ? `Circuit Open (${remainingCooldown}s)` : "Degraded"}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lastRestError && (
          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            <div><strong>Last Error:</strong> {lastRestError.endpoint}</div>
            <div><strong>Status:</strong> {lastRestError.status || "N/A"} - {lastRestError.code || lastRestError.message}</div>
            <div><strong>At:</strong> {lastRestError.at}</div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckHealth}
            disabled={isCheckingHealth}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isCheckingHealth ? 'animate-spin' : ''}`} />
            {isCheckingHealth ? "Checking..." : "Check Health"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={clearLimitedMode}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset Degraded State
          </Button>
        </div>

        {showDebug && (
          <div className="text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-48">
            <pre>{JSON.stringify(getDebugInfo(), null, 2)}</pre>
          </div>
        )}

        {lastHealthyAt && (
          <div className="text-xs text-muted-foreground">
            Last healthy: {new Date(lastHealthyAt).toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
