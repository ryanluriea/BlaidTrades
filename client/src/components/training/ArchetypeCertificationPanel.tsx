import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useArchetypeTestSummary,
  useRunArchetypeTest,
} from "@/hooks/useArchetypes";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Play,
  Loader2,
  RefreshCw,
  FlaskConical,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function ArchetypeCertificationPanel() {
  const { data: archetypes = [], isLoading } = useArchetypeTestSummary();
  const runTest = useRunArchetypeTest();
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRunTest = async (archetypeId: string) => {
    setRunningId(archetypeId);
    try {
      await runTest.mutateAsync({ archetypeId });
    } finally {
      setRunningId(null);
    }
  };

  const handleRunAllTests = async () => {
    const activeArchetypes = archetypes.filter(a => a.is_active);
    for (const arch of activeArchetypes) {
      setRunningId(arch.id);
      try {
        await runTest.mutateAsync({ archetypeId: arch.id });
      } catch (e) {
        console.error(`Test failed for ${arch.name}:`, e);
      }
    }
    setRunningId(null);
  };

  const getStatusIcon = (status: string | null | undefined) => {
    switch (status) {
      case "pass":
        return <CheckCircle className="w-4 h-4 text-profit" />;
      case "warn":
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case "fail":
        return <XCircle className="w-4 h-4 text-loss" />;
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "pass":
        return <Badge variant="outline" className="text-profit border-profit/30">PASS</Badge>;
      case "warn":
        return <Badge variant="outline" className="text-warning border-warning/30">WARN</Badge>;
      case "fail":
        return <Badge variant="outline" className="text-loss border-loss/30">FAIL</Badge>;
      case "running":
        return <Badge variant="outline" className="text-primary border-primary/30">RUNNING</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">UNTESTED</Badge>;
    }
  };

  // Group by category
  const groupedArchetypes = archetypes.reduce((acc, arch) => {
    const category = arch.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(arch);
    return acc;
  }, {} as Record<string, typeof archetypes>);

  // Summary stats
  const stats = {
    total: archetypes.length,
    active: archetypes.filter(a => a.is_active).length,
    pass: archetypes.filter(a => a.latestTestRun?.status === "pass").length,
    warn: archetypes.filter(a => a.latestTestRun?.status === "warn").length,
    fail: archetypes.filter(a => a.latestTestRun?.status === "fail").length,
    untested: archetypes.filter(a => !a.latestTestRun).length,
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Archetype Certification
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Archetype Certification
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunAllTests}
            disabled={runningId !== null}
          >
            {runningId ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Test All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {/* Stats row */}
        <div className="grid grid-cols-5 gap-2 mb-4 text-center">
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-lg font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="p-2 rounded-lg bg-profit/10">
            <p className="text-lg font-bold text-profit">{stats.pass}</p>
            <p className="text-xs text-muted-foreground">Pass</p>
          </div>
          <div className="p-2 rounded-lg bg-warning/10">
            <p className="text-lg font-bold text-warning">{stats.warn}</p>
            <p className="text-xs text-muted-foreground">Warn</p>
          </div>
          <div className="p-2 rounded-lg bg-loss/10">
            <p className="text-lg font-bold text-loss">{stats.fail}</p>
            <p className="text-xs text-muted-foreground">Fail</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-lg font-bold text-muted-foreground">{stats.untested}</p>
            <p className="text-xs text-muted-foreground">Untested</p>
          </div>
        </div>

        {/* Archetype list by category */}
        <ScrollArea className="h-[300px]">
          <div className="space-y-4">
            {Object.entries(groupedArchetypes).map(([category, arches]) => (
              <div key={category}>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  {category}
                </h4>
                <div className="space-y-1">
                  {arches.map(arch => (
                    <div
                      key={arch.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getStatusIcon(arch.latestTestRun?.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {arch.name}
                            {!arch.is_active && (
                              <span className="text-xs text-muted-foreground ml-1">(inactive)</span>
                            )}
                          </p>
                          {arch.latestTestRun?.finished_at && (
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(arch.latestTestRun.finished_at), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(arch.latestTestRun?.status)}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleRunTest(arch.id)}
                          disabled={runningId === arch.id}
                        >
                          {runningId === arch.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}