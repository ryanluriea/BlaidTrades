import { useBots } from "@/hooks/useBots";
import { useAccounts } from "@/hooks/useAccounts";
import { useAiOpsBriefings, useSystemEvents, useBotInstances } from "@/hooks/useTrading";

export interface DashboardStats {
  totalEquity: number;
  todayPnl: number;
  activeBots: number;
  totalBots: number;
  systemHealth: "healthy" | "degraded" | "error";
}

export function useDashboardStats() {
  const { data: bots = [], isLoading: botsLoading } = useBots();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: botInstances = [] } = useBotInstances();

  const totalEquity = accounts.reduce((sum, acc) => sum + Number(acc.current_balance || 0), 0);
  const initialBalance = accounts.reduce((sum, acc) => sum + Number(acc.initial_balance || 0), 0);
  const todayPnl = totalEquity - initialBalance;

  const activeBots = botInstances.filter(
    (bi: any) => bi.status === "running"
  ).length;

  const stats: DashboardStats = {
    totalEquity,
    todayPnl,
    activeBots,
    totalBots: bots.length,
    systemHealth: "healthy",
  };

  return {
    stats,
    bots,
    accounts,
    botInstances,
    isLoading: botsLoading || accountsLoading,
  };
}

export function useDashboardActivity() {
  const { data: systemEvents = [], isLoading: eventsLoading } = useSystemEvents(10);
  const { data: aiOpsBriefings = [], isLoading: briefingsLoading } = useAiOpsBriefings(5);

  return {
    systemEvents,
    aiOpsBriefings,
    latestBriefing: aiOpsBriefings[0] || null,
    isLoading: eventsLoading || briefingsLoading,
  };
}

export { useBots, useBot, useCreateBot, useUpdateBot, useDeleteBot } from "@/hooks/useBots";
