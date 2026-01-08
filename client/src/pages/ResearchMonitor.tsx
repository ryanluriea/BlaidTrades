import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, ChevronDown, ChevronRight, Settings, Radio
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  validation: Target,
  cost: Zap,
  phase: Radio,
  scoring: Target,
  rejection: AlertCircle,
  api_call: Zap,
};

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ResearchEvent | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    candidates: 0,
    totalCost: 0,
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
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        {/* Top Stats Bar - matching Tournaments exactly */}
        <div className="grid grid-cols-4 border-b border-border">
          <div className="p-3 border-r border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Queries</div>
            <div className="text-xl font-semibold mt-0.5">{stats.searches}</div>
          </div>
          <div className="p-3 border-r border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Sources</div>
            <div className="text-xl font-semibold mt-0.5">{stats.sources}</div>
          </div>
          <div className="p-3 border-r border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Candidates</div>
            <div className="text-xl font-semibold mt-0.5">{stats.candidates}</div>
          </div>
          <div className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</div>
            <div className="text-xl font-semibold mt-0.5 flex items-center gap-2">
              {connected ? (
                <span className="text-emerald-400">{usePolling ? "POLLING" : "LIVE"}</span>
              ) : (
                <span className="text-muted-foreground">IDLE</span>
              )}
            </div>
          </div>
        </div>

        {/* Main Content - 2 column layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 min-h-0">
          {/* Left Panel */}
          <div className="lg:col-span-1 border-r border-border flex flex-col min-h-0">
            {/* Schedule Section */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-2 text-sm font-medium mb-3">
                <Radio className={cn("w-4 h-4", connected && "text-emerald-400")} />
                <span>SCHEDULE</span>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-muted-foreground")} />
                    <span>Continuous Scan</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Badge variant="secondary" className="text-[10px] h-5">AUTO</Badge>
                    <span>{events.length > 0 ? format(events[events.length - 1]?.timestamp || new Date(), "h:mm a") : "Never ran"}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>Deep Research</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Badge variant="secondary" className="text-[10px] h-5">MANUAL</Badge>
                    <span>On demand</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Show Manual Controls - collapsible like Tournaments */}
            <Collapsible open={showControls} onOpenChange={setShowControls}>
              <CollapsibleTrigger className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground border-b border-border">
                <Settings className="w-3.5 h-3.5" />
                <span>Show Manual Controls</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 border-b border-border space-y-2">
                  <Button 
                    size="sm" 
                    className="w-full justify-start"
                    onClick={() => triggerResearchMutation.mutate()}
                    disabled={triggerResearchMutation.isPending}
                    data-testid="button-trigger-research"
                  >
                    {triggerResearchMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="h-3.5 w-3.5 mr-2" />
                    )}
                    Trigger Research
                  </Button>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="flex-1"
                      onClick={() => setPaused(!paused)}
                      data-testid="button-pause"
                    >
                      {paused ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
                      {paused ? "Resume" : "Pause"}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={clearEvents}
                      data-testid="button-clear"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* History Section */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 flex items-center justify-between border-b border-border">
                <span className="text-sm font-medium">HISTORY</span>
                <Badge variant="secondary" className="text-[10px] h-5">{events.length}</Badge>
              </div>
              <ScrollArea className="flex-1" ref={scrollRef}>
                <div className="p-2 space-y-1">
                  {events.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-12 bg-muted/30 rounded-sm animate-pulse" />
                    ))
                  ) : (
                    events.map(event => {
                      const Icon = EVENT_ICONS[event.type] || Zap;
                      return (
                        <div 
                          key={event.id}
                          className={cn(
                            "p-2 rounded-sm cursor-pointer transition-colors",
                            selectedEvent?.id === event.id ? "bg-muted" : "hover:bg-muted/50"
                          )}
                          onClick={() => setSelectedEvent(event)}
                          data-testid={`event-${event.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate flex-1">{event.title}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {format(event.timestamp, "h:mm a")}
                            </span>
                          </div>
                          {event.details && (
                            <p className="text-xs text-muted-foreground mt-0.5 ml-5 truncate">{event.details}</p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Right Panel - Detail View */}
          <div className="lg:col-span-2 flex flex-col min-h-0">
            {selectedEvent ? (
              <>
                <div className="p-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {selectedEvent.source}
                    </Badge>
                    <span className="font-medium">{selectedEvent.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {format(selectedEvent.timestamp, "PPpp")}
                  </div>
                </div>
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 text-sm">
                    {selectedEvent.details && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">Details</div>
                        <p className="text-foreground/80 whitespace-pre-wrap">{selectedEvent.details}</p>
                      </div>
                    )}
                    {selectedEvent.metadata?.reasoning && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">AI Reasoning</div>
                        <p className="text-foreground/80 italic">"{selectedEvent.metadata.reasoning}"</p>
                      </div>
                    )}
                    {selectedEvent.metadata?.confidence !== undefined && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">Confidence</div>
                        <p className="text-foreground/80">{selectedEvent.metadata.confidence}%</p>
                      </div>
                    )}
                    {selectedEvent.metadata?.costUsd !== undefined && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">Cost</div>
                        <p className="text-foreground/80">${selectedEvent.metadata.costUsd.toFixed(4)}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Brain className="h-16 w-16 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Select a research event to view details</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Click on any entry in the history list</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
