import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAccounts } from "@/hooks/useAccounts";
import { useCreateBotInstance } from "@/hooks/useBotInstances";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import type { Bot } from "@/hooks/useBots";
import {
  isValidModeForAccount,
  getValidModesForAccount,
  getModeDisabledReason,
  EXECUTION_MODE_INFO,
  ACCOUNT_TYPE_INFO,
  type AccountType,
  type ExecutionMode,
} from "@/lib/executionRouting";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AttachToAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: Bot;
}

export function AttachToAccountDialog({ open, onOpenChange, bot }: AttachToAccountDialogProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>("SIM_LIVE");
  
  const { data: accountsRaw, isLoading, isError } = useAccounts();
  const accounts = accountsRaw ?? [];
  const createInstance = useCreateBotInstance();

  const isAccountsDegraded = isError || (!isLoading && !accountsRaw);

  // Get the selected account
  const selectedAccount = useMemo(() => 
    accounts.find(acc => acc.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  // Get valid modes for selected account
  const validModes = useMemo(() => {
    if (!selectedAccount) return ["SIM_LIVE", "SHADOW"] as ExecutionMode[];
    return getValidModesForAccount(selectedAccount.accountType as AccountType)
      .filter(mode => mode !== "BACKTEST_ONLY"); // Don't show backtest in attach dialog
  }, [selectedAccount]);

  // Check if current mode is valid for selected account
  const isModeValid = useMemo(() => {
    if (!selectedAccount) return true;
    return isValidModeForAccount(selectedAccount.accountType as AccountType, selectedMode);
  }, [selectedAccount, selectedMode]);

  // Reset mode if it becomes invalid
  useMemo(() => {
    if (!isModeValid && validModes.length > 0) {
      setSelectedMode(validModes[0]);
    }
  }, [isModeValid, validModes]);

  const handleAttach = () => {
    if (!selectedAccountId || !isModeValid || !selectedAccount) return;

    // For VIRTUAL/SIM accounts, create sandbox with account's initial balance
    const isTemplateSandbox = selectedAccount.accountType === 'VIRTUAL' || selectedAccount.accountType === 'SIM';
    const sandboxBalance = isTemplateSandbox ? selectedAccount.initialBalance : undefined;

    createInstance.mutate(
      {
        botId: bot.id,
        accountId: selectedAccountId,
        executionMode: selectedMode,
        ...(sandboxBalance !== undefined && {
          sandboxInitialBalance: sandboxBalance,
          sandboxCurrentBalance: sandboxBalance,
          sandboxPeakBalance: sandboxBalance,
          sandboxMaxDrawdown: 0,
        }),
      } as unknown as Parameters<typeof createInstance.mutate>[0],
      {
        onSuccess: () => {
          onOpenChange(false);
          setSelectedAccountId("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach {bot.name} to Account</DialogTitle>
          <DialogDescription>
            Select an account and execution mode for this bot instance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isAccountsDegraded ? (
            <DegradedBanner message="Account data unavailable - cannot attach bot" />
          ) : (
          <>
          <div className="space-y-2">
            <Label>Account</Label>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId} disabled={isAccountsDegraded}>
              <SelectTrigger>
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => {
                  const typeInfo = ACCOUNT_TYPE_INFO[account.accountType as AccountType];
                  return (
                    <SelectItem key={account.id} value={account.id}>
                      <div className="flex items-center gap-2">
                        <span>{account.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {typeInfo?.shortLabel || account.accountType}
                        </Badge>
                        <span className="text-muted-foreground">
                          ${account.currentBalance.toLocaleString()}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedAccount && (
              <p className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_INFO[selectedAccount.accountType as AccountType]?.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Execution Mode</Label>
            <Select 
              value={selectedMode} 
              onValueChange={(v) => setSelectedMode(v as ExecutionMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["SIM_LIVE", "SHADOW", "LIVE"] as ExecutionMode[]).map((mode) => {
                  const modeInfo = EXECUTION_MODE_INFO[mode];
                  const isDisabled = selectedAccount && !isValidModeForAccount(
                    selectedAccount.accountType as AccountType, 
                    mode
                  );
                  const disabledReason = selectedAccount ? getModeDisabledReason(
                    selectedAccount.accountType as AccountType,
                    mode
                  ) : null;

                  return (
                    <TooltipProvider key={mode}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <SelectItem 
                              value={mode} 
                              disabled={isDisabled}
                              className={isDisabled ? "opacity-50" : ""}
                            >
                              <div className="flex items-center gap-2">
                                <span>{modeInfo.label}</span>
                                {isDisabled && <AlertTriangle className="w-3 h-3 text-muted-foreground" />}
                              </div>
                            </SelectItem>
                          </div>
                        </TooltipTrigger>
                        {disabledReason && (
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs">{disabledReason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {EXECUTION_MODE_INFO[selectedMode].description}
            </p>
          </div>

          {selectedAccount && (selectedAccount.accountType === 'VIRTUAL' || selectedAccount.accountType === 'SIM') && (
            <Alert variant="default" className="bg-primary/5 border-primary/20">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-xs">
                <strong>Sandbox Mode:</strong> This bot will get its own isolated balance of ${selectedAccount.initialBalance.toLocaleString()}. 
                P&L and positions are tracked separately from other bots.
              </AlertDescription>
            </Alert>
          )}

          {selectedMode === "LIVE" && selectedAccount?.accountType === "LIVE" && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Warning:</strong> LIVE mode will send real orders to your broker. 
                Ensure risk settings are properly configured.
              </AlertDescription>
            </Alert>
          )}

          {selectedAccount && !selectedAccount.allowSharedBots && (
            <Alert variant="default" className="bg-muted/50">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This account is configured for dedicated bot access. 
                Only one bot can trade on it at a time.
              </AlertDescription>
            </Alert>
          )}
          </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleAttach} 
            disabled={isAccountsDegraded || !selectedAccountId || createInstance.isPending || !isModeValid}
          >
            {createInstance.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Attach Bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
