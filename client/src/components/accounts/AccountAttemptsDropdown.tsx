import { useState } from "react";
import { format } from "date-fns";
import { Bomb, ChevronDown, History, RefreshCcw, TrendingDown, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { useAccountAttempts, useResetAccount } from "@/hooks/useAccounts";
import type { AccountAttempt } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AccountAttemptsDropdownProps {
  accountId: string;
  currentBalance: number;
  initialBalance: number;
  currentAttemptNumber?: number | null;
  consecutiveBlownCount?: number | null;
  totalBlownCount?: number | null;
}

export function AccountAttemptsDropdown({
  accountId,
  currentBalance,
  initialBalance,
  currentAttemptNumber = 1,
  consecutiveBlownCount = 0,
  totalBlownCount = 0,
}: AccountAttemptsDropdownProps) {
  const { data: attempts = [], isLoading } = useAccountAttempts(accountId);
  const resetAccount = useResetAccount();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [newBalance, setNewBalance] = useState(initialBalance.toString());

  const handleReset = () => {
    const balance = parseFloat(newBalance);
    if (isNaN(balance) || balance <= 0) return;
    
    resetAccount.mutate(
      { id: accountId, newInitialBalance: balance },
      { onSuccess: () => setShowResetDialog(false) }
    );
  };

  const currentAttempt = attempts.find(a => a.status === 'ACTIVE');
  const blownAttempts = attempts.filter(a => a.status === 'BLOWN');
  const hasBlownHistory = blownAttempts.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            data-testid="button-account-attempts"
          >
            <History className="w-4 h-4" />
            Attempt {currentAttemptNumber || 1}
            {hasBlownHistory && (
              <Badge variant="destructive" className="ml-1 text-xs px-1.5">
                <Bomb className="w-3 h-3 mr-1" />
                {totalBlownCount}
              </Badge>
            )}
            <ChevronDown className="w-4 h-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>Account History</span>
            {consecutiveBlownCount && consecutiveBlownCount >= 3 && (
              <Badge variant="destructive" className="text-xs">
                {consecutiveBlownCount} consecutive blows
              </Badge>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {currentAttempt && (
            <>
              <DropdownMenuItem className="flex-col items-start gap-1 cursor-default" disabled>
                <div className="flex items-center gap-2 w-full">
                  <CheckCircle2 className="w-4 h-4 text-profit" />
                  <span className="font-medium">Current Attempt #{currentAttempt.attemptNumber}</span>
                  <Badge variant="outline" className="ml-auto text-xs">ACTIVE</Badge>
                </div>
                <div className="flex items-center justify-between w-full text-sm text-muted-foreground pl-6">
                  <span>Started: {format(new Date(currentAttempt.startedAt || Date.now()), "MMM d, yyyy")}</span>
                  <PnlDisplay value={currentBalance - initialBalance} size="sm" />
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {isLoading ? (
            <DropdownMenuItem disabled>Loading history...</DropdownMenuItem>
          ) : blownAttempts.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              No blown attempts - keep trading!
            </DropdownMenuItem>
          ) : (
            blownAttempts.slice(0, 5).map((attempt) => (
              <DropdownMenuItem
                key={attempt.id}
                className="flex-col items-start gap-1 cursor-default"
                disabled
                data-testid={`menu-item-attempt-${attempt.attemptNumber}`}
              >
                <div className="flex items-center gap-2 w-full">
                  <Bomb className="w-4 h-4 text-destructive" />
                  <span className="font-medium">Attempt #{attempt.attemptNumber}</span>
                  <Badge variant="destructive" className="ml-auto text-xs">BLOWN</Badge>
                </div>
                <div className="flex flex-col gap-0.5 w-full text-xs text-muted-foreground pl-6">
                  <div className="flex justify-between">
                    <span>Start: ${attempt.startingBalance?.toLocaleString()}</span>
                    <span>End: ${attempt.endingBalance?.toLocaleString() ?? '0'}</span>
                  </div>
                  {attempt.blownAt && (
                    <span>Blown: {format(new Date(attempt.blownAt), "MMM d, yyyy h:mm a")}</span>
                  )}
                  {attempt.blownReason && (
                    <span className="text-destructive truncate max-w-full" title={attempt.blownReason}>
                      {attempt.blownReason.length > 40 ? attempt.blownReason.slice(0, 40) + '...' : attempt.blownReason}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => setShowResetDialog(true)}
            className="gap-2"
            data-testid="button-reset-account"
          >
            <RefreshCcw className="w-4 h-4" />
            Reset Account with Fresh Balance
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Account</DialogTitle>
            <DialogDescription>
              Start a new attempt with a fresh balance. Your current P&L records will be cleared,
              but historical attempts will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="newBalance">New Initial Balance</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  id="newBalance"
                  type="number"
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  placeholder="10000"
                  data-testid="input-new-balance"
                />
              </div>
            </div>
            {(consecutiveBlownCount ?? 0) >= 2 && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <TrendingDown className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Warning: {consecutiveBlownCount} consecutive blown attempts</p>
                  <p className="text-xs opacity-80">
                    Consider reviewing your strategy or demoting to TRIALS stage for further testing.
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleReset} 
              disabled={resetAccount.isPending}
              data-testid="button-confirm-reset"
            >
              {resetAccount.isPending ? "Resetting..." : "Reset Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
