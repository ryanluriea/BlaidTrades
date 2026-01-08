import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useGoNoGoStatus } from "@/hooks/useProductionScorecard";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Rocket,
  FlaskConical,
  Eye,
  Zap,
  Target,
} from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

const stageConfig = [
  { key: 'goPaper', label: 'PAPER', icon: FlaskConical, description: 'Simulated trading ready' },
  { key: 'goShadow', label: 'SHADOW', icon: Eye, description: 'Mirror mode ready' },
  { key: 'goCanary', label: 'CANARY', icon: Zap, description: 'Limited live ready' },
  { key: 'goLive', label: 'LIVE', icon: Target, description: 'Full production ready' },
] as const;

export function GoNoGoPanel() {
  const { 
    isLoading,
    goPaper, 
    goShadow, 
    goCanary, 
    goLive, 
    blockers,
    paperReadiness,
    chaosResults,
  } = useGoNoGoStatus();

  const isDegraded = !isLoading && paperReadiness === undefined && chaosResults === undefined;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            GO / NO-GO Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            GO / NO-GO Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="GO/NO-GO status unavailable" />
        </CardContent>
      </Card>
    );
  }

  const statuses = { goPaper, goShadow, goCanary, goLive };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Rocket className="w-5 h-5" />
          GO / NO-GO Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stage Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stageConfig.map(({ key, label, icon: Icon, description }) => {
            const isGo = statuses[key];
            return (
              <div 
                key={key}
                className={`p-4 rounded-lg border-2 text-center transition-colors ${
                  isGo 
                    ? 'border-profit/50 bg-profit/10' 
                    : 'border-muted bg-muted/30'
                }`}
              >
                <div className="flex justify-center mb-2">
                  {isGo ? (
                    <CheckCircle className="w-8 h-8 text-profit" />
                  ) : (
                    <XCircle className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{label}</span>
                </div>
                <Badge variant={isGo ? "default" : "secondary"} className="text-xs">
                  {isGo ? 'GO' : 'NO-GO'}
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">{description}</p>
              </div>
            );
          })}
        </div>

        {/* Blockers */}
        {blockers.length > 0 && (
          <div className="p-4 rounded-lg bg-loss/10 border border-loss/30 space-y-2">
            <div className="flex items-center gap-2 text-loss font-medium">
              <AlertTriangle className="w-4 h-4" />
              Blockers ({blockers.length})
            </div>
            <ul className="text-sm space-y-1">
              {blockers.map((blocker, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <XCircle className="w-3 h-3 mt-1 text-loss flex-shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-muted-foreground">Paper Bots</p>
            <p className="font-mono text-lg">{paperReadiness?.active_runners.count_paper_bots ?? 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-muted-foreground">Heartbeat %</p>
            <p className="font-mono text-lg">{(paperReadiness?.active_runners.heartbeat_fresh_pct ?? 0).toFixed(0)}%</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-muted-foreground">Resilience</p>
            <p className="font-mono text-lg">{chaosResults?.resilience_score ?? '—'}%</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-muted-foreground">Chaos Verdict</p>
            <p className="font-mono text-lg">{chaosResults?.verdict ?? '—'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
