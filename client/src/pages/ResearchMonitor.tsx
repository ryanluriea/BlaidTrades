import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, Clock, DollarSign, CheckCircle, XCircle, 
  AlertTriangle, ChevronDown, ChevronRight, Activity, Cpu, TrendingUp,
  FileText, Link, BarChart3
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

function ExpandableEvent({ event }: { event: ResearchEvent }) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = EVENT_ICONS[event.type] || Zap;
  const hasExpandableContent = !!(
    event.metadata?.reasoning || 
    event.metadata?.hypothesis || 
    event.metadata?.confidenceBreakdown ||
    event.metadata?.sources?.length ||
    event.metadata?.citations?.length ||
    (event.details && event.details.length > 100)
  );
  
  const validationIcon = event.metadata?.validationResult === "PASS" ? CheckCircle :
                        event.metadata?.validationResult === "FAIL" ? XCircle :
                        event.metadata?.validationResult === "WARN" ? AlertTriangle : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        className={cn(
          "rounded-md border transition-colors",
          SOURCE_BG[event.source],
          hasExpandableContent && "cursor-pointer"
        )}
      >
        <CollapsibleTrigger asChild disabled={!hasExpandableContent}>
          <div className="flex items-start gap-3 py-2 px-3">
            <div className="flex items-center gap-2 min-w-[100px] text-xs text-muted-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {format(event.timestamp, "h:mm:ss a")}
            </div>
            
            <div className={cn("shrink-0", EVENT_COLORS[event.type])}>
              <Icon className="h-4 w-4" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge 
                  variant="outline" 
                  className={cn("text-[10px] uppercase", SOURCE_COLORS[event.source])}
                >
                  {event.source}
                </Badge>
                {event.type !== "system" && (
                  <Badge 
                    variant="secondary" 
                    className="text-[10px] uppercase"
                  >
                    {event.type.replace("_", " ")}
                  </Badge>
                )}
                <span className="font-medium text-sm">{event.title}</span>
                {validationIcon && (
                  <span className={cn(
                    "ml-1",
                    event.metadata?.validationResult === "PASS" && "text-green-400",
                    event.metadata?.validationResult === "FAIL" && "text-red-400",
                    event.metadata?.validationResult === "WARN" && "text-amber-400"
                  )}>
                    {validationIcon === CheckCircle && <CheckCircle className="h-3.5 w-3.5" />}
                    {validationIcon === XCircle && <XCircle className="h-3.5 w-3.5" />}
                    {validationIcon === AlertTriangle && <AlertTriangle className="h-3.5 w-3.5" />}
                  </span>
                )}
              </div>
              
              {event.details && event.details.length <= 100 && (
                <p className="text-xs text-muted-foreground mt-1 break-all">
                  {event.details}
                </p>
              )}
              
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {event.metadata?.confidence !== undefined && (
                  <Badge variant="secondary" className="text-[10px]">
                    <TrendingUp className="h-2.5 w-2.5 mr-1" />
                    {event.metadata.confidence}%
                  </Badge>
                )}
                {event.metadata?.costUsd !== undefined && (
                  <Badge variant="outline" className="text-[10px] text-amber-400">
                    <DollarSign className="h-2.5 w-2.5 mr-0.5" />
                    {event.metadata.costUsd.toFixed(4)}
                  </Badge>
                )}
                {event.metadata?.inputTokens !== undefined && (
                  <Badge variant="outline" className="text-[10px] text-slate-400">
                    {(event.metadata.inputTokens + (event.metadata.outputTokens || 0)).toLocaleString()} tokens
                  </Badge>
                )}
                {event.metadata?.durationMs !== undefined && (
                  <Badge variant="outline" className="text-[10px] text-slate-400">
                    {(event.metadata.durationMs / 1000).toFixed(1)}s
                  </Badge>
                )}
                {event.metadata?.model && (
                  <Badge variant="outline" className="text-[10px]">
                    {event.metadata.model}
                  </Badge>
                )}
                {event.metadata?.archetype && (
                  <Badge variant="outline" className="text-[10px] text-purple-400">
                    {event.metadata.archetype}
                  </Badge>
                )}
                {event.metadata?.depth && (
                  <Badge variant="outline" className="text-[10px] text-sky-400">
                    {event.metadata.depth}
                  </Badge>
                )}
              </div>
            </div>
            
            {hasExpandableContent && (
              <div className="shrink-0 text-muted-foreground">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            )}
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 ml-[116px] space-y-2 border-t border-border/50 mt-2 pt-2">
            {event.details && event.details.length > 100 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Details</span>
                <p className="text-xs text-foreground/80 mt-0.5 break-all whitespace-pre-wrap">
                  {event.details}
                </p>
              </div>
            )}
            
            {event.metadata?.hypothesis && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Hypothesis</span>
                <p className="text-xs text-foreground/80 mt-0.5">
                  {event.metadata.hypothesis}
                </p>
              </div>
            )}
            
            {event.metadata?.reasoning && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">AI Reasoning</span>
                <p className="text-xs text-foreground/80 mt-0.5 italic">
                  "{event.metadata.reasoning}"
                </p>
              </div>
            )}
            
            {event.metadata?.confidenceBreakdown && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Confidence Breakdown</span>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {Object.entries(event.metadata.confidenceBreakdown).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-[10px] bg-background/30 rounded px-2 py-0.5">
                      <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="font-mono">{typeof value === 'number' ? value.toFixed(0) : value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {event.metadata?.sources && event.metadata.sources.length > 0 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Research Sources</span>
                <div className="space-y-1 mt-1">
                  {event.metadata.sources.map((source, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[10px] bg-background/30 rounded px-2 py-1">
                      <Badge variant="outline" className="text-[8px] shrink-0">{source.type}</Badge>
                      <div>
                        <span className="font-medium">{source.label}</span>
                        <span className="text-muted-foreground ml-1">- {source.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {event.metadata?.citations && event.metadata.citations.length > 0 && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Citations ({event.metadata.citations.length})</span>
                <div className="space-y-0.5 mt-1">
                  {event.metadata.citations.slice(0, 5).map((url, idx) => (
                    <a 
                      key={idx}
                      href={url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-400 hover:underline block truncate flex items-center gap-1"
                    >
                      <Link className="h-2.5 w-2.5 shrink-0" />
                      {url}
                    </a>
                  ))}
                  {event.metadata.citations.length > 5 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{event.metadata.citations.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {event.metadata?.url && (
              <a 
                href={event.metadata.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center gap-1"
              >
                <Link className="h-3 w-3" />
                {event.metadata.url}
              </a>
            )}
            
            {event.metadata?.traceId && (
              <div className="text-[9px] text-muted-foreground/50 font-mono">
                trace: {event.metadata.traceId.slice(0, 8)}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    ideas: 0, 
    candidates: 0,
    totalCost: 0,
    totalTokens: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimestamp = useRef<number>(0);
  const wsFailCount = useRef(0);

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
        ideas: prev.ideas + (evt.type === "idea" ? 1 : 0),
        candidates: prev.candidates + (evt.type === "candidate" ? 1 : 0),
        totalCost: prev.totalCost + (evt.metadata?.costUsd || 0),
        totalTokens: prev.totalTokens + (evt.metadata?.inputTokens || 0) + (evt.metadata?.outputTokens || 0),
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
    console.log("[ResearchMonitor] Switching to HTTP polling");
    
    setEvents(prev => [...prev, {
      id: `sys-poll-${Date.now()}`,
      timestamp: new Date(),
      type: "system",
      source: "system",
      title: "Connected via HTTP polling",
      details: "Watching AI research activity (polling mode)",
    }]);
    
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
        wsFailCount.current = 0;
        setConnected(true);
        console.log("[ResearchMonitor] WebSocket connected");
        
        setEvents(prev => [...prev, {
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
          
          // Handle initial connection with recent events
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
            console.log(`[ResearchMonitor] Loaded ${historicalEvents.length} historical events`);
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
        console.log("[ResearchMonitor] WebSocket disconnected");
        wsFailCount.current++;
        
        if (wsFailCount.current >= 3) {
          startPolling();
        } else {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error("[ResearchMonitor] WebSocket error:", error);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error("[ResearchMonitor] Failed to connect:", e);
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
    
    const connect = () => {
      if (!mounted) return;
      connectWebSocket();
    };
    
    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
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
    setStats({ searches: 0, sources: 0, ideas: 0, candidates: 0, totalCost: 0, totalTokens: 0 });
  };

  const triggerResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategy-lab/trigger-research");
      return res.json();
    },
    onMutate: () => {
      setEvents(prev => [...prev, {
        id: `sys-trigger-${Date.now()}`,
        timestamp: new Date(),
        type: "system",
        source: "system",
        title: "Research triggered manually",
        details: "Starting AI research cycle...",
      }]);
    },
  });

  return (
    <AppLayout 
      title="Research Monitor" 
      disableMainScroll
      headerContent={
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"} className="text-xs">
            {connected ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                Connecting...
              </>
            )}
          </Badge>
          
          <div className="flex items-center gap-3 ml-4 text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <Search className="h-3 w-3 text-blue-400" />
                  <span className="text-muted-foreground">{stats.searches}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Queries made</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <Globe className="h-3 w-3 text-cyan-400" />
                  <span className="text-muted-foreground">{stats.sources}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Sources analyzed</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <Sparkles className="h-3 w-3 text-yellow-400" />
                  <span className="text-muted-foreground">{stats.ideas}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Ideas discovered</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <Target className="h-3 w-3 text-emerald-400" />
                  <span className="text-muted-foreground">{stats.candidates}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Strategies created</TooltipContent>
            </Tooltip>
            {stats.totalCost > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 cursor-help">
                    <DollarSign className="h-3 w-3 text-amber-400" />
                    <span className="text-muted-foreground">${stats.totalCost.toFixed(4)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total cost (USD)</TooltipContent>
              </Tooltip>
            )}
          </div>
          
          <div className="flex items-center gap-1 ml-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => triggerResearchMutation.mutate()}
                  disabled={triggerResearchMutation.isPending}
                  data-testid="button-trigger-research"
                >
                  {triggerResearchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Trigger research now</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={() => setPaused(!paused)}
                  data-testid="button-pause-feed"
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{paused ? "Resume feed" : "Pause feed"}</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={clearEvents}
                  data-testid="button-clear-feed"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear feed</TooltipContent>
            </Tooltip>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-full p-4">
        <Card className="flex-1 overflow-hidden bg-card/50 border-border">
          <ScrollArea className="h-full" ref={scrollRef}>
            <div className="p-4 font-mono text-sm space-y-1">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Brain className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-sm">Waiting for research activity...</p>
                  <p className="text-xs mt-2">Click the rocket button to trigger AI research</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Events will stream here in real-time</p>
                </div>
              ) : (
                events.map((event) => (
                  <ExpandableEvent key={event.id} event={event} />
                ))
              )}
              
              {paused && events.length > 0 && (
                <div className="flex items-center justify-center py-2 text-amber-400 text-xs">
                  <Pause className="h-3 w-3 mr-1.5" />
                  Feed paused - click play to resume
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>
    </AppLayout>
  );
}
