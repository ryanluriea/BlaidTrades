import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, DollarSign, Activity, Radio, Microscope,
  CheckCircle2, XCircle, Clock, ChevronRight
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, isValid } from "date-fns";
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
  metadata?: Record<string, any>;
}

const EVENT_ICONS: Record<ResearchEventType, typeof Search> = {
  search: Search,
  source: Globe,
  idea: Sparkles,
  candidate: Target,
  error: AlertCircle,
  system: Zap,
  analysis: Brain,
  reasoning: Brain,
  validation: CheckCircle2,
  cost: DollarSign,
  phase: Radio,
  scoring: Target,
  rejection: XCircle,
  api_call: Zap,
};

const EVENT_COLORS: Record<ResearchEventType, string> = {
  search: "text-blue-400",
  source: "text-cyan-400",
  idea: "text-amber-400",
  candidate: "text-emerald-400",
  error: "text-red-400",
  system: "text-muted-foreground",
  analysis: "text-purple-400",
  reasoning: "text-violet-400",
  validation: "text-emerald-400",
  cost: "text-amber-400",
  phase: "text-blue-400",
  scoring: "text-orange-400",
  rejection: "text-red-400",
  api_call: "text-cyan-400",
};

const SOURCE_COLORS: Record<ResearchSource, string> = {
  perplexity: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  grok: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  openai: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  anthropic: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  groq: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  gemini: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  system: "bg-muted text-muted-foreground border-border",
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

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ResearchEvent | null>(null);
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    candidates: 0,
    totalCost: 0,
  });
  const viewportRef = useRef<HTMLDivElement>(null);
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
        candidates: prev.candidates + (evt.type === "candidate" ? 1 : 0),
        totalCost: prev.totalCost + (evt.metadata?.costUsd || 0),
      }));
      if (evt.timestamp instanceof Date) {
        lastEventTimestamp.current = Math.max(lastEventTimestamp.current, evt.timestamp.getTime());
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
        wsFailCount.current = 0;
        setConnected(true);
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
        console.log("[ResearchMonitor] WebSocket disconnected");
        setConnected(false);
        wsFailCount.current++;
        
        if (wsFailCount.current >= 3) {
          startPolling();
        } else {
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
        }
      };

      ws.onerror = (e) => {
        console.error("[ResearchMonitor] WebSocket error:", e);
      };

      wsRef.current = ws;
    } catch (e) {
      wsFailCount.current++;
      if (wsFailCount.current >= 3) {
        startPolling();
      } else {
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
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
    if (viewportRef.current && !paused) {
      viewportRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  const clearEvents = () => {
    setEvents([]);
    setStats({ searches: 0, sources: 0, candidates: 0, totalCost: 0 });
    setSelectedEvent(null);
  };

  const triggerResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategy-lab/trigger-research");
      return res.json();
    },
  });

  return (
    <AppLayout title="Research Monitor">
      <div className="h-full flex flex-col">
        {/* Header with stats and controls */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Microscope className="h-5 w-5 text-primary" />
              <span className="font-medium">AI Research Activity</span>
            </div>
            
            {/* Connection Status */}
            <div className="flex items-center gap-2" data-testid="status-connection">
              {connected ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-mono" data-testid="text-connection-status">{usePolling ? "POLLING" : "LIVE"}</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono" data-testid="text-connection-status">DISCONNECTED</span>
                </>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2" data-testid="stat-searches">
              <Search className="h-3.5 w-3.5 text-blue-400" />
              <span className="font-mono" data-testid="text-search-count">{stats.searches}</span>
              <span className="text-xs text-muted-foreground">queries</span>
            </div>
            <div className="flex items-center gap-2" data-testid="stat-sources">
              <Globe className="h-3.5 w-3.5 text-cyan-400" />
              <span className="font-mono" data-testid="text-source-count">{stats.sources}</span>
              <span className="text-xs text-muted-foreground">sources</span>
            </div>
            <div className="flex items-center gap-2" data-testid="stat-candidates">
              <Target className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-mono" data-testid="text-candidate-count">{stats.candidates}</span>
              <span className="text-xs text-muted-foreground">candidates</span>
            </div>
            <div className="flex items-center gap-2" data-testid="stat-cost">
              <DollarSign className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono" data-testid="text-total-cost">${stats.totalCost.toFixed(3)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => triggerResearchMutation.mutate()}
              disabled={triggerResearchMutation.isPending}
              data-testid="button-trigger-research"
            >
              {triggerResearchMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5 mr-1.5" />
              )}
              Research
            </Button>
            <Button 
              size="icon" 
              variant="ghost"
              onClick={() => setPaused(!paused)}
              data-testid="button-pause"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button 
              size="icon" 
              variant="ghost"
              onClick={clearEvents}
              data-testid="button-clear"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex min-h-0">
          {/* Activity Feed - takes most of the space */}
          <div className="flex-1 flex flex-col min-h-0 border-r border-border">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Activity Feed</span>
              </div>
              <Badge variant="secondary" className="text-[10px] h-5">{events.length} events</Badge>
            </div>
            
            <ScrollArea className="flex-1" viewportRef={viewportRef}>
              <div className="divide-y divide-border/50">
                {events.length === 0 ? (
                  <div className="p-8 text-center">
                    <Brain className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">Waiting for research activity...</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Events will appear here in real-time</p>
                  </div>
                ) : (
                  [...events].reverse().map(event => {
                    const Icon = EVENT_ICONS[event.type] || Zap;
                    const isSelected = selectedEvent?.id === event.id;
                    return (
                      <div 
                        key={event.id}
                        className={cn(
                          "px-4 py-2.5 cursor-pointer transition-colors flex items-start gap-3",
                          isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"
                        )}
                        onClick={() => setSelectedEvent(event)}
                        data-testid={`event-${event.id}`}
                      >
                        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", EVENT_COLORS[event.type])} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{event.title}</span>
                            <Badge 
                              variant="outline" 
                              className={cn("text-[9px] h-4 px-1.5 shrink-0", SOURCE_COLORS[event.source])}
                            >
                              {event.source}
                            </Badge>
                          </div>
                          {event.details && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.details}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {safeFormat(event.timestamp, "h:mm:ss a")}
                          </span>
                          {isSelected && <ChevronRight className="h-3 w-3 text-primary" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Detail Panel */}
          <div className="w-[400px] flex flex-col min-h-0 bg-muted/5" data-testid="panel-event-detail">
            {selectedEvent ? (
              <>
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge 
                      variant="outline" 
                      className={cn("text-[10px]", SOURCE_COLORS[selectedEvent.source])}
                      data-testid="badge-event-source"
                    >
                      {selectedEvent.source}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] uppercase" data-testid="badge-event-type">
                      {selectedEvent.type}
                    </Badge>
                  </div>
                  <h3 className="font-medium" data-testid="text-event-title">{selectedEvent.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-event-timestamp">
                    {safeFormat(selectedEvent.timestamp, "PPpp")}
                  </p>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4" data-testid="event-detail-content">
                    {selectedEvent.details && (
                      <div data-testid="detail-section-details">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Details</div>
                        <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed" data-testid="text-event-details">
                          {selectedEvent.details}
                        </p>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.query && (
                      <div data-testid="detail-section-query">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Search Query</div>
                        <p className="text-sm font-mono bg-muted/50 px-2 py-1.5 rounded" data-testid="text-search-query">
                          {selectedEvent.metadata.query}
                        </p>
                      </div>
                    )}
                    
                    {(selectedEvent.metadata?.archetype || selectedEvent.metadata?.aiProvider) && (
                      <div className="flex flex-wrap items-center gap-2" data-testid="detail-section-meta-badges">
                        {selectedEvent.metadata?.archetype && (
                          <Badge variant="secondary" className="text-[10px]" data-testid="badge-archetype">
                            <Target className="h-2.5 w-2.5 mr-1" />
                            {selectedEvent.metadata.archetype}
                          </Badge>
                        )}
                        {selectedEvent.metadata?.aiProvider && (
                          <Badge variant="outline" className="text-[10px] text-primary" data-testid="badge-ai-provider">
                            <Brain className="h-2.5 w-2.5 mr-1" />
                            via {selectedEvent.metadata.aiProvider}
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.hypothesis && (
                      <div data-testid="detail-section-hypothesis">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Strategy Hypothesis</div>
                        <p className="text-sm text-foreground/90 leading-relaxed" data-testid="text-hypothesis">
                          {selectedEvent.metadata.hypothesis}
                        </p>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.reasoning && (
                      <div data-testid="detail-section-reasoning">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">AI Reasoning</div>
                        <p className="text-sm text-foreground/80 italic border-l-2 border-primary/30 pl-3 py-1" data-testid="text-ai-reasoning">
                          {selectedEvent.metadata.reasoning}
                        </p>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.synthesis && (
                      <div data-testid="detail-section-synthesis">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Research Synthesis</div>
                        <p className="text-sm text-foreground/80 bg-muted/30 px-3 py-2 rounded" data-testid="text-synthesis">
                          {selectedEvent.metadata.synthesis}
                        </p>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.sources && Array.isArray(selectedEvent.metadata.sources) && (
                      <div data-testid="detail-section-sources">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                          Sources Analyzed ({selectedEvent.metadata.sources.length})
                        </div>
                        <div className="space-y-2">
                          {selectedEvent.metadata.sources.map((src: any, i: number) => (
                            typeof src === 'string' ? (
                              <div key={i} className="text-xs text-muted-foreground flex items-center gap-2" data-testid={`source-item-${i}`}>
                                <Globe className="h-3 w-3 shrink-0" />
                                <span className="truncate">{src}</span>
                              </div>
                            ) : (
                              <div key={i} className="bg-muted/20 rounded p-2 border border-border/50" data-testid={`source-card-${i}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <Globe className="h-3 w-3 shrink-0 text-primary" />
                                  <span className="text-xs font-medium truncate">{src.label || src.title || 'Source'}</span>
                                  {src.type && (
                                    <Badge 
                                      variant="outline" 
                                      className={cn(
                                        "text-[9px] h-4 px-1 shrink-0",
                                        src.type === "HIGH" && "text-emerald-400 border-emerald-400/30",
                                        src.type === "MEDIUM" && "text-amber-400 border-amber-400/30",
                                        src.type === "LOW" && "text-muted-foreground border-border"
                                      )}
                                    >
                                      {src.type}
                                    </Badge>
                                  )}
                                </div>
                                {src.detail && (
                                  <p className="text-[11px] text-muted-foreground leading-relaxed pl-5">
                                    {src.detail}
                                  </p>
                                )}
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.confidence !== undefined && (
                      <div data-testid="detail-section-confidence">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Confidence Score</div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full transition-all",
                                selectedEvent.metadata.confidence >= 70 && "bg-emerald-500",
                                selectedEvent.metadata.confidence >= 40 && selectedEvent.metadata.confidence < 70 && "bg-amber-500",
                                selectedEvent.metadata.confidence < 40 && "bg-red-500"
                              )}
                              style={{ width: `${selectedEvent.metadata.confidence}%` }}
                            />
                          </div>
                          <span className="text-sm font-mono font-semibold" data-testid="text-confidence-value">
                            {selectedEvent.metadata.confidence}%
                          </span>
                        </div>
                        {selectedEvent.metadata?.confidenceBreakdown && (
                          <div className="grid grid-cols-2 gap-1 mt-2" data-testid="confidence-breakdown">
                            {Object.entries(selectedEvent.metadata.confidenceBreakdown)
                              .filter(([_, v]) => typeof v === 'number' && v > 0)
                              .sort(([, a], [, b]) => (b as number) - (a as number))
                              .map(([key, value]) => (
                                <div key={key} className="flex items-center justify-between text-[10px] bg-muted/30 rounded px-2 py-1">
                                  <span className="text-muted-foreground capitalize truncate">
                                    {key.replace(/([A-Z])/g, ' $1').trim()}
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
                    )}
                    
                    {selectedEvent.metadata?.validationChecks && (
                      <div data-testid="detail-section-validation">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Validation Checks</div>
                        <div className="space-y-1">
                          {(selectedEvent.metadata.validationChecks as Array<{name: string, passed: boolean}>).map((check, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs" data-testid={`validation-check-${i}`}>
                              {check.passed ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-400" />
                              )}
                              <span className={check.passed ? "text-foreground/80" : "text-red-400"}>{check.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.costUsd !== undefined && (
                      <div data-testid="detail-section-cost">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">API Cost</div>
                        <p className="text-sm font-mono" data-testid="text-api-cost">${selectedEvent.metadata.costUsd.toFixed(4)}</p>
                      </div>
                    )}
                    
                    {selectedEvent.metadata?.latencyMs !== undefined && (
                      <div data-testid="detail-section-latency">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Latency</div>
                        <p className="text-sm font-mono" data-testid="text-latency-value">{selectedEvent.metadata.latencyMs}ms</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Brain className="h-16 w-16 text-muted-foreground/15 mb-4" />
                <p className="text-sm text-muted-foreground">Select an event to view details</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Click on any activity in the feed
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
