import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Key,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  RefreshCw,
  Download,
  AlertTriangle,
  Loader2,
  Rocket,
  Lock,
} from "lucide-react";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useCredentialReadiness, type IntegrationStatus } from "@/hooks/useCredentialReadiness";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export function CredentialsVault() {
  const { data: integrations = [], isLoading: integrationsLoading } = useIntegrations();
  const { generateReport, exportReport, isLoading: reportLoading, report } = useCredentialReadiness();

  const getStatusBadge = (status: IntegrationStatus["status"]) => {
    switch (status) {
      case "PASS":
        return (
          <Badge className="bg-profit/10 text-profit border-profit/20 text-[10px]">
            <CheckCircle className="w-3 h-3 mr-1" />
            PASS
          </Badge>
        );
      case "FAIL":
        return (
          <Badge className="bg-loss/10 text-loss border-loss/20 text-[10px]">
            <XCircle className="w-3 h-3 mr-1" />
            FAIL
          </Badge>
        );
      case "DEGRADED":
        return (
          <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px]">
            <AlertTriangle className="w-3 h-3 mr-1" />
            DEGRADED
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px]">
            NOT CONFIGURED
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Readiness Report Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Production Readiness</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateReport()}
                disabled={reportLoading}
              >
                {reportLoading ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Validate
              </Button>
              {report && (
                <Button size="sm" variant="outline" onClick={exportReport}>
                  <Download className="w-3 h-3 mr-1" />
                  Export
                </Button>
              )}
            </div>
          </div>
          <CardDescription>
            Validate all credentials and integrations for CANARY/LIVE trading
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report ? (
            <>
              {/* Readiness Status Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={cn(
                    "p-3 rounded-lg border",
                    report.canary_ready
                      ? "bg-profit/10 border-profit/30"
                      : "bg-loss/10 border-loss/30"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Rocket className="w-4 h-4" />
                    <span className="font-medium text-sm">CANARY READY</span>
                  </div>
                  <Badge
                    className={cn(
                      "text-xs",
                      report.canary_ready
                        ? "bg-profit/20 text-profit"
                        : "bg-loss/20 text-loss"
                    )}
                  >
                    {report.canary_ready ? "YES" : "NO"}
                  </Badge>
                  {report.canary_blockers.length > 0 && (
                    <ul className="mt-2 text-xs text-loss space-y-0.5">
                      {report.canary_blockers.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div
                  className={cn(
                    "p-3 rounded-lg border",
                    report.live_ready
                      ? "bg-profit/10 border-profit/30"
                      : "bg-loss/10 border-loss/30"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Lock className="w-4 h-4" />
                    <span className="font-medium text-sm">LIVE READY</span>
                  </div>
                  <Badge
                    className={cn(
                      "text-xs",
                      report.live_ready
                        ? "bg-profit/20 text-profit"
                        : "bg-loss/20 text-loss"
                    )}
                  >
                    {report.live_ready ? "YES" : "NO"}
                  </Badge>
                  {report.live_blockers.length > 0 && (
                    <ul className="mt-2 text-xs text-loss space-y-0.5">
                      {report.live_blockers.slice(0, 3).map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                      {report.live_blockers.length > 3 && (
                        <li>+{report.live_blockers.length - 3} more</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  Total: <strong>{report.summary.total}</strong>
                </span>
                <span className="text-profit">
                  Passed: <strong>{report.summary.passed}</strong>
                </span>
                <span className="text-loss">
                  Failed: <strong>{report.summary.failed}</strong>
                </span>
                <span className="text-warning">
                  Degraded: <strong>{report.summary.degraded}</strong>
                </span>
              </div>

              {/* Validated Integrations List */}
              <ScrollArea className="h-48">
                <div className="space-y-2">
                  {report.integrations.map((integration) => (
                    <div
                      key={integration.id}
                      className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/30"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">
                          {integration.kind}
                        </Badge>
                        <span className="text-sm font-medium">{integration.label}</span>
                        {integration.latency_ms && (
                          <span className="text-xs text-muted-foreground">
                            {integration.latency_ms}ms
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {integration.validated && (
                          <span className="text-[10px] text-muted-foreground">
                            ✓ Validated
                          </span>
                        )}
                        {getStatusBadge(integration.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {report.smoke_test_latest && (
                <div className="text-xs text-muted-foreground">
                  Last smoke test: {report.smoke_test_latest.overall_status} at{" "}
                  {new Date(report.smoke_test_latest.finished_at).toLocaleString()}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Click "Validate" to check all credentials</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credentials Vault Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Stored Credentials</CardTitle>
          </div>
          <CardDescription>
            Encrypted API keys and secrets (metadata only - values never exposed)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-2 rounded-lg bg-muted/30 mb-3 flex items-center gap-2 text-xs">
            <Shield className="w-3 h-3 text-profit" />
            <span className="text-muted-foreground">
              AES-256 encrypted at rest. Only edge functions can access raw values.
            </span>
          </div>

          {integrationsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : integrations.length > 0 ? (
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <Key className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{integration.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {integration.provider} • {integration.kind.replace('_', ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {integration.key_fingerprint ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-profit" />
                          <span className="text-xs font-mono">{integration.key_fingerprint}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <XCircle className="w-3 h-3 text-loss" />
                          <span className="text-xs text-muted-foreground">No key</span>
                        </div>
                      )}
                      {integration.last_verified_at && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {format(new Date(integration.last_verified_at), "MMM d")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No credentials stored</p>
              <p className="text-xs mt-1">Add integrations to store encrypted API keys</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
