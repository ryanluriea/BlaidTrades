import { useState } from "react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { 
  Bell, 
  Inbox, 
  TrendingUp, 
  ShieldAlert, 
  Server,
  CheckCircle2,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAlerts,
  useDismissAlert,
  useSnoozeAlert,
  useAcknowledgeAlert,
  type Alert,
} from "@/hooks/useAlerts";
import { AlertCard } from "./AlertCard";
import { PromoteToLiveDialog } from "./PromoteToLiveDialog";

interface AlertsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabValue = "all" | "promotions" | "risk" | "system";

const tabs: { value: TabValue; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: Bell },
  { value: "promotions", label: "Promotions", icon: TrendingUp },
  { value: "risk", label: "Risk", icon: ShieldAlert },
  { value: "system", label: "System", icon: Server },
];

const tabFilters: Record<TabValue, string[] | undefined> = {
  all: undefined,
  promotions: ["PROMOTION_READY", "LIVE_PROMOTION_RECOMMENDED"],
  risk: ["BOT_DEGRADED", "BOT_STALLED", "ACCOUNT_RISK_BREACH", "EXECUTION_RISK"],
  system: ["DATA_HEALTH", "ARBITER_DECISION_ANOMALY"],
};

export function AlertsDrawer({ open, onOpenChange }: AlertsDrawerProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [promoteAlert, setPromoteAlert] = useState<Alert | null>(null);

  const { data: allAlerts, isLoading } = useAlerts({
    status: ["OPEN", "ACKED"],
    limit: 50,
  });

  const dismissAlert = useDismissAlert();
  const snoozeAlert = useSnoozeAlert();
  const ackAlert = useAcknowledgeAlert();

  // Filter alerts based on active tab
  const filteredAlerts = allAlerts?.filter((alert) => {
    const categories = tabFilters[activeTab];
    if (!categories) return true;
    return categories.includes(alert.category);
  });

  // Count alerts per tab
  const countForTab = (tab: TabValue): number => {
    if (!allAlerts) return 0;
    const categories = tabFilters[tab];
    if (!categories) return allAlerts.filter((a) => a.status === "OPEN").length;
    return allAlerts.filter(
      (a) => categories.includes(a.category) && a.status === "OPEN"
    ).length;
  };

  const handleViewEntity = (alert: Alert) => {
    if (alert.entityType === "BOT" && alert.entityId) {
      setLocation(`/bots?expand=${alert.entityId}`);
      onOpenChange(false);
    } else if (alert.entityType === "ACCOUNT" && alert.entityId) {
      setLocation(`/accounts/${alert.entityId}`);
      onOpenChange(false);
    }
  };

  const handlePromote = (alert: Alert) => {
    setPromoteAlert(alert);
  };

  const totalOpen = countForTab("all");

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-border/50 h-full" hideCloseButton>
          {/* Header */}
          <SheetHeader className="px-5 pt-5 pb-4 border-b border-border/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base font-semibold">Notifications</SheetTitle>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                    <Settings2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalOpen > 0 ? `${totalOpen} requiring attention` : "You're all caught up"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>

          {/* Tab Navigation */}
          <div className="px-3 py-2 border-b border-border/50 bg-muted/30 shrink-0">
            <div className="flex gap-1 flex-wrap">
              {tabs.map((tab) => {
                const count = countForTab(tab.value);
                const isActive = activeTab === tab.value;
                const Icon = tab.icon;
                
                return (
                  <Button
                    key={tab.value}
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "h-8 px-3 text-xs font-medium transition-all",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 mr-1.5" />
                    {tab.label}
                    {count > 0 && (
                      <Badge 
                        variant={tab.value === "risk" ? "destructive" : "secondary"}
                        className="ml-1.5 h-4 min-w-4 px-1 text-[10px]"
                      >
                        {count}
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Spinner className="h-6 w-6 text-muted-foreground" />
              </div>
            ) : !filteredAlerts || filteredAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 px-6">
                <div className="p-4 rounded-full bg-muted/50 mb-4">
                  {activeTab === "all" ? (
                    <CheckCircle2 className="w-10 h-10 text-emerald-500/70" />
                  ) : (
                    <Inbox className="w-10 h-10 text-muted-foreground/50" />
                  )}
                </div>
                <h4 className="text-sm font-medium text-foreground mb-1">
                  {activeTab === "all" ? "All caught up!" : "No alerts"}
                </h4>
                <p className="text-xs text-muted-foreground text-center max-w-[200px]">
                  {activeTab === "all" 
                    ? "You have no pending notifications. Check back later."
                    : `No ${tabs.find(t => t.value === activeTab)?.label.toLowerCase()} alerts at this time.`
                  }
                </p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-3 space-y-2">
                  {filteredAlerts.map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      onDismiss={(id) => dismissAlert.mutate(id)}
                      onSnooze={(id, hours) =>
                        snoozeAlert.mutate({ alertId: id, hours })
                      }
                      onAcknowledge={(id) => ackAlert.mutate(id)}
                      onPromote={handlePromote}
                      onViewEntity={handleViewEntity}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer */}
          {filteredAlerts && filteredAlerts.length > 0 && (
            <div className="px-4 py-3 border-t border-border/50 bg-muted/30 shrink-0">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  // Mark all as read
                  filteredAlerts
                    .filter(a => a.status === "OPEN")
                    .forEach(a => ackAlert.mutate(a.id));
                }}
              >
                Mark all as read
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <PromoteToLiveDialog
        alert={promoteAlert}
        open={!!promoteAlert}
        onOpenChange={(open) => !open && setPromoteAlert(null)}
      />
    </>
  );
}
