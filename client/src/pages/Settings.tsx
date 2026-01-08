import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/components/ThemeProvider";
import { useAppSettings, useUpdateAppSettings } from "@/hooks/useSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, ShieldCheck, Phone, MessageSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { use2FA } from "@/hooks/use2FA";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import http from "@/lib/http";
import { 
  Settings as SettingsIcon,
  Database,
  Building2,
  Shield,
  FlaskConical,
  Palette,
  FileText,
  Lock,
  Bell,
  Cpu,
  DollarSign,
  Clock,
  HelpCircle,
  LogOut,
  Cloud,
  User,
  Mail,
  Key,
  Eye,
  EyeOff,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  loadAISettings, 
  saveAISettings, 
  FREQUENCY_OPTIONS_WITH_TOOLTIPS,
  AI_SETTINGS_STORAGE_KEY,
} from "@/components/bots/AISettingsDropdown";

// LLM Budget types and component
interface LLMBudget {
  id: string | null;
  userId: string;
  provider: string;
  monthlyLimitUsd: number;
  currentMonthSpendUsd: number;
  isEnabled: boolean;
  isPaused: boolean;
  isAutoThrottled: boolean;
  priority: number;
}

const PROVIDER_CONFIG: Record<string, { name: string; color: string; models: string }> = {
  groq: { name: "Groq", color: "text-orange-400", models: "Llama 3.3 70B" },
  openai: { name: "OpenAI", color: "text-green-400", models: "GPT-4o" },
  anthropic: { name: "Anthropic", color: "text-amber-400", models: "Claude 3.5 Sonnet" },
  gemini: { name: "Google", color: "text-blue-400", models: "Gemini 2.0 Flash" },
  xai: { name: "xAI", color: "text-purple-400", models: "Grok-beta" },
  openrouter: { name: "OpenRouter", color: "text-pink-400", models: "Fallback" },
};

function LLMBudgetSection() {
  const queryClient = useQueryClient();
  const [evolutionFrequency, setEvolutionFrequency] = useState(() => loadAISettings().evolutionFrequency);
  const [costCap, setCostCap] = useState(() => loadAISettings().costCap);

  // Sync with localStorage changes from other components
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AI_SETTINGS_STORAGE_KEY && e.newValue) {
        try {
          const settings = JSON.parse(e.newValue);
          setEvolutionFrequency(settings.evolutionFrequency);
          setCostCap(settings.costCap);
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleFrequencyChange = (value: string) => {
    setEvolutionFrequency(value);
    saveAISettings({ evolutionFrequency: value, costCap });
    toast.success("Evolution frequency updated");
  };

  const handleCostCapChange = (value: number[]) => {
    const cap = value[0];
    setCostCap(cap);
    saveAISettings({ evolutionFrequency, costCap: cap });
  };
  
  const { data: budgetsData, isLoading } = useQuery<{ success: boolean; data: LLMBudget[] }>({
    queryKey: ["/api/llm-budgets"],
    queryFn: async () => {
      const response = await fetch("/api/llm-budgets", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch LLM budgets");
      return response.json();
    },
    staleTime: 30000,
  });

  const updateBudget = useMutation({
    mutationFn: async ({ provider, data }: { provider: string; data: Partial<LLMBudget> }) => {
      const response = await fetch(`/api/llm-budgets/${provider}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update budget");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm-budgets"] });
      toast.success("Budget updated");
    },
    onError: (err: any) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  const resetMonthly = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/llm-budgets/reset-monthly", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to reset budgets");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm-budgets"] });
      toast.success("Monthly spend reset");
    },
  });

  const budgets = budgetsData?.data || [];
  const totalSpend = budgets.reduce((sum, b) => sum + (b.currentMonthSpendUsd || 0), 0);
  const totalLimit = budgets.reduce((sum, b) => sum + (b.monthlyLimitUsd || 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-purple-400" />
            <span className="font-medium">Monthly LLM Spend</span>
          </div>
          <p className="text-2xl font-mono font-bold mt-1">
            ${totalSpend.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">/ ${totalLimit.toFixed(0)}</span>
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => resetMonthly.mutate()}
          disabled={resetMonthly.isPending}
        >
          {resetMonthly.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          Reset Month
        </Button>
      </div>

      {/* Evolution Frequency & Cost Cap */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            <span className="font-medium text-sm">Evolution Frequency</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                <p className="text-xs">How often bots automatically evolve their strategies using AI. More frequent = faster learning but higher LLM costs.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select value={evolutionFrequency} onValueChange={handleFrequencyChange}>
            <SelectTrigger className="w-full" data-testid="select-evolution-frequency-settings">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS_WITH_TOOLTIPS.map((opt) => (
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

        <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-purple-400" />
            <span className="font-medium text-sm">Monthly Cost Cap</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[200px]">
                <p className="text-xs">Maximum total LLM spending per month. AI evolution automatically pauses when this limit is reached.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              value={[costCap]}
              onValueChange={handleCostCapChange}
              max={200}
              min={5}
              step={5}
              className="flex-1"
              data-testid="slider-cost-cap-settings"
            />
            <span className="text-sm font-mono font-bold w-14 text-right">${costCap}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-pause all AI evolution when reached
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {budgets.map((budget) => {
          const config = PROVIDER_CONFIG[budget.provider] || { name: budget.provider, color: "text-foreground", models: "" };
          const spendPct = budget.monthlyLimitUsd > 0 ? (budget.currentMonthSpendUsd / budget.monthlyLimitUsd) * 100 : 0;
          const isOverBudget = spendPct >= 100;

          return (
            <div 
              key={budget.provider}
              className={cn(
                "p-4 rounded-lg border",
                !budget.isEnabled && "opacity-50",
                budget.isAutoThrottled && "border-amber-500/50 bg-amber-500/5",
                isOverBudget && "border-red-500/50 bg-red-500/5"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Cpu className={cn("w-5 h-5 shrink-0", config.color)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{config.name}</span>
                      {budget.isAutoThrottled && (
                        <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[10px]">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Throttled
                        </Badge>
                      )}
                      {budget.isPaused && (
                        <Badge variant="outline" className="text-red-400 border-red-500/30 text-[10px]">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{config.models}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-mono">
                      ${(budget.currentMonthSpendUsd || 0).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      / ${budget.monthlyLimitUsd}
                    </p>
                  </div>
                  <Switch
                    checked={budget.isEnabled && !budget.isPaused}
                    onCheckedChange={(checked) => {
                      updateBudget.mutate({
                        provider: budget.provider,
                        data: checked 
                          ? { isEnabled: true, isPaused: false } 
                          : { isEnabled: false },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <Progress 
                  value={Math.min(spendPct, 100)} 
                  className={cn(
                    "h-1.5",
                    isOverBudget ? "[&>div]:bg-red-500" : spendPct > 80 ? "[&>div]:bg-amber-500" : ""
                  )}
                />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Label className="text-xs text-muted-foreground">Limit:</Label>
                <Select
                  value={String(budget.monthlyLimitUsd)}
                  onValueChange={(v) => {
                    updateBudget.mutate({
                      provider: budget.provider,
                      data: { monthlyLimitUsd: parseInt(v) },
                    });
                  }}
                >
                  <SelectTrigger className="w-24 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">$5</SelectItem>
                    <SelectItem value="10">$10</SelectItem>
                    <SelectItem value="25">$25</SelectItem>
                    <SelectItem value="50">$50</SelectItem>
                    <SelectItem value="100">$100</SelectItem>
                    <SelectItem value="250">$250</SelectItem>
                  </SelectContent>
                </Select>

                <Label className="text-xs text-muted-foreground ml-auto">Priority:</Label>
                <Select
                  value={String(budget.priority)}
                  onValueChange={(v) => {
                    updateBudget.mutate({
                      provider: budget.provider,
                      data: { priority: parseInt(v) },
                    });
                  }}
                >
                  <SelectTrigger className="w-16 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1st</SelectItem>
                    <SelectItem value="2">2nd</SelectItem>
                    <SelectItem value="3">3rd</SelectItem>
                    <SelectItem value="4">4th</SelectItem>
                    <SelectItem value="5">5th</SelectItem>
                    <SelectItem value="6">6th</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
        <p className="text-xs text-muted-foreground">
          LLM providers are tried in priority order. If a provider is over budget or paused, 
          the next available provider is used. Auto-throttle activates when spend exceeds the monthly limit.
        </p>
      </div>
    </div>
  );
}

// Cloud Backup Section Component for Google Drive backup
function CloudBackupSection() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);

  const { data: dashboardData, isLoading, refetch } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/cloud-backup/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/cloud-backup/dashboard", { credentials: "include" });
      if (res.status === 401) {
        return { success: true, data: { connected: false } };
      }
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5000,
  });

  const { data: statusData } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/cloud-backup/status"],
    queryFn: async () => {
      const res = await fetch("/api/cloud-backup/status", { credentials: "include" });
      if (res.status === 401) {
        return { success: true, data: { connected: false, backingUp: false } };
      }
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: configData } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/cloud-backup/config"],
    queryFn: async () => {
      const res = await fetch("/api/cloud-backup/config", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 30000,
  });

  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cloud-backup/create", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast.success("Backup created successfully");
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/status"] });
    },
    onError: (error: any) => {
      toast.error(`Backup failed: ${error.message}`);
    },
  });

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/auth/google-drive/authorize", { credentials: "include" });
      const data = await res.json();
      
      if (data.success && data.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        toast.error(data.message || "Could not start Google Drive authorization");
        setIsConnecting(false);
      }
    } catch (error) {
      toast.error(String(error));
      setIsConnecting(false);
    }
  };

  const dashboard = dashboardData?.data;
  const backupStatus = statusData?.data;
  const config = configData?.data;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!dashboard?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            Cloud Backup
          </CardTitle>
          <CardDescription>
            Connect Google Drive to automatically backup your bots, strategies, and settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Cloud className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium">Connect to Google Drive</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Link your Google Drive to automatically backup your bots, strategies, and settings to the cloud.
              </p>
            </div>
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="gap-2"
              data-testid="button-connect-google-drive"
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Cloud className="w-4 h-4" />
              )}
              {isConnecting ? "Connecting..." : "Connect Google Drive"}
            </Button>
            <p className="text-xs text-muted-foreground">
              You will be redirected to authorize BlaidTrades to access your Drive.
            </p>
            {config?.redirectUri && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50 border max-w-md">
                <p className="text-xs font-medium mb-1">OAuth Redirect URI (for Google Cloud Console):</p>
                <code className="text-xs text-muted-foreground break-all">{config.redirectUri}</code>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="w-5 h-5" />
          Cloud Backup
          <Badge variant="outline" className="ml-auto gap-1">
            {backupStatus?.backingUp || createBackupMutation.isPending ? (
              <><Loader2 className="w-3 h-3 animate-spin" />Backing up...</>
            ) : dashboard?.status?.backupCount > 0 ? (
              <><CheckCircle2 className="w-3 h-3 text-emerald-500" />{dashboard.status.backupCount} backups</>
            ) : (
              <><Clock className="w-3 h-3" />No backups yet</>
            )}
          </Badge>
        </CardTitle>
        <CardDescription>
          Your data is connected to Google Drive for cloud backup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-md border bg-muted/30">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Database className="w-4 h-4" />
              Total Backups
            </div>
            <div className="text-2xl font-bold">{dashboard.status?.backupCount || 0}</div>
          </div>
          <div className="p-4 rounded-md border bg-muted/30">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              Last Backup
            </div>
            <div className="text-sm font-medium">
              {dashboard.status?.latestBackup?.createdTime 
                ? new Date(dashboard.status.latestBackup.createdTime).toLocaleDateString()
                : "Never"}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending || backupStatus?.backingUp}
            className="gap-2"
            data-testid="button-create-backup"
          >
            {createBackupMutation.isPending || backupStatus?.backingUp ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Cloud className="w-4 h-4" />
            )}
            Create Backup Now
          </Button>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-backup-status">
            Refresh Status
          </Button>
        </div>

        {config?.redirectUri && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs font-medium mb-1">OAuth Redirect URI (for Google Cloud Console):</p>
            <code className="text-xs text-muted-foreground break-all">{config.redirectUri}</code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Data Migration Section Component for export/import
function DataMigrationSection() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: { bots: number; botGenerations: number; strategyArchetypes: number; strategyCandidates: number; accounts: number };
    errors: string[];
  } | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/data-migration/export", { credentials: "include" });
      if (!response.ok) throw new Error("Export failed");
      
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blaidtrades-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`Exported ${data.bots?.length || 0} bots and ${data.strategyCandidates?.length || 0} strategies`);
    } catch (error: any) {
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.version) {
        throw new Error("Invalid export file: missing version field");
      }
      
      const response = await fetch("/api/data-migration/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setImportResult(result.data);
        const imported = result.data.imported;
        toast.success(`Imported ${imported.bots} bots, ${imported.botGenerations} generations, ${imported.strategyCandidates} strategies`);
      } else {
        throw new Error(result.message || "Import failed");
      }
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          Data Migration
        </CardTitle>
        <CardDescription>
          Export your bots and strategies to a file, or import from another environment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium mb-2">Export Data</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Download all your bots, strategies, archetypes, and accounts as a JSON file.
              Use this to backup your data or transfer to another environment.
            </p>
            <Button onClick={handleExport} disabled={isExporting} data-testid="button-export-data">
              {isExporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isExporting ? "Exporting..." : "Export All Data"}
            </Button>
          </div>

          <div className="p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium mb-2">Import Data</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a previously exported JSON file to import bots and strategies.
              Existing items with the same ID will be skipped.
            </p>
            <div className="flex items-center gap-4">
              <label htmlFor="import-file">
                <Button asChild disabled={isImporting}>
                  <span data-testid="button-import-data">
                    {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {isImporting ? "Importing..." : "Choose File to Import"}
                  </span>
                </Button>
              </label>
              <input
                id="import-file"
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
                disabled={isImporting}
                data-testid="input-import-file"
              />
            </div>
          </div>

          {importResult && (
            <div className={cn(
              "p-4 rounded-lg border",
              importResult.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
            )}>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                {importResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                )}
                Import Results
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Bots: {importResult.imported.bots}</div>
                <div>Generations: {importResult.imported.botGenerations}</div>
                <div>Archetypes: {importResult.imported.strategyArchetypes}</div>
                <div>Strategies: {importResult.imported.strategyCandidates}</div>
                <div>Accounts: {importResult.imported.accounts}</div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  <p className="font-medium text-red-400">{importResult.errors.length} errors:</p>
                  <ul className="list-disc list-inside mt-1 max-h-32 overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>...and {importResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <p className="text-xs text-muted-foreground">
            <strong>Tip:</strong> To migrate data from development to production, export here 
            in dev, then navigate to the production deployment and import the file there.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Profile Section Component for account management
function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || "");
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const handleUpdateUsername = async () => {
    if (!newUsername.trim()) {
      toast.error("Username is required");
      return;
    }
    
    setIsUpdatingUsername(true);
    try {
      // Fetch CSRF token first
      const csrfRes = await fetch("/api/auth/csrf-token", { credentials: "include" });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken;

      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({ username: newUsername.trim() }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update username");
      }
      
      toast.success("Username updated successfully");
      setIsEditingUsername(false);
      refreshUser?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to update username");
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.trim() || !emailPassword) {
      toast.error("Please fill in all fields");
      return;
    }
    
    setIsUpdatingEmail(true);
    try {
      // Fetch CSRF token first
      const csrfRes = await fetch("/api/auth/csrf-token", { credentials: "include" });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken;

      const response = await fetch("/api/auth/email", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword: emailPassword }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update email");
      }
      
      toast.success("Email updated successfully");
      setShowChangeEmail(false);
      setNewEmail("");
      setEmailPassword("");
      refreshUser?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to update email");
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
      toast.error("Password must contain uppercase, lowercase, and a number");
      return;
    }
    
    setIsUpdatingPassword(true);
    try {
      // Fetch CSRF token first
      const csrfRes = await fetch("/api/auth/csrf-token", { credentials: "include" });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken;

      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to change password");
      }
      
      toast.success("Password changed successfully");
      setShowChangePassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast.error(error.message || "Failed to change password");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            {isEditingUsername ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  className="max-w-[200px]"
                  data-testid="input-username"
                />
                <Button 
                  size="sm" 
                  onClick={handleUpdateUsername}
                  disabled={isUpdatingUsername}
                  data-testid="button-save-username"
                >
                  {isUpdatingUsername && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  Save
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => {
                    setIsEditingUsername(false);
                    setNewUsername(user?.username || "");
                  }}
                  data-testid="button-cancel-username"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-medium" data-testid="text-username">{user?.username || "No username"}</span>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => setIsEditingUsername(true)}
                  data-testid="button-edit-username"
                >
                  Edit
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="font-medium flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Email Address
        </h4>
        
        {showChangeEmail ? (
          <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
            <div className="space-y-2">
              <Label htmlFor="new-email">New Email</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter new email"
                data-testid="input-new-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-password">Current Password</Label>
              <Input
                id="email-password"
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Enter your password to confirm"
                data-testid="input-email-password"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleChangeEmail} 
                disabled={isUpdatingEmail}
                data-testid="button-confirm-email"
              >
                {isUpdatingEmail && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update Email
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => {
                  setShowChangeEmail(false);
                  setNewEmail("");
                  setEmailPassword("");
                }}
                data-testid="button-cancel-email"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
            <span className="text-sm" data-testid="text-email">{user?.email}</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowChangeEmail(true)}
              data-testid="button-change-email"
            >
              Change Email
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          Password
        </h4>
        
        {showChangePassword ? (
          <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  data-testid="input-current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  data-testid="button-toggle-current-password"
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  data-testid="input-new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  data-testid="button-toggle-new-password"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Min 8 characters with uppercase, lowercase, and number
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-confirm-password"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleChangePassword} 
                disabled={isUpdatingPassword}
                data-testid="button-confirm-password"
              >
                {isUpdatingPassword && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Change Password
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => {
                  setShowChangePassword(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                data-testid="button-cancel-password"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
            <span className="text-sm text-muted-foreground">Last changed: Never</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowChangePassword(true)}
              data-testid="button-change-password"
            >
              Change Password
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Security Section Component for 2FA setup
function SecuritySection() {
  const { user } = useAuth();
  const { 
    securitySettings, 
    isLoading: securityLoading,
    is2FARequired,
    enable2FA,
    isEnabling,
    disable2FA,
    isDisabling,
  } = use2FA();
  
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [verificationStep, setVerificationStep] = useState<"idle" | "sent" | "verifying">("idle");
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Get current phone from settings
  useEffect(() => {
    if (securitySettings && (securitySettings as any).phone_e164_encrypted) {
      // Phone is stored - just show masked version
      setPhoneNumber("***configured***");
    }
  }, [securitySettings]);

  // Express 2FA endpoints - SINGLE CONTROL PLANE (no Supabase Edge Functions)
  const handleSavePhone = async () => {
    if (!user || !phoneNumber || phoneNumber === "***configured***") return;
    
    // Clean and auto-format to E.164
    let cleanPhone = phoneNumber.replace(/[^+\d]/g, "");
    
    // Auto-add +1 for US numbers if not already in E.164 format
    if (!cleanPhone.startsWith("+")) {
      if (cleanPhone.length === 10) {
        cleanPhone = "+1" + cleanPhone;
      } else if (cleanPhone.length === 11 && cleanPhone.startsWith("1")) {
        cleanPhone = "+" + cleanPhone;
      } else {
        toast.error("Please enter a valid 10-digit US phone number");
        return;
      }
    }
    
    if (cleanPhone.length < 11) {
      toast.error("Please enter a valid phone number");
      return;
    }

    setIsSavingPhone(true);
    try {
      const response = await http.post<{ success: boolean; error?: string }>(
        "/api/auth/2fa/phone",
        { phone_e164: cleanPhone }
      );
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Failed to save phone");
      }
      toast.success("Phone number saved");
    } catch (err: any) {
      toast.error(`Failed to save phone: ${err.message}`);
    } finally {
      setIsSavingPhone(false);
    }
  };

  const handleSendCode = async () => {
    if (!user) return;
    setIsSending(true);
    try {
      // Express endpoint for 2FA setup (TOTP-based, not SMS)
      const response = await http.post<{ success: boolean; otpauth_url?: string; phone_last_4?: string; error?: string }>(
        "/api/auth/2fa/setup",
        {}
      );
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "2FA setup not available");
      }
      
      toast.success("2FA setup initiated");
      setVerificationStep("sent");
    } catch (err: any) {
      toast.error(`Failed to initiate 2FA: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerify = async () => {
    if (!user || code.length !== 6) return;
    setIsVerifying(true);
    try {
      const response = await http.post<{ success: boolean; backup_codes?: string[]; error?: string }>(
        "/api/auth/2fa/confirm",
        { code }
      );
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Invalid code");
      }
      
      // Enable 2FA after successful verification
      enable2FA();
      toast.success("2FA enabled successfully!");
      setVerificationStep("idle");
      setCode("");
    } catch (err: any) {
      toast.error(`Verification failed: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  if (securityLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const phoneConfigured = phoneNumber === "***configured***";

  return (
    <div className="space-y-8">
      {/* Status Card */}
      <div className={cn(
        "flex items-center justify-between p-4 rounded-lg border",
        is2FARequired 
          ? "bg-emerald-500/5 border-emerald-500/20" 
          : "bg-yellow-500/5 border-yellow-500/20"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-full",
            is2FARequired ? "bg-emerald-500/10" : "bg-yellow-500/10"
          )}>
            <Shield className={cn(
              "w-5 h-5",
              is2FARequired ? "text-emerald-400" : "text-yellow-400"
            )} />
          </div>
          <div>
            <p className="font-medium">
              {is2FARequired ? "2FA is Active" : "2FA Not Enabled"}
            </p>
            <p className="text-sm text-muted-foreground">
              {is2FARequired 
                ? "Your account is secured with SMS verification" 
                : "Enable 2FA to secure sensitive operations"}
            </p>
          </div>
        </div>
        {is2FARequired ? (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Protected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
            Required for Live Trading
          </Badge>
        )}
      </div>

      {/* Setup Steps */}
      <div className="space-y-6">
        {/* Step 1: Phone Number */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
              phoneConfigured 
                ? "bg-emerald-500/20 text-emerald-400" 
                : "bg-primary/20 text-primary"
            )}>
              {phoneConfigured ? <CheckCircle2 className="w-3.5 h-3.5" /> : "1"}
            </div>
            <Label className="text-sm font-medium">Phone Number</Label>
            {phoneConfigured && (
              <span className="text-xs text-emerald-400 ml-auto">Configured</span>
            )}
          </div>
          
          <div className="ml-8 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="phone"
                  placeholder="(555) 123-4567"
                  value={phoneConfigured ? "••••••••••" : phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={phoneConfigured}
                  className="pl-10"
                />
              </div>
              {!phoneConfigured ? (
                <Button 
                  onClick={handleSavePhone}
                  disabled={isSavingPhone || !phoneNumber}
                  size="default"
                >
                  {isSavingPhone ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  size="default"
                  onClick={() => setPhoneNumber("")}
                >
                  Change
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Enter your 10-digit US phone number. We'll add the country code automatically.
            </p>
          </div>
        </div>

        {/* Step 2: Verification */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
              is2FARequired 
                ? "bg-emerald-500/20 text-emerald-400" 
                : phoneConfigured
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
            )}>
              {is2FARequired ? <CheckCircle2 className="w-3.5 h-3.5" /> : "2"}
            </div>
            <Label className="text-sm font-medium">Verify & Enable</Label>
          </div>
          
          <div className="ml-8">
            {!is2FARequired ? (
              <div className="space-y-4">
                {verificationStep === "idle" && (
                  <Button 
                    onClick={handleSendCode} 
                    disabled={isSending || !phoneConfigured}
                    className="w-full sm:w-auto"
                  >
                    {isSending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <MessageSquare className="w-4 h-4 mr-2" />
                    )}
                    Send Verification Code
                  </Button>
                )}

                {verificationStep === "sent" && (
                  <div className="space-y-4 p-4 rounded-lg bg-muted/30 border border-border/50">
                    <div className="flex items-center gap-2 text-sm">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <span>Enter the 6-digit code sent to your phone</span>
                    </div>
                    <div className="flex justify-start">
                      <InputOTP maxLength={6} value={code} onChange={setCode}>
                        <InputOTPGroup>
                          <InputOTPSlot index={0} className="w-10 h-12" />
                          <InputOTPSlot index={1} className="w-10 h-12" />
                          <InputOTPSlot index={2} className="w-10 h-12" />
                          <InputOTPSlot index={3} className="w-10 h-12" />
                          <InputOTPSlot index={4} className="w-10 h-12" />
                          <InputOTPSlot index={5} className="w-10 h-12" />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button 
                        onClick={handleVerify} 
                        disabled={code.length !== 6 || isVerifying}
                      >
                        {isVerifying ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                        )}
                        Verify & Enable
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={handleSendCode} 
                        disabled={isSending}
                      >
                        Resend Code
                      </Button>
                    </div>
                  </div>
                )}

                {!phoneConfigured && (
                  <p className="text-xs text-muted-foreground">
                    Save your phone number first to enable verification.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-sm text-muted-foreground">
                  You'll be prompted for verification when accessing sensitive features.
                </p>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => disable2FA()}
                  disabled={isDisabling}
                >
                  {isDisabling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Disable
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { signOut } = useAuth();
  const { data: settings, isLoading } = useAppSettings();
  const updateSettings = useUpdateAppSettings();

  const [generalSettings, setGeneralSettings] = useState({
    timezone: "America/New_York",
    currency: "USD",
  });

  const [riskDefaults, setRiskDefaults] = useState({
    max_position_size: 2,
    max_daily_loss: 1000,
    default_stop_ticks: 20,
    default_target_ticks: 40,
  });

  const [labsSettings, setLabsSettings] = useState({
    auto_evolution: true,
    auto_promote_to_sim: true,
    auto_promote_to_shadow: true,
    live_requires_approval: true,
  });

  const [appearanceSettings, setAppearanceSettings] = useState({
    compact_mode: false,
    show_pnl_colors: true,
  });

  const [notificationsSettings, setNotificationsSettings] = useState({
    discord_webhook_url: "",
    notify_promotions: true,
    notify_demotions: true,
    notify_kills: true,
    notify_errors: true,
  });

  // Load settings from database
  useEffect(() => {
    if (settings) {
      const general = settings.general as Record<string, any> || {};
      const risk = settings.risk_defaults as Record<string, any> || {};
      const labs = settings.labs as Record<string, any> || {};
      const appearance = settings.appearance as Record<string, any> || {};

      setGeneralSettings({
        timezone: general.timezone || "America/New_York",
        currency: general.currency || "USD",
      });
      setRiskDefaults({
        max_position_size: risk.max_position_size || 2,
        max_daily_loss: risk.max_daily_loss || 1000,
        default_stop_ticks: risk.default_stop_ticks || 20,
        default_target_ticks: risk.default_target_ticks || 40,
      });
      setLabsSettings({
        auto_evolution: labs.auto_evolution ?? true,
        auto_promote_to_sim: labs.auto_promote_to_sim ?? true,
        auto_promote_to_shadow: labs.auto_promote_to_shadow ?? true,
        live_requires_approval: labs.live_requires_approval ?? true,
      });
      setAppearanceSettings({
        compact_mode: appearance.compact_mode ?? false,
        show_pnl_colors: appearance.show_pnl_colors ?? true,
      });
      
      const notifications = settings.notifications as Record<string, any> || {};
      setNotificationsSettings({
        discord_webhook_url: notifications.discord_webhook_url || "",
        notify_promotions: notifications.notify_promotions ?? true,
        notify_demotions: notifications.notify_demotions ?? true,
        notify_kills: notifications.notify_kills ?? true,
        notify_errors: notifications.notify_errors ?? true,
      });
    }
  }, [settings]);

  const handleSaveGeneral = () => {
    if (settings?.id) updateSettings.mutate({ id: settings.id, general: generalSettings });
  };

  const handleSaveRisk = () => {
    if (settings?.id) updateSettings.mutate({ id: settings.id, risk_defaults: riskDefaults });
  };

  const handleSaveLabs = () => {
    if (settings?.id) updateSettings.mutate({ id: settings.id, labs: labsSettings });
  };

  const handleSaveAppearance = () => {
    if (settings?.id) updateSettings.mutate({ id: settings.id, appearance: appearanceSettings });
  };

  const handleSaveNotifications = () => {
    if (settings?.id) updateSettings.mutate({ id: settings.id, notifications: notificationsSettings });
  };

  if (isLoading) {
    return (
      <AppLayout title="Settings">
        <div className="space-y-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Settings">
      <div className="space-y-6">
        <Tabs defaultValue="profile" className="space-y-4">
          <TabsList className="h-auto p-1 bg-muted/50 border border-border rounded-md flex flex-wrap gap-1">
            <TabsTrigger 
              value="profile" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-primary/20 rounded-sm" 
              data-testid="tab-profile"
            >
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger 
              value="general" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
            >
              <SettingsIcon className="w-4 h-4" />
              General
            </TabsTrigger>
            <TabsTrigger 
              value="security" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
            >
              <Lock className="w-4 h-4" />
              Security
            </TabsTrigger>
            <TabsTrigger 
              value="risk" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
            >
              <Shield className="w-4 h-4" />
              Risk
            </TabsTrigger>
            <TabsTrigger 
              value="labs" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
            >
              <FlaskConical className="w-4 h-4" />
              Labs
            </TabsTrigger>
            <TabsTrigger 
              value="appearance" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
            >
              <Palette className="w-4 h-4" />
              Theme
            </TabsTrigger>
            <TabsTrigger 
              value="notifications" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm" 
              data-testid="tab-notifications"
            >
              <Bell className="w-4 h-4" />
              Notify
            </TabsTrigger>
            <TabsTrigger 
              value="llm-budget" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm" 
              data-testid="tab-llm-budget"
            >
              <Cpu className="w-4 h-4" />
              AI/LLM
            </TabsTrigger>
            <TabsTrigger 
              value="data-migration" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm" 
              data-testid="tab-data-migration"
            >
              <Database className="w-4 h-4" />
              Migrate
            </TabsTrigger>
            <TabsTrigger 
              value="cloud-backup" 
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm" 
              data-testid="tab-cloud-backup"
            >
              <Cloud className="w-4 h-4" />
              Cloud
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Profile Settings
                </CardTitle>
                <CardDescription>Manage your account, email, and password</CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileSection />
              </CardContent>
            </Card>

            <Card className="mt-6 border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </CardTitle>
                <CardDescription>
                  Sign out of your BlaidAgent account on this device
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="destructive" 
                  onClick={signOut}
                  data-testid="button-sign-out-profile"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Configure general application settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select 
                    value={generalSettings.timezone} 
                    onValueChange={(v) => setGeneralSettings({ ...generalSettings, timezone: v })}
                  >
                    <SelectTrigger id="timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Default Currency</Label>
                  <Select 
                    value={generalSettings.currency} 
                    onValueChange={(v) => setGeneralSettings({ ...generalSettings, currency: v })}
                  >
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={handleSaveGeneral} disabled={updateSettings.isPending}>
                  {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </CardContent>
            </Card>

            <Card className="mt-6 border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </CardTitle>
                <CardDescription>
                  Sign out of your BlaidAgent account on this device
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="destructive" 
                  onClick={signOut}
                  data-testid="button-sign-out"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Two-Factor Authentication
                </CardTitle>
                <CardDescription>
                  Secure your account with SMS-based 2FA. Required for live trading.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SecuritySection />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data-providers">
            <Card>
              <CardHeader>
                <CardTitle>Data Providers</CardTitle>
                <CardDescription>Configure market data API connections (stored securely)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h4 className="font-medium">Databento</h4>
                  <div className="space-y-2">
                    <Label htmlFor="databento-key">API Key</Label>
                    <Input id="databento-key" type="password" placeholder="Enter API key" />
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Polygon.io</h4>
                  <div className="space-y-2">
                    <Label htmlFor="polygon-key">API Key</Label>
                    <Input id="polygon-key" type="password" placeholder="Enter API key" />
                  </div>
                </div>

                <Button>Save API Keys</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brokers">
            <Card>
              <CardHeader>
                <CardTitle>Broker Connections</CardTitle>
                <CardDescription>Configure broker API connections for live trading</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h4 className="font-medium">Ironbeam</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ironbeam-username">Username</Label>
                      <Input id="ironbeam-username" placeholder="Enter username" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ironbeam-password">Password</Label>
                      <Input id="ironbeam-password" type="password" placeholder="Enter password" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Tradovate</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="tradovate-key">API Key</Label>
                      <Input id="tradovate-key" type="password" placeholder="Enter API key" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tradovate-secret">API Secret</Label>
                      <Input id="tradovate-secret" type="password" placeholder="Enter secret" />
                    </div>
                  </div>
                </div>

                <Button>Save Broker Settings</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risk">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Risk Defaults</CardTitle>
                  <CardDescription>Default risk parameters for new bots and accounts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="max-position">Max Position Size (contracts)</Label>
                      <Input 
                        id="max-position" 
                        type="number" 
                        value={riskDefaults.max_position_size}
                        onChange={(e) => setRiskDefaults({ ...riskDefaults, max_position_size: parseInt(e.target.value) || 2 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-daily-loss">Max Daily Loss ($)</Label>
                      <Input 
                        id="max-daily-loss" 
                        type="number" 
                        value={riskDefaults.max_daily_loss}
                        onChange={(e) => setRiskDefaults({ ...riskDefaults, max_daily_loss: parseInt(e.target.value) || 1000 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="default-stop">Default Stop (ticks)</Label>
                      <Input 
                        id="default-stop" 
                        type="number" 
                        value={riskDefaults.default_stop_ticks}
                        onChange={(e) => setRiskDefaults({ ...riskDefaults, default_stop_ticks: parseInt(e.target.value) || 20 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="default-target">Default Target (ticks)</Label>
                      <Input 
                        id="default-target" 
                        type="number" 
                        value={riskDefaults.default_target_ticks}
                        onChange={(e) => setRiskDefaults({ ...riskDefaults, default_target_ticks: parseInt(e.target.value) || 40 })}
                      />
                    </div>
                  </div>

                  <Button onClick={handleSaveRisk} disabled={updateSettings.isPending}>
                    {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save Risk Defaults
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Risk Tier Presets</CardTitle>
                  <CardDescription>Dynamic position sizing scales risk with account equity</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="p-4 rounded-lg border border-border">
                      <h4 className="font-medium text-sm mb-3 text-profit">Conservative</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Risk/Trade</span>
                          <span className="font-mono">0.25%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Risk $</span>
                          <span className="font-mono">$150</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Contracts</span>
                          <span className="font-mono">1</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Daily Loss Limit</span>
                          <span className="font-mono">1.5%</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg border-2 border-primary">
                      <h4 className="font-medium text-sm mb-3 text-primary">Moderate (Default)</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Risk/Trade</span>
                          <span className="font-mono">0.5%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Risk $</span>
                          <span className="font-mono">$300</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Contracts</span>
                          <span className="font-mono">3</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Daily Loss Limit</span>
                          <span className="font-mono">2%</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg border border-border">
                      <h4 className="font-medium text-sm mb-3 text-loss">Aggressive</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Risk/Trade</span>
                          <span className="font-mono">1.0%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Risk $</span>
                          <span className="font-mono">$500</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Contracts</span>
                          <span className="font-mono">5</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Daily Loss Limit</span>
                          <span className="font-mono">3%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Position sizes are calculated dynamically: Risk $ ÷ (Stop Distance × Contract Size) = Contracts.
                    All orders are capped by account and bot limits.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="labs">
            <Card>
              <CardHeader>
                <CardTitle>Labs (Experimental)</CardTitle>
                <CardDescription>Autonomy and experimental features for semi-autonomous operation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Auto Evolution</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically create new generations based on performance
                    </p>
                  </div>
                  <Switch 
                    checked={labsSettings.auto_evolution}
                    onCheckedChange={(v) => setLabsSettings({ ...labsSettings, auto_evolution: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Auto Promote to SIM</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically promote passing bots from BACKTEST to SIM
                    </p>
                  </div>
                  <Switch 
                    checked={labsSettings.auto_promote_to_sim}
                    onCheckedChange={(v) => setLabsSettings({ ...labsSettings, auto_promote_to_sim: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Auto Promote to SHADOW</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically promote qualifying bots from SIM to SHADOW
                    </p>
                  </div>
                  <Switch 
                    checked={labsSettings.auto_promote_to_shadow}
                    onCheckedChange={(v) => setLabsSettings({ ...labsSettings, auto_promote_to_shadow: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">LIVE Requires Approval</p>
                    <p className="text-sm text-muted-foreground">
                      Require manual approval before promoting to LIVE (recommended)
                    </p>
                  </div>
                  <Switch 
                    checked={labsSettings.live_requires_approval}
                    onCheckedChange={(v) => setLabsSettings({ ...labsSettings, live_requires_approval: v })}
                  />
                </div>

                <Button onClick={handleSaveLabs} disabled={updateSettings.isPending}>
                  {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Lab Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Customize the look and feel</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Compact Mode</p>
                    <p className="text-sm text-muted-foreground">
                      Reduce spacing for denser information display
                    </p>
                  </div>
                  <Switch 
                    checked={appearanceSettings.compact_mode}
                    onCheckedChange={(v) => setAppearanceSettings({ ...appearanceSettings, compact_mode: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Show P&L Colors</p>
                    <p className="text-sm text-muted-foreground">
                      Use green/red colors for profit/loss values
                    </p>
                  </div>
                  <Switch 
                    checked={appearanceSettings.show_pnl_colors}
                    onCheckedChange={(v) => setAppearanceSettings({ ...appearanceSettings, show_pnl_colors: v })}
                  />
                </div>

                <Button onClick={handleSaveAppearance} disabled={updateSettings.isPending}>
                  {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Appearance
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notification Settings
                </CardTitle>
                <CardDescription>Configure Discord webhook and notification preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="discord-webhook">Discord Webhook URL</Label>
                  <Input 
                    id="discord-webhook"
                    data-testid="input-discord-webhook"
                    type="password"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={notificationsSettings.discord_webhook_url}
                    onChange={(e) => setNotificationsSettings({ ...notificationsSettings, discord_webhook_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Create a webhook in your Discord server settings to receive notifications.
                  </p>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <h4 className="font-medium text-sm">Notification Types</h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Promotions</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when bots are promoted to a new stage
                      </p>
                    </div>
                    <Switch 
                      checked={notificationsSettings.notify_promotions}
                      onCheckedChange={(v) => setNotificationsSettings({ ...notificationsSettings, notify_promotions: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Demotions</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when bots are demoted due to performance issues
                      </p>
                    </div>
                    <Switch 
                      checked={notificationsSettings.notify_demotions}
                      onCheckedChange={(v) => setNotificationsSettings({ ...notificationsSettings, notify_demotions: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Kill Triggers</p>
                      <p className="text-sm text-muted-foreground">
                        Notify when bots are killed due to invariant breaches
                      </p>
                    </div>
                    <Switch 
                      checked={notificationsSettings.notify_kills}
                      onCheckedChange={(v) => setNotificationsSettings({ ...notificationsSettings, notify_kills: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Critical Errors</p>
                      <p className="text-sm text-muted-foreground">
                        Notify on critical system errors and failures
                      </p>
                    </div>
                    <Switch 
                      checked={notificationsSettings.notify_errors}
                      onCheckedChange={(v) => setNotificationsSettings({ ...notificationsSettings, notify_errors: v })}
                    />
                  </div>
                </div>

                <Button onClick={handleSaveNotifications} disabled={updateSettings.isPending} data-testid="button-save-notifications">
                  {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Notifications
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="llm-budget">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="w-5 h-5" />
                  AI/LLM Budget Management
                </CardTitle>
                <CardDescription>
                  Configure spending limits and priorities for AI model providers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LLMBudgetSection />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data-migration">
            <DataMigrationSection />
          </TabsContent>

          <TabsContent value="cloud-backup">
            <CloudBackupSection />
          </TabsContent>

          <TabsContent value="prompts">
            <Card>
              <CardHeader>
                <CardTitle>Bot Creation Prompts</CardTitle>
                <CardDescription>Templates and prompts for creating and evolving bots</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Starter Pack Prompt</Label>
                  <Textarea 
                    placeholder="Template for generating starter bot configurations..."
                    className="h-32 font-mono text-sm"
                    defaultValue="Create a diversified starter pack of 5 trading bots covering: TrendFollower, MeanReversion, ORB, VWAP, and Microtrend strategies. Each should have conservative risk defaults and be optimized for ES futures."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Evolution Prompt</Label>
                  <Textarea 
                    placeholder="Template for evolving bot parameters..."
                    className="h-32 font-mono text-sm"
                    defaultValue="Generate 3 parameter variations with 10-15% mutation strength. Focus on: entry timing, stop placement, and position sizing. Preserve core strategy logic while optimizing for higher Sharpe ratio."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Graduation Prompt</Label>
                  <Textarea 
                    placeholder="Template for evaluating bot readiness..."
                    className="h-32 font-mono text-sm"
                    defaultValue="Evaluate bot readiness based on: minimum 50 trades, win rate > 48%, profit factor > 1.2, max drawdown < 15%, positive expectancy. Consider regime performance and consistency."
                  />
                </div>

                <Button>Save Prompts</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
