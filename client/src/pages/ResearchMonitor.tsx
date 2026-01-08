import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Wifi, WifiOff, Trash2, Pause, Play, Search, Brain, Globe, Target, Sparkles, AlertCircle, CheckCircle2, Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";

interface ResearchEvent {
  id: string;
  timestamp: Date;
  type: "search" | "source" | "idea" | "candidate" | "error" | "system" | "analysis";
  source: "perplexity" | "grok" | "system";
  title: string;
  details?: string;
  metadata?: Record<string, any>;
}

const EVENT_ICONS: Record<ResearchEvent["type"], typeof Search> = {
  search: Search,
  source: Globe,
  idea: Sparkles,
  candidate: Target,
  error: AlertCircle,
  system: Zap,
  analysis: Brain,
};

const SOURCE_COLORS: Record<ResearchEvent["source"], string> = {
  perplexity: "text-cyan-400",
  grok: "text-purple-400",
  system: "text-muted-foreground",
};

const SOURCE_BG: Record<ResearchEvent["source"], string> = {
  perplexity: "bg-cyan-500/10 border-cyan-500/20",
  grok: "bg-purple-500/10 border-purple-500/20",
  system: "bg-muted/50 border-border",
};

export default function ResearchMonitor() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ searches: 0, sources: 0, ideas: 0, candidates: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/research-monitor`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
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
        if (paused) return;
        
        try {
          const data = JSON.parse(event.data);
          
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
            
            setEvents(prev => [...prev.slice(-499), newEvent]);
            
            setStats(prev => ({
              ...prev,
              searches: prev.searches + (newEvent.type === "search" ? 1 : 0),
              sources: prev.sources + (newEvent.type === "source" ? 1 : 0),
              ideas: prev.ideas + (newEvent.type === "idea" ? 1 : 0),
              candidates: prev.candidates + (newEvent.type === "candidate" ? 1 : 0),
            }));
          }
        } catch (e) {
          console.error("[ResearchMonitor] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log("[ResearchMonitor] WebSocket disconnected");
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error("[ResearchMonitor] WebSocket error:", error);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error("[ResearchMonitor] Failed to connect:", e);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 5000);
    }
  }, [paused]);

  useEffect(() => {
    let mounted = true;
    
    const connect = () => {
      if (!mounted) return;
      connectWebSocket();
    };
    
    connect();

    return () => {
      mounted = false;
      // Clear any pending reconnect timers first
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on cleanup
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
    setStats({ searches: 0, sources: 0, ideas: 0, candidates: 0 });
  };

  return (
    <AppLayout title="Research Monitor" disableMainScroll>
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between gap-4 p-4 border-b">
          <div className="flex items-center gap-3">
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => navigate("/strategy-lab")}
              data-testid="button-back-to-strategy-lab"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                Research Monitor
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
              </h1>
              <p className="text-xs text-muted-foreground">Watch AI bots research and discover strategies in real-time</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-4 mr-4 text-xs">
              <div className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-muted-foreground">{stats.searches}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-muted-foreground">{stats.sources}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
                <span className="text-muted-foreground">{stats.ideas}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-muted-foreground">{stats.candidates}</span>
              </div>
            </div>
            
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

        <div className="flex-1 overflow-hidden p-4">
          <Card className="h-full bg-black/40 border-border">
            <ScrollArea className="h-full" ref={scrollRef}>
              <div className="p-4 font-mono text-sm space-y-1">
                {events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Brain className="h-12 w-12 mb-4 opacity-30" />
                    <p className="text-sm">Waiting for research activity...</p>
                    <p className="text-xs mt-1">Events will appear here when AI bots are researching</p>
                  </div>
                ) : (
                  events.map((event) => {
                    const Icon = EVENT_ICONS[event.type];
                    return (
                      <div 
                        key={event.id}
                        className={cn(
                          "flex items-start gap-3 py-2 px-3 rounded-md border transition-colors",
                          SOURCE_BG[event.source]
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-[140px] text-xs text-muted-foreground shrink-0">
                          <Clock className="h-3 w-3" />
                          {format(event.timestamp, "HH:mm:ss.SSS")}
                        </div>
                        
                        <div className={cn("shrink-0", SOURCE_COLORS[event.source])}>
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
                            <span className="font-medium">{event.title}</span>
                          </div>
                          {event.details && (
                            <p className="text-xs text-muted-foreground mt-1 break-all">
                              {event.details}
                            </p>
                          )}
                          {event.metadata?.confidence && (
                            <Badge variant="secondary" className="text-[10px] mt-1">
                              {event.metadata.confidence}% confidence
                            </Badge>
                          )}
                          {event.metadata?.url && (
                            <a 
                              href={event.metadata.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:underline mt-1 block truncate"
                            >
                              {event.metadata.url}
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
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
      </div>
    </AppLayout>
  );
}
