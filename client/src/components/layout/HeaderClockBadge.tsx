import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useMarketHours } from "@/hooks/useMarketHours";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { useTimezone } from "@/hooks/useTimezone";
import { HealthDrawer } from "@/components/health/HealthDrawer";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, AlertTriangle, XCircle, WifiOff, Pause, Database, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface HeaderClockBadgeProps {
  symbol?: string;
  className?: string;
}

interface CacheStats {
  redis_cache?: {
    status: string;
    enabled: boolean;
    is_primary_hydration_source: boolean;
    symbols_cached: number;
    total_bars: number;
    memory_used_mb: string;
    last_error?: string;
  };
  databento?: {
    status: string;
    symbols_cached: Array<{
      symbol: string;
      bars: number;
      stale: boolean;
    }>;
  };
}

interface HealthStats {
  status: string;
  timestamp: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
  };
  uptime: number;
}

export function HeaderClockBadge({ 
  symbol = 'ES',
  className 
}: HeaderClockBadgeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { data: health, isLoading: healthLoading, isError: healthError } = useHealthSummary();
  const { data: marketHours, isLoading: marketLoading } = useMarketHours(symbol);
  const { formatInTimezone, getTimezoneAbbr } = useTimezone();
  
  const { data: cacheStats } = useQuery<CacheStats>({
    queryKey: ['/api/_proof/live-data'],
    queryFn: async () => {
      const res = await fetch('/api/_proof/live-data', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch cache stats');
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: healthStats } = useQuery<HealthStats>({
    queryKey: ['/api/health'],
    queryFn: async () => {
      const res = await fetch('/api/health', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch health stats');
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isHealthDegraded = healthError || (!healthLoading && !health);
  
  const isMarketOpen = marketHours?.isOpen ?? false;
  const sessionType = marketHours?.sessionType ?? 'CLOSED';
  const isMaintenance = sessionType === 'MAINTENANCE';

  const getHealthIcon = () => {
    if (healthLoading) {
      return { Icon: Clock, color: "text-muted-foreground animate-pulse" };
    }
    if (isHealthDegraded) {
      return { Icon: WifiOff, color: "text-amber-400" };
    }
    switch (health?.overall) {
      case "GREEN":
        return { Icon: CheckCircle2, color: "text-emerald-400" };
      case "YELLOW":
        return { Icon: AlertTriangle, color: "text-yellow-400" };
      case "RED":
        return { Icon: XCircle, color: "text-destructive" };
      default:
        return { Icon: CheckCircle2, color: "text-muted-foreground" };
    }
  };

  const getSessionLabel = () => {
    if (marketLoading) {
      return '---';
    }
    if (isMarketOpen) {
      return sessionType === 'RTH' ? 'RTH' : 'OPEN';
    }
    if (isMaintenance) {
      return 'MAINT';
    }
    return 'CLOSED';
  };

  const { Icon: HealthIcon, color: healthIconColor } = getHealthIcon();

  const totalBars = cacheStats?.databento?.symbols_cached?.reduce((sum, s) => sum + s.bars, 0) || 0;
  const totalSymbols = cacheStats?.databento?.symbols_cached?.length || 0;
  const cacheSizeMB = parseFloat(cacheStats?.redis_cache?.memory_used_mb || "0");
  const redisConnected = cacheStats?.redis_cache?.status === "CONNECTED";
  const maxCacheMB = 10;
  const cachePercent = Math.min((cacheSizeMB / maxCacheMB) * 100, 100);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex flex-col px-2 py-0.5 text-xs transition-colors hover:opacity-80",
              className
            )}
            data-testid="button-header-clock-badge"
          >
            <div className="flex items-center">
              <HealthIcon 
                className={cn("w-3.5 h-3.5 flex-shrink-0 cursor-pointer", healthIconColor)} 
                onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
              />
              
              <span className="mx-1.5 h-3 w-px bg-border/40" />
              
              {marketLoading ? (
                <span className="text-muted-foreground font-medium uppercase text-[10px] tracking-wide animate-pulse">
                  {getSessionLabel()}
                </span>
              ) : isMarketOpen ? (
                <span className="text-emerald-400 font-semibold uppercase text-[10px] tracking-wide">
                  {getSessionLabel()}
                </span>
              ) : isMaintenance ? (
                <span className="text-amber-400 font-medium uppercase text-[10px] tracking-wide flex items-center gap-0.5">
                  <Pause className="w-2.5 h-2.5" />
                  {getSessionLabel()}
                </span>
              ) : (
                <span className="text-muted-foreground font-medium uppercase text-[10px] tracking-wide">
                  {getSessionLabel()}
                </span>
              )}
              
              <span className="mx-1.5 h-3 w-px bg-border/40" />
              
              <span className="text-foreground font-mono text-xs tabular-nums font-medium tracking-tight">
                {formatInTimezone(currentTime, "h:mm:ss a")}
              </span>
              
              <span className="text-muted-foreground font-mono text-[10px] ml-0.5">
                {getTimezoneAbbr()}
              </span>
              
              <span className="mx-1.5 h-3 w-px bg-border/40" />
              
              <span className="text-muted-foreground text-[10px]">
                {formatInTimezone(currentTime, "dd MMM")}
              </span>
            </div>
            
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex-1 h-1 bg-muted/50 rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    redisConnected ? "bg-emerald-500/70" : "bg-amber-500/70"
                  )}
                  style={{ width: `${Math.max(cachePercent, 5)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground font-mono tabular-nums">
                {cacheSizeMB.toFixed(1)}MB
              </span>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-64 p-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="w-4 h-4" />
              <span>Cache Status</span>
            </div>
            
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Symbols Cached</span>
                <span className="font-mono">{totalSymbols}/4</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bars</span>
                <span className="font-mono">{totalBars.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Redis</span>
                <span className={cn(
                  "font-medium",
                  redisConnected ? "text-emerald-400" : "text-amber-400"
                )}>
                  {redisConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cache Size</span>
                <span className="font-mono">{cacheSizeMB.toFixed(2)} MB</span>
              </div>
              {cacheStats?.redis_cache?.last_error && (
                <div className="text-amber-400 text-[10px] pt-1 border-t border-border/30">
                  {cacheStats.redis_cache.last_error}
                </div>
              )}
            </div>

            {healthStats?.memory && (
              <div className="pt-2 border-t border-border/50 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Memory Usage</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Heap Used</span>
                    <span className="font-mono">{healthStats.memory.heapUsedMB} MB</span>
                  </div>
                  {/* Progress bar shows usage against max heap (8GB), not current allocation */}
                  {(() => {
                    const MAX_HEAP_MB = 8192;
                    const usedPct = healthStats.memory.heapUsedMB / MAX_HEAP_MB;
                    return (
                      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            usedPct > 0.75 
                              ? "bg-destructive/70" 
                              : usedPct > 0.50 
                                ? "bg-amber-500/70" 
                                : "bg-emerald-500/70"
                          )}
                          style={{ width: `${Math.min(usedPct * 100, 100)}%` }}
                        />
                      </div>
                    );
                  })()}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Heap Allocated</span>
                    <span className="font-mono">{healthStats.memory.heapTotalMB} MB</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">RSS</span>
                    <span className="font-mono">{healthStats.memory.rssMB} MB</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Uptime</span>
                    <span className="font-mono">{Math.floor(healthStats.uptime / 60)}m {healthStats.uptime % 60}s</span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="pt-2 border-t border-border/50 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Market Session</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exchange</span>
                  <span className="font-medium">{marketHours?.exchange || 'CME'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session</span>
                  <span className={cn(
                    "font-medium",
                    isMarketOpen ? "text-emerald-400" : isMaintenance ? "text-amber-400" : "text-muted-foreground"
                  )}>
                    {sessionType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RTH Hours</span>
                  <span className="font-mono text-[10px]">09:30 - 16:00 ET</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No-Trade Windows</span>
                  <span className="font-mono text-[10px]">First/Last 15min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trading Days</span>
                  <span className="font-mono text-[10px]">Mon-Fri</span>
                </div>
                {marketHours?.reason && (
                  <div className="text-muted-foreground/70 text-[10px] pt-1">
                    {marketHours.reason}
                  </div>
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      <ErrorBoundary 
        onReset={() => setDrawerOpen(false)}
        fallback={null}
      >
        <HealthDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </ErrorBoundary>
    </>
  );
}
