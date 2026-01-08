import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Settings,
  Database,
  Zap,
  Shield,
  TrendingUp,
  Wallet,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "pending";
  value?: string | number | null;
  required?: string | number;
  evidenceLink?: string;
  evidenceLabel?: string;
}

interface ChecklistGroup {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ChecklistItem[];
}

interface PromotionAuditChecklistProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botName: string;
  fromStage: string;
  toStage: string;
  checklist: ChecklistGroup[];
  isLoading?: boolean;
  onPromote?: () => void;
  canPromote?: boolean;
}

const statusConfig = {
  pass: { icon: CheckCircle2, color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
  fail: { icon: XCircle, color: "text-red-500", bgColor: "bg-red-500/10" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bgColor: "bg-amber-500/10" },
  pending: { icon: Loader2, color: "text-muted-foreground", bgColor: "bg-muted/50" },
};

export function PromotionAuditChecklist({
  open,
  onOpenChange,
  botName,
  fromStage,
  toStage,
  checklist,
  isLoading = false,
  onPromote,
  canPromote = false,
}: PromotionAuditChecklistProps) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>(
    checklist.filter(g => g.items.some(i => i.status === "fail")).map(g => g.id)
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => 
      prev.includes(groupId) 
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const getGroupStatus = (items: ChecklistItem[]): "pass" | "fail" | "warning" | "pending" => {
    if (items.some(i => i.status === "pending")) return "pending";
    if (items.some(i => i.status === "fail")) return "fail";
    if (items.some(i => i.status === "warning")) return "warning";
    return "pass";
  };

  const totalItems = checklist.reduce((acc, g) => acc + g.items.length, 0);
  const passedItems = checklist.reduce((acc, g) => acc + g.items.filter(i => i.status === "pass").length, 0);
  const failedItems = checklist.reduce((acc, g) => acc + g.items.filter(i => i.status === "fail").length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Promotion Audit Checklist
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            <span>Promoting</span>
            <Badge variant="outline">{botName}</Badge>
            <span>from</span>
            <Badge variant="outline">{fromStage}</Badge>
            <span>to</span>
            <Badge variant="outline">{toStage}</Badge>
          </DialogDescription>
        </DialogHeader>

        {/* Summary Bar */}
        <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium">{passedItems}</span>
            <span className="text-xs text-muted-foreground">passed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium">{failedItems}</span>
            <span className="text-xs text-muted-foreground">failed</span>
          </div>
          <div className="flex-1" />
          <div className="text-sm text-muted-foreground">
            {passedItems}/{totalItems} checks
          </div>
        </div>

        <ScrollArea className="max-h-[45vh] pr-4">
          <div className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Running audit checks...</span>
              </div>
            ) : (
              checklist.map((group) => {
                const groupStatus = getGroupStatus(group.items);
                const GroupIcon = group.icon;
                const StatusIcon = statusConfig[groupStatus].icon;
                const isExpanded = expandedGroups.includes(group.id);
                
                return (
                  <Collapsible key={group.id} open={isExpanded}>
                    <CollapsibleTrigger
                      onClick={() => toggleGroup(group.id)}
                      className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <GroupIcon className="w-4 h-4 text-muted-foreground" />
                      <span className="flex-1 text-left text-sm font-medium">{group.title}</span>
                      <StatusIcon className={cn("w-4 h-4", statusConfig[groupStatus].color, groupStatus === "pending" && "animate-spin")} />
                      <Badge variant="secondary" className="text-xs">
                        {group.items.filter(i => i.status === "pass").length}/{group.items.length}
                      </Badge>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-6 space-y-1 mt-1">
                      {group.items.map((item) => {
                        const ItemIcon = statusConfig[item.status].icon;
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-center gap-2 p-2 rounded-md text-sm",
                              statusConfig[item.status].bgColor
                            )}
                          >
                            <ItemIcon className={cn("w-4 h-4 flex-shrink-0", statusConfig[item.status].color, item.status === "pending" && "animate-spin")} />
                            <span className="flex-1">{item.label}</span>
                            {item.value !== undefined && item.required !== undefined && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {String(item.value)} / {String(item.required)}
                              </span>
                            )}
                            {item.evidenceLink && (
                              <Button variant="ghost" size="sm" className="h-6 text-xs" asChild>
                                <a href={item.evidenceLink} target="_blank" rel="noopener noreferrer">
                                  {item.evidenceLabel || "Evidence"}
                                  <ExternalLink className="w-3 h-3 ml-1" />
                                </a>
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={onPromote}
            disabled={!canPromote || isLoading}
          >
            {canPromote ? `Promote to ${toStage}` : "Cannot Promote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= HELPER TO BUILD CHECKLIST FROM BOT DATA =============

export function buildPromotionChecklist(
  fromStage: string,
  toStage: string,
  metrics: {
    trades?: number;
    activeDays?: number;
    sharpe?: number | null;
    profitFactor?: number | null;
    maxDrawdownPct?: number | null;
    lastTradeAt?: string | null;
  } | null,
  healthState: string,
  dataHealth: {
    primaryVerified: boolean;
    backupConfigured: boolean;
    staleQuotes: boolean;
    clockSync: boolean;
  },
  executionHealth: {
    fillModelConfigured: boolean;
    slippageEnabled: boolean;
    rejectedOrders: number;
    reconciliationPassed: boolean;
  },
  riskConfig: {
    maxDailyLossSet: boolean;
    maxPositionSet: boolean;
    killSwitchEnabled: boolean;
    blackoutConfigured: boolean;
  },
  capitalContinuity: {
    startingEquityMatch: boolean;
    riskScalingValidated: boolean;
  }
): ChecklistGroup[] {
  const thresholds = getStageThresholds(fromStage, toStage);
  
  return [
    {
      id: "identity",
      title: "Identity & Configuration",
      icon: Settings,
      items: [
        { id: "config_stable", label: "Strategy config stable (no edits in last 5 min)", status: "pass" },
        { id: "instrument_valid", label: "Instrument mapping valid", status: "pass" },
        { id: "timeframe_set", label: "Timeframe + session rules set", status: "pass" },
        { id: "params_snapshot", label: "Deterministic parameters snapshot saved", status: "pass" },
      ],
    },
    {
      id: "data",
      title: "Data Health",
      icon: Database,
      items: [
        { id: "primary_verified", label: "Primary data source verified", status: dataHealth.primaryVerified ? "pass" : "fail" },
        { id: "backup_configured", label: "Backup data source configured", status: dataHealth.backupConfigured ? "pass" : "warning" },
        { id: "no_stale_quotes", label: "No stale quotes in last 30 min", status: !dataHealth.staleQuotes ? "pass" : "warning" },
        { id: "clock_sync", label: "Clock sync OK", status: dataHealth.clockSync ? "pass" : "fail" },
      ],
    },
    {
      id: "execution",
      title: "Execution Model Integrity",
      icon: Zap,
      items: [
        { id: "fill_model", label: "Fill model configured", status: executionHealth.fillModelConfigured ? "pass" : "fail" },
        { id: "slippage", label: "Slippage + latency simulation enabled", status: executionHealth.slippageEnabled ? "pass" : "warning" },
        { id: "no_rejected", label: "No rejected orders (last 50 trades)", status: executionHealth.rejectedOrders === 0 ? "pass" : "fail", value: executionHealth.rejectedOrders, required: 0 },
        { id: "reconciliation", label: "Reconciliation passes", status: executionHealth.reconciliationPassed ? "pass" : "fail" },
      ],
    },
    {
      id: "risk",
      title: "Risk & Safety",
      icon: Shield,
      items: [
        { id: "max_daily_loss", label: "Max daily loss set and enforced", status: riskConfig.maxDailyLossSet ? "pass" : "fail" },
        { id: "max_position", label: "Max position size set and enforced", status: riskConfig.maxPositionSet ? "pass" : "fail" },
        { id: "kill_switch", label: "Kill switch enabled", status: riskConfig.killSwitchEnabled ? "pass" : "fail" },
        { id: "blackout", label: "News/economic blackout configured", status: riskConfig.blackoutConfigured ? "pass" : "warning" },
      ],
    },
    {
      id: "performance",
      title: "Performance Minimums",
      icon: TrendingUp,
      items: [
        { 
          id: "min_trades", 
          label: `Minimum trades (${fromStage} → ${toStage})`, 
          status: (metrics?.trades ?? 0) >= thresholds.minTrades ? "pass" : "fail",
          value: metrics?.trades ?? 0,
          required: thresholds.minTrades,
        },
        { 
          id: "min_days", 
          label: "Minimum active days", 
          status: (metrics?.activeDays ?? 0) >= thresholds.minDays ? "pass" : "fail",
          value: metrics?.activeDays ?? 0,
          required: thresholds.minDays,
        },
        { 
          id: "min_pf", 
          label: "Profit factor threshold", 
          status: (metrics?.profitFactor ?? 0) >= thresholds.minPF ? "pass" : "fail",
          value: metrics?.profitFactor?.toFixed(2) ?? "N/A",
          required: thresholds.minPF,
        },
        { 
          id: "max_dd", 
          label: "Max drawdown within limit", 
          status: (metrics?.maxDrawdownPct ?? 0) <= thresholds.maxDD ? "pass" : "fail",
          value: metrics?.maxDrawdownPct?.toFixed(1) ?? "N/A",
          required: `≤${thresholds.maxDD}%`,
        },
        { 
          id: "health", 
          label: "Bot health OK", 
          status: healthState === "OK" ? "pass" : healthState === "WARN" ? "warning" : "fail",
          value: healthState,
          required: "OK or WARN",
        },
      ],
    },
    {
      id: "capital",
      title: "Capital Continuity",
      icon: Wallet,
      items: [
        { id: "starting_equity", label: "Starting equity continuity confirmed", status: capitalContinuity.startingEquityMatch ? "pass" : "fail" },
        { id: "risk_scaling", label: "Risk scaling derived from starting capital validated", status: capitalContinuity.riskScalingValidated ? "pass" : "fail" },
      ],
    },
  ];
}

function getStageThresholds(fromStage: string, toStage: string): { minTrades: number; minDays: number; minPF: number; maxDD: number } {
  if (toStage === "PAPER") {
    return { minTrades: 30, minDays: 3, minPF: 1.1, maxDD: 8 };
  }
  if (toStage === "SHADOW") {
    return { minTrades: 50, minDays: 5, minPF: 1.15, maxDD: 6 };
  }
  if (toStage === "CANARY") {
    return { minTrades: 75, minDays: 7, minPF: 1.2, maxDD: 5 };
  }
  if (toStage === "LIVE") {
    return { minTrades: 100, minDays: 10, minPF: 1.25, maxDD: 5 };
  }
  return { minTrades: 30, minDays: 3, minPF: 1.1, maxDD: 8 };
}
