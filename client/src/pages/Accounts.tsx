import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteAccount, useAccount } from "@/hooks/useAccounts";
import { useAccountsWithLinkedBotsCounts } from "@/hooks/useLinkedBots";
import { useAppSettings, useUpdateAppSettings } from "@/hooks/useSettings";
import { CreateAccountWizard } from "@/components/accounts/CreateAccountWizard";
import { EditAccountDialog } from "@/components/accounts/EditAccountDialog";
import { AccountDetailDropdown } from "@/components/accounts/AccountDetailDropdown";
import { AccountsTableView } from "@/components/accounts/AccountsTableView";
import { StageRoutingPanel } from "@/components/accounts/StageRoutingPanel";
import { 
  Plus, 
  Wallet,
  Trash2,
  MoreVertical,
  Bot,
  LayoutGrid,
  LayoutList,
  Settings,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function Accounts() {
  const { data: result, isLoading } = useAccountsWithLinkedBotsCounts();
  // Extract accounts array from the wrapper result - hook returns { data: accounts[], degraded, ... }
  const accounts = result?.data ?? [];
  const deleteAccount = useDeleteAccount();
  
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<string>("overview");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [showRouting, setShowRouting] = useState(false);
  
  // Stage routing defaults - persisted to app_settings.general.stageRoutingDefaults
  const { data: appSettings } = useAppSettings();
  const updateSettings = useUpdateAppSettings();
  
  const stageDefaults = useMemo(() => {
    const stored = (appSettings?.general as { stageRoutingDefaults?: Record<string, string | null> })?.stageRoutingDefaults;
    return stored ?? { PAPER: null, SHADOW: null, LIVE: null };
  }, [appSettings]);

  const { data: editAccount } = useAccount(editAccountId || undefined);

  const handleDelete = (id: string) => {
    setSelectedAccountId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedAccountId) {
      deleteAccount.mutate(selectedAccountId);
    }
    setDeleteDialogOpen(false);
    setSelectedAccountId(null);
  };

  const handleToggleExpand = (id: string, tab: string = "overview") => {
    if (expandedAccountId === id && expandedTab === tab) {
      setExpandedAccountId(null);
    } else {
      setExpandedAccountId(id);
      setExpandedTab(tab);
    }
  };

  const handleEdit = (id: string) => {
    setEditAccountId(id);
  };

  const handleStageDefaultChange = (stage: string, accountId: string | null) => {
    if (!appSettings) return;
    
    const currentGeneral = (appSettings.general as Record<string, unknown>) ?? {};
    const currentDefaults = (currentGeneral.stageRoutingDefaults as Record<string, string | null>) ?? {};
    const updatedDefaults = { ...currentDefaults, [stage]: accountId };
    
    // Only update the general section with merged stageRoutingDefaults
    // Backend storage.upsertAppSettings does a .set() which only updates provided fields
    updateSettings.mutate({
      general: {
        ...currentGeneral,
        stageRoutingDefaults: updatedDefaults,
      },
    });
  };

  return (
    <AppLayout title="Accounts">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex items-center gap-2">
            <ToggleGroup 
              type="single" 
              value={viewMode} 
              onValueChange={(v) => v && setViewMode(v as "cards" | "table")}
              className="border border-border rounded-md"
            >
              <ToggleGroupItem value="cards" size="sm" className="h-8 px-2">
                <LayoutGrid className="w-4 h-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="table" size="sm" className="h-8 px-2">
                <LayoutList className="w-4 h-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Account
            </Button>
          </div>
        </div>

        {/* Stage Routing Defaults (Collapsible) */}
        <Collapsible open={showRouting} onOpenChange={setShowRouting}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" />
                Stage Routing Defaults
                {!showRouting && (
                  <span className="text-[10px] ml-2 opacity-60">
                    {(() => {
                      const preview: string[] = [];
                      const stages = ["PAPER", "SHADOW", "LIVE"] as const;
                      for (const stage of stages) {
                        const accountId = stageDefaults[stage];
                        if (accountId) {
                          const account = accounts.find(a => a.id === accountId);
                          if (account) {
                            preview.push(`${stage}: ${account.name}`);
                          }
                        }
                      }
                      return preview.length > 0 ? preview.join(" | ") : "Not configured";
                    })()}
                  </span>
                )}
              </span>
              <ChevronDown className={cn("w-4 h-4 transition-transform", showRouting && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <StageRoutingPanel
              defaultAccounts={stageDefaults}
              onDefaultChange={handleStageDefaultChange}
              compact
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Accounts List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-5 w-24 mb-1.5" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : accounts && accounts.length > 0 ? (
          viewMode === "table" ? (
            <AccountsTableView
              accounts={accounts as any}
              stageDefaults={stageDefaults}
              onViewDetails={handleToggleExpand}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                // Handle both camelCase (API) and snake_case field names
                const initialBalance = Number((account as any).initialBalance ?? (account as any).initial_balance ?? 0);
                const currentBalance = Number((account as any).currentBalance ?? (account as any).current_balance ?? initialBalance);
                const pnl = currentBalance - initialBalance;
                const provider = (account as any).provider || "INTERNAL";
                const allowShared = (account as any).allow_shared_bots ?? (account as any).allowSharedBots;
                const isExpanded = expandedAccountId === account.id;
                
                // Get which stages use this account as default
                const defaultStages: string[] = [];
                if (stageDefaults.PAPER === account.id) defaultStages.push("PAPER");
                if (stageDefaults.SHADOW === account.id) defaultStages.push("SHADOW");
                if (stageDefaults.LIVE === account.id) defaultStages.push("LIVE");

                return (
                  <Card 
                    key={account.id} 
                    className={cn(
                      "transition-colors overflow-hidden",
                      isExpanded ? "border-primary/50" : "hover:border-primary/30"
                    )}
                  >
                    <CardContent className="p-3">
                      {/* Top Row */}
                      <div className="flex items-center gap-3 mb-3">
                        {/* Expand/Collapse Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0"
                          onClick={() => handleToggleExpand(account.id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                        
                        <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                          <Wallet className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {account.name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <StatusBadge status={account.account_type as any} />
                            {(account.account_type === "VIRTUAL" || account.account_type === "SIM") && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                Template
                              </span>
                            )}
                            {provider !== "INTERNAL" && (
                              <StatusBadge status={provider.toLowerCase() as any} />
                            )}
                            <StatusBadge status={account.risk_tier as any} />
                            {allowShared && (
                              <StatusBadge status="shared" />
                            )}
                            {defaultStages.length > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                Default: {defaultStages.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-popover">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(account.id); }}>
                              <Settings className="w-4 h-4 mr-2" />
                              Edit Risk & Caps
                            </DropdownMenuItem>
                            {(account.account_type === "VIRTUAL" || account.account_type === "SIM") && (
                              <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                                <Users className="w-4 h-4 mr-2" />
                                {allowShared ? "Disable" : "Enable"} Sharing
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Recompute Rollups
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleDelete(account.id); }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      {/* Stats Row - Risk & Activity */}
                      <div className="grid grid-cols-6 gap-2 text-center bg-muted/30 rounded-lg p-2">
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Risk Tier</p>
                          <p className="font-mono text-xs font-semibold capitalize">
                            {(account as any).risk_tier ?? (account as any).riskTier ?? "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Max Contracts</p>
                          <p className="font-mono text-xs font-semibold">
                            {(account as any).max_contracts_per_trade ?? (account as any).maxContractsPerTrade ?? "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Daily Limit</p>
                          <p className="font-mono text-xs font-semibold text-loss">
                            {(() => {
                              const dailyLoss = (account as any).max_daily_loss_percent ?? (account as any).maxDailyLossPercent;
                              return dailyLoss ? `${(Number(dailyLoss) * 100).toFixed(0)}%` : "—";
                            })()}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Balance</p>
                          <p className="font-mono text-xs font-semibold">
                            ${(currentBalance / 1000).toFixed(0)}k
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">P&L</p>
                          <PnlDisplay value={pnl} size="sm" className="justify-center" />
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleExpand(account.id, "bots");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleToggleExpand(account.id, "bots");
                            }
                          }}
                        >
                          <p className="text-[10px] uppercase text-muted-foreground">Bots</p>
                          <p className="font-mono text-xs font-semibold flex items-center justify-center gap-1">
                            <Bot className="w-3 h-3" />
                            {account.linked_bots_count}
                          </p>
                        </div>
                      </div>
                    </CardContent>

                    {/* Expandable Detail Dropdown */}
                    <AccountDetailDropdown 
                      account={account as any}
                      isExpanded={isExpanded}
                      initialTab={expandedTab}
                    />
                  </Card>
                );
              })}
            </div>
          )
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Wallet className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-semibold mb-1">No accounts yet</h3>
              <p className="text-sm text-muted-foreground mb-3 text-center">
                Create accounts to start trading
              </p>
              <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add Account
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialogs */}
      <CreateAccountWizard 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen} 
      />

      <EditAccountDialog
        account={editAccount || null}
        open={!!editAccountId}
        onOpenChange={(open) => !open && setEditAccountId(null)}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this account? All associated trades, positions, and bot instances will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
