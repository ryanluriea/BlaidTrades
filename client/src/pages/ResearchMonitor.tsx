import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, DollarSign, Activity, Radio, Microscope,
  CheckCircle2, XCircle, Clock, ChevronRight, TrendingUp, Shield, Lightbulb,
  ExternalLink, BarChart2, Layers, ArrowRight, BookOpen, MessageSquare, ArrowDownCircle,
  Download, GitBranch, History, Users
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { format, isValid, formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";

type ResearchEventType = 
  | "search" | "source" | "idea" | "candidate" | "error" | "system" | "analysis"
  | "reasoning" | "validation" | "cost" | "phase" | "scoring" | "rejection" | "api_call"
  | "action_required";

type ResearchSource = "perplexity" | "grok" | "openai" | "anthropic" | "groq" | "gemini" | "system";

interface ResearchEvent {
  id: string;
  timestamp: Date;
  type: ResearchEventType;
  source: ResearchSource;
  title: string;
  details?: string;
  metadata?: Record<string, any>;
}

interface StrategyCandidate {
  id: string;
  name: string;
  archetype: string;
  hypothesis: string;
  confidence: number;
  confidenceBreakdown?: Record<string, number>;
  reasoning?: string;
  synthesis?: string;
  sources?: Array<{ type: string; label: string; detail: string; url?: string }>;
  symbols?: string[];
  provider: ResearchSource;
  timestamp: Date;
}

interface ResearchPhase {
  name: string;
  status: "pending" | "active" | "complete" | "error";
  startTime?: Date;
  endTime?: Date;
  message?: string;
}

interface ConfidencePoint {
  timestamp: Date;
  confidence: number;
  reason: string;
  provider: ResearchSource;
}

interface ProviderConclusion {
  provider: ResearchSource;
  confidence: number;
  recommendation: "BUY" | "SELL" | "NEUTRAL" | "WATCH";
  reasoning: string;
  timestamp: Date;
}

const SOURCE_COLORS: Record<ResearchSource, string> = {
  perplexity: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  grok: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  groq: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  gemini: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  system: "bg-muted text-muted-foreground border-border",
};

const SOURCE_CATEGORY_ICONS: Record<string, typeof Search> = {
  "Social": MessageSquare,
  "Options Flow": BarChart2,
  "Macro": Globe,
  "Technical": TrendingUp,
  "Academic": BookOpen,
  "News": Zap,
  "default": Globe,
};

const safeFormat = (date: Date | string | null | undefined, formatStr: string): string => {
  if (!date) return "—";
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (!isValid(d)) return "—";
    return format(d, formatStr);
  } catch {
    return "—";
  }
};

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 30);
  }
}

function ClickableText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_REGEX);
  const urls = text.match(URL_REGEX) || [];
  
  if (urls.length === 0) {
    return <span className={className}>{text}</span>;
  }
  
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {urls[i] && (
            <a
              href={urls[i]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
              data-testid={`link-${extractDomain(urls[i])}`}
            >
              {extractDomain(urls[i])}
              <ExternalLink className="h-2.5 w-2.5 inline" />
            </a>
          )}
        </span>
      ))}
    </span>
  );
}

function StrategyInsightCard({ candidate, isSelected, onClick }: { 
  candidate: StrategyCandidate; 
  isSelected: boolean;
  onClick: () => void;
}) {
  const confidenceColor = candidate.confidence >= 70 ? "text-emerald-400" : 
                          candidate.confidence >= 50 ? "text-amber-400" : "text-red-400";
  const confidenceBgColor = candidate.confidence >= 70 ? "bg-emerald-500" : 
                            candidate.confidence >= 50 ? "bg-amber-500" : "bg-red-500";
  
  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onClick}
      data-testid={`strategy-card-${candidate.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className={cn("text-[10px]", SOURCE_COLORS[candidate.provider])}>
                {candidate.provider}
              </Badge>
              {candidate.archetype && (
                <Badge variant="secondary" className="text-[10px]">
                  {candidate.archetype}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base truncate" data-testid="text-strategy-name">
              {candidate.name}
            </CardTitle>
          </div>
          <div className="flex flex-col items-end">
            <div className={cn("text-2xl font-mono font-bold", confidenceColor)} data-testid="text-confidence">
              {candidate.confidence}%
            </div>
            <span className="text-[10px] text-muted-foreground">confidence</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidate.hypothesis && (
          <div data-testid="section-hypothesis">
            <div className="flex items-center gap-1.5 mb-1">
              <Lightbulb className="h-3 w-3 text-amber-400" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Hypothesis</span>
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed line-clamp-2">
              {candidate.hypothesis}
            </p>
          </div>
        )}
        
        {candidate.reasoning && (
          <div data-testid="section-reasoning">
            <div className="flex items-center gap-1.5 mb-1">
              <Brain className="h-3 w-3 text-violet-400" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Why This Strategy</span>
            </div>
            <p className="text-sm text-foreground/70 italic border-l-2 border-primary/30 pl-2 line-clamp-2">
              {candidate.reasoning}
            </p>
          </div>
        )}
        
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            {candidate.symbols?.map(s => (
              <Badge key={s} variant="outline" className="text-[9px] h-4 px-1">
                {s}
              </Badge>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {safeFormat(candidate.timestamp, "h:mm a")}
          </span>
        </div>
        
        {candidate.confidenceBreakdown && Object.keys(candidate.confidenceBreakdown).length > 0 && (
          <div className="pt-2 border-t border-border/50" data-testid="confidence-breakdown">
            <div className="grid grid-cols-3 gap-1">
              {Object.entries(candidate.confidenceBreakdown)
                .filter(([_, v]) => typeof v === "number" && v > 0)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3)
                .map(([key, value]) => (
                  <div key={key} className="text-center">
                    <div className="text-xs font-mono text-primary">{value}%</div>
                    <div className="text-[9px] text-muted-foreground truncate capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim().split(" ").slice(0, 2).join(" ")}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SourcePanel({ sources }: { sources: Array<{ type: string; label: string; detail: string; url?: string }> }) {
  const categorizedSources = useMemo(() => {
    const categories: Record<string, typeof sources> = {};
    sources.forEach(src => {
      const category = src.type || "Other";
      if (!categories[category]) categories[category] = [];
      categories[category].push(src);
    });
    return categories;
  }, [sources]);
  
  return (
    <div className="space-y-4" data-testid="source-panel">
      {Object.entries(categorizedSources).map(([category, items]) => {
        const Icon = SOURCE_CATEGORY_ICONS[category] || SOURCE_CATEGORY_ICONS.default;
        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">{category}</span>
              <Badge variant="secondary" className="text-[9px] h-4 ml-auto">{items.length}</Badge>
            </div>
            <div className="space-y-1.5">
              {items.map((src, idx) => (
                <div 
                  key={idx} 
                  className="bg-muted/30 rounded px-2.5 py-2 border border-border/30"
                  data-testid={`source-item-${category}-${idx}`}
                >
                  <div className="flex items-start gap-2">
                    <Globe className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{src.label}</span>
                        {src.url && (
                          <a 
                            href={src.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="shrink-0 text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      {src.detail && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {src.detail}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  "Scouting": "AI scans markets, news, and data sources for trading opportunities",
  "Evidence": "Gathering supporting data and validating signals from multiple sources",
  "Candidates": "Synthesizing insights into actionable strategy candidates",
};

function ResearchPhaseTimeline({ phases }: { phases: ResearchPhase[] }) {
  const hasActivity = phases.some(p => p.status !== "pending");
  if (!hasActivity) return null;
  
  return (
    <div className="flex items-center gap-1" data-testid="phase-timeline">
      {phases.map((phase, idx) => (
        <div key={phase.name} className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium cursor-help transition-colors",
                phase.status === "complete" && "bg-emerald-500/20 text-emerald-400",
                phase.status === "active" && "bg-primary/20 text-primary animate-pulse",
                phase.status === "pending" && "bg-muted text-muted-foreground",
                phase.status === "error" && "bg-red-500/20 text-red-400"
              )}>
                {phase.status === "complete" && <CheckCircle2 className="h-3 w-3" />}
                {phase.status === "active" && <Loader2 className="h-3 w-3 animate-spin" />}
                {phase.status === "pending" && <Clock className="h-3 w-3" />}
                {phase.status === "error" && <XCircle className="h-3 w-3" />}
                {phase.name}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px]">
              <p className="text-xs">{PHASE_DESCRIPTIONS[phase.name] || phase.name}</p>
            </TooltipContent>
          </Tooltip>
          {idx < phases.length - 1 && (
            <ChevronRight className="h-3 w-3 mx-0.5 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<StrategyCandidate | null>(null);
  const [viewMode, setViewMode] = useState<"insights" | "activity" | "rejected">("insights");
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    candidates: 0,
    totalCost: 0,
    rejections: 0,
  });
  const [providerCosts, setProviderCosts] = useState<Record<string, { cost: number; tokens: number; calls: number }>>({});
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [researchPhases, setResearchPhases] = useState<ResearchPhase[]>([
    { name: "Scouting", status: "pending" },
    { name: "Evidence", status: "pending" },
    { name: "Candidates", status: "pending" },
  ]);
  const [confidenceHistory, setConfidenceHistory] = useState<ConfidencePoint[]>([]);
  const [modelConclusions, setModelConclusions] = useState<ProviderConclusion[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimestamp = useRef<number>(0);
  const wsFailCount = useRef(0);

  const candidates = useMemo<StrategyCandidate[]>(() => {
    return events
      .filter(e => e.type === "candidate" && e.metadata)
      .map(e => ({
        id: e.id,
        name: e.title || e.metadata?.strategyName || "Unnamed Strategy",
        archetype: e.metadata?.archetype || "",
        hypothesis: e.metadata?.hypothesis || "",
        confidence: e.metadata?.confidence || 0,
        confidenceBreakdown: e.metadata?.confidenceBreakdown,
        reasoning: e.metadata?.reasoning || "",
        synthesis: e.metadata?.synthesis || "",
        sources: e.metadata?.sources || [],
        symbols: e.metadata?.symbols || [],
        provider: e.source,
        timestamp: e.timestamp,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }, [events]);

  const allSources = useMemo(() => {
    const sourcesMap = new Map<string, { type: string; label: string; detail: string; url?: string }>();
    events
      .filter(e => e.type === "source")
      .forEach(e => {
        const url = e.metadata?.url || e.details;
        if (url && !sourcesMap.has(url)) {
          sourcesMap.set(url, {
            type: e.metadata?.category || "Research",
            label: e.title || new URL(url).hostname,
            detail: e.metadata?.snippet || "",
            url,
          });
        }
      });
    candidates.forEach(c => {
      c.sources?.forEach(src => {
        if (src.label && !sourcesMap.has(src.label)) {
          sourcesMap.set(src.label, src);
        }
      });
    });
    return Array.from(sourcesMap.values());
  }, [events, candidates]);

  const addEvents = useCallback((newEvents: ResearchEvent[]) => {
    if (paused || newEvents.length === 0) return;
    
    setEvents(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const unique = newEvents.filter(e => !existingIds.has(e.id));
      if (unique.length === 0) return prev;
      return [...prev.slice(-499 + unique.length), ...unique];
    });
    
    newEvents.forEach(evt => {
      setStats(prev => ({
        ...prev,
        searches: prev.searches + (evt.type === "search" ? 1 : 0),
        sources: prev.sources + (evt.type === "source" ? 1 : 0),
        candidates: prev.candidates + (evt.type === "candidate" ? 1 : 0),
        rejections: prev.rejections + (evt.type === "rejection" ? 1 : 0),
        totalCost: prev.totalCost + (evt.metadata?.costUsd || 0),
      }));
      
      if (evt.type === "cost" && evt.metadata?.provider) {
        setProviderCosts(prev => {
          const provider = evt.metadata?.provider || "unknown";
          const existing = prev[provider] || { cost: 0, tokens: 0, calls: 0 };
          return {
            ...prev,
            [provider]: {
              cost: existing.cost + (evt.metadata?.costUsd || 0),
              tokens: existing.tokens + (evt.metadata?.inputTokens || 0) + (evt.metadata?.outputTokens || 0),
              calls: existing.calls + 1,
            }
          };
        });
      }
      
      if (evt.type === "phase") {
        const phaseName = evt.metadata?.phase || evt.title;
        const phaseStatus = evt.metadata?.status || (evt.title.includes("Complete") ? "complete" : "active");
        setResearchPhases(prev => prev.map(p => 
          p.name.toLowerCase().includes(phaseName?.toLowerCase()) 
            ? { ...p, status: phaseStatus, message: evt.details }
            : p
        ));
      }
      
      if (evt.type === "candidate" && evt.metadata?.confidence) {
        setConfidenceHistory(prev => [...prev.slice(-19), {
          timestamp: evt.timestamp,
          confidence: evt.metadata?.confidence || 0,
          reason: evt.metadata?.strategyName || evt.title,
          provider: evt.source,
        }]);
      }
      
      if (evt.type === "validation" && evt.metadata?.confidence) {
        setConfidenceHistory(prev => [...prev.slice(-19), {
          timestamp: evt.timestamp,
          confidence: evt.metadata?.confidence || 0,
          reason: evt.metadata?.check || "Validation",
          provider: evt.source,
        }]);
      }
      
      if (evt.type === "reasoning" && evt.metadata?.recommendation) {
        setModelConclusions(prev => {
          const existing = prev.filter(p => p.provider !== evt.source);
          return [...existing, {
            provider: evt.source,
            confidence: evt.metadata?.confidence || 50,
            recommendation: evt.metadata?.recommendation || "NEUTRAL",
            reasoning: evt.details || "",
            timestamp: evt.timestamp,
          }];
        });
      }
      
      if (evt.timestamp instanceof Date) {
        lastEventTimestamp.current = Math.max(lastEventTimestamp.current, evt.timestamp.getTime());
      }
    });
    
    if (autoScroll && scrollAreaRef.current) {
      setTimeout(() => {
        scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }, 50);
    }
  }, [paused, autoScroll]);

  const pollEvents = useCallback(async () => {
    if (paused) return;
    try {
      const url = lastEventTimestamp.current 
        ? `/api/research-monitor/events?since=${lastEventTimestamp.current}`
        : `/api/research-monitor/events`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.events?.length > 0) {
        const mapped: ResearchEvent[] = data.events.map((e: any) => ({
          id: e.id,
          timestamp: new Date(e.timestamp),
          type: e.eventType || "system",
          source: e.source || "system",
          title: e.title,
          details: e.details,
          metadata: e.metadata,
        }));
        addEvents(mapped);
      }
    } catch (e) {
      console.error("[ResearchMonitor] Polling error:", e);
    }
  }, [paused, addEvents]);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;
    console.log("[ResearchMonitor] Switching to HTTP polling");
    setUsePolling(true);
    setConnected(true);
    pollEvents();
    pollingIntervalRef.current = setInterval(pollEvents, 3000);
  }, [pollEvents]);

  const connectWebSocket = useCallback(() => {
    if (usePolling) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/research-monitor`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[ResearchMonitor] WebSocket connected");
        setConnected(true);
        wsFailCount.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "research_event" && data.event) {
            const evt: ResearchEvent = {
              id: data.event.id || crypto.randomUUID(),
              timestamp: new Date(data.event.timestamp || Date.now()),
              type: data.event.eventType || "system",
              source: data.event.source || "system",
              title: data.event.title,
              details: data.event.details,
              metadata: data.event.metadata,
            };
            addEvents([evt]);
          }
        } catch (err) {
          console.error("[ResearchMonitor] Parse error:", err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        wsFailCount.current++;
        
        if (wsFailCount.current >= 3) {
          startPolling();
        } else {
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000 * wsFailCount.current);
        }
      };

      ws.onerror = (error) => {
        console.error("[ResearchMonitor] WebSocket error:", error);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[ResearchMonitor] Failed to connect:", err);
      wsFailCount.current++;
      if (wsFailCount.current >= 3) {
        startPolling();
      }
    }
  }, [addEvents, startPolling, usePolling]);

  useEffect(() => {
    let mounted = true;
    const connect = () => { if (mounted) connectWebSocket(); };
    connect();
    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const clearEvents = () => {
    setEvents([]);
    setStats({ searches: 0, sources: 0, candidates: 0, totalCost: 0, rejections: 0 });
    setProviderCosts({});
    setSelectedCandidate(null);
    setResearchPhases([
      { name: "Scouting", status: "pending" },
      { name: "Evidence", status: "pending" },
      { name: "Candidates", status: "pending" },
    ]);
    setConfidenceHistory([]);
    setModelConclusions([]);
  };
  
  const modelConsensus = useMemo(() => {
    if (modelConclusions.length === 0) return null;
    const avgConfidence = modelConclusions.reduce((sum, m) => sum + m.confidence, 0) / modelConclusions.length;
    const recommendations = modelConclusions.map(m => m.recommendation);
    const mostCommon = recommendations.sort((a, b) =>
      recommendations.filter(v => v === b).length - recommendations.filter(v => v === a).length
    )[0];
    const agreement = recommendations.filter(r => r === mostCommon).length / recommendations.length;
    return {
      avgConfidence: Math.round(avgConfidence),
      consensus: mostCommon,
      agreement: Math.round(agreement * 100),
      providers: modelConclusions.length,
    };
  }, [modelConclusions]);
  
  const strategyLineage = useMemo(() => {
    const sortedByTime = [...candidates].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return sortedByTime.map((c, idx) => {
      const parentId = (c as any).parentId || (c as any).derivedFrom;
      const parent = parentId 
        ? sortedByTime.find(s => s.name === parentId || (s as any).id === parentId)
        : (idx > 0 ? sortedByTime[idx - 1] : null);
      return {
        ...c,
        generation: idx + 1,
        parent: parent?.name || null,
        improvement: parent ? c.confidence - parent.confidence : 0,
      };
    });
  }, [candidates]);
  
  const rejectedStrategies = useMemo(() => {
    return events
      .filter(e => e.type === "rejection")
      .map(e => ({
        id: e.id,
        name: e.metadata?.strategyName || e.title.replace("Rejected: ", ""),
        reason: e.metadata?.rejectionReason || e.details || "Unknown reason",
        confidence: e.metadata?.confidence,
        threshold: e.metadata?.threshold,
        archetype: e.metadata?.archetype,
        timestamp: e.timestamp,
        provider: e.source,
      }))
      .reverse()
      .slice(0, 10);
  }, [events]);
  
  const exportReport = useCallback(() => {
    const content = {
      title: "BlaidTrades Research Report",
      generatedAt: new Date().toISOString(),
      summary: {
        totalStrategies: candidates.length,
        topStrategy: candidates[0]?.name || "None",
        topConfidence: candidates[0]?.confidence || 0,
        totalCost: stats.totalCost,
        sourcesAnalyzed: stats.sources,
        rejectedCount: stats.rejections,
      },
      strategies: candidates.map(c => ({
        name: c.name,
        archetype: c.archetype,
        confidence: c.confidence,
        hypothesis: c.hypothesis,
        reasoning: c.reasoning,
        provider: c.provider,
        sources: c.sources,
      })),
      modelConsensus: modelConsensus,
      confidenceTimeline: confidenceHistory,
      rejectedStrategies: rejectedStrategies.map(r => ({
        name: r.name,
        reason: r.reason,
        confidence: r.confidence,
        threshold: r.threshold,
      })),
      providerCosts: providerCosts,
    };
    
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `blaidtrades-research-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [candidates, stats, modelConsensus, confidenceHistory, rejectedStrategies, providerCosts]);

  const triggerResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategy-lab/trigger-research");
      return res.json();
    },
    onSuccess: () => {
      setResearchPhases([
        { name: "Scouting", status: "active" },
        { name: "Evidence", status: "pending" },
        { name: "Candidates", status: "pending" },
      ]);
    },
  });

  const activeProvider = events.length > 0 ? events[events.length - 1].source : null;

  return (
    <AppLayout title="Research Monitor">
      <div className="h-full flex flex-col">
        {/* Header Banner - Clean, Minimal Design */}
        <div className="border-b border-border bg-muted/10">
          <div className="flex items-center justify-between px-4 py-2.5">
            {/* Left: Title and Connection Status */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Microscope className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Research Monitor</span>
              </div>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help" data-testid="status-connection">
                    {connected ? (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-mono uppercase">{usePolling ? "Polling" : "Live"}</span>
                      </>
                    ) : (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-mono">Offline</span>
                      </>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{connected ? "Real-time updates active" : "Reconnecting..."}</p>
                </TooltipContent>
              </Tooltip>
              
              {activeProvider && (
                <Badge variant="outline" className={cn("text-[9px] h-5", SOURCE_COLORS[activeProvider])}>
                  {activeProvider}
                </Badge>
              )}
            </div>

            {/* Center: Phase Timeline (only shows when active) */}
            <ResearchPhaseTimeline phases={researchPhases} />

            {/* Right: Stats (only show non-zero) and Actions */}
            <div className="flex items-center gap-3">
              {/* Stats - only show when there's data */}
              {(stats.sources > 0 || stats.candidates > 0 || stats.totalCost > 0) && (
                <div className="flex items-center gap-3 text-xs border-r border-border pr-3">
                  {stats.sources > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help" data-testid="stat-sources">
                          <Globe className="h-3 w-3 text-cyan-400" />
                          <span className="font-mono text-foreground">{stats.sources}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Research sources analyzed</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {stats.candidates > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help" data-testid="stat-candidates">
                          <Target className="h-3 w-3 text-emerald-400" />
                          <span className="font-mono text-foreground">{stats.candidates}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Strategy candidates discovered</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {stats.totalCost > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help" data-testid="stat-cost">
                          <DollarSign className="h-3 w-3 text-amber-400" />
                          <span className="font-mono text-foreground">${stats.totalCost.toFixed(2)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Total AI API cost this session</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                <Button 
                  size="sm" 
                  onClick={() => triggerResearchMutation.mutate()}
                  disabled={triggerResearchMutation.isPending}
                  data-testid="button-trigger-research"
                  className="h-7 px-3"
                >
                  {triggerResearchMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Start Research
                </Button>
                
                <div className="w-px h-4 bg-border mx-1" />
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={() => setPaused(!paused)} data-testid="button-pause" className="h-7 w-7">
                      {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{paused ? "Resume updates" : "Pause updates"}</p>
                  </TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="icon" 
                      variant={autoScroll ? "secondary" : "ghost"} 
                      onClick={() => setAutoScroll(!autoScroll)} 
                      data-testid="button-autoscroll"
                      className="h-7 w-7"
                    >
                      <ArrowDownCircle className={cn("h-3.5 w-3.5", autoScroll && "text-primary")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}</p>
                  </TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={clearEvents} data-testid="button-clear" className="h-7 w-7">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Clear all events</p>
                  </TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={exportReport} 
                      data-testid="button-export"
                      disabled={candidates.length === 0}
                      className="h-7 w-7"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{candidates.length === 0 ? "No data to export" : "Download research report"}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content - Three Column Layout */}
        <div className="flex-1 flex min-h-0">
          {/* Left Panel - Strategy Insights */}
          <div className="flex-1 flex flex-col min-h-0 border-r border-border">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-muted/5">
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium uppercase tracking-wide text-foreground/80">Strategies</span>
                {candidates.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{candidates.length}</Badge>
                )}
              </div>
              <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="sm" 
                      variant={viewMode === "insights" ? "secondary" : "ghost"} 
                      className="h-6 px-2.5 text-[10px]"
                      onClick={() => setViewMode("insights")}
                      data-testid="tab-insights"
                    >
                      Cards
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">View strategy cards</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="sm" 
                      variant={viewMode === "activity" ? "secondary" : "ghost"} 
                      className="h-6 px-2.5 text-[10px]"
                      onClick={() => setViewMode("activity")}
                      data-testid="tab-activity"
                    >
                      Log
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Real-time activity feed</p>
                  </TooltipContent>
                </Tooltip>
                {stats.rejections > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        size="sm" 
                        variant={viewMode === "rejected" ? "secondary" : "ghost"} 
                        className="h-6 px-2.5 text-[10px]"
                        onClick={() => setViewMode("rejected")}
                        data-testid="tab-rejected"
                      >
                        <XCircle className="h-2.5 w-2.5 mr-1 text-red-400" />
                        {stats.rejections}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">Rejected strategies with reasons</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            
            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              {viewMode === "insights" ? (
                candidates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center mb-6">
                      <Brain className="h-10 w-10 text-primary/40" />
                    </div>
                    <h3 className="text-base font-medium text-foreground mb-2">Ready to Discover Strategies</h3>
                    <p className="text-sm text-muted-foreground max-w-[280px] mb-6">
                      AI will analyze markets, news, and data sources to find trading opportunities
                    </p>
                    <Button 
                      onClick={() => triggerResearchMutation.mutate()}
                      disabled={triggerResearchMutation.isPending}
                      data-testid="button-empty-state-research"
                      className="gap-2"
                    >
                      {triggerResearchMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Rocket className="h-4 w-4" />
                      )}
                      Start AI Research
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {candidates.map(candidate => (
                      <StrategyInsightCard
                        key={candidate.id}
                        candidate={candidate}
                        isSelected={selectedCandidate?.id === candidate.id}
                        onClick={() => setSelectedCandidate(candidate)}
                      />
                    ))}
                  </div>
                )
              ) : viewMode === "rejected" ? (
                rejectedStrategies.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <XCircle className="h-16 w-16 text-muted-foreground/15 mb-4" />
                    <p className="text-sm text-muted-foreground">No rejected strategies yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Strategies that don't meet criteria will appear here with reasons
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground mb-4 px-2">
                      Strategies that were evaluated but not promoted, with specific reasons why.
                    </div>
                    {rejectedStrategies.map(rejected => (
                      <Card 
                        key={rejected.id} 
                        className="border-red-500/20 bg-red-500/5"
                        data-testid={`rejected-card-${rejected.id}`}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <XCircle className="h-3.5 w-3.5 text-red-400" />
                                <Badge variant="outline" className={cn("text-[9px]", SOURCE_COLORS[rejected.provider])}>
                                  {rejected.provider}
                                </Badge>
                                {rejected.archetype && (
                                  <Badge variant="secondary" className="text-[9px]">
                                    {rejected.archetype}
                                  </Badge>
                                )}
                              </div>
                              <CardTitle className="text-sm text-foreground/80">{rejected.name}</CardTitle>
                            </div>
                            {rejected.confidence !== undefined && (
                              <div className="flex flex-col items-end">
                                <span className="text-lg font-mono text-red-400">{rejected.confidence}%</span>
                                {rejected.threshold && (
                                  <span className="text-[9px] text-muted-foreground">
                                    threshold: {rejected.threshold}%
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="bg-red-500/10 rounded px-3 py-2 border border-red-500/20">
                            <div className="flex items-center gap-1.5 mb-1">
                              <AlertCircle className="h-3 w-3 text-red-400" />
                              <span className="text-[10px] text-red-300 uppercase tracking-wider">Rejection Reason</span>
                            </div>
                            <p className="text-xs text-foreground/70">{rejected.reason}</p>
                          </div>
                          <div className="flex justify-end mt-2">
                            <span className="text-[10px] text-muted-foreground">
                              {safeFormat(rejected.timestamp, "h:mm:ss a")}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              ) : (
                <div className="divide-y divide-border/50">
                  {events.length === 0 ? (
                    <div className="p-8 text-center">
                      <Activity className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
                      <p className="text-sm text-muted-foreground">Waiting for research activity...</p>
                    </div>
                  ) : (
                    [...events].reverse().map(event => (
                      event.type === "action_required" ? (
                        <div 
                          key={event.id}
                          className="mx-2 my-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30"
                          data-testid={`action-required-${event.id}`}
                        >
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-amber-300">Action Required</span>
                                <Badge variant="outline" className={cn("text-[9px] h-4 px-1", SOURCE_COLORS[event.source])}>
                                  {event.source}
                                </Badge>
                              </div>
                              <p className="text-xs text-foreground/80">{event.title.replace(/^⚠️ Action Required: /, "")}</p>
                              {event.metadata?.actionRequired && (
                                <p className="text-xs text-amber-200/80 mt-1.5 bg-amber-500/10 px-2 py-1.5 rounded">
                                  {event.metadata.actionRequired}
                                </p>
                              )}
                              {event.metadata?.actionType === "INCREASE_BUDGET" && event.metadata?.currentSpend !== undefined && (
                                <div className="flex items-center gap-2 mt-2">
                                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-[10px] text-muted-foreground">
                                    Current: ${event.metadata.currentSpend?.toFixed(2)} / ${event.metadata.limit?.toFixed(2) || "10.00"}
                                  </span>
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                              {safeFormat(event.timestamp, "h:mm:ss")}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div 
                          key={event.id}
                          className={cn(
                            "px-3 py-2 flex items-start gap-3",
                            event.type === "reasoning" && "bg-violet-500/5 border-l-2 border-violet-500/50",
                            event.type === "validation" && "bg-emerald-500/5 border-l-2 border-emerald-500/50",
                            event.type === "rejection" && "bg-red-500/5 border-l-2 border-red-500/50"
                          )}
                          data-testid={`activity-event-${event.id}`}
                        >
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full mt-2 shrink-0",
                            event.type === "candidate" && "bg-emerald-400",
                            event.type === "source" && "bg-cyan-400",
                            event.type === "error" && "bg-red-400",
                            event.type === "phase" && "bg-blue-400",
                            event.type === "reasoning" && "bg-violet-400",
                            event.type === "validation" && "bg-emerald-400",
                            event.type === "rejection" && "bg-red-400",
                            event.type === "cost" && "bg-amber-400",
                            !["candidate", "source", "error", "phase", "reasoning", "validation", "rejection", "cost"].includes(event.type) && "bg-muted-foreground"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ClickableText text={event.title} className="text-xs" />
                              <Badge variant="outline" className={cn("text-[9px] h-4 px-1", SOURCE_COLORS[event.source])}>
                                {event.source}
                              </Badge>
                              {event.type === "cost" && event.metadata?.costUsd && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1 font-mono">
                                  ${event.metadata.costUsd.toFixed(4)}
                                </Badge>
                              )}
                              {event.type === "validation" && event.metadata?.status && (
                                <Badge 
                                  variant="outline" 
                                  className={cn(
                                    "text-[9px] h-4 px-1",
                                    event.metadata.status === "PASS" && "text-emerald-400 border-emerald-500/30",
                                    event.metadata.status === "WARN" && "text-amber-400 border-amber-500/30",
                                    event.metadata.status === "FAIL" && "text-red-400 border-red-500/30"
                                  )}
                                >
                                  {event.metadata.status}
                                </Badge>
                              )}
                            </div>
                            {event.details && (
                              <ClickableText 
                                text={event.details} 
                                className="text-[10px] text-muted-foreground mt-0.5 block" 
                              />
                            )}
                            {event.metadata?.url && !event.details?.includes(event.metadata.url) && (
                              <a 
                                href={event.metadata.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                                {extractDomain(event.metadata.url)}
                              </a>
                            )}
                            {event.metadata?.snippet && (
                              <p className="text-[10px] text-muted-foreground/80 mt-1 italic line-clamp-2 bg-muted/20 px-2 py-1 rounded">
                                "{event.metadata.snippet}"
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {safeFormat(event.timestamp, "h:mm:ss")}
                          </span>
                        </div>
                      )
                    ))
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right Panel - Sources & Detail */}
          <div className="w-[320px] flex flex-col min-h-0 bg-muted/5">
            {selectedCandidate ? (
              <>
                <div className="px-4 py-2.5 border-b border-border bg-muted/5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="outline" className={cn("text-[9px] h-4", SOURCE_COLORS[selectedCandidate.provider])}>
                      {selectedCandidate.provider}
                    </Badge>
                    {selectedCandidate.archetype && (
                      <Badge variant="secondary" className="text-[9px] h-4">
                        {selectedCandidate.archetype}
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-medium text-sm" data-testid="detail-strategy-name">{selectedCandidate.name}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {safeFormat(selectedCandidate.timestamp, "MMM d, h:mm a")}
                  </p>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4">
                    {selectedCandidate.hypothesis && (
                      <div data-testid="detail-hypothesis">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Lightbulb className="h-3 w-3 text-amber-400" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Core Hypothesis</span>
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed">
                          {selectedCandidate.hypothesis}
                        </p>
                      </div>
                    )}
                    
                    {selectedCandidate.reasoning && (
                      <div data-testid="detail-reasoning">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Brain className="h-3 w-3 text-violet-400" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">AI Reasoning</span>
                        </div>
                        <p className="text-sm text-foreground/80 italic border-l-2 border-primary/30 pl-3 py-1">
                          {selectedCandidate.reasoning}
                        </p>
                      </div>
                    )}
                    
                    {selectedCandidate.synthesis && (
                      <div data-testid="detail-synthesis">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Sparkles className="h-3 w-3 text-primary" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Research Synthesis</span>
                        </div>
                        <p className="text-sm text-foreground/70 bg-muted/30 px-3 py-2 rounded">
                          {selectedCandidate.synthesis}
                        </p>
                      </div>
                    )}
                    
                    <div data-testid="detail-confidence">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Shield className="h-3 w-3 text-emerald-400" />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence Analysis</span>
                      </div>
                      <div className="flex items-center gap-3 mb-2">
                        <Progress 
                          value={selectedCandidate.confidence} 
                          className="flex-1 h-2"
                        />
                        <span className={cn(
                          "text-lg font-mono font-bold",
                          selectedCandidate.confidence >= 70 ? "text-emerald-400" : 
                          selectedCandidate.confidence >= 50 ? "text-amber-400" : "text-red-400"
                        )}>
                          {selectedCandidate.confidence}%
                        </span>
                      </div>
                      {selectedCandidate.confidenceBreakdown && (
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(selectedCandidate.confidenceBreakdown)
                            .filter(([_, v]) => typeof v === "number" && v > 0)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between text-[10px] bg-muted/30 rounded px-2 py-1">
                                <span className="text-muted-foreground capitalize truncate">
                                  {key.replace(/([A-Z])/g, " $1").trim()}
                                </span>
                                <span className={cn(
                                  "font-mono ml-1",
                                  (value as number) >= 15 && "text-emerald-400",
                                  (value as number) >= 8 && (value as number) < 15 && "text-amber-400",
                                  (value as number) < 8 && "text-muted-foreground"
                                )}>
                                  {value}%
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    
                    {selectedCandidate.sources && selectedCandidate.sources.length > 0 && (
                      <div data-testid="detail-sources">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Globe className="h-3 w-3 text-cyan-400" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            Research Sources ({selectedCandidate.sources.length})
                          </span>
                        </div>
                        <SourcePanel sources={selectedCandidate.sources} />
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <>
                <div className="px-4 py-2.5 border-b border-border bg-muted/5">
                  <div className="flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-xs font-medium uppercase tracking-wide text-foreground/80">Overview</span>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-5">
                    {Object.keys(providerCosts).length > 0 && (
                      <div data-testid="provider-costs">
                        <div className="flex items-center gap-1.5 mb-3">
                          <DollarSign className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-xs font-medium">Cost by Provider</span>
                        </div>
                        <div className="space-y-2">
                          {Object.entries(providerCosts)
                            .sort(([,a], [,b]) => b.cost - a.cost)
                            .map(([provider, data]) => (
                              <div 
                                key={provider} 
                                className="bg-muted/30 rounded px-3 py-2 border border-border/30"
                                data-testid={`cost-${provider}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Badge 
                                      variant="outline" 
                                      className={cn("text-[9px]", SOURCE_COLORS[provider as ResearchSource] || "text-muted-foreground")}
                                    >
                                      {provider}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {data.calls} call{data.calls !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                  <span className="text-sm font-mono text-amber-400">
                                    ${data.cost.toFixed(4)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                                  <span>{data.tokens.toLocaleString()} tokens</span>
                                  <span>${(data.cost / Math.max(data.calls, 1)).toFixed(4)}/call avg</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    
                    {modelConsensus && (
                      <div data-testid="model-consensus">
                        <div className="flex items-center gap-1.5 mb-3">
                          <Users className="h-3.5 w-3.5 text-violet-400" />
                          <span className="text-xs font-medium">Multi-Model Consensus</span>
                        </div>
                        <div className="bg-muted/30 rounded px-3 py-3 border border-border/30 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Avg Confidence</span>
                            <span className={cn(
                              "text-sm font-mono font-bold",
                              modelConsensus.avgConfidence >= 70 ? "text-emerald-400" : 
                              modelConsensus.avgConfidence >= 50 ? "text-amber-400" : "text-red-400"
                            )}>
                              {modelConsensus.avgConfidence}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Consensus</span>
                            <Badge variant="secondary" className="text-[9px]">
                              {modelConsensus.consensus}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Agreement</span>
                            <span className="text-xs font-mono">{modelConsensus.agreement}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Providers</span>
                            <span className="text-xs font-mono">{modelConsensus.providers}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {strategyLineage.length > 0 && (
                      <div data-testid="strategy-lineage">
                        <div className="flex items-center gap-1.5 mb-3">
                          <GitBranch className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-medium">Strategy Genealogy</span>
                        </div>
                        <div className="space-y-2">
                          {strategyLineage.map((s, idx) => (
                            <div 
                              key={s.name} 
                              className="bg-muted/30 rounded px-3 py-2 border border-border/30"
                              data-testid={`lineage-${idx}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[9px] h-4 px-1">
                                    Gen {s.generation}
                                  </Badge>
                                  <span className="text-xs font-medium truncate max-w-[140px]">{s.name}</span>
                                </div>
                                <span className={cn(
                                  "text-xs font-mono",
                                  s.confidence >= 70 ? "text-emerald-400" : 
                                  s.confidence >= 50 ? "text-amber-400" : "text-red-400"
                                )}>
                                  {s.confidence}%
                                </span>
                              </div>
                              {s.parent && (
                                <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                  <ArrowRight className="h-2.5 w-2.5" />
                                  <span className="truncate">from {s.parent}</span>
                                  {s.improvement !== 0 && (
                                    <span className={cn(
                                      "ml-auto",
                                      s.improvement > 0 ? "text-emerald-400" : "text-red-400"
                                    )}>
                                      {s.improvement > 0 ? "+" : ""}{s.improvement}%
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {confidenceHistory.length > 0 && (
                      <div data-testid="confidence-timeline">
                        <div className="flex items-center gap-1.5 mb-3">
                          <History className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-xs font-medium">Confidence Evolution</span>
                        </div>
                        <div className="space-y-1.5">
                          {confidenceHistory.slice(-8).map((point, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-center gap-2 text-[10px] bg-muted/20 rounded px-2 py-1"
                            >
                              <span className={cn(
                                "font-mono w-8",
                                point.confidence >= 70 ? "text-emerald-400" : 
                                point.confidence >= 50 ? "text-amber-400" : "text-red-400"
                              )}>
                                {point.confidence}%
                              </span>
                              <Badge variant="outline" className={cn("text-[8px] h-3 px-1", SOURCE_COLORS[point.provider])}>
                                {point.provider}
                              </Badge>
                              <span className="text-muted-foreground truncate flex-1">{point.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Sources - only show when there are some or no other content */}
                    {(allSources.length > 0 || Object.keys(providerCosts).length === 0) && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-3">
                          <Globe className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-xs font-medium">Research Sources</span>
                          {allSources.length > 0 && (
                            <Badge variant="secondary" className="text-[9px] h-4 ml-auto">
                              {allSources.length}
                            </Badge>
                          )}
                        </div>
                        {allSources.length === 0 ? (
                          <div className="flex flex-col items-center justify-center text-center py-6 bg-muted/20 rounded-lg border border-border/30">
                            <Globe className="h-8 w-8 text-muted-foreground/20 mb-2" />
                            <p className="text-xs text-muted-foreground">Sources appear during research</p>
                          </div>
                        ) : (
                          <SourcePanel sources={allSources} />
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
