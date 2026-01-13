import { useState, useEffect } from "react";
import { Shield, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useStrategyLabAutonomousState, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { cn } from "@/lib/utils";

export function FleetGovernorButton() {
  const { data: autonomousState } = useStrategyLabAutonomousState();
  const toggleState = useToggleStrategyLabState();
  
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
          <span className="hidden lg:inline">Governor</span>
          <Badge variant="outline" className={cn("text-[10px] h-5", fleetGovernorEnabled ? "text-amber-400 border-amber-500/40" : "")}>
            {fleetGovernorEnabled ? `${fleetGovernorGlobalCap}` : "Off"}
          </Badge>
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
