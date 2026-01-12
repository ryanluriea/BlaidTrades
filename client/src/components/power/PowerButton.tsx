import { useState } from "react";
import { cn } from "@/lib/utils";
import { Power, Clock, DollarSign, Zap, Timer } from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface SystemPowerState {
  isOn: boolean;
  scheduledStart?: string;
  scheduledEnd?: string;
  dailyLossLimit?: number;
  currentDailyPnL?: number;
  throttleThreshold?: number;
  isThrottled?: boolean;
  autoFlattenBeforeClose?: boolean;
  flattenMinutesBeforeClose?: number;
}

export function PowerButton() {
  const [confirmDialog, setConfirmDialog] = useState<"on" | "off" | null>(null);
  const queryClient = useQueryClient();

  const { data: powerState, isLoading } = useQuery<SystemPowerState>({
    queryKey: ["/api/system/power"],
    queryFn: async () => {
      const response = await fetch("/api/system/power", {
        credentials: "include",
      });
      if (!response.ok) {
        return { isOn: false };
      }
      return response.json();
    },
    refetchInterval: 5000,
  });

  const defaultPowerState: SystemPowerState = {
    isOn: false,
    isThrottled: false,
    autoFlattenBeforeClose: true,
    flattenMinutesBeforeClose: 15,
  };

  const togglePower = useMutation({
    mutationFn: async (newState: boolean) => {
      const response = await fetch("/api/system/power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isOn: newState }),
      });
      if (!response.ok) throw new Error("Failed to toggle power");
      return response.json();
    },
    onMutate: async (newState: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/system/power"] });
      const previousState = queryClient.getQueryData<SystemPowerState>(["/api/system/power"]);
      const currentState = previousState ?? defaultPowerState;
      queryClient.setQueryData<SystemPowerState>(["/api/system/power"], {
        ...currentState,
        isOn: newState,
      });
      setConfirmDialog(null);
      return { previousState };
    },
    onError: (_err, _newState, context) => {
      if (context?.previousState !== undefined) {
        queryClient.setQueryData(["/api/system/power"], context.previousState);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/system/power"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/power"] });
    },
  });

  const toggleAutoFlatten = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch("/api/system/auto-flatten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ autoFlattenBeforeClose: enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle auto-flatten");
      return response.json();
    },
    onMutate: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/system/power"] });
      const previousState = queryClient.getQueryData<SystemPowerState>(["/api/system/power"]);
      const currentState = previousState ?? defaultPowerState;
      queryClient.setQueryData<SystemPowerState>(["/api/system/power"], {
        ...currentState,
        autoFlattenBeforeClose: enabled,
      });
      return { previousState };
    },
    onError: (_err, _enabled, context) => {
      if (context?.previousState !== undefined) {
        queryClient.setQueryData(["/api/system/power"], context.previousState);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/system/power"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/power"] });
    },
  });

  const isOn = powerState?.isOn ?? false;
  const isThrottled = powerState?.isThrottled ?? false;
  const autoFlatten = powerState?.autoFlattenBeforeClose ?? true;
  const flattenMinutes = powerState?.flattenMinutesBeforeClose ?? 15;

  const handleToggle = () => {
    if (isOn) {
      setConfirmDialog("off");
    } else {
      togglePower.mutate(true);
    }
  };

  const confirmShutdown = () => {
    togglePower.mutate(false);
  };

  const getIconColor = () => {
    if (isLoading) return "text-muted-foreground";
    if (!isOn) return "text-zinc-500";
    if (isThrottled) return "text-amber-400";
    return "text-blue-400";
  };

  const getStatusText = () => {
    if (isLoading) return "Loading...";
    if (!isOn) return "System OFF";
    if (isThrottled) return "Throttled";
    return "System ON";
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-2 hover:opacity-80 transition-opacity"
            data-testid="button-power"
          >
            <Power className={cn("w-5 h-5 transition-colors", getIconColor())} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>{getStatusText()}</span>
            {isOn && (
              <span className="text-xs text-blue-400 font-normal">Active</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={handleToggle}
            className={cn(
              "cursor-pointer",
              isOn ? "text-destructive focus:text-destructive" : "text-blue-400 focus:text-blue-400"
            )}
            data-testid="menu-item-power-toggle"
          >
            <Power className="w-4 h-4 mr-2" />
            {isOn ? "Shutdown All Bots" : "Power On System"}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Schedule & Limits
          </DropdownMenuLabel>
          
          <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-schedule">
            <Clock className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span>Trading Hours</span>
              <span className="text-xs text-muted-foreground">
                {powerState?.scheduledStart && powerState?.scheduledEnd 
                  ? `${powerState.scheduledStart} - ${powerState.scheduledEnd}`
                  : "24/7 (No schedule)"
                }
              </span>
            </div>
          </DropdownMenuItem>
          
          <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-limits">
            <DollarSign className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span>Daily Loss Limit</span>
              <span className="text-xs text-muted-foreground">
                {powerState?.dailyLossLimit 
                  ? `$${powerState.currentDailyPnL?.toFixed(0) ?? 0} / $${powerState.dailyLossLimit}`
                  : "No limit set"
                }
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Position Management
          </DropdownMenuLabel>

          <div 
            className="flex items-center justify-between px-2 py-1.5"
            data-testid="menu-item-auto-flatten"
          >
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-sm">Auto-Flatten Before Close</span>
                <span className="text-xs text-muted-foreground">
                  {autoFlatten ? `${flattenMinutes} min before session end` : "Disabled"}
                </span>
              </div>
            </div>
            <Switch 
              checked={autoFlatten}
              onCheckedChange={(checked) => toggleAutoFlatten.mutate(checked)}
              disabled={toggleAutoFlatten.isPending}
              data-testid="switch-auto-flatten"
            />
          </div>

          {isThrottled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-amber-400 cursor-default" disabled>
                <Zap className="w-4 h-4 mr-2" />
                Throttle Mode Active
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDialog === "off"} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Power className="w-5 h-5" />
              Shutdown All Bots?
            </DialogTitle>
            <DialogDescription>
              This will immediately stop all bot activity. No new orders will be placed.
              Existing positions will remain open unless you close them manually.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmShutdown}
              disabled={togglePower.isPending}
              data-testid="button-confirm-shutdown"
            >
              {togglePower.isPending ? "Shutting down..." : "Shutdown"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
