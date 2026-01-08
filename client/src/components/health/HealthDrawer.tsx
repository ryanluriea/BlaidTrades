import { useState, useEffect } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useLiveReadiness, type ComponentHealth } from "@/hooks/useLiveReadiness";
import { useSmokeTest } from "@/hooks/useSmokeTest";
import { useRunFullAudit } from "@/hooks/useFullAudit";
import { useHealthSummary, type HealthBlocker } from "@/hooks/useHealthSummary";
import { useMemoryStatus } from "@/hooks/useMemoryStatus";
import { useScaleTestResults, useScaleTestStatus, useRunScaleTest } from "@/hooks/useScaleTests";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DataConsistencyVerifier } from "./DataConsistencyVerifier";
import { SessionSelectionStability } from "./SessionSelectionStability";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  Download,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Database,
  Wifi,
  Server,
  Bot,
  Cpu,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Activity,
  Shield,
  FileCheck,
  Bell,
  Zap,
  HardDrive,
  Gauge,
  Play,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";


interface HealthDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const componentIcons: Record<string, React.ElementType> = {
  Redis: Database,
  Queues: Server,
  "Market Data Live": Wifi,
  "Market Data Historical": Activity,
  Brokers: Cpu,
  "Bot Fleet": Bot,
  "Risk Engine": Shield,
  Audit: FileCheck,
  Alerts: Bell,
  "Emergency Controls": Zap,
  "Data Integrity": Shield,
  Authentication: Shield,
};

function safeFormatDistance(timestamp: string | null | undefined, fallback = "Never"): string {
  if (!timestamp) return fallback;
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return fallback;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return fallback;
  }
}

function safeFormat(timestamp: string | null | undefined, formatStr: string, fallback = "N/A"): string {
  if (!timestamp) return fallback;
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return fallback;
    return format(date, formatStr);
  } catch {
    return fallback;
  }
}

export function HealthDrawer({ open, onOpenChange }: HealthDrawerProps) {
  const {
    data: readinessResult,
    isLoading,
    error: readinessError,
    refetch,
  } = useLiveReadiness();
  const { data: healthSummary, error: summaryError } = useHealthSummary();
  const { runSmokeTest, isRunning: smokeTestRunning } = useSmokeTest();
  const { mutateAsync: runAudit, isPending: auditRunning } = useRunFullAudit();
  const { data: memoryStatus } = useMemoryStatus();
  const { data: scaleTestResults } = useScaleTestResults();
  const { data: scaleTestStatus } = useScaleTestStatus();
  const { mutateAsync: runScaleTest, isPending: scaleTestRunning } = useRunScaleTest();
  const navigate = useNavigate();
  const [expandedBlockers, setExpandedBlockers] = useState<Set<string>>(new Set());
  const [hasAutoRun, setHasAutoRun] = useState(false);
  const [showOnlyVerified, setShowOnlyVerified] = useState(false);

  // Extract data from the envelope - fail-closed: if degraded, treat as null
  const readiness = readinessResult?.degraded ? null : readinessResult?.data;
  const isDegraded = readinessResult?.degraded ?? false;

  // Auto-run smoke test on first open if components are UNVERIFIED/FAIL
  useEffect(() => {
    if (open && !hasAutoRun && !smokeTestRunning && readiness) {
      const needsVerification = readiness.componentHealth.some(
        (c) => c.status === "UNVERIFIED" || c.status === "FAIL",
      );
      if (needsVerification) {
        setHasAutoRun(true);
        runSmokeTest().then(() => refetch());
      }
    }
  }, [open, hasAutoRun, smokeTestRunning, readiness, refetch, runSmokeTest]);

  const toggleBlocker = (code: string) => {
    setExpandedBlockers((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleSmokeTest = async () => {
    await runSmokeTest();
    refetch();
  };

  const handleAudit = async () => {
    await runAudit();
    refetch();
  };

  const handleExportJson = () => {
    if (!readiness) return;
    const report = {
      overall_status: readiness.overallStatus,
      live_ready: readiness.liveReady,
      canary_ready: readiness.canaryReady,
      blockers: readiness.blockers,
      component_health: readiness.componentHealth,
      timestamp: readiness.timestamp,
      build_version: "1.0.0",
      environment: "production",
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `health-report-${format(new Date(), "yyyy-MM-dd-HHmmss")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Health report exported");
  };

  const handleCopySummary = () => {
    if (!readiness) return;
    const summary = `BlaidAgent Health Report
Status: ${readiness.overallStatus}
Live Ready: ${readiness.liveReady ? "YES" : "NO"}
Canary Ready: ${readiness.canaryReady ? "YES" : "NO"}
Timestamp: ${safeFormat(readiness.timestamp, "PPpp")}

Components:
${readiness.componentHealth.map((c) => `- ${c.name}: ${c.status}`).join("\n")}

Blockers (${readiness.blockers.length}):
${readiness.blockers.map((b) => `- [${b.severity}] ${b.message}`).join("\n") || "None"}`;

    navigator.clipboard.writeText(summary);
    toast.success("Summary copied to clipboard");
  };

  const handleBlockerCTA = async (blocker: HealthBlocker) => {
    // Handle special CTAs that should trigger actions instead of navigation
    if (blocker.cta === "Run Full Audit" || blocker.cta === "Run Audit") {
      await handleAudit();
      return;
    }
    if (blocker.cta === "Run Smoke Test") {
      await handleSmokeTest();
      return;
    }
    // Navigate for other CTAs
    if (blocker.deep_link) {
      onOpenChange(false);
      navigate(blocker.deep_link);
    }
  };

  // RULE: Never show "OK" badges - only show problems
  const getOverallBadge = (status: string) => {
    switch (status) {
      case "OK":
        return null; // No badge for OK - clean UI
      case "WARN":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-lg px-4 py-1">WARN</Badge>;
      case "BLOCKED":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-lg px-4 py-1">BLOCKED</Badge>;
      default:
        return <Badge variant="outline" className="text-lg px-4 py-1">UNKNOWN</Badge>;
    }
  };

  // RULE: Never show "OK" badges - only show problems
  const getComponentBadge = (status: string) => {
    switch (status) {
      case "OK":
        return null; // No badge for OK - clean UI
      case "DEGRADED":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 text-[10px]">DEGRADED</Badge>;
      case "FAIL":
        return <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">FAIL</Badge>;
      case "UNVERIFIED":
        return <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">UNVERIFIED</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">UNKNOWN</Badge>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col" hideCloseButton>
        {/* Header */}
        <SheetHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-semibold">System Health</SheetTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {readiness?.timestamp
                  ? `Updated ${safeFormatDistance(readiness.timestamp, "recently")}`
                  : "Loading..."}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSmokeTest}
                disabled={smokeTestRunning || isLoading}
              >
                {smokeTestRunning ? (
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAudit}
                disabled={auditRunning || isLoading}
              >
                Audit
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {(readinessError || summaryError || isDegraded) && (
              <ErrorBanner
                endpoint="/rest/v1/(health queries)"
                message={
                  isDegraded
                    ? `Health data unavailable: ${readinessResult?.message || "System degraded"}`
                    : String((readinessError as any)?.message || (summaryError as any)?.message || readinessError || summaryError)
                }
                onRetry={() => refetch()}
              />
            )}

            {/* Top Summary Row */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Overall:</span>
                  {readiness && getOverallBadge(readiness.overallStatus)}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  {readiness?.liveReady ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Live Trading</p>
                    <p className={cn("text-xs", readiness?.liveReady ? "text-emerald-400" : "text-red-400")}>
                      {readiness?.liveReady ? "READY" : "BLOCKED"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {readiness?.canaryReady ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-yellow-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Canary</p>
                    <p className={cn("text-xs", readiness?.canaryReady ? "text-emerald-400" : "text-yellow-400")}>
                      {readiness?.canaryReady ? "READY" : "BLOCKED"}
                    </p>
                  </div>
                </div>
              </div>
              {!readiness?.liveReady && readiness?.blockers[0] && (
                <p className="text-xs text-red-400 mt-2 line-clamp-1">
                  Primary blocker: {readiness.blockers[0].message}
                </p>
              )}
            </Card>

            {/* Blocking Reasons */}
            {readiness?.blockers && readiness.blockers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Blocking Reasons ({readiness.blockers.length})
                </h3>
                <div className="space-y-2">
                  {readiness.blockers.map((blocker, idx) => (
                    <Card
                      key={blocker.code + idx}
                      className={cn(
                        "p-3 cursor-pointer transition-colors hover:bg-muted/50",
                        blocker.severity === "CRITICAL" && "border-red-500/30",
                        blocker.severity === "ERROR" && "border-orange-500/30",
                        blocker.severity === "WARNING" && "border-yellow-500/30"
                      )}
                      onClick={() => toggleBlocker(blocker.code)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2 flex-1">
                          <span className="mt-0.5">
                            {expandedBlockers.has(blocker.code) ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  blocker.severity === "CRITICAL" && "bg-red-500/10 text-red-400 border-red-500/30",
                                  blocker.severity === "ERROR" && "bg-orange-500/10 text-orange-400 border-orange-500/30",
                                  blocker.severity === "WARNING" && "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                                )}
                              >
                                {blocker.severity}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{blocker.component}</span>
                            </div>
                            <p className="text-sm">{blocker.message}</p>
                          </div>
                        </div>
                        {blocker.cta && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBlockerCTA(blocker);
                            }}
                          >
                            {blocker.cta}
                            <ArrowRight className="w-3 h-3 ml-1" />
                          </Button>
                        )}
                      </div>
                      {expandedBlockers.has(blocker.code) && (
                        <div className="mt-2 ml-6 text-xs text-muted-foreground space-y-1">
                          <p>Code: {blocker.code}</p>
                          {blocker.deep_link && <p>Deep Link: {blocker.deep_link}</p>}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Data Consistency Section */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Data Integrity</h3>
              <div className="grid grid-cols-1 gap-2">
                <DataConsistencyVerifier />
                <SessionSelectionStability />
              </div>
            </div>

            {/* Memory Status Section */}
            {memoryStatus?.current && memoryStatus?.peak && (() => {
              const currentHeapPct = (memoryStatus.current.heapPercent ?? memoryStatus.current.heapUsedPercent ?? 0) * (memoryStatus.current.heapUsedPercent !== undefined && memoryStatus.current.heapUsedPercent < 1 ? 100 : 1);
              const peakHeapPct = (memoryStatus.peak.heapPercent ?? memoryStatus.peak.heapUsedPercent ?? 0) * (memoryStatus.peak.heapUsedPercent !== undefined && memoryStatus.peak.heapUsedPercent < 1 ? 100 : 1);
              return (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  Memory
                </h3>
                <Card className="p-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Heap Usage</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono">
                          {((memoryStatus.current.heapUsed ?? 0) / 1024 / 1024).toFixed(0)} / {((memoryStatus.current.heapTotal ?? 0) / 1024 / 1024).toFixed(0)} MB
                        </span>
                        {memoryStatus.loadSheddingActive && (
                          <Badge variant="destructive" className="text-[10px]">SHEDDING</Badge>
                        )}
                        {memoryStatus.isUnderPressure && !memoryStatus.loadSheddingActive && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">PRESSURE</Badge>
                        )}
                      </div>
                    </div>
                    <Progress 
                      value={currentHeapPct} 
                      className={cn(
                        "h-2",
                        currentHeapPct > 80 ? "bg-red-500/20" : 
                        currentHeapPct > 60 ? "bg-yellow-500/20" : "bg-muted"
                      )}
                    />
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Current</p>
                        <p className="font-mono">{currentHeapPct.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Peak</p>
                        <p className="font-mono">{peakHeapPct.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Trend</p>
                        <p className={cn(
                          "font-mono",
                          memoryStatus.trend === "rising" ? "text-yellow-400" :
                          memoryStatus.trend === "falling" ? "text-emerald-400" : ""
                        )}>
                          {memoryStatus.trend ?? "stable"}
                        </p>
                      </div>
                    </div>
                    {(memoryStatus.blockedRequests ?? 0) > 0 && (
                      <p className="text-xs text-red-400">
                        Blocked requests: {memoryStatus.blockedRequests}
                      </p>
                    )}
                  </div>
                </Card>
              </div>
            );})()}

            {/* Scale Tests Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Gauge className="w-4 h-4" />
                  Scale Readiness
                </h3>
                {!scaleTestStatus?.running && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runScaleTest("full")}
                    disabled={scaleTestRunning}
                  >
                    {scaleTestRunning ? (
                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3 mr-1" />
                    )}
                    Run Tests
                  </Button>
                )}
              </div>
              <Card className="p-3">
                <div className="space-y-2">
                  {scaleTestStatus?.running ? (
                    <div className="flex items-center gap-2 text-xs">
                      <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
                      <span>Running {scaleTestStatus.currentProfile}...</span>
                    </div>
                  ) : scaleTestResults && scaleTestResults.length > 0 ? (
                    <div className="space-y-2">
                      {scaleTestResults.slice(0, 4).map((result) => (
                        <div key={result.runId} className="flex items-center justify-between text-xs">
                          <span className="font-medium">{result.profile}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : "-"}
                            </span>
                            {result.status === "PASS" ? (
                              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">PASS</Badge>
                            ) : result.status === "FAIL" ? (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">FAIL</Badge>
                            ) : result.status === "RUNNING" ? (
                              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">RUNNING</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">{result.status}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                      {(() => {
                        const allPass = scaleTestResults.every(r => r.status === "PASS");
                        const hasFail = scaleTestResults.some(r => r.status === "FAIL");
                        return (
                          <div className="pt-2 border-t border-border flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Scale Ready:</span>
                            {allPass ? (
                              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">YES</Badge>
                            ) : hasFail ? (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">NO</Badge>
                            ) : (
                              <Badge variant="outline">PENDING</Badge>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No scale tests run yet. Click "Run Tests" to verify autoscale readiness.
                    </p>
                  )}
                </div>
              </Card>
            </div>

            {/* Component Grid */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Components</h3>
              <div className="grid grid-cols-2 gap-2">
                {(healthSummary?.components || [])
                  .filter((component) =>
                    showOnlyVerified
                      ? Boolean(component.last_verified_at || component.last_success_at)
                      : true,
                  )
                  .map((component) => {
                    const Icon = componentIcons[component.name] || Activity;
                    return (
                      <Card key={component.name} className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium truncate">
                              {component.name}
                            </span>
                          </div>
                          {getComponentBadge(component.status)}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {component.metric_label && (
                            <p>
                              {component.metric_label}: {component.metric_value}
                            </p>
                          )}
                          {component.last_success_at && (
                            <p>
                              Last OK: {safeFormatDistance(component.last_success_at)}
                            </p>
                          )}
                          {component.last_error_at && (
                            <p>
                              Last error: {safeFormatDistance(component.last_error_at)}
                            </p>
                          )}
                          {component.last_error_message && (
                            <p className="text-red-400 line-clamp-2">
                              {component.last_error_message}
                            </p>
                          )}
                          {component.last_verified_at && (
                            <p>
                              Verified: {safeFormat(component.last_verified_at, "PPpp")}
                            </p>
                          )}
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Blockers: {readiness?.blockers.length || 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleExportJson}>
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCopySummary}>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}