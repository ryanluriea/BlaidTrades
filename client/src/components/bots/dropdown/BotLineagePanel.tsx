import { useQuery } from "@tanstack/react-query";
import http from "@/lib/http";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, ExternalLink, ChevronDown, Sparkles, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface BotLineagePanelProps {
  botId: string;
}

interface StrategyLineage {
  id: string;
  bot_id: string | null;
  candidate_id: string | null;
  thesis: string | null;
  regimes: string[] | null;
  do_trade_bullets: string[] | null;
  dont_trade_bullets: string[] | null;
  evidence_links_json: Record<string, unknown> | null;
  evolution_summary_json: Record<string, unknown> | null;
  ai_usage_json: Record<string, unknown> | null;
  cost_lifetime_usd: number | null;
  author_type: string | null;
  created_at: string;
  updated_at: string;
}

export function BotLineagePanel({ botId }: BotLineagePanelProps) {
  const { data: lineage, isLoading } = useQuery({
    queryKey: ["bot-lineage", botId],
    queryFn: async (): Promise<StrategyLineage | null> => {
      // Use Express API for lineage data
      const response = await http.get<any>(`/api/bots/${botId}/lineage`);
      if (!response.ok || !response.data) return null;
      return response.data as StrategyLineage;
    },
    enabled: !!botId,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/50">
        <CardHeader className="p-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (!lineage) {
    return (
      <Card className="bg-card/50">
        <CardHeader className="p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Why This Bot Exists
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <p className="text-xs text-muted-foreground">
            No strategy lineage available. This bot may have been created manually.
          </p>
        </CardContent>
      </Card>
    );
  }

  const regimes = lineage.regimes || [];
  const doTrade = lineage.do_trade_bullets || [];
  const dontTrade = lineage.dont_trade_bullets || [];
  const evidenceLinks = lineage.evidence_links_json as { sources?: Array<{ title?: string; url?: string }> } | null;
  const evolutionSummary = lineage.evolution_summary_json as { changes?: Array<{ reason: string; diff: string }> } | null;
  const aiUsage = lineage.ai_usage_json as Record<string, { cost: number; calls: number }> | null;
  const updatedAgo = formatDistanceToNow(new Date(lineage.updated_at), { addSuffix: true });

  return (
    <Card className="bg-card/50">
      <CardHeader className="p-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Why This Bot Exists
          </CardTitle>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Updated {updatedAgo}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Thesis */}
        {lineage.thesis && (
          <p className="text-sm">{lineage.thesis}</p>
        )}

        {/* Regimes */}
        {regimes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {regimes.map((regime) => (
              <Badge
                key={regime}
                variant="outline"
                className="text-[10px] capitalize"
              >
                {regime.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}

        {/* Do/Don't Trade */}
        {(doTrade.length > 0 || dontTrade.length > 0) && (
          <div className="grid gap-2 md:grid-cols-2">
            {doTrade.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Trades When
                </p>
                <ul className="space-y-0.5">
                  {doTrade.slice(0, 4).map((item, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground pl-4">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dontTrade.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Avoids
                </p>
                <ul className="space-y-0.5">
                  {dontTrade.slice(0, 4).map((item, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground pl-4">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Evolution Changes */}
        {evolutionSummary?.changes && evolutionSummary.changes.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className="h-3 w-3" />
              Recent Changes ({evolutionSummary.changes.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-24 mt-2">
                <div className="space-y-1.5">
                  {evolutionSummary.changes.slice(0, 5).map((change, i) => (
                    <div key={i} className="text-[11px] p-1.5 rounded bg-muted/50">
                      <p className="font-medium">{change.reason}</p>
                      <p className="text-muted-foreground font-mono">{change.diff}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Evidence Links */}
        {evidenceLinks?.sources && evidenceLinks.sources.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className="h-3 w-3" />
              Evidence Sources ({evidenceLinks.sources.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-1">
                {evidenceLinks.sources.slice(0, 5).map((source, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    {source.url ? (
                      <a 
                        href={source.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate max-w-[250px]"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{source.title}</span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* AI Usage & Cost */}
        {(aiUsage || lineage.cost_lifetime_usd) && (
          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              <span>AI-generated</span>
            </div>
            {lineage.cost_lifetime_usd != null && lineage.cost_lifetime_usd > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ${lineage.cost_lifetime_usd.toFixed(4)} spent
              </span>
            )}
            {aiUsage && Object.keys(aiUsage).length > 0 && (
              <div className="flex gap-1">
                {Object.entries(aiUsage).slice(0, 3).map(([provider]) => (
                  <Badge key={provider} variant="outline" className="text-[9px] h-4 px-1">
                    {provider}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
