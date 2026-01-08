import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBots } from "@/hooks/useBots";
import { useLinkedBots } from "@/hooks/useLinkedBots";
import { useCreateBotInstance } from "@/hooks/useBotInstances";
import { Loader2, Info, Bot } from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import type { Account } from "@/hooks/useAccounts";

type AccountType = "VIRTUAL" | "SIM" | "LIVE";
type BotMode = "SHADOW" | "LIVE" | "BACKTEST_ONLY" | "SIM_LIVE";

interface AttachBotToAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}

// Derive execution mode from bot stage and account type
function deriveExecutionMode(botStage: string, accountType: AccountType): BotMode {
  // VIRTUAL/SIM accounts can only run SIM_LIVE or SHADOW
  if (accountType === "VIRTUAL" || accountType === "SIM") {
    return botStage === "SHADOW" ? "SHADOW" : "SIM_LIVE";
  }
  
  // LIVE accounts: mode matches bot stage
  switch (botStage) {
    case "LIVE":
    case "CANARY":
      return "LIVE";
    case "SHADOW":
      return "SHADOW";
    default:
      return "SIM_LIVE";
  }
}

export function AttachBotToAccountDialog({ open, onOpenChange, account }: AttachBotToAccountDialogProps) {
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  
  const { data: allBots = [], isLoading: botsLoading, isError: botsError } = useBots();
  const { data: linkedBotsRaw, isLoading: linkedLoading, isError: linkedError } = useLinkedBots(account.id);
  const createInstance = useCreateBotInstance();

  // Extract linked bots from the result wrapper - useLinkedBots returns { data: LinkedBot[], degraded, ... }
  const linkedBots = linkedBotsRaw?.data ?? [];
  const isBotsDegraded = botsError || (!botsLoading && allBots === undefined);
  const isLinkedDegraded = linkedError || (!linkedLoading && linkedBotsRaw === undefined);

  // Get bots not already attached to this account
  // Filter out TRIALS bots - they operate in backtest-only sandbox mode and don't need account assignment
  const linkedBotIds = new Set(linkedBots.map(lb => lb.botId));
  const availableBots = allBots.filter(bot => 
    !linkedBotIds.has(bot.id) && 
    bot.stage !== 'TRIALS' // TRIALS bots use internal sandbox, no account needed
  );

  // Check if we need to warn about sharing
  const needsSharedAccess = !account.allowSharedBots && linkedBots.length > 0;

  const toggleBotSelection = (id: string) => {
    setSelectedBotIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  };

  const handleAttach = async () => {
    if (!selectedBotIds.length) return;

    // For VIRTUAL/SIM accounts, create sandbox with account's initial balance
    const isTemplateSandbox = account.accountType === "VIRTUAL" || account.accountType === "SIM";
    const sandboxBalance = isTemplateSandbox ? account.initialBalance : undefined;

    // If account doesn't allow shared bots but already has a bot, auto-enable sharing
    if (needsSharedAccess) {
      try {
        const http = (await import("@/lib/http")).default;
        await http.patch(`/api/accounts/${account.id}`, { allowSharedBots: true });
      } catch (e) {
        console.warn("Failed to enable shared bots:", e);
      }
    }

    for (const botId of selectedBotIds) {
      const bot = availableBots.find((b) => b.id === botId) ?? allBots.find((b) => b.id === botId);
      if (!bot) continue;
      
      // Auto-derive execution mode from bot's stage and account type
      const mode = deriveExecutionMode(bot.stage, account.accountType);
      
      await createInstance.mutateAsync({
        botId,
        accountId: account.id,
        executionMode: mode,
        ...(sandboxBalance !== undefined && {
          sandboxInitialBalance: sandboxBalance,
          sandboxCurrentBalance: sandboxBalance,
          sandboxPeakBalance: sandboxBalance,
          sandboxMaxDrawdown: 0,
        }),
      });
    }

    // After attaching, close dialog
    setSelectedBotIds([]);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach Bot to {account.name}</DialogTitle>
          <DialogDescription>
            Select bots to link to this {account.accountType} account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isBotsDegraded ? (
            <DegradedBanner message="Bot data unavailable - cannot attach bots" />
          ) : availableBots.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No available bots</p>
              <p className="text-xs mt-1">All bots are already attached to this account, or no bots exist yet.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Bots</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => {
                      if (selectedBotIds.length === availableBots.length) {
                        setSelectedBotIds([]);
                      } else {
                        setSelectedBotIds(availableBots.map(b => b.id));
                      }
                    }}
                  >
                    {selectedBotIds.length === availableBots.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/50 bg-muted/10 px-2 py-1">
                  {availableBots.map((bot) => {
                    const checked = selectedBotIds.includes(bot.id);
                    const symbol = (bot as any).symbol || 'ES';
                    return (
                      <div
                        key={bot.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleBotSelection(bot.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleBotSelection(bot.id);
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted/40 cursor-pointer"
                        data-testid={`bot-row-${bot.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          className="mr-1 h-3 w-3"
                        />
                        <span className="flex-1 truncate">{bot.name}</span>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {symbol}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {bot.stage}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {selectedBotIds.length
                    ? `${selectedBotIds.length} bot${selectedBotIds.length > 1 ? "s" : ""} selected`
                    : "Select one or more bots to attach"}
                </p>
              </div>

              {(account.accountType === "VIRTUAL" || account.accountType === "SIM") && (
                <Alert variant="default" className="bg-muted/50">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Each bot will start with ${account.initialBalance.toLocaleString()} paper balance.
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
            disabled={isBotsDegraded || !selectedBotIds.length || createInstance.isPending}
          >
            {createInstance.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Attach Bots
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
