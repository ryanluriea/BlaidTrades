import { useEffect, useState, Suspense, lazy } from "react";
import { useLocation } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

import { PipelineTab } from "@/components/autonomy/PipelineTab";
import { BacktestsTab } from "@/components/autonomy/BacktestsTab";
import { RunsLogsTab } from "@/components/autonomy/RunsLogsTab";
import { ReadinessScorecard } from "@/components/autonomy/ReadinessScorecard";
import { BacktestAutonomyProofPanel } from "@/components/autonomy/BacktestAutonomyProofPanel";
import { ProofDashboard } from "@/components/proof/ProofDashboard";
import { ExecutionProofPanel } from "@/components/proof/ExecutionProofPanel";
import { ResilienceScorecardPanel } from "@/components/proof/ResilienceScorecardPanel";
import { AutonomyLoopsPanel } from "@/components/proof/AutonomyLoopsPanel";
import { SystemAuditObservatory } from "@/components/proof/SystemAuditObservatory";
import { ConnectionsTab } from "@/components/connections";

import { useSystemEvents, useAiOpsBriefings } from "@/hooks/useTrading";
import { useGenerateAIBriefing } from "@/hooks/useEvolution";
import { useGoNoGoStatus } from "@/hooks/useProductionScorecard";
import { useQuery } from "@tanstack/react-query";

import { 
  LayoutDashboard,
  Zap,
  ShieldCheck,
  Server,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Activity,
  HeartPulse,
  Wrench,
  TrendingUp,
  Clock,
  Bot,
  Brain,
  GitBranch,
  DollarSign,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";

function MissionControlTab() {
  const goNoGo = useGoNoGoStatus();
  
  const { data: selfHealingEvents = [] } = useQuery({
    queryKey: ['self-healing-events'],
    queryFn: async () => {
      const response = await fetch('/api/system-events?limit=50', {
        credentials: 'include',
      });
      if (!response.ok) return [];
      const result = await response.json();
      const events = result.data || [];
      return events.filter((e: any) => 
        e.eventType?.includes('SELF_HEALING') || 
        e.eventType?.includes('AUTO_RECOVER') ||
        e.title?.includes('recovered') ||
        e.title?.includes('Self-healing')
      ).slice(0, 10);
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: healthSummary } = useQuery({
    queryKey: ['health-summary'],
    queryFn: async () => {
      const response = await fetch('/api/health-summary', {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (!goNoGo || goNoGo.isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-2 px-3">
                <Skeleton className="h-5 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Card><CardContent className="py-2 px-3"><Skeleton className="h-12" /></CardContent></Card>
          <Card><CardContent className="py-2 px-3"><Skeleton className="h-12" /></CardContent></Card>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-2 px-3">
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const goPaper = goNoGo.goPaper ?? false;
  const goShadow = goNoGo.goShadow ?? false;
  const goCanary = goNoGo.goCanary ?? false;
  const goLive = goNoGo.goLive ?? false;
  const blockers = goNoGo.blockers ?? [];

  const stages = [
    { key: 'paper', label: 'PAPER', go: goPaper, icon: Bot },
    { key: 'shadow', label: 'SHADOW', go: goShadow, icon: Activity },
    { key: 'canary', label: 'CANARY', go: goCanary, icon: TrendingUp },
    { key: 'live', label: 'LIVE', go: goLive, icon: Zap },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {stages.map((stage) => (
          <Card key={stage.key} className="text-center">
            <CardContent className="py-2 px-3">
              <div className="flex items-center justify-center gap-2">
                {stage.go ? (
                  <CheckCircle className="w-4 h-4 text-profit" />
                ) : (
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="font-medium text-xs">{stage.label}</span>
                <Badge variant={stage.go ? "default" : "secondary"} className="text-[10px] h-5">
                  {stage.go ? "GO" : "NO-GO"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card>
          <CardContent className="py-2 px-3">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              <span className="text-xs font-medium">Blockers ({blockers.length})</span>
            </div>
            {blockers.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {blockers.slice(0, 3).map((blocker, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <XCircle className="w-3 h-3 text-loss mt-0.5 shrink-0" />
                    <span className="text-muted-foreground truncate">{blocker}</span>
                  </li>
                ))}
                {blockers.length > 3 && (
                  <li className="text-muted-foreground/70">+{blockers.length - 3} more</li>
                )}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3 text-profit" />
                No blockers
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-2 px-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Wrench className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-medium">Self-Healing</span>
            </div>
            {selfHealingEvents.length > 0 ? (
              <ul className="space-y-1 text-xs max-h-16 overflow-auto">
                {selfHealingEvents.slice(0, 2).map((event: any, idx: number) => (
                  <li key={event.id || idx} className="flex items-start gap-1.5">
                    {event.severity === 'info' ? (
                      <CheckCircle className="w-3 h-3 text-profit mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
                    )}
                    <span className="text-muted-foreground truncate">{event.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3 text-profit" />
                System stable
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <div className="text-lg font-bold">{healthSummary?.data?.activeBots ?? '-'}</div>
            <div className="text-[10px] text-muted-foreground">Active Bots</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <div className="text-lg font-bold">{healthSummary?.data?.runningJobs ?? '-'}</div>
            <div className="text-[10px] text-muted-foreground">Running Jobs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <div className="text-lg font-bold">{healthSummary?.data?.paperInstances ?? '-'}</div>
            <div className="text-[10px] text-muted-foreground">Paper Runners</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <HeartPulse className={`w-4 h-4 mx-auto ${healthSummary?.data?.systemHealthy ? 'text-profit' : 'text-warning'}`} />
            <div className="text-[10px] text-muted-foreground">System Health</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExecutionTab() {
  const [subTab, setSubTab] = useState("pipeline");
  
  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="autonomy">Autonomy</TabsTrigger>
        </TabsList>
        
        <TabsContent value="pipeline" className="mt-4 space-y-6">
          <PipelineTab />
        </TabsContent>
        
        <TabsContent value="autonomy" className="mt-4 space-y-6">
          <AutonomyLoopsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ValidationTab() {
  const [subTab, setSubTab] = useState("backtests");
  
  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="backtests">Backtests</TabsTrigger>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="proof">Proof</TabsTrigger>
        </TabsList>
        
        <TabsContent value="backtests" className="mt-4 space-y-6">
          <BacktestsTab />
          <BacktestAutonomyProofPanel />
        </TabsContent>
        
        <TabsContent value="readiness" className="mt-4 space-y-6">
          <ReadinessScorecard />
          <ResilienceScorecardPanel />
        </TabsContent>
        
        <TabsContent value="proof" className="mt-4 space-y-6">
          <ExecutionProofPanel />
          <ProofDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfrastructureTab() {
  const [subTab, setSubTab] = useState("health");
  const { data: systemEvents = [] } = useSystemEvents(100);
  const { data: briefings = [] } = useAiOpsBriefings();
  const generateBriefing = useGenerateAIBriefing();

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="ai-ops">AI Ops</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="health" className="mt-4 space-y-6">
          <SystemAuditObservatory />
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent System Events</CardTitle>
            </CardHeader>
            <CardContent>
              {systemEvents.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-auto">
                  {systemEvents.slice(0, 20).map((event) => (
                    <div 
                      key={event.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                      data-testid={`event-item-${event.id}`}
                    >
                      {event.severity === "info" ? (
                        <CheckCircle className="w-5 h-5 text-profit mt-0.5" />
                      ) : event.severity === "warning" ? (
                        <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-loss mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{event.title}</p>
                        {event.message && (
                          <p className="text-sm text-muted-foreground truncate">{event.message}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <StatusBadge status={event.severity} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">No system events yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/alpha-decay" className="block" data-testid="link-alpha-decay">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-400" />
                    Alpha Decay Monitor
                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Track strategy performance decay across your bot fleet. Monitor Sharpe ratio degradation, win rate drops, and get early warnings.
                  </p>
                </CardContent>
              </Card>
            </Link>
            
            <Link to="/tca" className="block" data-testid="link-tca">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-400" />
                    Trade Cost Analysis
                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Execution quality metrics including slippage analysis, fill rates, timing analysis, and market impact reports.
                  </p>
                </CardContent>
              </Card>
            </Link>
            
            <Link to="/correlation" className="block" data-testid="link-correlation">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-blue-400" />
                    Correlation Analysis
                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Bot correlation tracking and portfolio diversification metrics. Identify concentrated risk across your strategies.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </TabsContent>

        <TabsContent value="ai-ops" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">AI Ops Center</CardTitle>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => generateBriefing.mutate('morning')}
                  disabled={generateBriefing.isPending}
                  data-testid="button-morning-brief"
                >
                  {generateBriefing.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">Morning Brief</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => generateBriefing.mutate('night')}
                  disabled={generateBriefing.isPending}
                  data-testid="button-night-report"
                >
                  {generateBriefing.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">Night Report</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {briefings.length > 0 ? (
                briefings.slice(0, 5).map((briefing) => (
                  <div 
                    key={briefing.id}
                    className="p-4 rounded-lg bg-muted/30"
                    data-testid={`briefing-item-${briefing.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <h4 className="font-medium">{briefing.title}</h4>
                      <StatusBadge status={briefing.briefing_type as any} />
                    </div>
                    <p className="text-sm text-muted-foreground">{briefing.summary}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(briefing.created_at).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No AI briefings yet</p>
                  <p className="text-sm">Generate a morning or night briefing to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <RunsLogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function OperationsCenter() {
  const location = useLocation();
  
  const getInitialTab = () => {
    if (location.pathname === "/backtests") {
      return "validation";
    }
    if (location.pathname === "/training") {
      return "execution";
    }
    return "dashboard";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab());

  useEffect(() => {
    if (location.pathname === "/backtests") {
      setActiveTab("validation");
    } else if (location.pathname === "/training") {
      setActiveTab("execution");
    }
  }, [location.pathname]);

  return (
    <AppLayout title="Operations Center" disableMainScroll>
      <div className="flex flex-col h-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex flex-col h-full">
          <TabsList className="h-10 bg-background flex-shrink-0 border-b border-border rounded-none w-full justify-start gap-2 px-0">
            <TabsTrigger 
              value="dashboard" 
              className="text-sm gap-1.5 px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-dashboard"
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger 
              value="execution" 
              className="text-sm gap-1.5 px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-execution"
            >
              <Zap className="w-4 h-4" />
              Execution
            </TabsTrigger>
            <TabsTrigger 
              value="validation" 
              className="text-sm gap-1.5 px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-validation"
            >
              <ShieldCheck className="w-4 h-4" />
              Validation
            </TabsTrigger>
            <TabsTrigger 
              value="infrastructure" 
              className="text-sm gap-1.5 px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-infrastructure"
            >
              <Server className="w-4 h-4" />
              Infrastructure
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4 flex-1 overflow-auto">
            <MissionControlTab />
          </TabsContent>

          <TabsContent value="execution" className="mt-4 flex-1 overflow-auto">
            <ExecutionTab />
          </TabsContent>

          <TabsContent value="validation" className="mt-4 flex-1 overflow-auto">
            <ValidationTab />
          </TabsContent>

          <TabsContent value="infrastructure" className="mt-4 flex-1 overflow-auto">
            <InfrastructureTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
