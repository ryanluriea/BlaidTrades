import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useAccounts } from "@/hooks/useAccounts";
import http from "@/lib/http";
import { useActionSecurity, isActionAllowed, getActionDenialReason } from "@/hooks/useActionSecurity";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Check, X, AlertTriangle, Shield, ArrowRight, Zap } from "lucide-react";
import type { Alert } from "@/hooks/useAlerts";
import { useLogAlertAction, useUpdateAlertStatus } from "@/hooks/useAlerts";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface PromoteToLiveDialogProps {
  alert: Alert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GateCheck {
  label: string;
  pass: boolean;
  value?: string | number;
  required?: string | number;
}

export function PromoteToLiveDialog({
  alert,
  open,
  onOpenChange,
}: PromoteToLiveDialogProps) {
  const { user } = useAuth();
  const { checkActionSecurity } = useActionSecurity();
  const queryClient = useQueryClient();
  const { data: accounts, isLoading: accountsLoading, isError: accountsError } = useAccounts();
  
  // Fail-closed: treat loading/error/empty as degraded state
  const accountsDegraded = accountsLoading || accountsError || !accounts;
  const logAction = useLogAlertAction();
  const updateStatus = useUpdateAlertStatus();

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [startAsShadow, setStartAsShadow] = useState(true);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [securityBlock, setSecurityBlock] = useState<{ open: boolean; message: string }>({
    open: false,
    message: "",
  });

  const payload = alert?.payloadJson as Record<string, unknown> | null;
  const botId = alert?.entityId;
  const currentStage = (payload?.current_stage as string) || "SHADOW";
  const targetStage = (payload?.next_stage as string) || "LIVE";

  // Filter to only LIVE accounts
  const liveAccounts = accounts?.filter((a) => a.accountType === "LIVE" && a.isActive);

  // Build gate checks from payload
  const gates: GateCheck[] = [];
  if (payload?.gates) {
    const gatesData = payload.gates as Record<
      string,
      { value: number; required: number; pass: boolean }
    >;
    Object.entries(gatesData).forEach(([key, gate]) => {
      gates.push({
        label: key.charAt(0).toUpperCase() + key.slice(1),
        pass: gate.pass,
        value: gate.value,
        required: gate.required,
      });
    });
  }

  const allGatesPass = gates.length === 0 || gates.every((g) => g.pass);
  const hasLiveAccount = !!(liveAccounts && liveAccounts.length > 0);
  // Fail-closed: disable promotion when accounts data is unavailable
  const canPromote = !accountsDegraded && allGatesPass && selectedAccountId && hasLiveAccount;

  // Promotion mutation
  const promoteMutation = useMutation({
    mutationFn: async () => {
      if (!botId || !user) throw new Error("Missing bot or user");

      const mode = startAsShadow ? "SHADOW" : "LIVE";

      // Call the Express promote endpoint (single control plane)
      const response = await http.post<{ success: boolean; trace_id: string; reasons?: string[]; error?: string }>(
        `/api/bots/${botId}/promote`,
        {
          target_mode: mode,
          account_id: selectedAccountId,
          force: false,
        }
      );

      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.reasons?.join(", ") || response.data?.error || "Promotion failed");
      }

      return response.data;
    },
    onSuccess: async (data) => {
      // Log the action
      if (alert) {
        await logAction.mutateAsync({
          alertId: alert.id,
          actionType: startAsShadow ? "START_SHADOW" : "PROMOTE_TO_LIVE",
          requestJson: {
            bot_id: botId,
            account_id: selectedAccountId,
            start_as_shadow: startAsShadow,
          },
          resultJson: data,
          success: true,
        });

        // Mark alert as resolved
        await updateStatus.mutateAsync({
          alertId: alert.id,
          status: "RESOLVED",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });

      toast.success(
        startAsShadow
          ? "Bot started in SHADOW mode for dress rehearsal"
          : "Bot promoted to LIVE trading"
      );

      onOpenChange(false);
      setShowFinalConfirm(false);
    },
    onError: async (error) => {
      if (alert) {
        await logAction.mutateAsync({
          alertId: alert.id,
          actionType: startAsShadow ? "START_SHADOW" : "PROMOTE_TO_LIVE",
          requestJson: {
            bot_id: botId,
            account_id: selectedAccountId,
            start_as_shadow: startAsShadow,
          },
          resultJson: { error: error.message },
          success: false,
        });
      }

      toast.error(`Promotion failed: ${error.message}`);
    },
  });

  const handlePromote = async () => {
    // Fail-closed: prevent action when accounts data is unavailable
    if (accountsDegraded) {
      toast.error("Cannot promote: account data unavailable");
      return;
    }
    
    // Action-time security check (never on boot)
    const sec = await checkActionSecurity("promote_live");
    if (!isActionAllowed(sec)) {
      setSecurityBlock({ open: true, message: getActionDenialReason(sec) || "Live action blocked" });
      return;
    }

    if (!startAsShadow) {
      // Show extra confirmation for direct LIVE promotion
      setShowFinalConfirm(true);
    } else {
      promoteMutation.mutate();
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedAccountId("");
      setStartAsShadow(true);
      setShowFinalConfirm(false);
    }
  }, [open]);

  if (!alert) return null;

  return (
    <>
      <AlertDialog open={securityBlock.open} onOpenChange={(v) => setSecurityBlock((s) => ({ ...s, open: v }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Action blocked
            </AlertDialogTitle>
            <AlertDialogDescription>{securityBlock.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSecurityBlock({ open: false, message: "" })}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Promote to LIVE
            </DialogTitle>
            <DialogDescription>
              Review eligibility and configure the promotion to live trading.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Fail-closed: Show degraded banner when accounts unavailable */}
            {accountsDegraded && (
              <DegradedBanner
                message={accountsError ? "Failed to load accounts" : "Loading accounts..."}
                error_code={accountsError ? "ACCOUNTS_FETCH_ERROR" : undefined}
              />
            )}
            
            {/* Bot Info */}
            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{alert.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Badge variant="outline">{currentStage}</Badge>
                <ArrowRight className="w-3 h-3" />
                <Badge variant="default">{targetStage}</Badge>
              </div>
            </div>

            {/* Eligibility Checklist */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Eligibility Checklist
              </Label>
              <div className="space-y-1.5">
                {gates.map((gate, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {gate.pass ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-destructive" />
                      )}
                      {gate.label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {gate.value !== undefined && gate.required !== undefined
                        ? `${gate.value} / ${gate.required}`
                        : gate.pass
                        ? "" // RULE: No "OK" badges - checkmark icon already indicates pass
                        : "FAIL"}
                    </span>
                  </div>
                ))}
                {gates.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    All gates passed
                  </div>
                )}
              </div>
            </div>

            {/* Account Selection */}
            <div>
              <Label htmlFor="account" className="text-xs text-muted-foreground">
                Select LIVE Account
              </Label>
              {/* Only show "no accounts" warning when not degraded */}
              {!accountsDegraded && !hasLiveAccount ? (
                <div className="mt-1.5 p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="w-4 h-4" />
                    No LIVE accounts available
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a LIVE account with broker credentials first.
                  </p>
                </div>
              ) : (
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                  disabled={accountsDegraded}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={accountsDegraded ? "Loading..." : "Choose account..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {liveAccounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div className="flex items-center gap-2">
                          <span>{account.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {account.broker || account.provider}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Shadow toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <Label
                  htmlFor="shadow-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  Start in SHADOW first
                </Label>
                <p className="text-xs text-muted-foreground">
                  Recommended: Run a dress rehearsal before live orders
                </p>
              </div>
              <Switch
                id="shadow-toggle"
                checked={startAsShadow}
                onCheckedChange={setStartAsShadow}
                disabled={accountsDegraded}
              />
            </div>

            {/* Warning for direct LIVE */}
            {!startAsShadow && (
              <div className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
                  <Zap className="w-4 h-4" />
                  Real broker orders will be sent
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Skipping SHADOW mode means orders execute with real money immediately.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePromote}
              disabled={!canPromote || promoteMutation.isPending}
            >
              {promoteMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
              {startAsShadow ? "Start SHADOW" : "Promote to LIVE"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final confirmation for direct LIVE */}
      <AlertDialog open={showFinalConfirm} onOpenChange={setShowFinalConfirm}>
        <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Confirm LIVE Trading
              </AlertDialogTitle>
              <AlertDialogDescription>
                You are about to enable LIVE trading. This will send real orders to your broker. This action cannot be undone.
                <br />
                <br />
                <strong>Are you absolutely sure?</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  // Fail-closed: prevent action when accounts data is unavailable
                  if (accountsDegraded) {
                    setShowFinalConfirm(false);
                    toast.error("Cannot promote: account data unavailable");
                    return;
                  }
                  
                  const sec = await checkActionSecurity("promote_live");
                  if (!isActionAllowed(sec)) {
                    setShowFinalConfirm(false);
                    setSecurityBlock({ open: true, message: getActionDenialReason(sec) || "Live action blocked" });
                    return;
                  }
                  promoteMutation.mutate();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {promoteMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                Yes, Start LIVE Trading
              </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
