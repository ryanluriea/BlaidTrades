import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  ShieldAlert,
  XOctagon,
  Pause,
  Lock,
  Camera,
  AlertTriangle,
  CheckCircle,
  WrenchIcon,
} from "lucide-react";
import { toast } from "sonner";
import http from "@/lib/http";

interface EmergencyState {
  live_trading_killed: boolean;
  promotions_frozen: boolean;
  allocator_locked: boolean;
}

export function EmergencyControlsPanel() {
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [emergencyState, setEmergencyState] = useState<EmergencyState>({
    live_trading_killed: false,
    promotions_frozen: false,
    allocator_locked: false,
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async (field: keyof EmergencyState) => {
    setIsLoading(true);
    try {
      const newValue = !emergencyState[field];
      await http.post('/api/emergency/toggle', { field, value: newValue });
      setEmergencyState(prev => ({ ...prev, [field]: newValue }));
      toast.success(newValue ? `Emergency: ${field} ACTIVATED` : `${field} deactivated`);
    } catch (error: any) {
      toast.error(`Failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  };

  const handleSnapshot = async () => {
    try {
      await http.post('/api/emergency/snapshot', {});
      toast.success('System snapshot saved');
    } catch (error: any) {
      toast.error(`Snapshot failed: ${error.message || 'Unknown error'}`);
    }
  };

  const anyEmergencyActive =
    emergencyState.live_trading_killed ||
    emergencyState.promotions_frozen ||
    emergencyState.allocator_locked;

  const controls = [
    {
      id: "live_trading_killed" as const,
      title: "Kill Live Trading",
      description: "Immediately halt all LIVE stage trading",
      icon: XOctagon,
      activeColor: "text-destructive",
    },
    {
      id: "promotions_frozen" as const,
      title: "Freeze Promotions",
      description: "Prevent any stage promotions",
      icon: Pause,
      activeColor: "text-amber-500",
    },
    {
      id: "allocator_locked" as const,
      title: "Lock Allocator",
      description: "Prevent capital allocation changes",
      icon: Lock,
      activeColor: "text-amber-500",
    },
  ];

  return (
    <Card className={anyEmergencyActive ? "border-destructive" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${anyEmergencyActive ? "text-destructive" : "text-muted-foreground"}`} />
            <CardTitle>Emergency Controls</CardTitle>
          </div>
          {anyEmergencyActive && (
            <Badge variant="destructive" className="animate-pulse">
              EMERGENCY MODE ACTIVE
            </Badge>
          )}
        </div>
        <CardDescription>
          Critical system controls for emergencies. These actions take effect immediately.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {controls.map((control) => (
          <div
            key={control.id}
            className="flex items-center justify-between gap-4 p-3 rounded-lg border"
          >
            <div className="flex items-center gap-3 flex-1">
              <control.icon
                className={`h-5 w-5 ${
                  emergencyState[control.id] ? control.activeColor : "text-muted-foreground"
                }`}
              />
              <div>
                <Label className="text-sm font-medium">{control.title}</Label>
                <p className="text-xs text-muted-foreground">{control.description}</p>
              </div>
            </div>
            
            <AlertDialog open={confirmAction === control.id} onOpenChange={(open) => !open && setConfirmAction(null)}>
              <AlertDialogTrigger asChild>
                <Switch
                  checked={emergencyState[control.id]}
                  onCheckedChange={() => setConfirmAction(control.id)}
                  disabled={isLoading}
                  data-testid={`switch-${control.id}`}
                />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Confirm {emergencyState[control.id] ? "Deactivate" : "Activate"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {emergencyState[control.id]
                      ? `Are you sure you want to deactivate ${control.title}?`
                      : `Are you sure you want to activate ${control.title}? This is an emergency action.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleToggle(control.id)}
                    className={emergencyState[control.id] ? "" : "bg-destructive hover:bg-destructive/90"}
                  >
                    {emergencyState[control.id] ? "Deactivate" : "Activate"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}

        <Separator />

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSnapshot}
            data-testid="button-snapshot"
          >
            <Camera className="h-4 w-4 mr-2" />
            System Snapshot
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {anyEmergencyActive ? (
              <>
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Emergency controls active
              </>
            ) : (
              <>
                <CheckCircle className="h-3 w-3 text-green-500" />
                All systems normal
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
