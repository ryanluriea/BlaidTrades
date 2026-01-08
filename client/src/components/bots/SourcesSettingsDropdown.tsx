import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, TrendingUp, Database, Newspaper, Calendar, Loader2, Check, X, HelpCircle, AlertTriangle, BarChart3, Globe, Radio, Settings } from "lucide-react";
import { SignalHealthBars, type SourceHealthData } from "./SignalHealthBars";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ProviderHealthPopover, ProviderSettingsDialog, type IntegrationData } from "./ProviderHealthPopover";

export const SOURCES_SETTINGS_STORAGE_KEY = "blaidagent_sources_settings";

export interface SignalSourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
  icon: typeof TrendingUp;
  color: string;
  description: string;
  provider: string;
}

export interface SourcesSettingsData {
  sources: Record<string, { enabled: boolean; weight: number }>;
}

const DEFAULT_SOURCES: SignalSourceConfig[] = [
  {
    id: "unusual_whales",
    name: "Unusual Whales",
    enabled: true,
    weight: 40,
    icon: TrendingUp,
    color: "text-green-400",
    description: "Options order flow for institutional activity detection",
    provider: "unusual_whales",
  },
  {
    id: "fred",
    name: "FRED",
    enabled: true,
    weight: 20,
    icon: Database,
    color: "text-amber-400",
    description: "Federal Reserve economic data for macro regime detection",
    provider: "fred",
  },
  {
    id: "finnhub",
    name: "Finnhub",
    enabled: true,
    weight: 10,
    icon: Newspaper,
    color: "text-cyan-400",
    description: "Real-time market news and sentiment analysis",
    provider: "finnhub",
  },
  {
    id: "newsapi",
    name: "NewsAPI",
    enabled: true,
    weight: 8,
    icon: Globe,
    color: "text-blue-400",
    description: "Global news aggregation from 80,000+ sources",
    provider: "news_api",
  },
  {
    id: "marketaux",
    name: "Marketaux",
    enabled: true,
    weight: 7,
    icon: Radio,
    color: "text-indigo-400",
    description: "Financial news with entity recognition and sentiment",
    provider: "marketaux",
  },
  {
    id: "fmp",
    name: "FMP",
    enabled: true,
    weight: 5,
    icon: Calendar,
    color: "text-purple-400",
    description: "Economic calendar and high-impact event scheduling",
    provider: "fmp",
  },
  {
    id: "databento",
    name: "Databento",
    enabled: true,
    weight: 5,
    icon: BarChart3,
    color: "text-orange-400",
    description: "CME futures real-time and historical market data",
    provider: "databento",
  },
  {
    id: "polygon",
    name: "Polygon",
    enabled: true,
    weight: 5,
    icon: Activity,
    color: "text-pink-400",
    description: "Market data aggregation and reference data",
    provider: "polygon",
  },
];

export function loadSourcesSettings(): SourcesSettingsData {
  const defaults = DEFAULT_SOURCES.reduce((acc, s) => ({
    ...acc,
    [s.id]: { enabled: s.enabled, weight: s.weight },
  }), {} as Record<string, { enabled: boolean; weight: number }>);
  
  try {
    const stored = localStorage.getItem(SOURCES_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        sources: { ...defaults, ...parsed.sources },
      };
    }
  } catch {}
  return { sources: defaults };
}

export function saveSourcesSettings(settings: SourcesSettingsData) {
  try {
    localStorage.setItem(SOURCES_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new StorageEvent("storage", {
      key: SOURCES_SETTINGS_STORAGE_KEY,
      newValue: JSON.stringify(settings),
    }));
  } catch {}
}

export function getEnabledSources(): SignalSourceConfig[] {
  const settings = loadSourcesSettings();
  return DEFAULT_SOURCES.filter(s => settings.sources[s.id]?.enabled !== false);
}

export function SourcesSettingsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, { enabled: boolean; weight: number }>>(() => 
    loadSourcesSettings().sources
  );

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SOURCES_SETTINGS_STORAGE_KEY && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          setSources(data.sources);
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const { data: integrationStatus, isLoading } = useQuery<{ success: boolean; data: { integrations: Array<{ provider: string; configured: boolean; verified?: boolean }> } }>({
    queryKey: ["/api/integrations/status"],
    queryFn: async () => {
      const response = await fetch("/api/integrations/status", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch integration status");
      return response.json();
    },
    staleTime: 60000,
    retry: false,
  });

  const integrations = integrationStatus?.data?.integrations || [];

  const isProviderConfigured = (providerList: string): boolean => {
    const providers = providerList.split(",").map(p => p.trim());
    return providers.some(provider => {
      const integration = integrations.find(i => i.provider === provider);
      return integration?.configured ?? false;
    });
  };

  const handleToggleSource = (sourceId: string) => {
    const newSources = {
      ...sources,
      [sourceId]: {
        ...sources[sourceId],
        enabled: !sources[sourceId]?.enabled,
      },
    };
    setSources(newSources);
    saveSourcesSettings({ sources: newSources });
  };

  const handleWeightChange = (sourceId: string, weight: number) => {
    const newSources = {
      ...sources,
      [sourceId]: {
        ...sources[sourceId],
        weight,
      },
    };
    setSources(newSources);
    saveSourcesSettings({ sources: newSources });
  };

  const getSourceWeight = (sourceId: string): number => {
    const defaultSource = DEFAULT_SOURCES.find(s => s.id === sourceId);
    const storedWeight = sources[sourceId]?.weight;
    if (typeof storedWeight === 'number' && storedWeight > 0) {
      return storedWeight;
    }
    return defaultSource?.weight ?? 0;
  };

  const isSourceEnabled = (sourceId: string): boolean => {
    return sources[sourceId]?.enabled !== false;
  };

  const enabledCount = DEFAULT_SOURCES.filter(s => isSourceEnabled(s.id)).length;
  const totalWeight = DEFAULT_SOURCES
    .filter(s => isSourceEnabled(s.id))
    .reduce((sum, s) => sum + getSourceWeight(s.id), 0);

  const getSourceHealth = (sourceId: string): 'green' | 'yellow' | 'red' | 'loading' => {
    if (isLoading) return 'loading';
    const source = DEFAULT_SOURCES.find(s => s.id === sourceId);
    if (!source) return 'red';
    const integration = integrations.find(i => i.provider === source.provider);
    if (!integration?.configured) return 'red';
    if (integration?.verified) return 'green';
    return 'yellow';
  };

  const enabledSources = DEFAULT_SOURCES.filter(s => isSourceEnabled(s.id));
  const healthStats = enabledSources.reduce(
    (acc, source) => {
      const health = getSourceHealth(source.id);
      if (health !== 'loading') {
        acc[health].push(source.name);
      }
      return acc;
    },
    { green: [] as string[], yellow: [] as string[], red: [] as string[] }
  );

  const getAggregateHealth = (): { status: 'green' | 'yellow' | 'red' | 'loading'; color: string; label: string } => {
    if (isLoading) {
      return { status: 'loading', color: 'text-muted-foreground', label: 'Loading...' };
    }
    const totalSources = DEFAULT_SOURCES.length;
    const downCount = healthStats.red.length;
    const healthyCount = totalSources - downCount;
    const healthPercent = totalSources > 0 ? (healthyCount / totalSources) * 100 : 0;
    
    if (healthPercent >= 75) {
      return { status: 'green', color: 'text-emerald-500', label: 'Healthy' };
    }
    if (healthPercent >= 50) {
      return { status: 'yellow', color: 'text-yellow-500', label: 'Partial' };
    }
    if (healthPercent >= 25) {
      return { status: 'yellow', color: 'text-orange-500', label: 'Degraded' };
    }
    return { status: 'red', color: 'text-red-500', label: 'Critical' };
  };

  const aggregateHealth = getAggregateHealth();

  const sourceHealthData: SourceHealthData[] = DEFAULT_SOURCES.map(source => ({
    id: source.id,
    name: source.name,
    health: getSourceHealth(source.id),
  }));

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm"
          className="gap-1.5 px-2 h-6"
          data-testid="button-sources-settings"
        >
          <SignalHealthBars sources={sourceHealthData} />
          <span className={cn("text-xs", aggregateHealth.color)}>{enabledCount}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium">Signal Sources</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{enabledCount} active</span>
              {totalWeight > 0 && totalWeight !== 100 && (
                <Tooltip>
                  <TooltipTrigger>
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Weights sum to {totalWeight}%, not 100%</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              Signal Sources
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                <p className="text-xs">Data sources used for signal fusion. Toggle to enable/disable each source. Adjust weights to prioritize different signals.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {DEFAULT_SOURCES.map((source) => {
                const IconComponent = source.icon;
                const isEnabled = isSourceEnabled(source.id);
                const weight = getSourceWeight(source.id);
                const isConfigured = isProviderConfigured(source.provider);
                const integration = integrations.find(i => i.provider === source.provider);
                const isVerified = integration?.verified ?? false;
                
                const getConnectionStatus = (): { color: string; label: string; dotClass: string } => {
                  if (!isConfigured) {
                    return { color: "text-red-500", label: "Not configured", dotClass: "bg-red-500" };
                  }
                  if (isVerified) {
                    return { color: "text-green-500", label: "Connected", dotClass: "bg-green-500" };
                  }
                  return { color: "text-yellow-500", label: "Configured but not verified", dotClass: "bg-yellow-500" };
                };
                
                const connectionStatus = getConnectionStatus();

                const integrationData: IntegrationData = {
                  provider: source.provider,
                  displayName: source.name,
                  configured: isConfigured,
                  verified: isVerified,
                  lastVerifiedAt: (integration as any)?.last_verified_at,
                  lastUsedAt: (integration as any)?.last_used_at,
                  count24h: (integration as any)?.proof_of_use_count_24h ?? 0,
                  latencyMs: (integration as any)?.latencyMs,
                };

                return (
                  <div key={source.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <ProviderHealthPopover
                        provider={source.provider}
                        name={source.name}
                        icon={IconComponent}
                        color={source.color}
                        integrationData={integrationData}
                      >
                        <button
                          type="button"
                          className="flex items-center gap-2 hover-elevate rounded-md px-1 py-0.5 -mx-1 transition-colors"
                          data-testid={`button-health-${source.id}`}
                        >
                          <div className="relative">
                            <IconComponent className={cn("h-4 w-4", isEnabled ? source.color : "text-muted-foreground/40")} />
                            <span 
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background",
                                connectionStatus.dotClass
                              )}
                              data-testid={`status-${source.id}`}
                            />
                          </div>
                          <div>
                            <span className={cn("text-xs font-medium", !isEnabled && "text-muted-foreground/60")}>
                              {source.name}
                            </span>
                            {!isConfigured && (
                              <AlertTriangle className="h-3 w-3 text-yellow-500 ml-1 inline" />
                            )}
                          </div>
                        </button>
                      </ProviderHealthPopover>
                      <div className="flex items-center gap-1.5">
                        {isEnabled && weight > 0 && (
                          <span className={cn("text-[10px] font-mono", source.color)}>
                            {weight}%
                          </span>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSettingsProvider(source.provider);
                              }}
                              data-testid={`button-settings-${source.id}`}
                            >
                              <Settings className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Configure credentials</p>
                          </TooltipContent>
                        </Tooltip>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => handleToggleSource(source.id)}
                          className="scale-75"
                          data-testid={`switch-source-${source.id}`}
                        />
                      </div>
                    </div>
                    
                    {isEnabled && weight > 0 && (
                      <Slider
                        value={[weight]}
                        onValueChange={(v) => handleWeightChange(source.id, v[0])}
                        min={0}
                        max={100}
                        step={5}
                        className="w-full"
                        data-testid={`slider-weight-${source.id}`}
                      />
                    )}
                    
                    <p className="text-[10px] text-muted-foreground">
                      {source.description}
                    </p>
                    
                    {source.id !== DEFAULT_SOURCES[DEFAULT_SOURCES.length - 1].id && (
                      <Separator className="mt-2" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total Weight</span>
            <span className={cn(
              "font-mono font-medium",
              totalWeight === 100 ? "text-green-400" : "text-yellow-400"
            )}>
              {totalWeight}%
            </span>
          </div>
        </div>
      </PopoverContent>

      {settingsProvider && (() => {
        const source = DEFAULT_SOURCES.find(s => s.provider === settingsProvider);
        if (!source) return null;
        const integration = integrations.find(i => i.provider === settingsProvider);
        const integrationData: IntegrationData = {
          provider: settingsProvider,
          displayName: source.name,
          configured: isProviderConfigured(settingsProvider),
          verified: integration?.verified ?? false,
          lastVerifiedAt: (integration as any)?.last_verified_at,
          lastUsedAt: (integration as any)?.last_used_at,
          count24h: (integration as any)?.proof_of_use_count_24h ?? 0,
        };
        return (
          <ProviderSettingsDialog
            open={true}
            onOpenChange={(open) => !open && setSettingsProvider(null)}
            provider={settingsProvider}
            name={source.name}
            icon={source.icon}
            color={source.color}
            integrationData={integrationData}
          />
        );
      })()}
    </Popover>
  );
}
