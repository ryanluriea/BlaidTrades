import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Cpu, Loader2, History, Zap, DollarSign, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { BotLLMSettingsPopover } from "./BotLLMSettingsPopover";

interface CostEvent {
  id: string;
  bot_id: string;
  category: string;
  provider: string;
  event_type: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string;
  created_at: string;
  metadata: any;
  trace_id?: string;
}

interface JobResult {
  id: string;
  bot_id: string;
  job_type: string;
  status: string;
  result: any;
  created_at: string;
}

interface LLMProviderBadgeProps {
  botId: string;
  botName?: string;
  strategyConfig?: {
    aiSettings?: {
      evolutionFrequency?: string;
      enabledProviders?: string[];
      useGlobalSettings?: boolean;
    };
    [key: string]: unknown;
  };
  /** Compact mode for grid box display - shows only abbreviation */
  compact?: boolean;
}

export const PROVIDER_CONFIG: Record<string, { name: string; color: string; bgColor: string; abbrev: string }> = {
  perplexity: { name: "Perplexity", color: "text-cyan-400", bgColor: "bg-cyan-500", abbrev: "PPX" },
  groq: { name: "Groq", color: "text-orange-400", bgColor: "bg-orange-500", abbrev: "GRQ" },
  openai: { name: "OpenAI", color: "text-emerald-400", bgColor: "bg-emerald-500", abbrev: "GPT" },
  anthropic: { name: "Anthropic", color: "text-amber-400", bgColor: "bg-amber-500", abbrev: "CLD" },
  gemini: { name: "Gemini", color: "text-blue-400", bgColor: "bg-blue-500", abbrev: "GEM" },
  xai: { name: "xAI", color: "text-purple-400", bgColor: "bg-purple-500", abbrev: "XAI" },
  grok: { name: "xAI Grok", color: "text-purple-400", bgColor: "bg-purple-500", abbrev: "G" },
  openrouter: { name: "OpenRouter", color: "text-pink-400", bgColor: "bg-pink-500", abbrev: "ORT" },
  other: { name: "External AI", color: "text-violet-400", bgColor: "bg-violet-500", abbrev: "AI" },
};

function formatTimeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  
  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  
  if (totalDays > 0) return `${totalDays}d ago`;
  if (totalHours > 0) return `${totalHours}h ago`;
  if (totalMinutes > 0) return `${totalMinutes}m ago`;
  return "just now";
}

function formatLocalTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}

export function LLMProviderBadge({ botId, botName, strategyConfig, compact = false }: LLMProviderBadgeProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  
  // Fetch ALL LLM cost events (no limit) for accurate counts
  const { data, isLoading } = useQuery<{ success: boolean; data: CostEvent[] }>({
    queryKey: ["/api/bots", botId, "cost-events", "all"],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/cost-events?limit=1000`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch cost events");
      return response.json();
    },
    enabled: !!botId,
    staleTime: 30000,
  });
  
  // Fetch job results to get mutation details (WHY and WHAT)
  const { data: jobsData } = useQuery<{ success: boolean; data: JobResult[] }>({
    queryKey: ["/api/jobs", botId, "evolution"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs?botId=${botId}&limit=100`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
    enabled: historyOpen && !!botId,
    staleTime: 60000,
  });

  const llmEvents = (data?.data || []).filter(e => e.category === "llm");
  const evolutionJobs = (jobsData?.data || []).filter(j => 
    j.job_type === "EVOLVING" && j.result?.aiEvolution
  );
  
  const lastEvent = llmEvents[0];
  const provider = lastEvent?.provider?.toLowerCase() || null;
  const config = provider ? PROVIDER_CONFIG[provider] : null;
  
  // Count usage and costs per provider
  const usageCount = llmEvents.length;
  const providerStats = llmEvents.reduce<Record<string, { count: number; cost: number; tokens: number }>>((acc, event) => {
    const p = event.provider?.toLowerCase();
    if (p) {
      if (!acc[p]) acc[p] = { count: 0, cost: 0, tokens: 0 };
      acc[p].count += 1;
      acc[p].cost += parseFloat(event.cost_usd || "0") || 0;
      acc[p].tokens += (event.input_tokens || 0) + (event.output_tokens || 0);
    }
    return acc;
  }, {});
  
  // Total cost across all providers
  const totalCost = Object.values(providerStats).reduce((sum, s) => sum + s.cost, 0);
  const totalTokens = Object.values(providerStats).reduce((sum, s) => sum + s.tokens, 0);

  if (isLoading) {
    if (compact) {
      return (
        <div className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border bg-muted/20 border-muted-foreground/30">
          <span className="text-[9px] uppercase leading-none opacity-70 text-muted-foreground">LLM</span>
          <span className="text-[11px] font-mono font-semibold leading-none text-muted-foreground">...</span>
        </div>
      );
    }
    return (
      <Badge 
        variant="outline" 
        className="h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  const inputTokens = lastEvent?.input_tokens || 0;
  const outputTokens = lastEvent?.output_tokens || 0;
  const cost = parseFloat(lastEvent?.cost_usd || "0") || 0;

  // ===== SHARED JSX ELEMENTS (defined before any early returns) =====
  
  const tooltipContent = (
    <TooltipContent side="top" className="max-w-[260px]">
      <p className="text-xs font-medium">
        {usageCount > 0 ? `${usageCount} AI call${usageCount > 1 ? 's' : ''}` : "No AI calls yet"}
      </p>
      {lastEvent && (
        <div className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
          <p>Last: {config?.name || lastEvent.provider} ({formatTimeAgo(lastEvent.created_at)})</p>
          <p>Tokens: {inputTokens.toLocaleString()} in / {outputTokens.toLocaleString()} out</p>
          <p>Cost: ${cost.toFixed(4)}</p>
          <p className="text-muted-foreground/70">
            {formatLocalTime(lastEvent.created_at)}
          </p>
        </div>
      )}
      {usageCount > 0 && Object.keys(providerStats).length > 0 && (
        <div className="text-[10px] mt-1.5 pt-1.5 border-t border-border/50">
          <p className="text-muted-foreground mb-0.5">Provider breakdown (all-time):</p>
          <div className="flex flex-col gap-0.5">
            {Object.entries(providerStats)
              .sort((a, b) => b[1].count - a[1].count)
              .map(([p, stats]) => {
                const pConfig = PROVIDER_CONFIG[p];
                return pConfig ? (
                  <div key={p} className="flex items-center justify-between gap-2">
                    <span className={cn("font-medium", pConfig.color)}>
                      {pConfig.name}: {stats.count}
                    </span>
                    <span className="text-muted-foreground">
                      ${stats.cost.toFixed(2)}
                    </span>
                  </div>
                ) : null;
              })}
          </div>
          <div className="mt-1 pt-1 border-t border-border/30 flex justify-between">
            <span className="text-muted-foreground">Total:</span>
            <span className="font-medium text-foreground">${totalCost.toFixed(2)}</span>
          </div>
        </div>
      )}
      <p className="text-[10px] text-purple-400 mt-1">Click for history</p>
    </TooltipContent>
  );

  const historyModal = (
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-purple-400" />
            AI Evolution History - {botName || `Bot ${botId.slice(0, 8)}`}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/30 rounded-md p-3 text-center">
              <div className="text-2xl font-bold text-purple-400">{usageCount}</div>
              <div className="text-xs text-muted-foreground">Total AI Calls</div>
            </div>
            <div className="bg-muted/30 rounded-md p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">${totalCost.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Total Cost</div>
            </div>
            <div className="bg-muted/30 rounded-md p-3 text-center">
              <div className="text-2xl font-bold text-blue-400">{(totalTokens / 1000).toFixed(0)}K</div>
              <div className="text-xs text-muted-foreground">Total Tokens</div>
            </div>
          </div>
          
          {/* Provider Breakdown */}
          <div className="bg-muted/20 rounded-md p-3">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              Provider Breakdown
            </h4>
            <div className="space-y-2">
              {Object.entries(providerStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([p, stats]) => {
                  const pConfig = PROVIDER_CONFIG[p];
                  const pct = usageCount > 0 ? (stats.count / usageCount * 100).toFixed(0) : 0;
                  return pConfig ? (
                    <div key={p} className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn("text-sm font-medium", pConfig.color)}>
                            {pConfig.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {stats.count} calls ({pct}%) - ${stats.cost.toFixed(2)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full",
                              p === "groq" ? "bg-orange-400" :
                              p === "openai" ? "bg-emerald-400" :
                              p === "anthropic" ? "bg-amber-400" :
                              p === "gemini" ? "bg-blue-400" : "bg-purple-400"
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null;
                })}
            </div>
          </div>
          
          {/* Evolution History - WHY and WHAT */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              Recent Evolution Jobs ({evolutionJobs.length})
            </h4>
            <ScrollArea className="h-[250px] pr-3">
              <div className="space-y-2">
                {evolutionJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Open history to load evolution details...
                  </p>
                ) : (
                  evolutionJobs.slice(0, 50).map((job) => {
                    const result = job.result;
                    const aiInfo = result?.aiEvolution || {};
                    const jobProvider = aiInfo.provider?.toLowerCase();
                    const jobConfig = jobProvider ? PROVIDER_CONFIG[jobProvider] : null;
                    
                    return (
                      <div 
                        key={job.id}
                        className="bg-card border rounded-md p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {jobConfig && (
                              <Badge variant="outline" className={cn("h-4 text-[9px]", jobConfig.color)}>
                                {jobConfig.name}
                              </Badge>
                            )}
                            <span className="text-muted-foreground">
                              {formatLocalTime(job.created_at)}
                            </span>
                          </div>
                          <span className="text-emerald-400 font-mono">
                            ${(aiInfo.cost || 0).toFixed(4)}
                          </span>
                        </div>
                        
                        {/* WHAT: Action taken */}
                        {result?.action && (
                          <div className="text-foreground font-medium">
                            {result.action === "EVOLUTION_CONVERGED" ? "Converged" : result.action}
                            {result.fromGeneration && result.toGeneration && (
                              <span className="text-muted-foreground font-normal ml-1">
                                Gen {result.fromGeneration} → {result.toGeneration}
                              </span>
                            )}
                          </div>
                        )}
                        
                        {/* WHY: Reason */}
                        {result?.reason && (
                          <div className="text-muted-foreground mt-0.5">
                            {result.reason}
                          </div>
                        )}
                        
                        {/* Suggestions applied */}
                        {aiInfo.suggestionsCount > 0 && (
                          <div className="text-muted-foreground mt-0.5">
                            Suggestions: {aiInfo.appliedCount || 0}/{aiInfo.suggestionsCount} applied
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  // ===== COMPACT MODE =====
  if (compact) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              className="w-[64px] h-6 flex items-center justify-center gap-1 rounded-sm border bg-muted/20 border-muted-foreground/30 cursor-pointer hover:bg-muted/40 transition-all"
              onClick={() => setHistoryOpen(true)}
              data-testid={`compact-llm-${botId}`}
            >
              <Sparkles className={cn("w-3.5 h-3.5", config?.color || "text-muted-foreground")} />
              <span className={cn(
                "text-[11px] font-mono font-semibold leading-none",
                config?.color || "text-muted-foreground"
              )}>
                {usageCount > 0 ? (config?.abbrev || lastEvent?.provider?.slice(0, 3).toUpperCase()) : "--"}
              </span>
            </button>
          </TooltipTrigger>
          {tooltipContent}
        </Tooltip>
        {historyModal}
      </>
    );
  }

  // ===== FULL MODE =====
  const badgeContent = (
    <Badge 
      variant="outline" 
      className={cn(
        "h-5 px-1.5 gap-1 text-[10px] cursor-pointer transition-colors",
        usageCount > 0 
          ? `bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20 ${config?.color || "text-purple-400"}`
          : "text-muted-foreground bg-muted/30 hover:bg-muted/50"
      )}
      data-testid={`badge-llm-${botId}`}
    >
      <Cpu className="h-3 w-3" />
      <span>{usageCount > 0 ? usageCount : "--"}</span>
    </Badge>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div onClick={() => setHistoryOpen(true)} className="cursor-pointer">
            {badgeContent}
          </div>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      {historyModal}
    </>
  );
}
