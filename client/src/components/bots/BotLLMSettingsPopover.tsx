import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap, Clock, AlertTriangle, Loader2, Settings, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface BotLLMSettingsPopoverProps {
  botId: string;
  botName: string;
  currentProvider?: string;
  strategyConfig?: {
    aiSettings?: BotAISettings;
    [key: string]: unknown;
  };
  trigger: React.ReactNode;
}

interface LLMBudget {
  provider: string;
  is_enabled: boolean;
  is_paused: boolean;
  is_auto_throttled: boolean;
}

interface BotAISettings {
  evolutionFrequency?: string;
  enabledProviders?: string[];
  useGlobalSettings?: boolean;
}

interface Bot {
  id: string;
  name: string;
  strategyConfig?: {
    aiSettings?: BotAISettings;
    [key: string]: unknown;
  };
}

const PROVIDER_CONFIG: Record<string, { name: string; color: string; model: string }> = {
  groq: { name: "Groq", color: "text-orange-400", model: "Llama 3.3 70B" },
  openai: { name: "OpenAI", color: "text-emerald-400", model: "GPT-4o" },
  anthropic: { name: "Anthropic", color: "text-amber-400", model: "Claude 3.5" },
  gemini: { name: "Gemini", color: "text-blue-400", model: "Gemini Pro" },
  xai: { name: "xAI", color: "text-purple-400", model: "Grok" },
  openrouter: { name: "OpenRouter", color: "text-pink-400", model: "Multi" },
};

const ALL_PROVIDERS = ["groq", "openai", "anthropic", "gemini", "xai", "openrouter"];

const FREQUENCY_OPTIONS = [
  { value: "global", label: "Use Global Setting" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "manual", label: "Manual Only" },
];

export function BotLLMSettingsPopover({ 
  botId, 
  botName,
  currentProvider,
  strategyConfig,
  trigger 
}: BotLLMSettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<BotAISettings>({
    useGlobalSettings: true,
    evolutionFrequency: "global",
    enabledProviders: ALL_PROVIDERS,
  });
  const [hasInitialized, setHasInitialized] = useState(false);
  const queryClient = useQueryClient();

  const { data: botData } = useQuery<{ success: boolean; data: Bot }>({
    queryKey: ["/api/bots", botId],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch bot");
      return response.json();
    },
    enabled: isOpen && !!botId,
    staleTime: 30000,
  });

  const { data: budgetsData } = useQuery<{ success: boolean; data: LLMBudget[] }>({
    queryKey: ["/api/llm-budgets"],
    queryFn: async () => {
      const response = await fetch("/api/llm-budgets", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch budgets");
      return response.json();
    },
    staleTime: 30000,
  });

  const globalBudgets = budgetsData?.data || [];
  const globalEnabledProviders = globalBudgets
    .filter(b => b.is_enabled && !b.is_paused)
    .map(b => b.provider);

  useEffect(() => {
    if (isOpen && !hasInitialized) {
      const existingConfig = strategyConfig || botData?.data?.strategyConfig;
      const existingSettings = existingConfig?.aiSettings;
      
      if (existingSettings) {
        setLocalSettings({
          useGlobalSettings: existingSettings.useGlobalSettings ?? true,
          evolutionFrequency: existingSettings.evolutionFrequency || "global",
          enabledProviders: existingSettings.enabledProviders || ALL_PROVIDERS,
        });
      } else {
        setLocalSettings({
          useGlobalSettings: true,
          evolutionFrequency: "global",
          enabledProviders: globalEnabledProviders.length > 0 ? globalEnabledProviders : ALL_PROVIDERS,
        });
      }
      setHasInitialized(true);
    }
  }, [isOpen, hasInitialized, strategyConfig, botData, globalEnabledProviders]);

  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false);
    }
  }, [isOpen]);

  const saveMutation = useMutation({
    mutationFn: async (settings: BotAISettings) => {
      const existingConfig = strategyConfig || botData?.data?.strategyConfig || {};
      const response = await fetch(`/api/bots/${botId}`, {
        method: "PATCH",
        body: JSON.stringify({
          strategyConfig: {
            ...existingConfig,
            aiSettings: settings,
          },
        }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to save settings");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId] });
      toast.success("Bot AI settings saved");
      setIsOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save settings");
    },
  });

  const handleToggleProvider = (provider: string) => {
    const current = localSettings.enabledProviders || [];
    const updated = current.includes(provider)
      ? current.filter(p => p !== provider)
      : [...current, provider];
    setLocalSettings({ ...localSettings, enabledProviders: updated, useGlobalSettings: false });
  };

  const handleResetToGlobal = () => {
    setLocalSettings({
      useGlobalSettings: true,
      evolutionFrequency: "global",
      enabledProviders: globalEnabledProviders.length > 0 ? globalEnabledProviders : ALL_PROVIDERS,
    });
  };

  const handleSave = () => {
    saveMutation.mutate(localSettings);
  };

  const effectiveProviders = localSettings.useGlobalSettings 
    ? globalEnabledProviders 
    : (localSettings.enabledProviders || []);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-medium">Bot AI Settings</span>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  data-testid={`button-reset-ai-settings-${botId}`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset AI Settings?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will reset all AI settings for this bot to use global defaults:
                    <ul className="list-disc ml-4 mt-2 space-y-1">
                      <li>Evolution frequency will match global setting</li>
                      <li>LLM provider preferences will be cleared</li>
                      <li>Bot will use the system-wide provider cascade</li>
                    </ul>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={handleResetToGlobal}
                    data-testid={`button-confirm-reset-ai-settings-${botId}`}
                  >
                    Reset to Global
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 truncate">
            {botName}
          </p>
        </div>

        <div className="p-3 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Use Global Settings</Label>
            <Switch
              checked={localSettings.useGlobalSettings}
              onCheckedChange={(checked) => 
                setLocalSettings({ ...localSettings, useGlobalSettings: checked })
              }
              className="scale-75"
              data-testid={`switch-global-settings-${botId}`}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Evolution Frequency
            </Label>
            <Select 
              value={localSettings.evolutionFrequency || "global"}
              onValueChange={(val) => 
                setLocalSettings({ 
                  ...localSettings, 
                  evolutionFrequency: val,
                  useGlobalSettings: val === "global",
                })
              }
              disabled={localSettings.useGlobalSettings}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-frequency-${botId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Zap className="h-3 w-3" />
              LLM Providers
              {localSettings.useGlobalSettings && (
                <Badge variant="secondary" className="h-4 text-[9px] px-1">Global</Badge>
              )}
            </Label>
            
            <div className="space-y-1.5">
              {Object.entries(PROVIDER_CONFIG).map(([key, config]) => {
                const isEnabled = effectiveProviders.includes(key);
                const globalBudget = globalBudgets.find(b => b.provider === key);
                const isThrottled = globalBudget?.is_auto_throttled;

                return (
                  <div 
                    key={key}
                    className={cn(
                      "flex items-center justify-between p-1.5 rounded-md border",
                      isEnabled ? "border-border" : "border-border/50 opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={() => handleToggleProvider(key)}
                        disabled={localSettings.useGlobalSettings}
                        className="scale-75"
                        data-testid={`switch-bot-provider-${key}-${botId}`}
                      />
                      <div className="flex items-center gap-1">
                        <span className={cn("text-xs font-medium", config.color)}>
                          {config.name}
                        </span>
                        {isThrottled && (
                          <AlertTriangle className="h-3 w-3 text-amber-400" />
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {config.model}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-border">
          <Button
            className="w-full h-8 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid={`button-save-ai-settings-${botId}`}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : null}
            Save Settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
