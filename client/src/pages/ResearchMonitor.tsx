import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, Clock, DollarSign, CheckCircle, XCircle, 
  AlertTriangle, ChevronDown, ChevronRight, Activity, Cpu, TrendingUp,
  FileText, Link, BarChart3, Download, Filter, RefreshCw, Radio, Eye, EyeOff,
  Layers, Timer, Coins, Signal, Database, MessageSquare
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";

type ResearchEventType = 
  | "search" | "source" | "idea" | "candidate" | "error" | "system" | "analysis"
  | "reasoning" | "validation" | "cost" | "phase" | "scoring" | "rejection" | "api_call";

type ResearchSource = "perplexity" | "grok" | "openai" | "anthropic" | "groq" | "gemini" | "system";

interface ResearchEvent {
  id: string;
  timestamp: Date;
  type: ResearchEventType;
  source: ResearchSource;
  title: string;
  details?: string;
  metadata?: {
    traceId?: string;
    phase?: string;
    durationMs?: number;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    confidence?: number;
    confidenceBreakdown?: Record<string, number>;
    strategyName?: string;
    archetype?: string;
    symbol?: string;
    symbols?: string[];
    depth?: string;
    regime?: string;
    trigger?: string;
    reasoning?: string;
    sources?: Array<{ type: string; label: string; detail: string }>;
    hypothesis?: string;
    validationResult?: "PASS" | "FAIL" | "WARN";
    validationReason?: string;
    rejectionReason?: string;
    url?: string;
    citations?: string[];
    [key: string]: any;
  };
}

const EVENT_ICONS: Record<ResearchEventType, typeof Search> = {
  search: Search,
  source: Globe,
  idea: Sparkles,
  candidate: Target,
  error: AlertCircle,
  system: Zap,
  analysis: Brain,
  reasoning: FileText,
  validation: CheckCircle,
  cost: DollarSign,
  phase: Activity,
  scoring: BarChart3,
  rejection: XCircle,
  api_call: Cpu,
};

const EVENT_COLORS: Record<ResearchEventType, string> = {
  search: "text-blue-400",
  source: "text-cyan-400",
  idea: "text-yellow-400",
  candidate: "text-emerald-400",
  error: "text-red-400",
  system: "text-muted-foreground",
  analysis: "text-purple-400",
  reasoning: "text-indigo-400",
  validation: "text-green-400",
  cost: "text-amber-400",
  phase: "text-sky-400",
  scoring: "text-orange-400",
  rejection: "text-rose-400",
  api_call: "text-slate-400",
};

const SOURCE_COLORS: Record<ResearchSource, string> = {
  perplexity: "text-cyan-400",
  grok: "text-purple-400",
  openai: "text-green-400",
  anthropic: "text-orange-400",
  groq: "text-blue-400",
  gemini: "text-indigo-400",
  system: "text-muted-foreground",
};

const SOURCE_BG: Record<ResearchSource, string> = {
  perplexity: "bg-cyan-500/10 border-cyan-500/20",
  grok: "bg-purple-500/10 border-purple-500/20",
  openai: "bg-green-500/10 border-green-500/20",
  anthropic: "bg-orange-500/10 border-orange-500/20",
  groq: "bg-blue-500/10 border-blue-500/20",
  gemini: "bg-indigo-500/10 border-indigo-500/20",
  system: "bg-muted/50 border-border",
};

const PHASE_ORDER = ["DISCOVERY", "RESEARCH", "SYNTHESIS", "VALIDATION", "EXPORT"];

function MetricCard({ icon: Icon, label, value, subValue, color }: { 
  icon: typeof Search; 
  label: string; 
  value: string | number; 
  subValue?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 bg-card/50">
      <Icon className={cn("h-4 w-4", color)} />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-sm font-medium tabular-nums">{value}</div>
        {subValue && <div className="text-[10px] text-muted-foreground">{subValue}</div>}
      </div>
    </div>
  );
}

function ProviderBar({ stats }: { stats: Record<ResearchSource, number> }) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  
  const providers = Object.entries(stats)
    .filter(([_, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  
  return (
    <div className="space-y-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
        {providers.map(([provider, count]) => {
          const pct = (count / total) * 100;
          const colors: Record<string, string> = {
            perplexity: "bg-cyan-500",
            grok: "bg-purple-500",
            openai: "bg-green-500",
            anthropic: "bg-orange-500",
            groq: "bg-blue-500",
            gemini: "bg-indigo-500",
            system: "bg-muted",
          };
          return (
            <div 
              key={provider} 
              className={cn("h-full transition-all", colors[provider])}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {providers.slice(0, 6).map(([provider, count]) => (
          <div key={provider} className="flex items-center justify-between text-[10px]">
            <span className={cn("capitalize", SOURCE_COLORS[provider as ResearchSource])}>{provider}</span>
            <span className="text-muted-foreground font-mono">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventCard({ event, isExpanded, onToggle }: { event: ResearchEvent; isExpanded: boolean; onToggle: () => void }) {
  const Icon = EVENT_ICONS[event.type] || Zap;
  const hasExpandableContent = !!(
    event.metadata?.reasoning || 
    event.metadata?.hypothesis || 
    event.metadata?.confidenceBreakdown ||
    event.metadata?.sources?.length ||
    event.metadata?.citations?.length ||
    (event.details && event.details.length > 80)
  );
  
  const validationIcon = event.metadata?.validationResult === "PASS" ? CheckCircle :
                        event.metadata?.validationResult === "FAIL" ? XCircle :
                        event.metadata?.validationResult === "WARN" ? AlertTriangle : null;

  return (
    <div className={cn(
      "rounded-md border transition-all",
      SOURCE_BG[event.source],
      hasExpandableContent && "cursor-pointer",
      isExpanded && "ring-1 ring-primary/30"
    )}>
      <div 
        className="flex items-start gap-2 py-2 px-3"
        onClick={() => hasExpandableContent && onToggle()}
      >
        <div className="flex items-center gap-1.5 min-w-[72px] text-[10px] text-muted-foreground shrink-0 tabular-nums">
          <Clock className="h-2.5 w-2.5" />
          {format(event.timestamp, "HH:mm:ss")}
        </div>
        
        <div className={cn("shrink-0 mt-0.5", EVENT_COLORS[event.type])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("text-[9px] uppercase h-4 px-1", SOURCE_COLORS[event.source])}>
              {event.source}
            </Badge>
            {event.type !== "system" && (
              <Badge variant="secondary" className="text-[9px] uppercase h-4 px-1">
                {event.type.replace("_", " ")}
              </Badge>
            )}
            <span className="font-medium text-xs truncate">{event.title}</span>
            {validationIcon && (
              <span className={cn(
                event.metadata?.validationResult === "PASS" && "text-green-400",
                event.metadata?.validationResult === "FAIL" && "text-red-400",
                event.metadata?.validationResult === "WARN" && "text-amber-400"
              )}>
                {validationIcon === CheckCircle && <CheckCircle className="h-3 w-3" />}
                {validationIcon === XCircle && <XCircle className="h-3 w-3" />}
                {validationIcon === AlertTriangle && <AlertTriangle className="h-3 w-3" />}
              </span>
            )}
          </div>
          
          {event.details && event.details.length <= 80 && !isExpanded && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {event.details}
            </p>
          )}
          
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {event.metadata?.confidence !== undefined && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                <TrendingUp className="h-2 w-2 mr-0.5" />
                {event.metadata.confidence}%
              </Badge>
            )}
            {event.metadata?.costUsd !== undefined && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-400">
                ${event.metadata.costUsd.toFixed(4)}
              </Badge>
            )}
            {event.metadata?.model && (
              <Badge variant="outline" className="text-[9px] h-4 px-1">
                {event.metadata.model.split('/').pop()?.slice(0, 12)}
              </Badge>
            )}
            {event.metadata?.durationMs !== undefined && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 text-slate-400">
                {(event.metadata.durationMs / 1000).toFixed(1)}s
              </Badge>
            )}
          </div>
        </div>
        
        {hasExpandableContent && (
          <div className="shrink-0 text-muted-foreground mt-1">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </div>
        )}
      </div>
      
      {isExpanded && hasExpandableContent && (
        <div className="px-3 pb-2 pt-0 ml-[84px] space-y-2 border-t border-border/30 mt-1 pt-2">
          {event.details && event.details.length > 80 && (
            <div>
              <span className="text-[9px] text-muted-foreground uppercase">Details</span>
              <p className="text-[10px] text-foreground/80 mt-0.5 break-all whitespace-pre-wrap">
                {event.details}
              </p>
            </div>
          )}
          
          {event.metadata?.hypothesis && (
            <div>
              <span className="text-[9px] text-muted-foreground uppercase">Hypothesis</span>
              <p className="text-[10px] text-foreground/80 mt-0.5">{event.metadata.hypothesis}</p>
            </div>
          )}
          
          {event.metadata?.reasoning && (
            <div>
              <span className="text-[9px] text-muted-foreground uppercase">AI Reasoning</span>
              <p className="text-[10px] text-foreground/80 mt-0.5 italic">"{event.metadata.reasoning}"</p>
            </div>
          )}
          
          {event.metadata?.confidenceBreakdown && (
            <div>
              <span className="text-[9px] text-muted-foreground uppercase">Confidence Breakdown</span>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {Object.entries(event.metadata.confidenceBreakdown).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-[9px] bg-background/30 rounded px-1.5 py-0.5">
                    <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <span className="font-mono">{typeof value === 'number' ? value.toFixed(0) : value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {event.metadata?.citations && event.metadata.citations.length > 0 && (
            <div>
              <span className="text-[9px] text-muted-foreground uppercase">Citations ({event.metadata.citations.length})</span>
              <div className="space-y-0.5 mt-1">
                {event.metadata.citations.slice(0, 3).map((url, idx) => (
                  <a 
                    key={idx}
                    href={url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[9px] text-blue-400 hover:underline block truncate flex items-center gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <Link className="h-2 w-2 shrink-0" />
                    {url.replace(/^https?:\/\//, '').slice(0, 50)}
                  </a>
                ))}
              </div>
            </div>
          )}
          
          {event.metadata?.traceId && (
            <div className="text-[8px] text-muted-foreground/50 font-mono">
              trace: {event.metadata.traceId.slice(0, 8)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseSection({ phase, events, expandedIds, onToggle }: { 
  phase: string; 
  events: ResearchEvent[]; 
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  
  const phaseColors: Record<string, string> = {
    DISCOVERY: "text-blue-400 border-blue-400/30",
    RESEARCH: "text-cyan-400 border-cyan-400/30",
    SYNTHESIS: "text-purple-400 border-purple-400/30",
    VALIDATION: "text-amber-400 border-amber-400/30",
    EXPORT: "text-emerald-400 border-emerald-400/30",
    SYSTEM: "text-muted-foreground border-border",
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-md border mb-1 hover-elevate",
          phaseColors[phase] || phaseColors.SYSTEM
        )}>
          <div className="flex items-center gap-2">
            <Activity className="h-3 w-3" />
            <span className="text-xs font-medium uppercase">{phase}</span>
            <Badge variant="secondary" className="text-[9px] h-4">{events.length}</Badge>
          </div>
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 pl-2 border-l border-border/30 ml-1.5 mb-3">
          {events.map(event => (
            <EventCard 
              key={event.id} 
              event={event} 
              isExpanded={expandedIds.has(event.id)}
              onToggle={() => onToggle(event.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<ResearchEventType>>(new Set());
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    ideas: 0, 
    candidates: 0,
    totalCost: 0,
    totalTokens: 0,
    providerCounts: {} as Record<ResearchSource, number>,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimestamp = useRef<number>(0);
  const wsFailCount = useRef(0);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFilter = useCallback((type: ResearchEventType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const addEvents = useCallback((newEvents: ResearchEvent[]) => {
    if (paused || newEvents.length === 0) return;
    
    setEvents(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const unique = newEvents.filter(e => !existingIds.has(e.id));
      if (unique.length === 0) return prev;
      return [...prev.slice(-499 + unique.length), ...unique];
    });
    
    setLastActivity(new Date());
    
    newEvents.forEach(evt => {
      setStats(prev => ({
        ...prev,
        searches: prev.searches + (evt.type === "search" ? 1 : 0),
        sources: prev.sources + (evt.type === "source" ? 1 : 0),
        ideas: prev.ideas + (evt.type === "idea" ? 1 : 0),
        candidates: prev.candidates + (evt.type === "candidate" ? 1 : 0),
        totalCost: prev.totalCost + (evt.metadata?.costUsd || 0),
        totalTokens: prev.totalTokens + (evt.metadata?.inputTokens || 0) + (evt.metadata?.outputTokens || 0),
        providerCounts: {
          ...prev.providerCounts,
          [evt.source]: (prev.providerCounts[evt.source] || 0) + 1,
        },
      }));
      if (evt.timestamp instanceof Date) {
        lastEventTimestamp.current = Math.max(lastEventTimestamp.current, evt.timestamp.getTime());
      } else if (typeof evt.timestamp === 'number') {
        lastEventTimestamp.current = Math.max(lastEventTimestamp.current, evt.timestamp);
      }
    });
  }, [paused]);

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
    setUsePolling(true);
    setConnected(true);
    
    addEvents([{
      id: `sys-poll-${Date.now()}`,
      timestamp: new Date(),
      type: "system",
      source: "system",
      title: "Connected via HTTP polling",
      details: "Watching AI research activity (polling mode)",
    }]);
    
    pollEvents();
    pollingIntervalRef.current = setInterval(pollEvents, 3000);
  }, [pollEvents, addEvents]);

  const connectWebSocket = useCallback(() => {
    if (usePolling) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/research-monitor`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsFailCount.current = 0;
        setConnected(true);
        
        addEvents([{
          id: `sys-${Date.now()}`,
          timestamp: new Date(),
          type: "system",
          source: "system",
          title: "Connected to Research Monitor",
          details: "Live feed active - watching AI research activity",
        }]);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "connected" && data.recentEvents?.length > 0) {
            const historicalEvents: ResearchEvent[] = data.recentEvents.map((evt: any) => ({
              id: evt.id || `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date(evt.timestamp || Date.now()),
              type: evt.eventType || "system",
              source: evt.source || "system",
              title: evt.title || "Research Activity",
              details: evt.details,
              metadata: evt.metadata,
            }));
            addEvents(historicalEvents);
            return;
          }
          
          if (paused) return;
          
          if (data.type === "research_event") {
            const newEvent: ResearchEvent = {
              id: data.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date(data.timestamp || Date.now()),
              type: data.eventType || "system",
              source: data.source || "system",
              title: data.title || "Research Activity",
              details: data.details,
              metadata: data.metadata,
            };
            addEvents([newEvent]);
          }
        } catch (e) {
          console.error("[ResearchMonitor] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsFailCount.current++;
        
        if (wsFailCount.current >= 3) {
          startPolling();
        } else {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 2000);
        }
      };

      ws.onerror = () => {};

      wsRef.current = ws;
    } catch (e) {
      wsFailCount.current++;
      if (wsFailCount.current >= 3) {
        startPolling();
      } else {
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      }
    }
  }, [paused, usePolling, addEvents, startPolling]);

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

  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, paused]);

  const clearEvents = () => {
    setEvents([]);
    setStats({ searches: 0, sources: 0, ideas: 0, candidates: 0, totalCost: 0, totalTokens: 0, providerCounts: {} });
    setExpandedIds(new Set());
  };

  const triggerResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategy-lab/trigger-research");
      return res.json();
    },
    onMutate: () => {
      addEvents([{
        id: `sys-trigger-${Date.now()}`,
        timestamp: new Date(),
        type: "system",
        source: "system",
        title: "Research triggered manually",
        details: "Starting AI research cycle...",
      }]);
    },
  });

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter(e => activeFilters.has(e.type));
  }, [events, activeFilters]);

  const groupedByPhase = useMemo(() => {
    const groups: Record<string, ResearchEvent[]> = {};
    filteredEvents.forEach(evt => {
      const phase = evt.metadata?.phase || "SYSTEM";
      if (!groups[phase]) groups[phase] = [];
      groups[phase].push(evt);
    });
    const orderedGroups: [string, ResearchEvent[]][] = [];
    PHASE_ORDER.forEach(p => {
      if (groups[p]) orderedGroups.push([p, groups[p]]);
    });
    Object.keys(groups).forEach(p => {
      if (!PHASE_ORDER.includes(p)) orderedGroups.push([p, groups[p]]);
    });
    return orderedGroups;
  }, [filteredEvents]);

  const eventTypes: ResearchEventType[] = ["search", "source", "idea", "candidate", "analysis", "reasoning", "validation", "scoring", "rejection", "cost", "api_call", "phase", "error", "system"];

  return (
    <AppLayout title="Research Monitor" disableMainScroll>
      <div className="flex flex-col h-full gap-3 pt-3">
        {/* Metrics Ribbon */}
        <div className="flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge 
              variant={connected ? "default" : "secondary"} 
              className={cn("gap-1", connected && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30")}
              data-testid="status-connection"
            >
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? (usePolling ? "Polling" : "Live") : "Connecting"}
            </Badge>
            
            <Separator orientation="vertical" className="h-6" />
            
            <MetricCard icon={Search} label="Queries" value={stats.searches} color="text-blue-400" />
            <MetricCard icon={Globe} label="Sources" value={stats.sources} color="text-cyan-400" />
            <MetricCard icon={Sparkles} label="Ideas" value={stats.ideas} color="text-yellow-400" />
            <MetricCard icon={Target} label="Candidates" value={stats.candidates} color="text-emerald-400" />
            <MetricCard 
              icon={DollarSign} 
              label="Cost" 
              value={`$${stats.totalCost.toFixed(4)}`} 
              subValue={`${(stats.totalTokens / 1000).toFixed(1)}k tokens`}
              color="text-amber-400" 
            />
            
            <div className="flex-1" />
            
            {lastActivity && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Timer className="h-3 w-3" />
                Last: {format(lastActivity, "HH:mm:ss")}
              </div>
            )}
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => triggerResearchMutation.mutate()}
                    disabled={triggerResearchMutation.isPending}
                    data-testid="button-trigger-research"
                  >
                    {triggerResearchMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Rocket className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Trigger Research</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setPaused(!paused)}
                    data-testid="button-pause"
                  >
                    {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{paused ? "Resume" : "Pause"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={clearEvents}
                    data-testid="button-clear"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Events</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        {/* Main 3-Panel Layout */}
        <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
          {/* Left Sidebar - Filters & Controls */}
          <Card className="w-56 flex-shrink-0 flex flex-col">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Filter className="h-3 w-3" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto py-0 px-3 pb-3">
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Event Types</div>
                  <div className="space-y-1">
                    {eventTypes.map(type => {
                      const Icon = EVENT_ICONS[type];
                      const isActive = activeFilters.size === 0 || activeFilters.has(type);
                      return (
                        <div 
                          key={type}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors text-xs",
                            isActive ? "bg-muted/50" : "opacity-40"
                          )}
                          onClick={() => toggleFilter(type)}
                          data-testid={`filter-${type}`}
                        >
                          <Checkbox 
                            checked={activeFilters.size === 0 || activeFilters.has(type)}
                            className="h-3 w-3"
                            data-testid={`checkbox-filter-${type}`}
                          />
                          <Icon className={cn("h-3 w-3", EVENT_COLORS[type])} />
                          <span className="capitalize">{type.replace("_", " ")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Quick Actions</div>
                  <div className="space-y-1">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => setActiveFilters(new Set())}
                      data-testid="button-filter-show-all"
                    >
                      <Eye className="h-3 w-3 mr-2" />
                      Show All
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => setActiveFilters(new Set(["error", "rejection"]))}
                      data-testid="button-filter-errors"
                    >
                      <AlertCircle className="h-3 w-3 mr-2" />
                      Errors Only
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => setActiveFilters(new Set(["candidate", "idea"]))}
                      data-testid="button-filter-results"
                    >
                      <Target className="h-3 w-3 mr-2" />
                      Results Only
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Center - Event Timeline */}
          <Card className="flex-1 flex flex-col min-w-0">
            <CardHeader className="py-2 px-3 flex-shrink-0">
              <CardTitle className="text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Radio className={cn("h-3 w-3", connected && !paused && "text-emerald-400 animate-pulse")} />
                  Event Timeline
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {filteredEvents.length} events
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-3 pb-3" ref={scrollRef}>
                {filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <Brain className="h-12 w-12 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Waiting for research activity...</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Events will appear here when AI bots are researching
                    </p>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="mt-4"
                      onClick={() => triggerResearchMutation.mutate()}
                      disabled={triggerResearchMutation.isPending}
                      data-testid="button-trigger-research-empty"
                    >
                      {triggerResearchMutation.isPending ? (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      ) : (
                        <Rocket className="h-3 w-3 mr-2" />
                      )}
                      Trigger Research
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1 pt-1">
                    {groupedByPhase.length > 1 ? (
                      groupedByPhase.map(([phase, phaseEvents]) => (
                        <PhaseSection 
                          key={phase} 
                          phase={phase} 
                          events={phaseEvents}
                          expandedIds={expandedIds}
                          onToggle={toggleExpanded}
                        />
                      ))
                    ) : (
                      filteredEvents.map(event => (
                        <EventCard 
                          key={event.id} 
                          event={event}
                          isExpanded={expandedIds.has(event.id)}
                          onToggle={() => toggleExpanded(event.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
          
          {/* Right Sidebar - Analytics */}
          <Card className="w-56 flex-shrink-0 flex flex-col">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <BarChart3 className="h-3 w-3" />
                Analytics
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto py-0 px-3 pb-3">
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Provider Distribution</div>
                  <ProviderBar stats={stats.providerCounts} />
                </div>
                
                <Separator />
                
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Session Summary</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Total Events</span>
                      <span className="font-mono">{events.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">API Calls</span>
                      <span className="font-mono">{events.filter(e => e.type === "api_call").length}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Validations</span>
                      <span className="font-mono">{events.filter(e => e.type === "validation").length}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Rejections</span>
                      <span className="font-mono text-rose-400">{events.filter(e => e.type === "rejection").length}</span>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Candidate Pipeline</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Ideas</span>
                      <Progress value={stats.ideas > 0 ? 100 : 0} className="w-20 h-1.5" />
                      <span className="text-[10px] font-mono w-6 text-right">{stats.ideas}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Screened</span>
                      <Progress value={stats.ideas > 0 ? (stats.candidates / stats.ideas) * 100 : 0} className="w-20 h-1.5" />
                      <span className="text-[10px] font-mono w-6 text-right">{stats.candidates}</span>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-2">Actions</div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="w-full h-7 text-xs"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `research-log-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
                      a.click();
                    }}
                    data-testid="button-export-log"
                  >
                    <Download className="h-3 w-3 mr-1.5" />
                    Export Log
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
