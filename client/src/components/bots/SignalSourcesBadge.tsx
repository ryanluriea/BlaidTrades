import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, TrendingUp, Database, Newspaper, Calendar, Loader2, Check, X, Zap, Settings, Ban, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBotSignalSources, type BotSignalSourcesConfig } from "./PerBotSourcesDialog";
import { loadSourcesSettings } from "./SourcesSettingsDropdown";

interface SignalSourcesBadgeProps {
  botId?: string;
  symbol?: string;
  className?: string;
  strategyConfig?: Record<string, unknown>;
  onClick?: () => void;
  /** Compact mode for grid box display - shows smaller text */
  compact?: boolean;
}

// Data provider info for institutional compliance
interface DataProvider {
  name: string;
  category: string;
  status: "CONNECTED" | "DEGRADED" | "OFFLINE";
  latencyMs?: number;
  lastFetchedAt?: string;
}

interface FusedSignal {
  symbol: string;
  netBias: string;
  confidence: number;
  sources: Array<{
    name: string;
    available: boolean;
    bias: string;
    confidence: number;
    weight: number;
    reasoning: string;
    providers?: DataProvider[];
  }>;
  sourceAttribution: {
    contributingSources: string[];
    sourceWeights: Record<string, number>;
    sourceConfidences: Record<string, number>;
    primarySource: string | null;
  };
}

// Fallback providers when backend data is not available
const FALLBACK_PROVIDERS: Record<string, DataProvider[]> = {
  "Options Flow": [{ name: "Unusual Whales", category: "Options Flow", status: "CONNECTED" }],
  "Macro Indicators": [{ name: "FRED", category: "Macro Indicators", status: "CONNECTED" }],
  "News Sentiment": [
    { name: "Finnhub", category: "News Sentiment", status: "CONNECTED" },
    { name: "NewsAPI", category: "News Sentiment", status: "CONNECTED" },
    { name: "Marketaux", category: "News Sentiment", status: "CONNECTED" },
  ],
  "Economic Calendar": [{ name: "FMP", category: "Economic Calendar", status: "CONNECTED" }],
};

interface AdaptiveWeightsResponse {
  success: boolean;
  data: {
    weights: {
      options_flow: number;
      macro_indicators: number;
      news_sentiment: number;
      economic_calendar: number;
    };
    lastOptimized: string;
    confidence: number;
    regime: "TRENDING" | "RANGING" | "VOLATILE" | "UNKNOWN";
  };
}

// Source Selection Governor state types
interface SourceState {
  sourceId: string;
  status: "enabled" | "disabled" | "probation";
  disabledAt?: string;
  disabledUntil?: string;
  reason?: string;
  consecutiveCyclesAtFloor?: number;
}

interface BotSourceStates {
  useAutonomousSelection: boolean;
  lastUpdated?: string;
  states: Record<string, SourceState>;
}

// Get governor source states from bot's strategyConfig
function getGovernorSourceStates(strategyConfig?: Record<string, unknown>): BotSourceStates | null {
  if (!strategyConfig) return null;
  const sourceStates = strategyConfig._sourceStates as BotSourceStates | undefined;
  if (!sourceStates?.useAutonomousSelection) return null;
  return sourceStates;
}

const SOURCE_CONFIG: Record<string, { abbrev: string; color: string; icon: typeof TrendingUp }> = {
  "Options Flow": { abbrev: "OPT", color: "text-green-400", icon: TrendingUp },
  "Macro Indicators": { abbrev: "MAC", color: "text-amber-400", icon: Database },
  "News Sentiment": { abbrev: "NWS", color: "text-cyan-400", icon: Newspaper },
  "Economic Calendar": { abbrev: "CAL", color: "text-purple-400", icon: Calendar },
};

// Map from adaptive weights API keys to display names
const SOURCE_ID_TO_NAME: Record<string, string> = {
  options_flow: "Options Flow",
  macro_indicators: "Macro Indicators",
  news_sentiment: "News Sentiment",
  economic_calendar: "Economic Calendar",
};

// Default source IDs that are considered enabled by default in the system
const DEFAULT_SOURCE_IDS = ["options_flow", "macro_indicators", "news_sentiment", "economic_calendar"];

// Helper to safely load settings with SSR protection and error handling
function safeLoadSourcesSettings(): Record<string, { enabled: boolean; weight: number }> {
  // SSR/pre-hydration guard
  if (typeof window === "undefined") {
    return DEFAULT_SOURCE_IDS.reduce((acc, id) => ({
      ...acc,
      [id]: { enabled: true, weight: 25 },
    }), {});
  }
  
  try {
    const settings = loadSourcesSettings();
    return settings.sources || {};
  } catch {
    // Graceful degradation on malformed localStorage
    return DEFAULT_SOURCE_IDS.reduce((acc, id) => ({
      ...acc,
      [id]: { enabled: true, weight: 25 },
    }), {});
  }
}

// Helper to count enabled sources from bot config
// Semantics differ based on settings type:
// - Global settings: missing entries default to enabled (all 4 defaults are enabled)
// - Custom bot settings: missing entries are DISABLED (opt-in model, only count explicit enables)
function countBotEnabledSources(botConfig: BotSignalSourcesConfig | null): number {
  if (!botConfig || botConfig.useGlobalSettings !== false) {
    // Using global settings - count from global localStorage
    const sources = safeLoadSourcesSettings();
    if (Object.keys(sources).length === 0) {
      // No global settings persisted - all defaults are enabled
      return DEFAULT_SOURCE_IDS.length;
    }
    // Count sources that are NOT explicitly disabled (missing = enabled for globals)
    return DEFAULT_SOURCE_IDS.filter(id => sources[id]?.enabled !== false).length;
  }
  
  // Using CUSTOM bot settings - count only EXPLICITLY enabled sources
  // In custom mode, missing entries = disabled (opt-in model)
  const sources = botConfig.sources || {};
  // Count sources where enabled is explicitly true
  return Object.values(sources).filter(config => config?.enabled === true).length;
}

// Helper to get enabled source IDs for a bot
function getEnabledSourceIds(botConfig: BotSignalSourcesConfig | null): string[] {
  if (!botConfig || botConfig.useGlobalSettings !== false) {
    // Using global settings
    const sources = safeLoadSourcesSettings();
    if (Object.keys(sources).length === 0) {
      return DEFAULT_SOURCE_IDS;
    }
    return DEFAULT_SOURCE_IDS.filter(id => sources[id]?.enabled !== false);
  }
  
  // Using custom bot settings - only explicitly enabled sources
  const sources = botConfig.sources || {};
  return Object.entries(sources)
    .filter(([_, config]) => config?.enabled === true)
    .map(([id]) => id);
}

// Count total CONNECTED data providers from enabled sources using backend data
function countConnectedProviders(
  enabledSourceIds: string[], 
  fusionSources?: FusedSignal["sources"]
): number {
  let count = 0;
  for (const sourceId of enabledSourceIds) {
    const displayName = SOURCE_ID_TO_NAME[sourceId];
    const sourceData = fusionSources?.find(s => s.name === displayName);
    // Use backend provider data if available, fallback to static mapping
    const providers = sourceData?.providers || FALLBACK_PROVIDERS[displayName] || [];
    // Only count CONNECTED providers (not DEGRADED or OFFLINE)
    count += providers.filter(p => p.status === "CONNECTED").length;
  }
  return count;
}

export function SignalSourcesBadge({ botId, symbol, className, strategyConfig, onClick, compact = false }: SignalSourcesBadgeProps) {
  const botSourcesConfig = strategyConfig ? getBotSignalSources(strategyConfig) : null;
  const isUsingGlobal = botSourcesConfig?.useGlobalSettings !== false;
  
  // Get governor source states (autonomous enable/disable)
  const governorStates = getGovernorSourceStates(strategyConfig);
  const usingAutonomousSelection = governorStates?.useAutonomousSelection || false;
  
  // Get base enabled source IDs for this bot
  const baseEnabledSourceIds = getEnabledSourceIds(botSourcesConfig);
  
  // Filter by governor states if using autonomous selection
  const enabledSourceIds = usingAutonomousSelection && governorStates
    ? baseEnabledSourceIds.filter(id => {
        const state = governorStates.states[id];
        return !state || state.status === "enabled" || state.status === "probation";
      })
    : baseEnabledSourceIds;
    
  // Get disabled source IDs for display
  const disabledSourceIds = usingAutonomousSelection && governorStates
    ? baseEnabledSourceIds.filter(id => {
        const state = governorStates.states[id];
        return state?.status === "disabled";
      })
    : [];
    
  // Get sources in probation
  const probationSourceIds = usingAutonomousSelection && governorStates
    ? baseEnabledSourceIds.filter(id => {
        const state = governorStates.states[id];
        return state?.status === "probation";
      })
    : [];

  // Fetch adaptive weights for this bot
  const { data: adaptiveData, isLoading: adaptiveLoading, error: adaptiveError } = useQuery<AdaptiveWeightsResponse>({
    queryKey: ["/api/signals/adaptive-weights", botId],
    queryFn: async () => {
      const url = botId 
        ? `/api/signals/adaptive-weights?botId=${botId}` 
        : "/api/signals/adaptive-weights";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch adaptive weights");
      const data = await response.json();
      // Validate success flag from API response
      if (!data.success) throw new Error("Adaptive weights API returned failure");
      return data;
    },
    staleTime: 60000,
    retry: false,
  });

  const { data, isLoading, error } = useQuery<{ success: boolean; data: FusedSignal }>({
    queryKey: ["/api/signals/fusion", symbol],
    queryFn: async () => {
      if (!symbol) throw new Error("No symbol");
      const response = await fetch(`/api/signals/fusion/${symbol}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch signal fusion");
      return response.json();
    },
    enabled: !!symbol,
    staleTime: 60000,
    retry: false,
  });

  const fusion = data?.data;
  const adaptiveWeights = adaptiveData?.data;
  
  // Count actual CONNECTED data providers from backend data
  const providerCount = countConnectedProviders(enabledSourceIds, fusion?.sources);
  
  // Check if ALL enabled sources have numeric weights (not undefined, not null)
  // Backend may return null for offline sources, undefined for omitted sources
  // Only show "Adaptive" when we have valid numeric weights for ALL enabled sources
  // Note: empty array means no sources enabled - that's a "Static" state, not "Adaptive"
  const hasEnabledSources = enabledSourceIds.length > 0;
  const allEnabledSourcesHaveWeights = hasEnabledSources && enabledSourceIds.every(sourceId => {
    const weight = adaptiveWeights?.weights?.[sourceId as keyof typeof adaptiveWeights.weights];
    return typeof weight === "number"; // Only numeric values are valid weights
  });
  
  // Determine if adaptive data is complete and valid for ALL enabled sources
  // Institutional requirement: only show "Adaptive" when we have complete numeric weight coverage
  // AND at least one source is enabled
  const hasAdaptiveData = !adaptiveLoading && !adaptiveError && adaptiveWeights && 
    adaptiveData?.success && allEnabledSourcesHaveWeights;

  if (!symbol) {
    if (compact) {
      return <span className="text-[9px] font-mono text-muted-foreground">--</span>;
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn("h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30", className)}
            data-testid={`badge-signal-sources${botId ? `-${botId}` : ""}`}
          >
            <Activity className="h-3 w-3" />
            <span>--</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">No symbol configured</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (isLoading) {
    if (compact) {
      return <span className="text-[9px] font-mono text-muted-foreground">...</span>;
    }
    return (
      <Badge variant="outline" className={cn("h-5 px-1.5 gap-1 text-[10px] bg-muted/30", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  if (error || !fusion) {
    if (compact) {
      return <span className="text-[9px] font-mono text-muted-foreground">N/A</span>;
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn("h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30", className)}
            data-testid={`badge-signal-sources${botId ? `-${botId}` : ""}`}
          >
            <Activity className="h-3 w-3" />
            <span>N/A</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Signal fusion unavailable</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const primarySource = fusion.sourceAttribution?.primarySource;

  const biasColor = fusion.netBias === "BULLISH" 
    ? "text-green-400" 
    : fusion.netBias === "BEARISH" 
      ? "text-red-400" 
      : "text-muted-foreground";

  // ===== COMPACT MODE =====
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={cn(
              "text-[9px] font-mono font-semibold",
              isUsingGlobal ? "text-amber-400" : "text-purple-400"
            )}
            data-testid={`compact-sources-${botId}`}
          >
            {providerCount}src
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-xs font-medium">Signal Sources ({symbol})</p>
          <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
            <p>{providerCount} connected providers</p>
            <p>{enabledSourceIds.length} sources enabled</p>
            <p>{isUsingGlobal ? "Using global settings" : "Custom bot settings"}</p>
          </div>
          <p className="text-[10px] text-purple-400 mt-1">Click to configure</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Build sources list from enabled source IDs - show ALL enabled sources
  // Weight semantics: number = valid weight, null = missing/unavailable
  const adaptiveSourcesList = enabledSourceIds.map(sourceId => {
    const displayName = SOURCE_ID_TO_NAME[sourceId] || sourceId;
    let weight: number | null;
    
    if (!adaptiveWeights || adaptiveLoading || adaptiveError) {
      // No adaptive data available at all
      weight = null;
    } else {
      const apiWeight = adaptiveWeights.weights?.[sourceId as keyof typeof adaptiveWeights.weights];
      // Only treat numeric values as valid weights; undefined/null from API = missing
      weight = typeof apiWeight === "number" ? apiWeight : null;
    }
    
    return { sourceId, displayName, weight };
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className={cn(
            "h-5 px-1.5 gap-1 text-[10px] cursor-pointer",
            isUsingGlobal 
              ? "bg-amber-500/10 border-amber-500/30" 
              : "bg-purple-500/10 border-purple-500/30",
            className
          )}
          onClick={onClick}
          data-testid={`badge-signal-sources${botId ? `-${botId}` : ""}`}
        >
          {isUsingGlobal ? (
            <Zap className="h-3 w-3 text-amber-400" />
          ) : (
            <Settings className="h-3 w-3 text-purple-400" />
          )}
          <span className={isUsingGlobal ? "text-amber-400" : "text-purple-400"}>
            {providerCount}src
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium">Signal Fusion: {symbol}</p>
          <div className="flex items-center gap-1">
            {hasAdaptiveData ? (
              <Badge 
                variant="outline" 
                className="h-4 text-[9px] px-1.5 text-amber-400 border-amber-500/30"
              >
                <Zap className="h-2.5 w-2.5 mr-0.5" />
                Adaptive
              </Badge>
            ) : (
              <Badge 
                variant="outline" 
                className="h-4 text-[9px] px-1.5 text-muted-foreground border-muted-foreground/30"
              >
                {adaptiveLoading ? "Loading..." : "Static"}
              </Badge>
            )}
            <Badge 
              variant="secondary" 
              className={cn("h-4 text-[9px] px-1.5", biasColor)}
            >
              {fusion.netBias}
            </Badge>
          </div>
        </div>
        
        {!hasEnabledSources ? (
          <div className="py-2">
            <p className="text-[11px] text-muted-foreground">No sources enabled</p>
          </div>
        ) : adaptiveLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Loading adaptive weights...</span>
          </div>
        ) : adaptiveError ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-red-400">Adaptive weights unavailable</p>
            {adaptiveSourcesList.map(({ sourceId, displayName }) => {
              const config = SOURCE_CONFIG[displayName] || { 
                abbrev: displayName.slice(0, 3).toUpperCase(), 
                color: "text-muted-foreground",
                icon: Activity,
              };
              const IconComponent = config.icon;
              
              return (
                <div 
                  key={sourceId}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <IconComponent className={cn("h-3 w-3", config.color)} />
                  <span className="flex-1">{displayName}</span>
                  <span className="text-muted-foreground font-mono">--%</span>
                  <Check className="h-3 w-3 text-green-400/50" />
                </div>
              );
            })}
          </div>
        ) : !hasAdaptiveData && !adaptiveLoading ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-amber-400">Incomplete adaptive data</p>
            {adaptiveSourcesList.map(({ sourceId, displayName, weight }) => {
              const config = SOURCE_CONFIG[displayName] || { 
                abbrev: displayName.slice(0, 3).toUpperCase(), 
                color: "text-muted-foreground",
                icon: Activity,
              };
              const IconComponent = config.icon;
              const isMissing = weight === null;
              
              return (
                <div 
                  key={sourceId}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <IconComponent className={cn("h-3 w-3", isMissing ? "text-muted-foreground/40" : config.color)} />
                  <span className={cn("flex-1", isMissing && "text-muted-foreground/60")}>{displayName}</span>
                  <span className={cn("font-mono", isMissing ? "text-muted-foreground/50" : config.color)}>
                    {isMissing ? "--%"  : `${(weight * 100).toFixed(0)}%`}
                  </span>
                  {isMissing ? (
                    <X className="h-3 w-3 text-amber-400/60" />
                  ) : (
                    <Check className="h-3 w-3 text-green-400/60" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {adaptiveSourcesList.length > 0 ? (
              adaptiveSourcesList.map(({ sourceId, displayName, weight }) => {
                const config = SOURCE_CONFIG[displayName] || { 
                  abbrev: displayName.slice(0, 3).toUpperCase(), 
                  color: "text-muted-foreground",
                  icon: Activity,
                };
                const IconComponent = config.icon;
                // At this point we know hasAdaptiveData is true, so weight should be a number (0 or positive)
                const weightValue = weight ?? 0;
                const isZeroWeight = weightValue === 0;
                
                return (
                  <div 
                    key={sourceId}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <IconComponent className={cn("h-3 w-3", isZeroWeight ? "text-muted-foreground/40" : config.color)} />
                    <span className={cn("flex-1", isZeroWeight && "text-muted-foreground/60")}>{displayName}</span>
                    <span className={cn("font-mono", isZeroWeight ? "text-muted-foreground/60" : config.color)}>
                      {(weightValue * 100).toFixed(0)}%
                    </span>
                    {isZeroWeight ? (
                      <X className="h-3 w-3 text-muted-foreground/40" />
                    ) : (
                      <Check className="h-3 w-3 text-green-400" />
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-[11px] text-muted-foreground">No sources enabled</p>
            )}
          </div>
        )}

        <div className="mt-2 pt-1.5 border-t border-border/50 space-y-0.5 text-[10px] text-muted-foreground">
          {hasAdaptiveData && adaptiveWeights && (
            <>
              <div className="flex justify-between">
                <span>Regime:</span>
                <span className={
                  adaptiveWeights.regime === "TRENDING" ? "text-green-400" :
                  adaptiveWeights.regime === "VOLATILE" ? "text-red-400" :
                  adaptiveWeights.regime === "RANGING" ? "text-amber-400" :
                  "text-muted-foreground"
                }>
                  {adaptiveWeights.regime}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Weight Confidence:</span>
                <span className="text-amber-400">{adaptiveWeights.confidence.toFixed(0)}%</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span>Fusion Confidence:</span>
            <span className={biasColor}>{fusion.confidence.toFixed(0)}%</span>
          </div>
          {primarySource && (
            <div className="flex justify-between">
              <span>Primary Source:</span>
              <span className={SOURCE_CONFIG[primarySource]?.color || "text-muted-foreground"}>
                {primarySource}
              </span>
            </div>
          )}
          {!isUsingGlobal && (
            <div className="flex items-center gap-1 mt-1 pt-1 border-t border-border/30">
              <Settings className="h-2.5 w-2.5 text-purple-400" />
              <span className="text-purple-400">Custom bot sources</span>
            </div>
          )}
          {usingAutonomousSelection && (
            <div className="flex items-center gap-1 mt-1 pt-1 border-t border-border/30">
              <Zap className="h-2.5 w-2.5 text-amber-400" />
              <span className="text-amber-400">Autonomous Source Selection</span>
            </div>
          )}
        </div>

        {/* GOVERNOR: Disabled Sources Section */}
        {usingAutonomousSelection && disabledSourceIds.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-border/50">
            <p className="text-[10px] text-red-400/80 mb-1 flex items-center gap-1">
              <Ban className="h-2.5 w-2.5" />
              Disabled by Governor:
            </p>
            <div className="space-y-1">
              {disabledSourceIds.map(sourceId => {
                const displayName = SOURCE_ID_TO_NAME[sourceId] || sourceId;
                const config = SOURCE_CONFIG[displayName] || { 
                  abbrev: displayName.slice(0, 3).toUpperCase(), 
                  color: "text-muted-foreground",
                  icon: Activity,
                };
                const IconComponent = config.icon;
                const state = governorStates?.states[sourceId];
                
                return (
                  <div 
                    key={sourceId}
                    className="flex items-center gap-2 text-[10px] text-muted-foreground/60"
                  >
                    <IconComponent className="h-3 w-3 opacity-40" />
                    <span className="flex-1">{displayName}</span>
                    {state?.reason && (
                      <span className="text-red-400/60 truncate max-w-[120px]">{state.reason}</span>
                    )}
                    <Ban className="h-2.5 w-2.5 text-red-400/60" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* GOVERNOR: Probation Sources Section */}
        {usingAutonomousSelection && probationSourceIds.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-border/50">
            <p className="text-[10px] text-amber-400/80 mb-1 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              In Probation:
            </p>
            <div className="space-y-1">
              {probationSourceIds.map(sourceId => {
                const displayName = SOURCE_ID_TO_NAME[sourceId] || sourceId;
                const config = SOURCE_CONFIG[displayName] || { 
                  abbrev: displayName.slice(0, 3).toUpperCase(), 
                  color: "text-muted-foreground",
                  icon: Activity,
                };
                const IconComponent = config.icon;
                
                return (
                  <div 
                    key={sourceId}
                    className="flex items-center gap-2 text-[10px] text-amber-400/80"
                  >
                    <IconComponent className="h-3 w-3" />
                    <span className="flex-1">{displayName}</span>
                    <Clock className="h-2.5 w-2.5" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* INSTITUTIONAL: Data Providers Section - MiFID II/SEC Reg SCI Compliance */}
        <div className="mt-2 pt-1.5 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground mb-1">Data Providers:</p>
          <div className="flex flex-wrap gap-1">
            {enabledSourceIds.flatMap(sourceId => {
              const displayName = SOURCE_ID_TO_NAME[sourceId];
              const sourceData = fusion.sources?.find(s => s.name === displayName);
              // Use backend provider data if available, fallback to static mapping
              const providers = sourceData?.providers || FALLBACK_PROVIDERS[displayName] || [];
              
              return providers.map(provider => {
                // Per-provider status for institutional compliance
                const status = provider.status || (sourceData?.available ? "CONNECTED" : "OFFLINE");
                const isConnected = status === "CONNECTED";
                const isDegraded = status === "DEGRADED";
                const isOffline = status === "OFFLINE";
                
                return (
                  <Badge 
                    key={`${sourceId}-${provider.name}`}
                    variant="outline"
                    className={cn(
                      "h-4 text-[9px] px-1.5",
                      isConnected && "text-green-400 border-green-500/30",
                      isDegraded && "text-amber-400 border-amber-500/30",
                      isOffline && "text-muted-foreground/50 border-muted-foreground/20"
                    )}
                  >
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full mr-1",
                      isConnected && "bg-green-400",
                      isDegraded && "bg-amber-400",
                      isOffline && "bg-muted-foreground/50"
                    )} />
                    {provider.name}
                  </Badge>
                );
              });
            })}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
