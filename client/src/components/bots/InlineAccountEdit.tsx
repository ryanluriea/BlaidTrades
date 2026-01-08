import { useState, useEffect } from "react";
import { Check, X, Lock, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateBotAccount } from "@/hooks/useBotInlineEdit";
import { useAccounts, type Account } from "@/hooks/useAccounts";
import { cn } from "@/lib/utils";

interface InlineAccountEditProps {
  botId: string;
  currentAccountId: string | null;
  currentAccountName: string | null;
  currentAccountType: string | null;
  stage: string;
  isLocked?: boolean;
  lockReason?: string;
}

export function InlineAccountEdit({
  botId,
  currentAccountId,
  currentAccountName,
  currentAccountType,
  stage,
  isLocked = false,
  lockReason,
}: InlineAccountEditProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayAccountId, setDisplayAccountId] = useState<string | null>(currentAccountId);
  const [displayAccountName, setDisplayAccountName] = useState<string | null>(currentAccountName);
  const [displayAccountType, setDisplayAccountType] = useState<string | null>(currentAccountType);
  const [selectedAccountId, setSelectedAccountId] = useState(currentAccountId || "");
  const updateAccount = useUpdateBotAccount();
  const { data: accountsRaw, isLoading, isError } = useAccounts();
  const accounts = accountsRaw ?? [];

  const isAccountsDegraded = isError || (!isLoading && !accountsRaw);

  // Filter accounts based on stage compatibility
  const compatibleAccounts = accounts.filter((account: Account) => {
    if (stage === "LIVE") {
      return account.accountType === "LIVE";
    }
    if (stage === "PAPER") {
      return account.accountType !== "LIVE"; // VIRTUAL or SIM
    }
    if (stage === "SHADOW") {
      return true; // All account types allowed for SHADOW
    }
    // TRIALS - all accounts or none
    return true;
  });

  // Group accounts by type
  const virtualAccounts = compatibleAccounts.filter((a: Account) => a.accountType === "VIRTUAL");
  const simAccounts = compatibleAccounts.filter((a: Account) => a.accountType === "SIM");
  const liveAccounts = compatibleAccounts.filter((a: Account) => a.accountType === "LIVE");

  // Sync display state when props change from external sources (e.g., initial data load)
  useEffect(() => {
    // Only sync if we have new data from props and we're not in edit mode
    if (!isOpen && currentAccountId !== displayAccountId) {
      setDisplayAccountId(currentAccountId);
      setDisplayAccountName(currentAccountName);
      setDisplayAccountType(currentAccountType);
      setSelectedAccountId(currentAccountId || "");
    }
  }, [currentAccountId, currentAccountName, currentAccountType]);

  const handleSave = () => {
    const newAccountId = selectedAccountId === "none" ? null : selectedAccountId || null;

    if (newAccountId !== displayAccountId) {
      // Optimistically update local display immediately so the chip updates
      if (newAccountId) {
        const account = accounts.find((a) => a.id === newAccountId) as Account | undefined;
        setDisplayAccountId(newAccountId);
        setDisplayAccountName(account?.name || null);
        setDisplayAccountType(account?.accountType || null);
      } else {
        setDisplayAccountId(null);
        setDisplayAccountName(null);
        setDisplayAccountType(null);
      }

      updateAccount.mutate({
        botId,
        oldAccountId: displayAccountId,
        newAccountId,
        stage,
      });

      setIsOpen(false);
    } else {
      setIsOpen(false);
    }
  };

  const handleCancel = () => {
    setSelectedAccountId(displayAccountId || "");
    setIsOpen(false);
  };

  const displayText = displayAccountName
    ? `${displayAccountName} · ${displayAccountType || "SIM"}`.toUpperCase()
    : "—";

  if (isAccountsDegraded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="hidden md:flex items-center justify-center px-2 py-1 rounded-full bg-amber-500/20 text-[11px] font-medium text-amber-500 w-32 flex-shrink-0 cursor-not-allowed gap-1 uppercase tracking-wide">
            <span className="truncate">Unavailable</span>
          </div>
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
          <div className="hidden md:flex items-center justify-center px-2 py-1 rounded-full bg-muted/50 text-[11px] font-medium text-muted-foreground w-32 flex-shrink-0 cursor-not-allowed gap-1 uppercase tracking-wide">
            <span className="truncate">{displayText}</span>
            <Lock className="w-2.5 h-2.5 flex-shrink-0" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {lockReason || "Editing locked"}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (!open) handleCancel();
      else setIsOpen(true);
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="hidden md:flex items-center justify-center px-2 py-1 rounded-full bg-muted/50 text-[11px] font-medium text-muted-foreground w-32 flex-shrink-0 hover:bg-muted/70 cursor-pointer transition-colors group uppercase tracking-wide"
              data-testid={`button-account-edit-${botId}`}
            >
              <span className="truncate">{displayText}</span>
              <Link2 className="w-2.5 h-2.5 ml-1 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-1">
          {currentAccountName ? (
            <>
              <div>Account: {currentAccountName}</div>
              <div>Type: {currentAccountType}</div>
              <div className="text-muted-foreground">Click to change</div>
            </>
          ) : (
            <div>Click to attach account</div>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent 
        align="end" 
        side="bottom" 
        className="w-48 p-2" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <Select value={selectedAccountId || "none"} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="h-7 text-[11px] px-2">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {stage === 'TRIALS' && (
                <SelectItem value="none" className="text-xs">
                  No account
                </SelectItem>
              )}
              
              {virtualAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Virtual</SelectLabel>
                  {virtualAccounts.map((account: Account) => (
                    <SelectItem key={account.id} value={account.id} className="text-xs">
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              
              {simAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Simulation</SelectLabel>
                  {simAccounts.map((account: Account) => (
                    <SelectItem key={account.id} value={account.id} className="text-xs">
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              
              {liveAccounts.length > 0 && stage !== "PAPER" && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Live</SelectLabel>
                  {liveAccounts.map((account: Account) => (
                    <SelectItem key={account.id} value={account.id} className="text-xs">
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              
              {compatibleAccounts.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No compatible accounts
                </div>
              )}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-3 text-xs"
              onClick={handleSave}
              disabled={updateAccount.isPending}
            >
              {updateAccount.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
