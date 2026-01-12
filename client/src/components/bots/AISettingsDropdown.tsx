import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { Cpu, Zap, DollarSign, Clock, AlertTriangle, Loader2, HelpCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

export const FREQUENCY_OPTIONS_WITH_TOOLTIPS = [
  { value: "hourly", label: "Hourly", description: "Fast iteration, higher cost" },
  { value: "daily", label: "Daily", description: "Balanced (recommended)" },
  { value: "weekly", label: "Weekly", description: "Conservative, lower cost" },
  { value: "manual", label: "Manual Only", description: "No automatic evolution" },
];

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

export function AISettingsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
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
  const enabledCount = budgets.filter(b => b.is_enabled && !b.is_paused).length;

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

  return (
    <>
      <Popover open={isOpen} onOpenChange={(open) => {
        if (!confirmDialog.open) {
          setIsOpen(open);
        }
      }}>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm"
                className="gap-1.5 px-2"
                data-testid="button-ai-settings"
              >
                <Sparkles className="w-4 h-4" />
                <span className="text-xs text-muted-foreground">${totalSpend.toFixed(2)}</span>
              </Button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">AI Settings</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent className="w-80 p-0" align="end">
          <div className="p-3 border-b border-border">
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
          </div>

          <div className="p-3 space-y-4">
            {/* Evolution Frequency */}
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

            {/* Cost Efficiency Toggle */}
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

            {/* LLM Providers */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
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
                                "h-full rounded-full",
                                pct > 90 ? "bg-destructive" : pct > 70 ? "bg-amber-400" : "bg-emerald-400"
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

            {/* Cost Alerts */}
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
                  <TooltipContent side="right" className="max-w-[200px]">
                    <p className="text-xs">Maximum total LLM spending per month. AI evolution automatically pauses when this limit is reached to prevent runaway costs.</p>
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
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => {
        if (!open) handleDialogClose(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => handleDialogClose(false)}
              data-testid="button-cancel-confirm"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => handleDialogClose(true)}
              data-testid="button-confirm-action"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
