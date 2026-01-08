import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, TrendingUp, Database, Newspaper, Calendar, Loader2, Check, AlertTriangle, Sparkles, Lock, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { loadSourcesSettings, type SignalSourceConfig } from "./SourcesSettingsDropdown";

export interface BotSignalSourcesConfig {
  useGlobalSettings: boolean;
  sources: Record<string, { enabled: boolean; weight: number }>;
}

interface AdaptiveWeightsData {
  weights: {
    options_flow: number;
    macro_indicators: number;
    news_sentiment: number;
    economic_calendar: number;
  };
  adjustments: Array<{
    sourceId: string;
    previousWeight: number;
    newWeight: number;
    reason: string;
    confidence: number;
  }>;
  lastOptimized: string;
  confidence: number;
  regime: string;
}

interface PerBotSourcesDialogProps {
  botId: string;
  botName: string;
  currentConfig?: BotSignalSourcesConfig;
  strategyConfig?: Record<string, unknown>;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULT_SOURCES: SignalSourceConfig[] = [
  {
    id: "options_flow",
    name: "Options Flow",
    enabled: true,
    weight: 40,
    icon: TrendingUp,
    color: "text-green-400",
    description: "Unusual Whales options order flow",
    provider: "unusual_whales",
  },
  {
    id: "macro_indicators",
    name: "Macro Indicators",
    enabled: true,
    weight: 35,
    icon: Database,
    color: "text-amber-400",
    description: "FRED economic data",
    provider: "fred",
  },
  {
    id: "news_sentiment",
    name: "News Sentiment",
    enabled: true,
    weight: 25,
    icon: Newspaper,
    color: "text-cyan-400",
    description: "Multi-provider news aggregation",
    provider: "news_api,marketaux,finnhub",
  },
  {
    id: "economic_calendar",
    name: "Economic Calendar",
    enabled: true,
    weight: 0,
    icon: Calendar,
    color: "text-purple-400",
    description: "High-impact economic events",
    provider: "fmp",
  },
];

export function PerBotSourcesDialog({ 
  botId, 
  botName, 
  currentConfig, 
  strategyConfig,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: PerBotSourcesDialogProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange || (() => {})) : setInternalOpen;
  const [useGlobalSettings, setUseGlobalSettings] = useState(
    currentConfig?.useGlobalSettings ?? false
  );
  const [sources, setSources] = useState<Record<string, { enabled: boolean; weight: number }>>(() => {
    if (currentConfig?.sources) {
      return currentConfig.sources;
    }
    const globalSettings = loadSourcesSettings();
    return globalSettings.sources;
  });

  const { data: adaptiveWeights, isLoading: weightsLoading } = useQuery<AdaptiveWeightsData>({
    queryKey: ["/api/signals/adaptive-weights", botId],
    queryFn: async () => {
      const response = await fetch(`/api/signals/adaptive-weights?botId=${botId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch adaptive weights");
      const data = await response.json();
      return data.data || data;
    },
    staleTime: 60000,
    enabled: open,
  });

  const { data: integrationStatus } = useQuery<{
    success: boolean;
    data: { integrations: Array<{ provider: string; configured: boolean; connected: boolean }> };
  }>({
    queryKey: ["/api/integrations/status"],
    queryFn: async () => {
      const response = await fetch("/api/integrations/status", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch integration status");
      return response.json();
    },
    staleTime: 60000,
  });

  const integrations = integrationStatus?.data?.integrations || [];

  const isProviderConfigured = (providerList: string): boolean => {
    const providers = providerList.split(",").map(p => p.trim());
    return providers.some(provider => {
      const integration = integrations.find(i => i.provider === provider);
      return integration?.configured ?? false;
    });
  };

  const updateBotMutation = useMutation({
    mutationFn: async (newConfig: BotSignalSourcesConfig) => {
      const updatedStrategyConfig = {
        ...strategyConfig,
        signalSources: newConfig,
      };
      const response = await fetch(`/api/bots/${botId}`, {
        method: "PATCH",
        body: JSON.stringify({ strategyConfig: updatedStrategyConfig }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update bot");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots-overview"] });
      toast.success(`Signal sources updated for ${botName}`);
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  const handleToggleSource = (sourceId: string) => {
    setSources(prev => ({
      ...prev,
      [sourceId]: {
        ...prev[sourceId],
        enabled: !prev[sourceId]?.enabled,
      },
    }));
  };

  const handleSave = () => {
    const updatedSources = { ...sources };
    if (adaptiveWeights?.weights) {
      for (const [key, weight] of Object.entries(adaptiveWeights.weights)) {
        if (updatedSources[key]) {
          updatedSources[key].weight = Math.round(weight * 100);
        }
      }
    }
    updateBotMutation.mutate({
      useGlobalSettings,
      sources: updatedSources,
    });
  };

  const handleUseGlobalToggle = (checked: boolean) => {
    setUseGlobalSettings(checked);
    if (checked) {
      const globalSettings = loadSourcesSettings();
      setSources(globalSettings.sources);
    }
  };

  const getAdaptiveWeight = (sourceId: string): number => {
    if (adaptiveWeights?.weights) {
      const weight = adaptiveWeights.weights[sourceId as keyof typeof adaptiveWeights.weights];
      return weight ? Math.round(weight * 100) : 0;
    }
    return sources[sourceId]?.weight || 0;
  };

  const enabledCount = Object.values(sources).filter(s => s.enabled).length;

  const formatLastOptimized = (dateStr?: string): string => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button 
              variant="ghost" 
              size="icon"
              data-testid={`button-bot-sources-${botId}`}
            >
              <Activity className="h-4 w-4" />
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            Signal Sources
          </DialogTitle>
          <DialogDescription>
            Configure signal sources for <span className="font-medium text-foreground">{botName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between gap-4 p-3 bg-muted/30 rounded-md">
            <div className="flex-1">
              <Label htmlFor="use-global" className="text-sm font-medium">
                Use Global Settings
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Inherit settings from global configuration
              </p>
            </div>
            <Switch
              id="use-global"
              checked={useGlobalSettings}
              onCheckedChange={handleUseGlobalToggle}
              data-testid="switch-use-global-sources"
            />
          </div>

          {!useGlobalSettings && (
            <>
              <Separator />

              <div className="flex items-center justify-between gap-2 p-3 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-md border border-blue-500/20">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium">Adaptive Weights</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {weightsLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatLastOptimized(adaptiveWeights?.lastOptimized)}
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Last optimization</p>
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="secondary" className="text-[10px] px-1.5">
                        {adaptiveWeights?.confidence?.toFixed(0) || 0}% confidence
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {adaptiveWeights?.regime || "UNKNOWN"}
                      </Badge>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {enabledCount} of {DEFAULT_SOURCES.length} sources enabled
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Weights auto-optimized
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px]">
                    <p className="text-xs">
                      Weights are automatically optimized based on backtest performance. 
                      Toggle sources on/off to control which signals are used.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="space-y-3">
                {DEFAULT_SOURCES.map((source) => {
                  const IconComponent = source.icon;
                  const isConfigured = isProviderConfigured(source.provider);
                  const currentSource = sources[source.id] || { enabled: source.enabled, weight: source.weight };
                  const adaptiveWeight = getAdaptiveWeight(source.id);

                  return (
                    <div
                      key={source.id}
                      className={cn(
                        "p-3 rounded-md border bg-card/50 space-y-2",
                        !currentSource.enabled && "opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <IconComponent className={cn("h-4 w-4 shrink-0", source.color)} />
                          <span className="text-sm font-medium truncate">{source.name}</span>
                          {isConfigured ? (
                            <Check className="h-3 w-3 text-green-400 shrink-0" />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Provider not configured</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Switch
                          checked={currentSource.enabled}
                          onCheckedChange={() => handleToggleSource(source.id)}
                          data-testid={`switch-source-${source.id}`}
                        />
                      </div>

                      {currentSource.enabled && (
                        <div className="flex items-center gap-3">
                          <Progress 
                            value={adaptiveWeight} 
                            className="flex-1 h-2" 
                          />
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3 text-blue-400" />
                            <span className="text-xs font-mono w-10 text-right text-muted-foreground">
                              {adaptiveWeight}%
                            </span>
                          </div>
                        </div>
                      )}

                      <p className="text-[11px] text-muted-foreground">
                        {source.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {adaptiveWeights?.adjustments && adaptiveWeights.adjustments.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded-md space-y-1">
                  <div className="font-medium text-foreground">Recent Adjustments:</div>
                  {adaptiveWeights.adjustments.slice(0, 2).map((adj, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-muted-foreground">{adj.sourceId}:</span>
                      <span>{Math.round(adj.previousWeight * 100)}%</span>
                      <span className="text-muted-foreground">-&gt;</span>
                      <span className="text-foreground">{Math.round(adj.newWeight * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {useGlobalSettings && (
            <>
              <div className="flex items-center justify-between gap-2 p-3 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-md border border-blue-500/20">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium">Adaptive Weights</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5">Read-only</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {weightsLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatLastOptimized(adaptiveWeights?.lastOptimized)}
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Last optimization</p>
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {adaptiveWeights?.regime || "UNKNOWN"}
                      </Badge>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {enabledCount} of {DEFAULT_SOURCES.length} sources active
                </span>
              </div>

              <div className="space-y-3">
                {DEFAULT_SOURCES.map((source) => {
                  const IconComponent = source.icon;
                  const isConfigured = isProviderConfigured(source.provider);
                  const currentSource = sources[source.id] || { enabled: source.enabled, weight: source.weight };
                  const adaptiveWeight = getAdaptiveWeight(source.id);

                  return (
                    <div
                      key={source.id}
                      className={cn(
                        "p-3 rounded-md border bg-card/50 space-y-2",
                        !currentSource.enabled && "opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <IconComponent className={cn("h-4 w-4 shrink-0", source.color)} />
                          <span className="text-sm font-medium truncate">{source.name}</span>
                          {isConfigured ? (
                            <Check className="h-3 w-3 text-green-400 shrink-0" />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Provider not configured</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Badge 
                          variant={currentSource.enabled ? "default" : "secondary"} 
                          className="text-[10px] px-1.5"
                        >
                          {currentSource.enabled ? "ON" : "OFF"}
                        </Badge>
                      </div>

                      {currentSource.enabled && (
                        <div className="flex items-center gap-3">
                          <Progress 
                            value={adaptiveWeight} 
                            className="flex-1 h-2" 
                          />
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3 text-blue-400" />
                            <span className="text-xs font-mono w-10 text-right text-muted-foreground">
                              {adaptiveWeight}%
                            </span>
                          </div>
                        </div>
                      )}

                      <p className="text-[11px] text-muted-foreground">
                        {source.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="text-xs text-muted-foreground text-center py-2 bg-muted/30 rounded-md">
                Using global configuration. Toggle off to customize for this bot.
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={updateBotMutation.isPending}
            data-testid="button-save-bot-sources"
          >
            {updateBotMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function getBotSignalSources(strategyConfig?: Record<string, unknown>): BotSignalSourcesConfig | null {
  if (!strategyConfig?.signalSources) return null;
  return strategyConfig.signalSources as BotSignalSourcesConfig;
}
