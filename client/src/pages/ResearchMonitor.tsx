import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, 
  AlertCircle, Zap, Rocket, Loader2, Clock, DollarSign, CheckCircle, XCircle, 
  AlertTriangle, ChevronDown, ChevronRight, Activity, Cpu, TrendingUp,
  FileText, Link, BarChart3, Download, Settings, Radio, Eye
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
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

function EventCard({ event, isExpanded, onToggle }: { event: ResearchEvent; isExpanded: boolean; onToggle: () => void }) {
  const Icon = EVENT_ICONS[event.type] || Zap;
  const hasExpandableContent = !!(
    event.metadata?.reasoning || 
    event.metadata?.hypothesis || 
    event.metadata?.confidenceBreakdown ||
    event.metadata?.sources?.length ||
    event.metadata?.citations?.length ||
    (event.details && event.details.length > 100)
  );

  return (
    <div 
      className={cn(
        "p-2 bg-muted/20 rounded-sm cursor-pointer transition-colors",
        isExpanded && "bg-muted/40"
      )}
      onClick={() => hasExpandableContent && onToggle()}
      data-testid={`event-${event.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="text-[10px] text-muted-foreground font-mono w-16 shrink-0">
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
            <span className="text-xs font-medium truncate">{event.title}</span>
            {event.metadata?.confidence !== undefined && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                {event.metadata.confidence}%
              </Badge>
            )}
            {event.metadata?.costUsd !== undefined && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-400">
                ${event.metadata.costUsd.toFixed(4)}
              </Badge>
            )}
          </div>
          {event.details && !isExpanded && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{event.details}</p>
          )}
        </div>
        {hasExpandableContent && (
          <div className="shrink-0 text-muted-foreground">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </div>
        )}
      </div>
      
      {isExpanded && hasExpandableContent && (
        <div className="mt-2 ml-[72px] space-y-2 text-[10px] border-l-2 border-border/50 pl-2">
          {event.details && (
            <p className="text-foreground/80 whitespace-pre-wrap">{event.details}</p>
          )}
          {event.metadata?.reasoning && (
            <div>
              <span className="text-muted-foreground uppercase">Reasoning:</span>
              <p className="text-foreground/80 italic mt-0.5">"{event.metadata.reasoning}"</p>
            </div>
          )}
          {event.metadata?.citations && event.metadata.citations.length > 0 && (
            <div className="space-y-0.5">
              {event.metadata.citations.slice(0, 3).map((url, idx) => (
                <a 
                  key={idx}
                  href={url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline flex items-center gap-1"
                  onClick={e => e.stopPropagation()}
                >
                  <Link className="h-2.5 w-2.5" />
                  {url.replace(/^https?:\/\//, '').slice(0, 40)}...
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ResearchMonitor() {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<ResearchEvent | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<ResearchEventType>>(new Set());
  const [stats, setStats] = useState({ 
    searches: 0, 
    sources: 0, 
    ideas: 0, 
    candidates: 0,
    totalCost: 0,
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
        setConnected(false);
        wsFailCount.current++;
        
        if (wsFailCount.current >= 3) {
          startPolling();
        } else {
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
        }
      };

      ws.onerror = () => {};

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
    setStats({ searches: 0, sources: 0, ideas: 0, candidates: 0, totalCost: 0 });
    setExpandedIds(new Set());
    setSelectedEvent(null);
  };

  const triggerResearchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategy-lab/trigger-research");
      return res.json();
    },
  });

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter(e => activeFilters.has(e.type));
  }, [events, activeFilters]);

  return (
    <AppLayout title="Research Monitor">
      <div className="h-full flex flex-col gap-3 p-2">
        {/* Top Stats Bar */}
        <div className="grid grid-cols-5 gap-2">
          <div className="bg-card/80 border border-border/50 rounded-sm p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</div>
            <div className="text-lg font-mono font-semibold flex items-center gap-1.5">
              {connected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">{usePolling ? "POLL" : "LIVE"}</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">OFF</span>
                </>
              )}
            </div>
          </div>
          <div className="bg-card/80 border border-border/50 rounded-sm p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Queries</div>
            <div className="text-lg font-mono font-semibold text-blue-400">{stats.searches}</div>
          </div>
          <div className="bg-card/80 border border-border/50 rounded-sm p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Sources</div>
            <div className="text-lg font-mono font-semibold text-cyan-400">{stats.sources}</div>
          </div>
          <div className="bg-card/80 border border-border/50 rounded-sm p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Candidates</div>
            <div className="text-lg font-mono font-semibold text-emerald-400">{stats.candidates}</div>
          </div>
          <div className="bg-card/80 border border-border/50 rounded-sm p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Cost</div>
            <div className="text-lg font-mono font-semibold text-amber-400">${stats.totalCost.toFixed(4)}</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 min-h-0">
          {/* Left Panel - Controls + History */}
          <div className="lg:col-span-1 flex flex-col gap-3 min-h-0">
            {/* Controls */}
            <div className="bg-card/80 border border-border/50 rounded-sm">
              <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wide">Controls</span>
              </div>
              <div className="p-2 space-y-2">
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
            </div>

            {/* Filters */}
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
              <div className="bg-card/80 border border-border/50 rounded-sm">
                <CollapsibleTrigger className="w-full px-3 py-2 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide">Filters</span>
                  </div>
                  {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-2 grid grid-cols-2 gap-1">
                    {(["search", "source", "idea", "candidate", "analysis", "validation", "error"] as ResearchEventType[]).map(type => {
                      const Icon = EVENT_ICONS[type];
                      const isActive = activeFilters.size === 0 || activeFilters.has(type);
                      return (
                        <div 
                          key={type}
                          className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer text-[10px]",
                            isActive ? "bg-muted/50" : "opacity-40"
                          )}
                          onClick={() => {
                            setActiveFilters(prev => {
                              const next = new Set(prev);
                              if (next.has(type)) next.delete(type);
                              else next.add(type);
                              return next;
                            });
                          }}
                          data-testid={`filter-${type}`}
                        >
                          <Checkbox checked={isActive} className="h-3 w-3" data-testid={`checkbox-filter-${type}`} />
                          <Icon className={cn("h-3 w-3", EVENT_COLORS[type])} />
                          <span className="capitalize">{type}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-2 pb-2">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="w-full h-6 text-[10px]"
                      onClick={() => setActiveFilters(new Set())}
                      data-testid="button-filter-show-all"
                    >
                      Show All
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* History List */}
            <div className="flex-1 bg-card/80 border border-border/50 rounded-sm flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className={cn("w-3.5 h-3.5", connected && !paused && "text-emerald-400 animate-pulse")} />
                  <span className="text-xs font-medium uppercase tracking-wide">History</span>
                </div>
                <Badge variant="secondary" className="text-[9px] h-4">{filteredEvents.length}</Badge>
              </div>
              <ScrollArea className="flex-1" ref={scrollRef}>
                <div className="p-2 space-y-1">
                  {filteredEvents.length === 0 ? (
                    <div className="py-8 text-center">
                      <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Waiting for activity...</p>
                    </div>
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
              </ScrollArea>
            </div>
          </div>

          {/* Right Panel - Detail View */}
          <div className="lg:col-span-2 bg-card/80 border border-border/50 rounded-sm flex flex-col min-h-0">
            {selectedEvent ? (
              <>
                <div className="px-3 py-2 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", SOURCE_COLORS[selectedEvent.source])}>
                      {selectedEvent.source}
                    </Badge>
                    <span className="text-sm font-medium">{selectedEvent.title}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {format(selectedEvent.timestamp, "PPpp")}
                  </div>
                </div>
                <ScrollArea className="flex-1 p-3">
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
                    {selectedEvent.metadata?.confidenceBreakdown && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">Confidence Breakdown</div>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(selectedEvent.metadata.confidenceBreakdown).map(([key, value]) => (
                            <div key={key} className="flex justify-between bg-muted/30 rounded-sm px-2 py-1 text-xs">
                              <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                              <span className="font-mono">{typeof value === 'number' ? value.toFixed(0) : value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedEvent.metadata?.citations && selectedEvent.metadata.citations.length > 0 && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase mb-1">Citations</div>
                        <div className="space-y-1">
                          {selectedEvent.metadata.citations.map((url, idx) => (
                            <a 
                              key={idx}
                              href={url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <Link className="h-3 w-3" />
                              {url}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <Brain className="h-12 w-12 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Select an event to view details</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Click on any entry in the history list</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
