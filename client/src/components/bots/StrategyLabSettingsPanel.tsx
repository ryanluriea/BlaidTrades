import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { 
  Zap, Rocket, Activity, ChevronDown, Info
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface QCBudget {
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
  canRun: boolean;
}

interface StrategyLabSettingsPanelProps {
  qcAutoTriggerEnabled: boolean;
  setQcAutoTriggerEnabled: (v: boolean) => void;
  qcAutoTriggerThreshold: number;
  setQcAutoTriggerThreshold: (v: number) => void;
  qcAutoTriggerTier: "A" | "B" | "AB";
  setQcAutoTriggerTier: (v: "A" | "B" | "AB") => void;
  qcBudget: QCBudget | null;
  qcDailyLimit: number;
  setQcDailyLimit: (v: number) => void;
  qcWeeklyLimit: number;
  setQcWeeklyLimit: (v: number) => void;
  fastTrackEnabled: boolean;
  setFastTrackEnabled: (v: boolean) => void;
  fastTrackMinTrades: number;
  setFastTrackMinTrades: (v: number) => void;
  fastTrackMinSharpe: number;
  setFastTrackMinSharpe: (v: number) => void;
  fastTrackMinWinRate: number;
  setFastTrackMinWinRate: (v: number) => void;
  fastTrackMaxDrawdown: number;
  setFastTrackMaxDrawdown: (v: number) => void;
  trialsAutoPromoteEnabled: boolean;
  setTrialsAutoPromoteEnabled: (v: boolean) => void;
  trialsMinTrades: number;
  setTrialsMinTrades: (v: number) => void;
  trialsMinSharpe: number;
  setTrialsMinSharpe: (v: number) => void;
  trialsMinWinRate: number;
  setTrialsMinWinRate: (v: number) => void;
  trialsMaxDrawdown: number;
  setTrialsMaxDrawdown: (v: number) => void;
  isPending: boolean;
  onSave: (updates: Record<string, unknown>) => void;
}

export function StrategyLabSettingsPanel({
  qcAutoTriggerEnabled,
  setQcAutoTriggerEnabled,
  qcAutoTriggerThreshold,
  setQcAutoTriggerThreshold,
  qcAutoTriggerTier,
  setQcAutoTriggerTier,
  qcBudget,
  qcDailyLimit,
  setQcDailyLimit,
  qcWeeklyLimit,
  setQcWeeklyLimit,
  fastTrackEnabled,
  setFastTrackEnabled,
  fastTrackMinTrades,
  setFastTrackMinTrades,
  fastTrackMinSharpe,
  setFastTrackMinSharpe,
  fastTrackMinWinRate,
  setFastTrackMinWinRate,
  fastTrackMaxDrawdown,
  setFastTrackMaxDrawdown,
  trialsAutoPromoteEnabled,
  setTrialsAutoPromoteEnabled,
  trialsMinTrades,
  setTrialsMinTrades,
  trialsMinSharpe,
  setTrialsMinSharpe,
  trialsMinWinRate,
  setTrialsMinWinRate,
  trialsMaxDrawdown,
  setTrialsMaxDrawdown,
  isPending,
  onSave,
}: StrategyLabSettingsPanelProps) {
  const [qcPopoverOpen, setQcPopoverOpen] = useState(false);
  const [fastTrackPopoverOpen, setFastTrackPopoverOpen] = useState(false);
  const [trialsPopoverOpen, setTrialsPopoverOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-muted/20 flex-wrap">
      {/* Section 1: Auto-Trigger to QC - Dropdown Button */}
      <Popover open={qcPopoverOpen} onOpenChange={setQcPopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-[11px] font-medium border-border/60 bg-background/50 px-2",
              qcAutoTriggerEnabled && "border-cyan-500/40"
            )}
            data-testid="toggle-qc-settings"
          >
            <Zap className={cn("h-3.5 w-3.5", qcAutoTriggerEnabled ? "text-foreground" : "text-muted-foreground")} />
            <span className="hidden sm:inline">Auto-Trigger to QC</span>
            <Badge variant="outline" className={cn("text-[9px]", qcAutoTriggerEnabled ? "text-foreground border-border" : "")}>
              {qcAutoTriggerEnabled ? `${qcAutoTriggerThreshold}%+ Tier ${qcAutoTriggerTier}` : "Off"}
            </Badge>
            <div className="hidden md:flex items-center gap-1 text-[9px] text-muted-foreground">
              <span className="font-mono" data-testid="panel-daily-budget">
                {qcBudget ? `${qcBudget.dailyUsed}/${qcBudget.dailyLimit}` : "--/--"}
              </span>
              <span>/</span>
              <span className="font-mono" data-testid="panel-weekly-budget">
                {qcBudget ? `${qcBudget.weeklyUsed}/${qcBudget.weeklyLimit}` : "--/--"}
              </span>
            </div>
            <Badge variant="outline" className={cn("text-[8px]", qcBudget?.canRun ? "text-emerald-400 border-emerald-500/40" : "text-amber-400 border-amber-500/40")}>
              {qcBudget?.canRun ? "OK" : "Limit"}
            </Badge>
            <ChevronDown className={cn("h-3 w-3 transition-transform", qcPopoverOpen && "rotate-180")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="panel-auto-trigger" className="text-xs font-normal">Auto-trigger enabled</Label>
              <Switch
                id="panel-auto-trigger"
                checked={qcAutoTriggerEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => {
                  setQcAutoTriggerEnabled(checked);
                  onSave({ qcAutoTriggerEnabled: checked });
                }}
                data-testid="switch-panel-auto-trigger"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label className="font-normal">Confidence threshold</Label>
                <span className="font-mono text-muted-foreground">{qcAutoTriggerThreshold}%</span>
              </div>
              <Slider
                value={[qcAutoTriggerThreshold]}
                onValueChange={([val]) => setQcAutoTriggerThreshold(val)}
                onValueCommit={([val]) => onSave({ qcAutoTriggerThreshold: val })}
                min={50} max={100} step={5}
                disabled={!qcAutoTriggerEnabled || isPending}
                data-testid="slider-panel-threshold"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-normal">Tier filter</Label>
              <Select
                value={qcAutoTriggerTier}
                onValueChange={(val: "A" | "B" | "AB") => {
                  setQcAutoTriggerTier(val);
                  onSave({ qcAutoTriggerTier: val });
                }}
                disabled={!qcAutoTriggerEnabled || isPending}
              >
                <SelectTrigger className="w-20 h-7 text-xs" data-testid="select-panel-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A only</SelectItem>
                  <SelectItem value="B">B only</SelectItem>
                  <SelectItem value="AB">A + B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="pt-2 mt-2 border-t border-border/40 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                <span>Budget Limits</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px]">
                      <span className="text-xs">Control how many QuantConnect verifications can run per day and week. Higher limits allow more strategies to be tested but consume more QC compute credits.</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Daily Limit</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-2.5 w-2.5 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[180px]">
                          <span className="text-[10px]">Max QC verifications per 24-hour period. Resets at midnight UTC.</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    type="number" min={1} max={100}
                    value={qcDailyLimit}
                    onChange={(e) => setQcDailyLimit(parseInt(e.target.value) || 10)}
                    onBlur={(e) => onSave({ qcDailyLimit: parseInt(e.target.value) || 10 })}
                    disabled={isPending}
                    className="h-7 text-xs font-mono"
                    data-testid="input-qc-daily-limit"
                  />
                  {qcBudget && (
                    <span className="text-[9px] text-muted-foreground/70">Used: {qcBudget.dailyUsed}</span>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Weekly Limit</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-2.5 w-2.5 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[180px]">
                          <span className="text-[10px]">Max QC verifications per 7-day rolling window. Helps prevent burst usage.</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    type="number" min={1} max={500}
                    value={qcWeeklyLimit}
                    onChange={(e) => setQcWeeklyLimit(parseInt(e.target.value) || 50)}
                    onBlur={(e) => onSave({ qcWeeklyLimit: parseInt(e.target.value) || 50 })}
                    disabled={isPending}
                    className="h-7 text-xs font-mono"
                    data-testid="input-qc-weekly-limit"
                  />
                  {qcBudget && (
                    <span className="text-[9px] text-muted-foreground/70">Used: {qcBudget.weeklyUsed}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="h-4 w-px bg-border/50" />

      {/* Section 2: Fast Track to PAPER - Dropdown Button */}
      <Popover open={fastTrackPopoverOpen} onOpenChange={setFastTrackPopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-[11px] font-medium border-border/60 bg-background/50 px-2",
              fastTrackEnabled && "border-purple-500/40"
            )}
            data-testid="toggle-fasttrack-settings"
          >
            <Rocket className={cn("h-3.5 w-3.5", fastTrackEnabled ? "text-foreground" : "text-muted-foreground")} />
            <span className="hidden sm:inline">Fast Track to PAPER</span>
            <Badge variant="outline" className={cn("text-[9px]", fastTrackEnabled ? "text-foreground border-border" : "")}>
              {fastTrackEnabled ? "Enabled" : "Off"}
            </Badge>
            <ChevronDown className={cn("h-3 w-3 transition-transform", fastTrackPopoverOpen && "rotate-180")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="panel-fast-track" className="text-xs font-normal">Fast Track enabled</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Skip TRIALS and create bot directly in PAPER if QC results are exceptional
                </p>
              </div>
              <Switch
                id="panel-fast-track"
                checked={fastTrackEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => {
                  setFastTrackEnabled(checked);
                  onSave({ fastTrackEnabled: checked });
                }}
                data-testid="switch-panel-fast-track"
              />
            </div>
            <div className={cn("grid grid-cols-2 gap-2", !fastTrackEnabled && "opacity-50 pointer-events-none")}>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Trades</Label>
                <Input
                  type="number" min={10} max={200}
                  value={fastTrackMinTrades}
                  onChange={(e) => setFastTrackMinTrades(parseInt(e.target.value) || 50)}
                  onBlur={(e) => onSave({ fastTrackMinTrades: parseInt(e.target.value) || 50 })}
                  className="h-7 text-xs"
                  disabled={!fastTrackEnabled || isPending}
                  data-testid="input-panel-ft-trades"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Sharpe</Label>
                <Input
                  type="number" min={0} max={5} step={0.1}
                  value={fastTrackMinSharpe}
                  onChange={(e) => setFastTrackMinSharpe(parseFloat(e.target.value) || 1.5)}
                  onBlur={(e) => onSave({ fastTrackMinSharpe: parseFloat(e.target.value) || 1.5 })}
                  className="h-7 text-xs"
                  disabled={!fastTrackEnabled || isPending}
                  data-testid="input-panel-ft-sharpe"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Win Rate %</Label>
                <Input
                  type="number" min={30} max={80}
                  value={fastTrackMinWinRate}
                  onChange={(e) => setFastTrackMinWinRate(parseInt(e.target.value) || 55)}
                  onBlur={(e) => onSave({ fastTrackMinWinRate: parseInt(e.target.value) || 55 })}
                  className="h-7 text-xs"
                  disabled={!fastTrackEnabled || isPending}
                  data-testid="input-panel-ft-winrate"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max Drawdown %</Label>
                <Input
                  type="number" min={5} max={50}
                  value={fastTrackMaxDrawdown}
                  onChange={(e) => setFastTrackMaxDrawdown(parseInt(e.target.value) || 15)}
                  onBlur={(e) => onSave({ fastTrackMaxDrawdown: parseInt(e.target.value) || 15 })}
                  className="h-7 text-xs"
                  disabled={!fastTrackEnabled || isPending}
                  data-testid="input-panel-ft-drawdown"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="h-4 w-px bg-border/50" />

      {/* Section 3: Auto-Promote to Trials - Dropdown Button */}
      <Popover open={trialsPopoverOpen} onOpenChange={setTrialsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-[11px] font-medium border-border/60 bg-background/50 px-2",
              trialsAutoPromoteEnabled && "border-blue-500/40"
            )}
            data-testid="toggle-trials-settings"
          >
            <Activity className={cn("h-3.5 w-3.5", trialsAutoPromoteEnabled ? "text-foreground" : "text-muted-foreground")} />
            <span className="hidden sm:inline">Auto-Promote to Trials</span>
            <Badge variant="outline" className={cn("text-[9px]", trialsAutoPromoteEnabled ? "text-foreground border-border" : "")}>
              {trialsAutoPromoteEnabled ? "Auto" : "Manual"}
            </Badge>
            <ChevronDown className={cn("h-3 w-3 transition-transform", trialsPopoverOpen && "rotate-180")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="panel-trials-promote" className="text-xs font-normal">Auto-promote to Trials</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Automatically create TRIALS bots when QC verification passes thresholds
                </p>
              </div>
              <Switch
                id="panel-trials-promote"
                checked={trialsAutoPromoteEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => {
                  setTrialsAutoPromoteEnabled(checked);
                  onSave({ trialsAutoPromoteEnabled: checked });
                }}
                data-testid="switch-panel-trials-promote"
              />
            </div>
            <div className={cn("grid grid-cols-2 gap-2", !trialsAutoPromoteEnabled && "opacity-50 pointer-events-none")}>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Trades</Label>
                <Input
                  type="number" min={10} max={500}
                  value={trialsMinTrades}
                  onChange={(e) => setTrialsMinTrades(parseInt(e.target.value) || 50)}
                  onBlur={(e) => onSave({ trialsMinTrades: parseInt(e.target.value) || 50 })}
                  className="h-7 text-xs"
                  disabled={!trialsAutoPromoteEnabled || isPending}
                  data-testid="input-panel-trials-trades"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Sharpe</Label>
                <Input
                  type="number" min={0} max={5} step={0.1}
                  value={trialsMinSharpe}
                  onChange={(e) => setTrialsMinSharpe(parseFloat(e.target.value) || 1.0)}
                  onBlur={(e) => onSave({ trialsMinSharpe: parseFloat(e.target.value) || 1.0 })}
                  className="h-7 text-xs"
                  disabled={!trialsAutoPromoteEnabled || isPending}
                  data-testid="input-panel-trials-sharpe"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min Win Rate %</Label>
                <Input
                  type="number" min={30} max={80}
                  value={trialsMinWinRate}
                  onChange={(e) => setTrialsMinWinRate(parseInt(e.target.value) || 50)}
                  onBlur={(e) => onSave({ trialsMinWinRate: parseInt(e.target.value) || 50 })}
                  className="h-7 text-xs"
                  disabled={!trialsAutoPromoteEnabled || isPending}
                  data-testid="input-panel-trials-winrate"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max Drawdown %</Label>
                <Input
                  type="number" min={5} max={50}
                  value={trialsMaxDrawdown}
                  onChange={(e) => setTrialsMaxDrawdown(parseInt(e.target.value) || 20)}
                  onBlur={(e) => onSave({ trialsMaxDrawdown: parseInt(e.target.value) || 20 })}
                  className="h-7 text-xs"
                  disabled={!trialsAutoPromoteEnabled || isPending}
                  data-testid="input-panel-trials-drawdown"
                />
              </div>
            </div>
            <div className="h-px bg-border/50" />
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Trial Instruments</Label>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                  MES
                </Badge>
                <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                  MNQ
                </Badge>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
