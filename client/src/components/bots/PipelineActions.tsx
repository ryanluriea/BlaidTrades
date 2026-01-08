import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import http from "@/lib/http";
import { Filter, MoreVertical, Check, Sparkles, Loader2, Archive, Trash2, ArrowUpDown, Bot, Zap, BarChart3, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResetBotFleetDialog } from "./ResetBotFleetDialog";

interface PipelineActionsProps {
  statusFilter?: string;
  onStatusChange?: (status: string) => void;
  symbolFilter?: string;
  onSymbolChange?: (symbol: string) => void;
  timeFilter?: string;
  onTimeChange?: (time: string) => void;
  availableSymbols?: string[];
  showArchived?: boolean;
  onShowArchivedChange?: (show: boolean) => void;
  sortBy?: string;
  onSortChange?: (sort: string) => void;
}

const timeOptions = [
  { value: "today", label: "Today" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "ytd", label: "YTD" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All Time" },
];

const statusOptions = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "idle", label: "Idle" },
  { value: "paused", label: "Paused" },
  { value: "error", label: "Error" },
  { value: "stopped", label: "Stopped" },
];

const sortOptions = [
  { value: "stage", label: "Stage Priority" },
  { value: "updated", label: "Recently Updated" },
  { value: "name", label: "Name A→Z" },
  { value: "name-desc", label: "Name Z→A" },
  { value: "pnl", label: "P&L (High→Low)" },
  { value: "pnl-asc", label: "P&L (Low→High)" },
  { value: "trades", label: "Most Trades" },
  { value: "created", label: "Newest First" },
];

export function PipelineActions({
  statusFilter,
  onStatusChange,
  symbolFilter,
  onSymbolChange,
  timeFilter,
  onTimeChange,
  availableSymbols = [],
  showArchived = false,
  onShowArchivedChange,
  sortBy = "stage",
  onSortChange,
}: PipelineActionsProps) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const queryClient = useQueryClient();

  // Fetch autonomy status
  const { data: autonomyData } = useQuery<{ success: boolean; data: { autonomyEnabled: boolean; majorityMode: string } }>({
    queryKey: ["/api/bots/autonomy-status"],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data: { autonomyEnabled: boolean; majorityMode: string } }>("/api/bots/autonomy-status");
      if (!response.ok) throw new Error("Failed to fetch autonomy status");
      return response.data;
    },
    refetchInterval: 30000,
    retry: false,
  });

  // Fetch symbol preference
  const { data: symbolPrefData } = useQuery<{ success: boolean; data: { symbolClass: string } }>({
    queryKey: ["/api/preferences/symbol"],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data: { symbolClass: string } }>("/api/preferences/symbol");
      if (!response.ok) throw new Error("Failed to fetch symbol preference");
      return response.data;
    },
    refetchInterval: 60000,
    retry: false,
  });

  const autonomyEnabled = autonomyData?.data?.autonomyEnabled ?? true;
  const currentSymbolClass = symbolPrefData?.data?.symbolClass ?? "ALL";

  // Mutations
  const toggleAutonomyMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await http.post<{ success: boolean; data: { promotionMode: string; botsUpdated: number }; error?: string; error_code?: string }>("/api/bots/bulk-autonomy", { enabled });
      if (!response.ok) {
        const errorCode = (response.data as any)?.error_code;
        if (response.status === 401 || errorCode === "AUTH_REQUIRED") {
          throw new Error("Session expired - please sign in again");
        }
        throw new Error(response.data?.error || "Failed to toggle autonomy");
      }
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/autonomy-status"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["botList"] });
      toast.success(`Autonomy ${data?.data?.promotionMode === "AUTO" ? "enabled" : "disabled"} for ${data?.data?.botsUpdated} bots`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to toggle autonomy mode");
    },
  });

  const setSymbolPrefMutation = useMutation({
    mutationFn: async (symbolClass: string) => {
      const response = await http.post<{ 
        success: boolean; 
        data: { symbolClass: string; convertedBots?: string[]; message?: string }; 
        error?: string; 
        error_code?: string 
      }>("/api/preferences/symbol", { symbolClass });
      if (!response.ok) {
        const errorCode = (response.data as any)?.error_code;
        if (response.status === 401 || errorCode === "AUTH_REQUIRED") {
          throw new Error("Session expired - please sign in again");
        }
        throw new Error(response.data?.error || "Failed to set symbol preference");
      }
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences/symbol"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["botList"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/autonomy-status"] });
      
      const converted = data?.data?.convertedBots?.length ?? 0;
      if (converted > 0) {
        toast.success(data?.data?.message || `Converted ${converted} TRIALS bot(s) to ${data?.data?.symbolClass}`);
      } else {
        toast.success(`Symbol preference set to ${data?.data?.symbolClass}`);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to set symbol preference");
    },
  });

  const hasFilters = statusFilter !== undefined || symbolFilter !== undefined || timeFilter !== undefined;
  const activeFilterCount = [
    statusFilter && statusFilter !== "all" ? 1 : 0,
    symbolFilter && symbolFilter !== "all" ? 1 : 0,
    timeFilter && timeFilter !== "today" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const handleSeedBots = async () => {
    setIsSeeding(true);
    try {
      const response = await http.post<{ 
        success: boolean; 
        trace_id?: string; 
        data?: { created_bots?: number; skipped_bots?: number };
        created_bots?: number; 
        skipped_bots?: number; 
        error?: string;
        details?: string;
      }>("/api/bots/starter-pack", { reset_existing: false });

      if (!response.ok || !response.data?.success) {
        const errorCode = (response.data as any)?.error_code;
        if (response.status === 401 || errorCode === "AUTH_REQUIRED") {
          throw new Error("Session expired - please sign in again");
        }
        const errMsg = response.error || response.data?.error || "Failed to create starter bots";
        throw new Error(errMsg + (response.data?.details ? `: ${response.data.details}` : ''));
      }

      const data = response.data;
      const createdCount = data.data?.created_bots || data.created_bots || 0;
      const skippedCount = data.data?.skipped_bots || data.skipped_bots || 0;
      toast.success(`Created ${createdCount} starter bots (${skippedCount} already existed)`);
      
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["botList"] });
    } catch (error) {
      console.error("Seed error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to seed starter bots");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" data-testid="button-pipeline-menu">
                <MoreVertical className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-medium rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Options & Filters</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48 bg-popover max-h-[70vh] overflow-y-auto">
          <DropdownMenuItem
            onClick={handleSeedBots}
            disabled={isSeeding}
          >
            {isSeeding ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-2" />
            )}
            Seed Starter Bots
          </DropdownMenuItem>
          {onShowArchivedChange && (
            <DropdownMenuItem
              onClick={() => onShowArchivedChange(!showArchived)}
            >
              <Archive className="w-3.5 h-3.5 mr-2" />
              {showArchived ? "Hide Archived" : "Show Archived"}
              {showArchived && <Check className="w-3 h-3 ml-auto" />}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setResetDialogOpen(true)}
            disabled={isSeeding}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete Bots
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setAutomationSettingsOpen(true)}
          >
            <Settings className="w-3.5 h-3.5 mr-2" />
            Automation Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {onSortChange && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ArrowUpDown className="w-3 h-3" />
                Sort By
              </DropdownMenuLabel>
              {sortOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  className="text-xs justify-between"
                  onClick={() => onSortChange(opt.value)}
                >
                  {opt.label}
                  {sortBy === opt.value && <Check className="w-3 h-3" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {statusFilter !== undefined && onStatusChange && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Filter className="w-3 h-3" />
                Status
              </DropdownMenuLabel>
              {statusOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  className="text-xs justify-between"
                  onClick={() => onStatusChange(opt.value)}
                >
                  {opt.label}
                  {statusFilter === opt.value && <Check className="w-3 h-3" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {symbolFilter !== undefined && onSymbolChange && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Symbol</DropdownMenuLabel>
              <DropdownMenuItem
                className="text-xs justify-between"
                onClick={() => onSymbolChange("all")}
              >
                All
                {symbolFilter === "all" && <Check className="w-3 h-3" />}
              </DropdownMenuItem>
              {availableSymbols.map((sym) => (
                <DropdownMenuItem
                  key={sym}
                  className="text-xs justify-between"
                  onClick={() => onSymbolChange(sym)}
                >
                  {sym}
                  {symbolFilter === sym && <Check className="w-3 h-3" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}

          {timeFilter !== undefined && onTimeChange && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Time Range</DropdownMenuLabel>
              {timeOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  className="text-xs justify-between"
                  onClick={() => onTimeChange(opt.value)}
                >
                  {opt.label}
                  {timeFilter === opt.value && <Check className="w-3 h-3" />}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ResetBotFleetDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen} />

      <Dialog open={automationSettingsOpen} onOpenChange={setAutomationSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              Automation Settings
            </DialogTitle>
            <DialogDescription>
              Configure how bots are automatically managed and promoted through stages.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="autonomy-toggle" className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Autonomous Promotion
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically promote bots through stages based on performance
                </p>
              </div>
              <Switch
                id="autonomy-toggle"
                checked={autonomyEnabled}
                onCheckedChange={(checked) => toggleAutonomyMutation.mutate(checked)}
                disabled={toggleAutonomyMutation.isPending}
                data-testid="switch-autonomy-toggle"
              />
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Symbol Class Preference
                </Label>
                <p className="text-xs text-muted-foreground">
                  Choose which contract sizes to trade
                </p>
              </div>
              <RadioGroup
                value={currentSymbolClass}
                onValueChange={(value) => setSymbolPrefMutation.mutate(value)}
                disabled={setSymbolPrefMutation.isPending}
                className="space-y-2"
              >
                <div className="flex items-center space-x-3 p-2 rounded-md hover-elevate">
                  <RadioGroupItem value="MICRO" id="symbol-micro" data-testid="radio-symbol-micro" />
                  <Label htmlFor="symbol-micro" className="flex-1 cursor-pointer">
                    <span className="text-sm font-medium">Micros</span>
                    <span className="text-xs text-muted-foreground ml-2">(MES, MNQ, MCL, etc.)</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-2 rounded-md hover-elevate">
                  <RadioGroupItem value="MINI" id="symbol-mini" data-testid="radio-symbol-mini" />
                  <Label htmlFor="symbol-mini" className="flex-1 cursor-pointer">
                    <span className="text-sm font-medium">Minis</span>
                    <span className="text-xs text-muted-foreground ml-2">(ES, NQ, CL, etc.)</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-2 rounded-md hover-elevate">
                  <RadioGroupItem value="ALL" id="symbol-all" data-testid="radio-symbol-all" />
                  <Label htmlFor="symbol-all" className="flex-1 cursor-pointer">
                    <span className="text-sm font-medium">All Symbols</span>
                    <span className="text-xs text-muted-foreground ml-2">(Trade any contract size)</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
