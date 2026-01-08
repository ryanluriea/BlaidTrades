import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot } from "@/hooks/useBots";
import { BotEquityCurve } from "./dropdown/BotEquityCurve";
import { BotPerformanceSummary } from "./dropdown/BotPerformanceSummary";
import { BotLinkedAccounts } from "./dropdown/BotLinkedAccounts";
import { BotOpenPositions } from "./dropdown/BotOpenPositions";
import { BotRecentTrades } from "./dropdown/BotRecentTrades";
import { BotMindConsole } from "./dropdown/BotMindConsole";
import { BotBiasFeed } from "./dropdown/BotBiasFeed";
import { BotActivityPanel } from "./dropdown/BotActivityPanel";
import { BotHistoryPanel } from "./dropdown/BotHistoryPanel";
import { BotGenerationsPanel } from "./dropdown/BotGenerationsPanel";
import { BotSizingPreview } from "./dropdown/BotSizingPreview";
import { BotExecutionStatus } from "./dropdown/BotExecutionStatus";
import { BotInlineControls } from "./dropdown/BotInlineControls";
import { BotEvolutionPanel } from "./dropdown/BotEvolutionPanel";
import { BotWalkForwardPanel } from "./dropdown/BotWalkForwardPanel";
import { BotBrainPanel } from "./dropdown/BotBrainPanel";
import { BotCapitalStatus } from "./dropdown/BotCapitalStatus";
import { RecoveryJourneyPanel } from "./dropdown/RecoveryJourneyPanel";
import { BotLineagePanel } from "./dropdown/BotLineagePanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBotInstances } from "@/hooks/useBotDetails";
interface BotDetailDropdownProps {
  bot: Bot;
  isExpanded: boolean;
}

type DateRange = "today" | "7d" | "30d" | "all";

export function BotDetailDropdown({ bot, isExpanded }: BotDetailDropdownProps) {
  const [mode, setMode] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  const { data: instances } = useBotInstances(
    isExpanded ? bot.id : undefined
  );

  if (!isExpanded) return null;

  const getDateFilter = () => {
    const now = new Date();
    switch (dateRange) {
      case "today":
        return now.toISOString().split("T")[0];
      case "7d":
        return new Date(now.setDate(now.getDate() - 7)).toISOString().split("T")[0];
      case "30d":
        return new Date(now.setDate(now.getDate() - 30)).toISOString().split("T")[0];
      default:
        return undefined;
    }
  };

  const filterOptions = {
    mode: mode === "all" ? undefined : mode,
    accountId: accountId === "all" ? undefined : accountId,
    startDate: getDateFilter(),
  };

  // Get unique accounts from instances
  const accounts = instances
    ? [...new Map(instances.map((i) => [i.account?.id, i.account])).values()].filter(Boolean)
    : [];

  // Get unique modes from instances
  const modes = instances ? [...new Set(instances.map((i) => i.mode))].filter(Boolean) : [];

  return (
    <div className="border-t border-border bg-muted/30 p-3 space-y-3">
      {/* Filters + Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          {bot.stage === 'TRIALS' ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-xs text-muted-foreground">
              <span>📊</span>
              <span>Backtest Data</span>
            </div>
          ) : (
            <>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue placeholder="Mode" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="all">All Modes</SelectItem>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-24 h-8 text-xs">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <BotInlineControls bot={bot} />
      </div>

      {/* Tabs for different sections */}
      <Tabs defaultValue="brain" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap bg-background/50 h-8">
          <TabsTrigger value="brain" className="text-xs px-2">Brain</TabsTrigger>
          <TabsTrigger value="overview" className="text-xs px-2">Overview</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs px-2">Activity</TabsTrigger>
          <TabsTrigger value="trades" className="text-xs px-2">Trades</TabsTrigger>
          <TabsTrigger value="evolution" className="text-xs px-2">Evolution</TabsTrigger>
          <TabsTrigger value="history" className="text-xs px-2">History</TabsTrigger>
          <TabsTrigger value="generations" className="text-xs px-2">Generations</TabsTrigger>
          <TabsTrigger value="signals" className="text-xs px-2">Signals</TabsTrigger>
        </TabsList>

        {/* Bot Brain - Health, Intent, Blockers, Events */}
        <TabsContent value="brain" className="mt-3 space-y-3">
          <BotLineagePanel botId={bot.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <BotBrainPanel botId={bot.id} stage={bot.stage} />
            <div className="space-y-3">
              <BotCapitalStatus 
                botId={bot.id} 
                botStage={bot.stage} 
                healthScore={bot.health_score || 100} 
              />
              <RecoveryJourneyPanel botId={bot.id} currentStage={bot.stage} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="overview" className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <BotPerformanceSummary botId={bot.id} options={filterOptions} />
            <BotExecutionStatus botId={bot.id} />
          </div>
          <BotSizingPreview 
            botId={bot.id} 
            botRiskConfig={bot.risk_config as Record<string, unknown>}
            instrumentSymbol={(bot.strategy_config as any)?.instrument || "ES"}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-3 space-y-3">
          <BotActivityPanel botId={bot.id} />
          <BotLinkedAccounts botId={bot.id} />
        </TabsContent>

        <TabsContent value="trades" className="mt-3 space-y-3">
          <BotEquityCurve botId={bot.id} options={filterOptions} />
          <BotOpenPositions botId={bot.id} />
          <BotRecentTrades botId={bot.id} options={filterOptions} />
        </TabsContent>

        <TabsContent value="evolution" className="mt-3 space-y-3">
          <BotEvolutionPanel botId={bot.id} />
          <BotWalkForwardPanel botId={bot.id} />
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <BotHistoryPanel botId={bot.id} />
        </TabsContent>

        <TabsContent value="generations" className="mt-3">
          <BotGenerationsPanel bot={bot} />
        </TabsContent>

        <TabsContent value="signals" className="mt-3 space-y-3">
          <BotMindConsole botId={bot.id} />
          <BotBiasFeed botId={bot.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
