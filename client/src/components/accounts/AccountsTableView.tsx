import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Trash2, Settings, Eye, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Account } from "@/hooks/useAccounts";

interface AccountWithLinkedBots extends Account {
  linked_bots_count: number;
}

interface AccountsTableViewProps {
  accounts: AccountWithLinkedBots[];
  stageDefaults?: Record<string, string | null>;
  onViewDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AccountsTableView({ 
  accounts, 
  stageDefaults = {},
  onViewDetails, 
  onEdit, 
  onDelete 
}: AccountsTableViewProps) {
  // Helper to get which stages use this account as default
  const getDefaultStages = (accountId: string): string[] => {
    const stages: string[] = [];
    if (stageDefaults.PAPER === accountId) stages.push("PAPER");
    if (stageDefaults.SHADOW === accountId) stages.push("SHADOW");
    if (stageDefaults.LIVE === accountId) stages.push("LIVE");
    return stages;
  };

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Risk Tier</TableHead>
              <TableHead className="text-right">Max Contracts</TableHead>
              <TableHead className="text-right">Daily Limit</TableHead>
              <TableHead className="text-center">Bots</TableHead>
              <TableHead className="text-center">
                <div className="flex items-center justify-center gap-1">
                  Shared
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">
                        When enabled, each bot gets its own isolated copy of the account balance.
                        Multiple bots can trade independently without competing for the same funds.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => {
              const provider = (account as any).provider || "INTERNAL";
              // Fix: Check both snake_case and camelCase versions for all fields
              // FAIL-CLOSED: Default to false - only show Shared when explicitly enabled
              const allowShared = (account as any).allow_shared_bots ?? (account as any).allowSharedBots ?? false;
              const accountType = (account as any).account_type ?? (account as any).accountType;
              const riskTier = (account as any).risk_tier ?? (account as any).riskTier;
              const maxContracts = (account as any).max_contracts_per_trade ?? (account as any).maxContractsPerTrade;
              const maxDailyLoss = (account as any).max_daily_loss_percent ?? (account as any).maxDailyLossPercent;
              const defaultStages = getDefaultStages(account.id);
              const isTemplate = accountType === "VIRTUAL" || accountType === "SIM";

              return (
                <TableRow 
                  key={account.id} 
                  className="cursor-pointer hover:bg-muted/20"
                  onClick={() => onViewDetails(account.id)}
                  data-testid={`row-account-${account.id}`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{account.name}</span>
                      {isTemplate && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                              Template
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              Template accounts can be cloned for each bot, providing isolated testing environments.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {defaultStages.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                              Default: {defaultStages.join(", ")}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              This account is the default for {defaultStages.join(" and ")} stage{defaultStages.length > 1 ? "s" : ""}.
                              Bots will automatically use this account when promoted to these stages.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      <StatusBadge status={accountType as any} />
                      {provider !== "INTERNAL" && (
                        <StatusBadge status={provider.toLowerCase() as any} />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={riskTier as any} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {maxContracts || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-loss">
                    {maxDailyLoss ? `${(Number(maxDailyLoss) * 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-center font-mono">
                    {account.linked_bots_count}
                  </TableCell>
                  <TableCell className="text-center">
                    {allowShared ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                            Shared
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">
                            Each bot gets an isolated copy of this account's balance for independent trading.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-account-menu-${account.id}`}>
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover">
                        <DropdownMenuItem onClick={() => onViewDetails(account.id)}>
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(account.id)}>
                          <Settings className="w-4 h-4 mr-2" />
                          Edit Settings
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => onDelete(account.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
