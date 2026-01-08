import { useState, useEffect } from "react";
import { useUpdateAccount, type Account } from "@/hooks/useAccounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Loader2, Info, AlertTriangle, RotateCcw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RiskSettingsForm, getDefaultRiskSettings, type RiskSettings } from "./RiskSettingsForm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface EditAccountDialogProps {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAccountDialog({ account, open, onOpenChange }: EditAccountDialogProps) {
  const updateAccount = useUpdateAccount();
  const [name, setName] = useState("");
  const [allowSharedBots, setAllowSharedBots] = useState(false);
  const [metricsMode, setMetricsMode] = useState<"ISOLATED" | "POOLED">("ISOLATED");
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(getDefaultRiskSettings("moderate"));
  const [initialBalance, setInitialBalance] = useState(10000);
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [showResetPnlConfirm, setShowResetPnlConfirm] = useState(false);
  const [showBalanceChangeConfirm, setShowBalanceChangeConfirm] = useState(false);
  const [pendingBalanceChange, setPendingBalanceChange] = useState<number | null>(null);

  // Parse balance values safely
  const getInitialBalance = () => {
    if (!account) return 10000;
    const raw = (account as any).initialBalance ?? (account as any).initial_balance;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 10000;
  };

  const getCurrentBalance = () => {
    if (!account) return 10000;
    const raw = (account as any).currentBalance ?? (account as any).current_balance;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 10000;
  };

  const pnl = account ? getCurrentBalance() - getInitialBalance() : 0;

  useEffect(() => {
    if (account) {
      setName(account.name);
      setAllowSharedBots(account.allowSharedBots || false);
      setMetricsMode(((account as any).metricsMode || (account as any).metrics_mode || "ISOLATED") as "ISOLATED" | "POOLED");
      setInitialBalance(getInitialBalance());
      setIsEditingBalance(false);
      setRiskSettings({
        risk_tier: account.riskTier as RiskSettings["risk_tier"],
        risk_percent_per_trade: account.riskPercentPerTrade || 0.005,
        max_risk_dollars_per_trade: account.maxRiskDollarsPerTrade,
        max_contracts_per_trade: account.maxContractsPerTrade || 3,
        max_contracts_per_symbol: account.maxContractsPerSymbol || 5,
        max_total_exposure_contracts: account.maxTotalExposureContracts || 8,
        max_daily_loss_percent: account.maxDailyLossPercent || 0.02,
        max_daily_loss_dollars: account.maxDailyLossDollars,
      });
    }
  }, [account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    
    // Check if balance changed and requires confirmation
    const originalBalance = getInitialBalance();
    if (isEditingBalance && initialBalance !== originalBalance) {
      setPendingBalanceChange(initialBalance);
      setShowBalanceChangeConfirm(true);
      return;
    }
    
    await saveChanges();
  };

  const saveChanges = async (newInitialBalance?: number, resetPnl?: boolean) => {
    if (!account) return;
    
    const updateData: Record<string, unknown> = {
      id: account.id,
      name,
      allow_shared_bots: allowSharedBots,
      metrics_mode: metricsMode,
      risk_tier: riskSettings.risk_tier === "custom" ? "moderate" : riskSettings.risk_tier,
      risk_percent_per_trade: riskSettings.risk_percent_per_trade,
      max_risk_dollars_per_trade: riskSettings.max_risk_dollars_per_trade,
      max_contracts_per_trade: riskSettings.max_contracts_per_trade,
      max_contracts_per_symbol: riskSettings.max_contracts_per_symbol,
      max_total_exposure_contracts: riskSettings.max_total_exposure_contracts,
      max_daily_loss_percent: riskSettings.max_daily_loss_percent,
      max_daily_loss_dollars: riskSettings.max_daily_loss_dollars,
    };

    // Handle balance changes
    if (newInitialBalance !== undefined) {
      updateData.initial_balance = newInitialBalance;
      // When changing initial balance, also update current balance to match (reset PnL)
      updateData.current_balance = newInitialBalance;
    } else if (resetPnl) {
      // Reset PnL: set current balance back to initial balance
      updateData.current_balance = getInitialBalance();
    }
    
    await updateAccount.mutateAsync(updateData as any);

    onOpenChange(false);
  };

  const handleResetPnl = () => {
    setShowResetPnlConfirm(true);
  };

  const confirmResetPnl = async () => {
    await saveChanges(undefined, true);
    setShowResetPnlConfirm(false);
  };

  const confirmBalanceChange = async () => {
    if (pendingBalanceChange !== null) {
      await saveChanges(pendingBalanceChange);
    }
    setShowBalanceChangeConfirm(false);
    setPendingBalanceChange(null);
  };

  if (!account) return null;

  const canEditSharing = account.accountType === "VIRTUAL" || account.accountType === "SIM";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Edit Account Settings</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <StatusBadge status={account.accountType as any} />
            <StatusBadge status={(account as any).provider || "INTERNAL"} />
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="flex-1 pr-4 max-h-[60vh]">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Account Name</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="text-xs text-muted-foreground">Starting Balance</p>
                      {!isEditingBalance && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs"
                          onClick={() => setIsEditingBalance(true)}
                          data-testid="button-edit-balance"
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                    {isEditingBalance ? (
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-mono">$</span>
                        <Input
                          type="number"
                          value={initialBalance}
                          onChange={(e) => setInitialBalance(Number(e.target.value))}
                          className="h-7 font-mono text-sm w-24"
                          min={0}
                          step={1000}
                          data-testid="input-initial-balance"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => {
                            setIsEditingBalance(false);
                            setInitialBalance(getInitialBalance());
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p className="font-mono font-medium">${getInitialBalance().toLocaleString()}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
                    <p className="font-mono font-medium">${getCurrentBalance().toLocaleString()}</p>
                  </div>
                </div>

                {/* PnL and Reset Section */}
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div>
                    <p className="text-xs text-muted-foreground">Total P&L</p>
                    <p className={`font-mono font-medium ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </p>
                  </div>
                  {pnl !== 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={handleResetPnl}
                            data-testid="button-reset-pnl"
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            Reset P&L
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Reset current balance to starting balance</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {isEditingBalance && initialBalance !== getInitialBalance() && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Changing starting balance will reset the account's tracked P&L. Bot trade history remains unaffected.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {canEditSharing && (
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="edit-allow_shared_bots" className="cursor-pointer">
                      Allow Multiple Bots
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs text-xs">
                            When enabled, multiple bots can trade on this account simultaneously.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Switch
                    id="edit-allow_shared_bots"
                    checked={allowSharedBots}
                    onCheckedChange={setAllowSharedBots}
                  />
                </div>
              )}

              {/* Metrics Mode Setting */}
              {allowSharedBots && (
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Label className="cursor-pointer">Metrics Mode</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs font-medium mb-1">Isolated vs Pooled</p>
                          <p className="text-xs text-muted-foreground">
                            <strong>Isolated:</strong> Each bot has separate P&L tracking. Use for testing multiple independent strategies.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            <strong>Pooled:</strong> All bots share the account balance. P&L is combined across all bots.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={metricsMode === "ISOLATED" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMetricsMode("ISOLATED")}
                      data-testid="button-metrics-isolated"
                    >
                      Isolated
                    </Button>
                    <Button
                      type="button"
                      variant={metricsMode === "POOLED" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMetricsMode("POOLED")}
                      data-testid="button-metrics-pooled"
                    >
                      Pooled
                    </Button>
                  </div>
                </div>
              )}

              {/* Risk Settings Section */}
              <div className="pt-2 border-t border-border">
                <h4 className="text-sm font-medium mb-3">Risk & Position Sizing</h4>
                <RiskSettingsForm
                  value={riskSettings}
                  onChange={setRiskSettings}
                  accountEquity={getCurrentBalance()}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4 flex-shrink-0 border-t border-border/50 mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateAccount.isPending || !name}>
              {updateAccount.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Reset PnL Confirmation Dialog */}
      <AlertDialog open={showResetPnlConfirm} onOpenChange={setShowResetPnlConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset P&L to Zero?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the current balance back to ${getInitialBalance().toLocaleString()}, 
              effectively zeroing out {pnl >= 0 ? 'gains' : 'losses'} of{' '}
              <span className={pnl >= 0 ? 'text-profit' : 'text-loss'}>
                {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmResetPnl}>
              Confirm Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Balance Change Confirmation Dialog */}
      <AlertDialog open={showBalanceChangeConfirm} onOpenChange={setShowBalanceChangeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Starting Balance?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the starting balance from ${getInitialBalance().toLocaleString()} to ${pendingBalanceChange?.toLocaleString() || '0'} 
              will reset the current balance to the new starting value and zero out tracked P&L. 
              <span className="block mt-2 font-medium">Note: Bot trade history and paper trade records remain unaffected.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingBalanceChange(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBalanceChange}>
              Confirm Change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
