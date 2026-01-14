import { useState, useEffect } from "react";
import { Shield, Info, Bot, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useStrategyLabOverview, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { cn } from "@/lib/utils";

export function FleetGovernorButton() {
  const { data: overviewData } = useStrategyLabOverview();
  const toggleState = useToggleStrategyLabState();
  
  // Extract fleet and candidate data from overview
  const fleetBreakdown = overviewData?.fleetBreakdown || { trials: 0, paper: 0, shadow: 0, canary: 0, live: 0, total: 0 };
  const candidateCounts = overviewData?.candidateCounts || { 
    pendingReview: 0, 
    sentToLab: 0, 
    queued: 0, 
    queuedForQc: 0, 
    waitlist: 0, 
    rejected: 0, 
    total: 0 
  };
  const autonomousState = overviewData;
  
  const [fleetGovernorEnabled, setFleetGovernorEnabled] = useState(true);
  const [fleetGovernorGlobalCap, setFleetGovernorGlobalCap] = useState(100);
  const [fleetGovernorTrialsCap, setFleetGovernorTrialsCap] = useState(50);
  const [fleetGovernorPaperCap, setFleetGovernorPaperCap] = useState(25);
  const [fleetGovernorLiveCap, setFleetGovernorLiveCap] = useState(10);
  const [fleetGovernorGracePeriodHours, setFleetGovernorGracePeriodHours] = useState(24);
  const [fleetGovernorMinObservationTrades, setFleetGovernorMinObservationTrades] = useState(20);
  const [fleetGovernorDemotionPolicy, setFleetGovernorDemotionPolicy] = useState<"ARCHIVE" | "RECYCLE">("RECYCLE");
  
  useEffect(() => {
    if (typeof autonomousState?.fleetGovernorEnabled === "boolean") {
      setFleetGovernorEnabled(autonomousState.fleetGovernorEnabled);
    }
    if (typeof autonomousState?.fleetGovernorGlobalCap === "number") {
      setFleetGovernorGlobalCap(autonomousState.fleetGovernorGlobalCap);
    }
    if (typeof autonomousState?.fleetGovernorTrialsCap === "number") {
      setFleetGovernorTrialsCap(autonomousState.fleetGovernorTrialsCap);
    }
    if (typeof autonomousState?.fleetGovernorPaperCap === "number") {
      setFleetGovernorPaperCap(autonomousState.fleetGovernorPaperCap);
    }
    if (typeof autonomousState?.fleetGovernorLiveCap === "number") {
      setFleetGovernorLiveCap(autonomousState.fleetGovernorLiveCap);
    }
    if (typeof autonomousState?.fleetGovernorGracePeriodHours === "number") {
      setFleetGovernorGracePeriodHours(autonomousState.fleetGovernorGracePeriodHours);
    }
    if (typeof autonomousState?.fleetGovernorMinObservationTrades === "number") {
      setFleetGovernorMinObservationTrades(autonomousState.fleetGovernorMinObservationTrades);
    }
    if (autonomousState?.fleetGovernorDemotionPolicy === "ARCHIVE" || autonomousState?.fleetGovernorDemotionPolicy === "RECYCLE") {
      setFleetGovernorDemotionPolicy(autonomousState.fleetGovernorDemotionPolicy);
    }
  }, [autonomousState]);
  
  const handleSettingsSave = (updates: Record<string, any>) => {
    toggleState.mutate(updates);
  };
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm"
          className={cn(
            "h-8 px-2 text-xs gap-1.5",
            fleetGovernorEnabled ? "text-amber-400" : "text-muted-foreground"
          )}
          data-testid="button-fleet-governor-global"
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Fleet</span>
          <Badge variant="outline" className={cn(
            "text-[10px] h-5 font-mono",
            fleetGovernorEnabled 
              ? fleetBreakdown.total >= fleetGovernorGlobalCap 
                ? "text-red-400 border-red-500/40" 
                : "text-amber-400 border-amber-500/40" 
              : ""
          )}>
            {fleetGovernorEnabled ? `${fleetBreakdown.total}/${fleetGovernorGlobalCap}` : "Off"}
          </Badge>
          {candidateCounts.waitlist > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 text-orange-400 border-orange-500/40">
              <Clock className="w-2.5 h-2.5 mr-0.5" />
              {candidateCounts.waitlist}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-3" side="bottom" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                Fleet Governor
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Automated fleet size management with performance-based demotion
              </p>
            </div>
            <Switch 
              checked={fleetGovernorEnabled}
              disabled={toggleState.isPending}
              onCheckedChange={(checked) => {
                setFleetGovernorEnabled(checked);
                handleSettingsSave({ fleetGovernorEnabled: checked });
              }}
              data-testid="switch-fleet-governor-global"
            />
          </div>
          
          <div className={cn("space-y-3", !fleetGovernorEnabled && "opacity-50 pointer-events-none")}>
            <div className="h-px bg-border/50" />
            
            {/* Fleet Status Overview */}
            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground mb-1.5 block flex items-center gap-1">
                <Bot className="w-3 h-3" />
                Active Fleet
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/30 rounded px-2 py-1.5">
                  <div className="text-[9px] text-muted-foreground">Total Bots</div>
                  <div className="text-sm font-mono font-bold">
                    <span className={cn(
                      fleetBreakdown.total >= fleetGovernorGlobalCap ? "text-red-400" : "text-green-400"
                    )}>{fleetBreakdown.total}</span>
                    <span className="text-muted-foreground">/{fleetGovernorGlobalCap}</span>
                  </div>
                </div>
                <div className="bg-muted/30 rounded px-2 py-1.5">
                  <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    Waitlist
                  </div>
                  <div className="text-sm font-mono font-bold text-orange-400">
                    {candidateCounts.waitlist || 0}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1 text-center">
                <div className="bg-muted/20 rounded px-1 py-1">
                  <div className="text-[8px] text-muted-foreground">TRIALS</div>
                  <div className="text-xs font-mono">{fleetBreakdown.trials}</div>
                </div>
                <div className="bg-muted/20 rounded px-1 py-1">
                  <div className="text-[8px] text-muted-foreground">PAPER</div>
                  <div className="text-xs font-mono">{fleetBreakdown.paper}</div>
                </div>
                <div className="bg-muted/20 rounded px-1 py-1">
                  <div className="text-[8px] text-muted-foreground">SHADOW</div>
                  <div className="text-xs font-mono">{fleetBreakdown.shadow}</div>
                </div>
                <div className="bg-muted/20 rounded px-1 py-1">
                  <div className="text-[8px] text-muted-foreground">CANARY</div>
                  <div className="text-xs font-mono">{fleetBreakdown.canary}</div>
                </div>
                <div className="bg-muted/20 rounded px-1 py-1">
                  <div className="text-[8px] text-muted-foreground">LIVE</div>
                  <div className="text-xs font-mono text-green-400">{fleetBreakdown.live}</div>
                </div>
              </div>
            </div>
            
            <div className="h-px bg-border/50" />
            
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Stage Caps</Label>
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Global</Label>
                  <Input
                    type="number" min={10} max={500}
                    value={fleetGovernorGlobalCap}
                    onChange={(e) => setFleetGovernorGlobalCap(parseInt(e.target.value) || 100)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorGlobalCap: parseInt(e.target.value) || 100 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-global-cap-global"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Trials</Label>
                  <Input
                    type="number" min={5} max={200}
                    value={fleetGovernorTrialsCap}
                    onChange={(e) => setFleetGovernorTrialsCap(parseInt(e.target.value) || 50)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorTrialsCap: parseInt(e.target.value) || 50 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-trials-cap-global"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Paper</Label>
                  <Input
                    type="number" min={5} max={100}
                    value={fleetGovernorPaperCap}
                    onChange={(e) => setFleetGovernorPaperCap(parseInt(e.target.value) || 25)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorPaperCap: parseInt(e.target.value) || 25 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-paper-cap-global"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Live</Label>
                  <Input
                    type="number" min={1} max={50}
                    value={fleetGovernorLiveCap}
                    onChange={(e) => setFleetGovernorLiveCap(parseInt(e.target.value) || 10)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorLiveCap: parseInt(e.target.value) || 10 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-live-cap-global"
                  />
                </div>
              </div>
            </div>
            
            <div className="h-px bg-border/50" />
            
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Demotion Settings</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Grace (hrs)</Label>
                  <Input
                    type="number" min={1} max={168}
                    value={fleetGovernorGracePeriodHours}
                    onChange={(e) => setFleetGovernorGracePeriodHours(parseInt(e.target.value) || 24)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorGracePeriodHours: parseInt(e.target.value) || 24 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-grace-period-global"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Min Trades</Label>
                  <Input
                    type="number" min={5} max={100}
                    value={fleetGovernorMinObservationTrades}
                    onChange={(e) => setFleetGovernorMinObservationTrades(parseInt(e.target.value) || 20)}
                    onBlur={(e) => handleSettingsSave({ fleetGovernorMinObservationTrades: parseInt(e.target.value) || 20 })}
                    className="h-7 text-xs"
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    data-testid="input-fleet-min-trades-global"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] text-muted-foreground">Policy</Label>
                  <Select
                    value={fleetGovernorDemotionPolicy}
                    disabled={!fleetGovernorEnabled || toggleState.isPending}
                    onValueChange={(v) => {
                      const policy = v as "ARCHIVE" | "RECYCLE";
                      setFleetGovernorDemotionPolicy(policy);
                      handleSettingsSave({ fleetGovernorDemotionPolicy: policy });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs" data-testid="select-fleet-demotion-policy-global">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARCHIVE">Archive</SelectItem>
                      <SelectItem value="RECYCLE">Recycle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div className="h-px bg-border/50" />
            <div className="text-[9px] text-muted-foreground/80 flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                Uses composite ranking (Sharpe + Win Rate + Risk-Adjusted PnL - Drawdown) 
                to demote underperformers when stage caps are exceeded.
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
