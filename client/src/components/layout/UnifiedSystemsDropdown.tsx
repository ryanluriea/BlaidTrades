import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Cpu, Zap, DollarSign, Clock, AlertTriangle, Loader2, HelpCircle, Play, Pause, Activity, Layers, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useStrategyLabAutonomousState, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { useStrategyLabDialog } from "@/contexts/StrategyLabDialogContext";
import {
  useGrokResearchState,
  useToggleGrokResearchState,
  getDepthLabel,
  type GrokResearchDepth,
  useOrchestratorStatus,
  useToggleFullSpectrum,
  useSetGrokResearchDepth,
  useTriggerGrokResearch,
} from "@/hooks/useGrokResearch";

interface LLMBudget {
  id: string | null;
  provider: string;
  monthly_limit_usd: number;
  current_month_spend_usd: number;
  is_enabled: boolean;
  is_paused: boolean;
  is_auto_throttled: boolean;
  priority: number;
}

const PROVIDER_CONFIG: Record<string, { name: string; color: string; model: string; researchOnly?: boolean }> = {
  perplexity: { name: "Perplexity", color: "text-cyan-400", model: "Sonar Large", researchOnly: true },
  groq: { name: "Groq", color: "text-orange-400", model: "Llama 3.3 70B" },
  openai: { name: "OpenAI", color: "text-emerald-400", model: "GPT-4o" },
  anthropic: { name: "Anthropic", color: "text-amber-400", model: "Claude Sonnet" },
  gemini: { name: "Gemini", color: "text-blue-400", model: "Gemini 2.0 Flash" },
  xai: { name: "xAI", color: "text-purple-400", model: "Grok 4.1" },
};

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Hourly", description: "Fast iteration, higher cost" },
  { value: "daily", label: "Daily", description: "Balanced (recommended)" },
  { value: "weekly", label: "Weekly", description: "Conservative, lower cost" },
  { value: "manual", label: "Manual Only", description: "No automatic evolution" },
];

export const AI_SETTINGS_STORAGE_KEY = "blaidagent_ai_settings";

export interface AISettingsData {
  evolutionFrequency: string;
  costCap: number;
  costEfficiencyMode: boolean;
}

export function loadAISettings(): AISettingsData {
  try {
    const stored = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { 
        evolutionFrequency: parsed.evolutionFrequency || "daily", 
        costCap: parsed.costCap || 50, 
        costEfficiencyMode: parsed.costEfficiencyMode === true 
      };
    }
  } catch {}
  return { evolutionFrequency: "daily", costCap: 50, costEfficiencyMode: false };
}

export function saveAISettings(settings: AISettingsData) {
  try {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new StorageEvent("storage", {
      key: AI_SETTINGS_STORAGE_KEY,
      newValue: JSON.stringify(settings),
    }));
  } catch {}
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

function EditableLimitInput({ 
  provider, 
  initialValue, 
  onSave 
}: { 
  provider: string; 
  initialValue: number; 
  onSave: (value: number, resetFn: () => void) => void;
}) {
  const [localValue, setLocalValue] = useState(String(initialValue));
  const [isDirty, setIsDirty] = useState(false);
  
  useEffect(() => {
    setLocalValue(String(initialValue));
    setIsDirty(false);
  }, [initialValue]);

  const resetToOriginal = () => {
    setLocalValue(String(initialValue));
    setIsDirty(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    setIsDirty(true);
  };

  const handleSave = () => {
    const numValue = parseFloat(localValue);
    if (!isNaN(numValue) && numValue > 0 && isDirty) {
      onSave(numValue, resetToOriginal);
    } else if (isDirty) {
      resetToOriginal();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      resetToOriginal();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onBlur={handleSave}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-5 w-14 px-1 text-[10px] font-mono text-right",
        isDirty && "border-amber-400"
      )}
      data-testid={`input-limit-${provider}`}
    />
  );
}

function EditableCostCapInput({ 
  initialValue, 
  onSave 
}: { 
  initialValue: number; 
  onSave: (value: number, resetFn: () => void) => void;
}) {
  const [localValue, setLocalValue] = useState(String(initialValue));
  const [isDirty, setIsDirty] = useState(false);
  
  useEffect(() => {
    setLocalValue(String(initialValue));
    setIsDirty(false);
  }, [initialValue]);

  const resetToOriginal = () => {
    setLocalValue(String(initialValue));
    setIsDirty(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    setIsDirty(true);
  };

  const handleSave = () => {
    const numValue = parseFloat(localValue);
    if (!isNaN(numValue) && numValue > 0 && isDirty) {
      onSave(numValue, resetToOriginal);
    } else if (isDirty) {
      resetToOriginal();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      resetToOriginal();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onBlur={handleSave}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-7 w-24 text-xs font-mono",
        isDirty && "border-amber-400"
      )}
      data-testid="input-cost-cap"
    />
  );
}

export function UnifiedSystemsDropdown({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("systems");
  const [evolutionFrequency, setEvolutionFrequency] = useState(() => loadAISettings().evolutionFrequency);
  const [costCap, setCostCap] = useState(() => loadAISettings().costCap);
  const [costEfficiencyMode, setCostEfficiencyMode] = useState(() => loadAISettings().costEfficiencyMode);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
    onCancel: undefined,
  });
  const queryClient = useQueryClient();

  const { data: strategyLabState } = useStrategyLabAutonomousState();
  const toggleStrategyLab = useToggleStrategyLabState();
  const { openSettings } = useStrategyLabDialog();
  
  const { data: grokState } = useGrokResearchState();
  const { data: orchestratorStatus } = useOrchestratorStatus();
  const toggleGrok = useToggleGrokResearchState();
  const setDepth = useSetGrokResearchDepth();
  const triggerResearch = useTriggerGrokResearch();
  const toggleFullSpectrum = useToggleFullSpectrum();

  const strategyLabPlaying = strategyLabState?.isPlaying ?? false;
  const adaptiveMode = strategyLabState?.adaptiveMode ?? "BALANCED";
  const qcEnabled = strategyLabState?.qcAutoTriggerEnabled ?? true;
  const qcDailyLimit = strategyLabState?.qcDailyLimit ?? 50;
  const qcWeeklyLimit = strategyLabState?.qcWeeklyLimit ?? 200;
  
  const grokEnabled = grokState?.enabled ?? false;
  const isFullSpectrum = orchestratorStatus?.isFullSpectrum ?? false;
  const grokDepth = isFullSpectrum ? "FULL_SPECTRUM" as GrokResearchDepth : (grokState?.depth ?? "CONTRARIAN_SCAN");

  const anyRunning = strategyLabPlaying || grokEnabled;

  const showConfirmation = (
    title: string, 
    description: string, 
    onConfirm: () => void,
    onCancel?: () => void
  ) => {
    setConfirmDialog({ open: true, title, description, onConfirm, onCancel });
  };

  const handleDialogClose = (confirmed: boolean) => {
    if (confirmed) {
      confirmDialog.onConfirm();
    } else if (confirmDialog.onCancel) {
      confirmDialog.onCancel();
    }
    setConfirmDialog(prev => ({ ...prev, open: false }));
  };

  const handleFrequencyChange = (value: string) => {
    const currentLabel = FREQUENCY_OPTIONS.find(o => o.value === evolutionFrequency)?.label || evolutionFrequency;
    const newLabel = FREQUENCY_OPTIONS.find(o => o.value === value)?.label || value;
    
    showConfirmation(
      "Change Evolution Frequency",
      `Change evolution frequency from "${currentLabel}" to "${newLabel}"? This affects how often AI analyzes and evolves your bot strategies.`,
      () => {
        setEvolutionFrequency(value);
        saveAISettings({ evolutionFrequency: value, costCap, costEfficiencyMode });
        toast.success(`Evolution frequency changed to ${newLabel}`);
      }
    );
  };

  const handleCostCapSave = (value: number, resetFn: () => void) => {
    showConfirmation(
      "Update Monthly Cost Cap",
      `Set the monthly AI cost cap to $${value}? All AI evolution will pause when this limit is reached.`,
      () => {
        setCostCap(value);
        saveAISettings({ evolutionFrequency, costCap: value, costEfficiencyMode });
        toast.success(`Monthly cost cap set to $${value}`);
      },
      resetFn
    );
  };
  
  const handleCostEfficiencyToggle = (enabled: boolean) => {
    const modeLabel = enabled ? "Cost Efficiency (cheaper models first)" : "Quality First (best models first)";
    
    showConfirmation(
      "Change AI Priority Mode",
      `Switch to ${modeLabel}? This changes the order in which AI providers are used for strategy evolution.`,
      async () => {
        setCostEfficiencyMode(enabled);
        saveAISettings({ evolutionFrequency, costCap, costEfficiencyMode: enabled });
        try {
          const response = await fetch("/api/ai-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ costEfficiencyMode: enabled }),
          });
          if (!response.ok) throw new Error("Failed to save");
          toast.success(enabled ? "Cost efficiency mode enabled" : "Quality mode enabled");
        } catch {
          toast.error("Failed to save AI settings");
          setCostEfficiencyMode(!enabled);
          saveAISettings({ evolutionFrequency, costCap, costEfficiencyMode: !enabled });
        }
      }
    );
  };
  
  useEffect(() => {
    const syncToBackend = async () => {
      const stored = loadAISettings();
      try {
        await fetch("/api/ai-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ costEfficiencyMode: stored.costEfficiencyMode }),
        });
      } catch {}
    };
    syncToBackend();
  }, []);

  const { data: budgetsData, isLoading: budgetsLoading } = useQuery<{ success: boolean; data: LLMBudget[] }>({
    queryKey: ["/api/llm-budgets"],
    queryFn: async () => {
      const response = await fetch("/api/llm-budgets", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch LLM budgets");
      return response.json();
    },
    staleTime: 30000,
  });

  const budgets = budgetsData?.data || [];
  const totalSpend = budgets.reduce((sum, b) => sum + (b.current_month_spend_usd || 0), 0);

  const toggleMutation = useMutation({
    mutationFn: async ({ provider, enabled }: { provider: string; enabled: boolean }) => {
      const response = await fetch(`/api/llm-budgets/${provider}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: enabled,
          isPaused: !enabled,
        }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update provider settings");
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm-budgets"] });
      const config = PROVIDER_CONFIG[variables.provider];
      toast.success(`${config?.name || variables.provider} ${variables.enabled ? "enabled" : "disabled"}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update provider settings");
    },
  });

  const updateLimitMutation = useMutation({
    mutationFn: async ({ provider, limit }: { provider: string; limit: number }) => {
      const response = await fetch(`/api/llm-budgets/${provider}`, {
        method: "PATCH",
        body: JSON.stringify({
          monthlyLimitUsd: limit,
        }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update limit");
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm-budgets"] });
      const config = PROVIDER_CONFIG[variables.provider];
      toast.success(`${config?.name || variables.provider} budget limit set to $${variables.limit}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update limit");
    },
  });

  const handleToggleProvider = (provider: string, currentEnabled: boolean) => {
    const config = PROVIDER_CONFIG[provider];
    const action = currentEnabled ? "Disable" : "Enable";
    
    showConfirmation(
      `${action} ${config?.name || provider}`,
      `${action} ${config?.name || provider} as an AI provider for strategy evolution?`,
      () => {
        toggleMutation.mutate({ provider, enabled: !currentEnabled });
      }
    );
  };

  const handleUpdateLimit = (provider: string, newLimit: number, resetFn: () => void) => {
    const config = PROVIDER_CONFIG[provider];
    
    showConfirmation(
      `Update ${config?.name || provider} Budget`,
      `Set ${config?.name || provider} monthly budget limit to $${newLimit}? The provider will be auto-throttled when this limit is reached.`,
      () => {
        updateLimitMutation.mutate({ provider, limit: newLimit });
      },
      resetFn
    );
  };

  const qcToggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch("/api/strategy-lab/state", {
        method: "PATCH",
        body: JSON.stringify({ qcAutoTriggerEnabled: enabled }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update QC settings");
      return response.json();
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/state"] });
      toast.success(enabled ? "QuantConnect verification enabled" : "QuantConnect verification disabled");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update QuantConnect settings");
    },
  });

  const handleQCToggle = (currentEnabled: boolean) => {
    const action = currentEnabled ? "Disable" : "Enable";
    
    showConfirmation(
      `${action} QuantConnect Verification`,
      currentEnabled 
        ? "Disable QuantConnect strategy verification? The Test column will be hidden in Strategy Lab."
        : "Enable QuantConnect verification for strategies? This uses QC compute credits.",
      () => {
        qcToggleMutation.mutate(!currentEnabled);
      }
    );
  };

  const getModeLabel = () => {
    switch (adaptiveMode) {
      case "SCANNING":
        return "Scanning";
      case "DEEP_RESEARCH":
        return "Deep";
      default:
        return "Balanced";
    }
  };

  const formatNextCycle = (ms: number | null | undefined): string => {
    if (!ms) return "Ready";
    const minutes = Math.ceil(ms / 60_000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  const handleStrategyLabToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStrategyLab.mutate(!strategyLabPlaying);
  };

  const handleGrokToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGrok.mutate(!grokEnabled);
  };

  const handleDepthChange = (newDepth: GrokResearchDepth) => {
    if (newDepth === "FULL_SPECTRUM") {
      toggleFullSpectrum.mutate(true);
    } else {
      if (isFullSpectrum) {
        toggleFullSpectrum.mutate(false);
      }
      setDepth.mutate(newDepth);
    }
  };

  const handleManualTrigger = () => {
    triggerResearch.mutate({});
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!confirmDialog.open) {
          setIsOpen(open);
        }
      }}>
        <Tooltip open={isOpen ? false : undefined}>
          <DialogTrigger asChild>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm"
                className={cn("gap-1.5 px-2 relative", className)}
                data-testid="button-unified-systems"
              >
                <Cpu className="w-4 h-4" />
                <span className="text-xs text-muted-foreground">${totalSpend.toFixed(2)}</span>
                <span
                  className={cn(
                    "absolute top-0.5 right-0.5 w-2 h-2 rounded-full",
                    anyRunning ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
              </Button>
            </TooltipTrigger>
          </DialogTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">AI & Autonomous Systems</p>
          </TooltipContent>
        </Tooltip>

        <DialogContent className="w-[32rem] max-w-[32rem] p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="p-2 border-b border-border">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="systems" className="text-xs" data-testid="tab-systems">
                  <Activity className="w-3 h-3 mr-1.5" />
                  Systems
                </TabsTrigger>
                <TabsTrigger value="ai" className="text-xs" data-testid="tab-ai-costs">
                  <DollarSign className="w-3 h-3 mr-1.5" />
                  AI Costs
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="systems" className="p-2 space-y-2 mt-0">
              <div className="px-2 py-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Autonomous Systems
                </span>
              </div>
              
              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-2 rounded-md border",
                  strategyLabPlaying ? "border-blue-500/50 bg-blue-500/10" : "border-border/50 bg-muted/30"
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={handleStrategyLabToggle}
                      disabled={toggleStrategyLab.isPending}
                      data-testid="button-strategy-lab-toggle"
                    >
                      {strategyLabPlaying ? (
                        <Pause className="w-3.5 h-3.5 text-blue-400" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-blue-400" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{strategyLabPlaying ? "Pause Strategy Lab" : "Start Strategy Lab"}</p>
                  </TooltipContent>
                </Tooltip>

                <button
                  type="button"
                  onClick={openSettings}
                  className="flex-1 flex items-center justify-between hover-elevate rounded px-1 py-0.5 cursor-pointer"
                  data-testid="button-strategy-lab-settings"
                >
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-blue-400" />
                    <span className="text-xs font-medium">Strategy Lab</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{getModeLabel()}</span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        strategyLabPlaying ? "text-emerald-400" : "text-muted-foreground"
                      )}
                    >
                      {strategyLabPlaying ? "Running" : "Paused"}
                    </span>
                  </div>
                </button>
              </div>

              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-2 rounded-md border",
                  grokEnabled ? "border-purple-500/50 bg-purple-500/10" : "border-border/50 bg-muted/30"
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={handleGrokToggle}
                      disabled={toggleGrok.isPending}
                      data-testid="button-grok-research-toggle"
                    >
                      {grokEnabled ? (
                        <Pause className="w-3.5 h-3.5 text-purple-400" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-purple-400" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{grokEnabled ? "Pause Grok Research" : "Start Grok Research"}</p>
                  </TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex-1 flex items-center justify-between hover-elevate rounded px-1 py-0.5 cursor-pointer"
                      data-testid="button-grok-depth-selector"
                    >
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-purple-400" />
                        <span className="text-xs font-medium">Grok Research</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">{getDepthLabel(grokDepth)}</span>
                        <span
                          className={cn(
                            "text-[10px] font-medium",
                            grokEnabled ? "text-purple-400" : "text-muted-foreground"
                          )}
                        >
                          {!grokEnabled ? "Paused" : isFullSpectrum
                            ? (() => {
                                const nextRunValues = (Object.values(orchestratorStatus?.nextRuns ?? {}).filter(v => v !== null) as number[])
                                  .filter(v => v >= 0)
                                  .concat([grokState?.nextCycleIn ?? 0].filter(v => v > 0));
                                return formatNextCycle(nextRunValues.length > 0 ? Math.min(...nextRunValues) : null);
                              })()
                            : formatNextCycle(grokState?.nextCycleIn)}
                        </span>
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={() => handleDepthChange("CONTRARIAN_SCAN")}
                      className={cn(grokDepth === "CONTRARIAN_SCAN" && "bg-accent")}
                      data-testid="menu-grok-depth-contrarian"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">Contrarian Scan</span>
                        <span className="text-xs text-muted-foreground">Find crowded trades (2h cycles)</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDepthChange("SENTIMENT_BURST")}
                      className={cn(grokDepth === "SENTIMENT_BURST" && "bg-accent")}
                      data-testid="menu-grok-depth-sentiment"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">Sentiment Burst</span>
                        <span className="text-xs text-muted-foreground">X/Twitter analysis (30min cycles)</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDepthChange("DEEP_REASONING")}
                      className={cn(grokDepth === "DEEP_REASONING" && "bg-accent")}
                      data-testid="menu-grok-depth-deep"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">Deep Reasoning</span>
                        <span className="text-xs text-muted-foreground">Institutional analysis (6h cycles)</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleDepthChange("FULL_SPECTRUM")}
                      className={cn(grokDepth === "FULL_SPECTRUM" && "bg-purple-500/20")}
                      data-testid="menu-grok-depth-full-spectrum"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-purple-400" />
                          <span className="font-medium text-purple-300">Full Spectrum</span>
                        </div>
                        <span className="text-xs text-muted-foreground">All 3 modes concurrent (staggered)</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleManualTrigger}
                      disabled={triggerResearch.isPending}
                      data-testid="menu-grok-manual-trigger"
                    >
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-purple-400" />
                        <span>{triggerResearch.isPending ? "Running..." : "Run Now"}</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TabsContent>

            <TabsContent value="ai" className="p-3 space-y-4 mt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium">AI Settings</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  <span>${totalSpend.toFixed(2)} this month</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Evolution Frequency
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px]">
                      <p className="text-xs">How often bots automatically evolve their strategies using AI. More frequent = faster learning but higher LLM costs.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={evolutionFrequency} onValueChange={handleFrequencyChange}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-evolution-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <DollarSign className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">Cost Efficiency</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[220px]">
                          <p className="text-xs">When enabled, tries cheaper models first (Groq, then OpenAI). When disabled, uses highest quality model first (Claude).</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {costEfficiencyMode ? "Groq first (cheaper)" : "Claude first (quality)"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={costEfficiencyMode}
                  onCheckedChange={handleCostEfficiencyToggle}
                  data-testid="switch-cost-efficiency"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5 text-yellow-400">
                    <Zap className="h-3 w-3" />
                    LLM Providers
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[220px]">
                      <p className="text-xs">AI providers used for strategy evolution. Toggle to enable/disable. Providers cascade in priority order when limits are reached.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                
                {budgetsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {budgets.filter(b => b.provider !== 'openrouter').map((budget) => {
                      const config = PROVIDER_CONFIG[budget.provider] || { 
                        name: budget.provider, 
                        color: "text-muted-foreground",
                        model: "Unknown"
                      };
                      const isEnabled = budget.is_enabled && !budget.is_paused;
                      const spend = budget.current_month_spend_usd || 0;
                      const limit = budget.monthly_limit_usd || 10;
                      const pct = Math.min((spend / limit) * 100, 100);

                      return (
                        <div 
                          key={budget.provider}
                          className={cn(
                            "flex items-center justify-between p-2 rounded-md border",
                            isEnabled ? "border-border" : "border-border/50 opacity-60"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={() => handleToggleProvider(budget.provider, isEnabled)}
                              className="scale-75"
                              data-testid={`switch-provider-${budget.provider}`}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-xs font-medium", config.color)}>
                                  {config.name}
                                </span>
                                {config.researchOnly && (
                                  <Badge variant="outline" className="h-3.5 px-1 text-[8px] border-cyan-400/50 text-cyan-400">
                                    Research
                                  </Badge>
                                )}
                                {budget.is_auto_throttled && (
                                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {config.model}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="flex items-center gap-1 text-[10px] font-mono">
                              <span className={pct > 90 ? "text-destructive" : ""}>${spend.toFixed(2)}</span>
                              <span className="text-muted-foreground">/</span>
                              <EditableLimitInput
                                provider={budget.provider}
                                initialValue={limit}
                                onSave={(value, resetFn) => handleUpdateLimit(budget.provider, value, resetFn)}
                              />
                            </div>
                            <div className="w-16 h-1 bg-muted rounded-full mt-0.5">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  pct > 90 ? "bg-destructive" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5 text-cyan-400">
                    <FlaskConical className="h-3 w-3" />
                    QC Verification
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[220px]">
                      <p className="text-xs">Use QuantConnect to verify strategies before deployment. Uses QC compute credits. Disable to hide the Test column in Strategy Lab.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                
                <div 
                  className={cn(
                    "flex items-center justify-between p-2 rounded-md border",
                    qcEnabled ? "border-cyan-500/50 bg-cyan-500/5" : "border-border/50 opacity-60"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={qcEnabled}
                      onCheckedChange={() => handleQCToggle(qcEnabled)}
                      disabled={qcToggleMutation.isPending}
                      className="scale-75"
                      data-testid="switch-qc-enabled"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-xs font-medium", qcEnabled ? "text-cyan-400" : "text-muted-foreground")}>
                          QuantConnect
                        </span>
                        {qcEnabled && (
                          <Badge variant="outline" className="h-3.5 px-1 text-[8px] border-cyan-400/50 text-cyan-400">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {qcEnabled ? `Daily: ${qcDailyLimit} / Weekly: ${qcWeeklyLimit}` : "Verification disabled"}
                      </p>
                    </div>
                  </div>
                  {qcEnabled && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-muted-foreground">
                        Compute credits
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <DollarSign className="h-3 w-3" />
                    Monthly Cost Cap
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[220px]">
                      <p className="text-xs">Total monthly spending limit across all AI providers. All AI evolution will pause when this limit is reached.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">$</span>
                  <EditableCostCapInput
                    initialValue={costCap}
                    onSave={handleCostCapSave}
                  />
                  <span className="text-xs text-muted-foreground">/ month</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Auto-pause all AI evolution when reached
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => !open && handleDialogClose(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleDialogClose(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDialogClose(true)}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
