/**
 * AccountBadge - Inline wallet icon button with account count badge
 * 
 * Displays inline next to bot name for PAPER+ stages.
 * Shows wallet icon with badge count when multiple accounts attached.
 */
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Wallet, Lock, AlertTriangle, Bomb } from "lucide-react";
import { useUpdateBotAccount } from "@/hooks/useBotInlineEdit";
import { useAccounts, type EnrichedAccount } from "@/hooks/useAccounts";

interface AccountBadgeProps {
  botId: string;
  stage: string;
  accountId?: string | null;
  accountName?: string | null;
  accountType?: 'SIM' | 'LIVE' | 'DEMO' | null;
  linkedAccountCount?: number;
  isLocked?: boolean;
  lockReason?: string;
  className?: string;
}

export function AccountBadge({
  botId,
  stage,
  accountId,
  accountName,
  accountType,
  linkedAccountCount = 1,
  isLocked = false,
  lockReason,
  className,
}: AccountBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(accountId ?? undefined);
  
  const { data: accountsRaw, isLoading: accountsLoading, error: accountsError } = useAccounts();
  
  // Sync selected account when prop changes (e.g., after mutation and cache refresh)
  useEffect(() => {
    if (!isOpen) {
      setSelectedAccountId(accountId ?? undefined);
    }
  }, [accountId, isOpen]);
  const updateAccountMutation = useUpdateBotAccount();
  
  const isPaperPlus = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  
  if (!isPaperPlus) return null;
  
  const accounts = accountsRaw ?? [];
  const simAccounts = accounts.filter(a => a.accountType === 'SIM');
  const liveAccounts = accounts.filter(a => a.accountType === 'LIVE');
  
  const currentAccount = accounts.find(a => a.id === accountId);
  const displayAccountName = accountName || currentAccount?.name;
  const displayAccountType = accountType || currentAccount?.accountType;
  const accountTypeDisplay = displayAccountType || (stage === 'LIVE' ? 'LIVE' : 'SIM');
  // Use computed balance (initial + bot P&L) for dynamic wallet display
  const accountBalance = currentAccount?.computedBalance ?? currentAccount?.currentBalance ?? null;
  const totalBotPnl = currentAccount?.totalBotPnl ?? 0;
  const totalBlownCount = currentAccount?.totalBlownCount ?? 0;
  const consecutiveBlownCount = currentAccount?.consecutiveBlownCount ?? 0;
  const isAccountsDegraded = accountsError || (!accountsLoading && !accountsRaw);
  
  const formatBalance = (balance: number | null) => {
    if (balance === null) return null;
    if (balance >= 1000000) return `$${(balance / 1000000).toFixed(1)}M`;
    if (balance >= 100000) return `$${(balance / 1000).toFixed(0)}K`;
    return `$${Math.round(balance).toLocaleString()}`;
  };
  
  const handleAccountSave = () => {
    if (!selectedAccountId || selectedAccountId === accountId) {
      setIsOpen(false);
      return;
    }
    updateAccountMutation.mutate(
      { 
        botId, 
        oldAccountId: accountId ?? null, 
        newAccountId: selectedAccountId,
        stage,
      },
      {
        onSuccess: () => setIsOpen(false),
        onError: () => setSelectedAccountId(accountId ?? undefined),
      }
    );
  };
  
  const handleAccountCancel = () => {
    setSelectedAccountId(accountId ?? undefined);
    setIsOpen(false);
  };

  const badgeCount = linkedAccountCount > 1 ? linkedAccountCount : null;
  
  if (isAccountsDegraded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={cn(
              "inline-flex items-center gap-1 px-1.5 h-6 rounded-md",
              "bg-amber-500/10 text-amber-500 cursor-not-allowed",
              className
            )}
            data-testid={`account-badge-${botId}`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">N/A</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Account data unavailable
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isLocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={cn(
              "inline-flex items-center gap-1 px-1.5 h-6 rounded-md",
              "bg-muted/50 text-muted-foreground/50 cursor-not-allowed",
              className
            )}
            data-testid={`account-badge-${botId}`}
          >
            <Wallet className="w-3 h-3" />
            {accountBalance !== null && (
              <span className="text-[10px] font-medium">{formatBalance(accountBalance)}</span>
            )}
            <Lock className="w-2.5 h-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div>{displayAccountName || "No account"}</div>
          {accountBalance !== null && <div>Balance: ${accountBalance.toLocaleString()}</div>}
          <div className="text-muted-foreground">{lockReason || "Account editing locked"}</div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (!open) handleAccountCancel();
      else setIsOpen(true);
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 h-6 rounded-md relative",
                "transition-colors cursor-pointer",
                displayAccountName 
                  ? "bg-muted/50 text-foreground hover:bg-muted"
                  : "bg-transparent text-muted-foreground/50 hover:bg-muted/30 border border-dashed border-muted-foreground/30",
                className
              )}
              data-testid={`account-badge-${botId}`}
            >
              <Wallet className="w-3 h-3 flex-shrink-0" />
              {accountBalance !== null && (
                <span className="text-[10px] font-medium">{formatBalance(accountBalance)}</span>
              )}
              {badgeCount && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-0.5">
                  {badgeCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-1">
          {displayAccountName ? (
            <>
              <div>Account: {displayAccountName}</div>
              <div>Type: {accountTypeDisplay}</div>
              {currentAccount?.initialBalance != null && (
                <div>Starting: ${currentAccount.initialBalance.toLocaleString()}</div>
              )}
              {accountBalance !== null && <div>Balance: ${accountBalance.toLocaleString()}</div>}
              {totalBotPnl !== 0 && (
                <div className={totalBotPnl >= 0 ? "text-green-400" : "text-red-400"}>
                  P&L: {totalBotPnl >= 0 ? '+' : ''}${totalBotPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              {totalBlownCount > 0 && (
                <div className="flex items-center gap-1 text-amber-400">
                  <Bomb className="w-3 h-3" />
                  <span>{totalBlownCount} blown {totalBlownCount === 1 ? 'attempt' : 'attempts'}</span>
                  {consecutiveBlownCount >= 2 && (
                    <span className="text-red-400">({consecutiveBlownCount} consecutive)</span>
                  )}
                </div>
              )}
              {badgeCount && <div>{badgeCount} accounts linked</div>}
              <div className="text-muted-foreground">Click to change</div>
            </>
          ) : (
            <div>Click to attach account</div>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent 
        align="start" 
        side="bottom" 
        className="w-48 p-2" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <Select
            value={selectedAccountId}
            onValueChange={setSelectedAccountId}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select account..." />
            </SelectTrigger>
            <SelectContent>
              {simAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">SIM Accounts</SelectLabel>
                  {simAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id} className="text-xs">
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {liveAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-green-400">LIVE Accounts</SelectLabel>
                  {liveAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id} className="text-xs">
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {accounts.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No accounts available</div>
              )}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 h-7 text-xs"
              onClick={handleAccountCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleAccountSave}
              disabled={updateAccountMutation.isPending || !selectedAccountId}
            >
              {updateAccountMutation.isPending ? "..." : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
