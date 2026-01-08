import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBot, useExportBotpack } from "@/hooks/useBots";
import { useBacktestSweep } from "@/hooks/useBacktestSweep";
import { Bot } from "@/hooks/useBots";
import http from "@/lib/http";
import { 
  Settings2, 
  Play, 
  Pause, 
  ArrowUpCircle, 
  FlaskConical,
  Download,
  ExternalLink,
  Loader2,
  Layers
} from "lucide-react";

interface BotControlsProps {
  bot: Bot;
}

export function BotControls({ bot }: BotControlsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateBot = useUpdateBot();
  const exportBotpack = useExportBotpack();
  const backtestSweep = useBacktestSweep();
  const [promoting, setPromoting] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);

  const handlePromoteToShadow = async () => {
    if (bot.mode === "LIVE") {
      toast({ title: "Bot is already live", variant: "destructive" });
      return;
    }

    setPromoting(true);
    try {
      const response = await http.post<{ success: boolean; trace_id: string; error?: string }>(
        `/api/bots/${bot.id}/promote`,
        { target_mode: "SHADOW" }
      );

      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Promotion failed");
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", bot.id] });
      
      toast({ 
        title: "Promoted to SHADOW",
        description: "Bot is now in shadow mode for dress rehearsal."
      });
    } catch (error: any) {
      toast({ 
        title: "Promotion failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setPromoting(false);
    }
  };

  const handlePromoteToLive = async () => {
    setPromoting(true);
    try {
      const response = await http.post<{ success: boolean; trace_id: string; error?: string }>(
        `/api/bots/${bot.id}/promote`,
        { target_mode: "LIVE" }
      );

      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Promotion failed");
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", bot.id] });
      
      toast({ 
        title: "Promoted to LIVE",
        description: "Bot is now live! Real orders will be placed."
      });
    } catch (error: any) {
      toast({ 
        title: "Promotion failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setPromoting(false);
    }
  };

  const handleRunBacktest = async () => {
    setRunningBacktest(true);
    try {
      const response = await http.post<{ success: boolean; trace_id: string; backtest_id?: number; error?: string }>(
        `/api/bots/${bot.id}/backtest`,
        { 
          start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          end_date: new Date().toISOString().split("T")[0],
          instrument: "ES",
          initial_capital: 50000
        }
      );

      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Backtest failed");
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/bots", bot.id, "backtests"] });
      
      toast({ 
        title: "Backtest started",
        description: "Check the Backtests page for results."
      });
    } catch (error: any) {
      toast({ 
        title: "Backtest failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setRunningBacktest(false);
    }
  };

  const handleExport = () => {
    exportBotpack.mutate(bot.id);
  };

  const canPromoteToShadow = bot.mode === "BACKTEST_ONLY" || bot.mode === "SIM_LIVE";
  const canPromoteToLive = bot.mode === "SHADOW";

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          Controls & Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleRunBacktest}
            disabled={runningBacktest}
          >
            {runningBacktest ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <FlaskConical className="w-3 h-3 mr-1" />
            )}
            Run Backtest
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => backtestSweep.mutate({ botId: bot.id, numWindows: 10, windowLengthDays: 30 })}
            disabled={backtestSweep.isPending}
          >
            {backtestSweep.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Layers className="w-3 h-3 mr-1" />
            )}
            Sweep (10 Windows)
          </Button>

          {canPromoteToShadow && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handlePromoteToShadow}
              disabled={promoting}
            >
              {promoting ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-3 h-3 mr-1" />
              )}
              Promote to SHADOW
            </Button>
          )}

          {canPromoteToLive && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={handlePromoteToLive}
              disabled={promoting}
            >
              {promoting ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-3 h-3 mr-1" />
              )}
              Promote to LIVE
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleExport}
            disabled={exportBotpack.isPending}
          >
            {exportBotpack.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Download className="w-3 h-3 mr-1" />
            )}
            Export .botpack
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            asChild
          >
            <Link to={`/bots/${bot.id}`}>
              <ExternalLink className="w-3 h-3 mr-1" />
              Full Page
            </Link>
          </Button>
        </div>

        {/* Current Mode Info */}
        <div className="mt-3 p-2 bg-muted/30 rounded text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current Mode:</span>
            <span className="font-medium">{bot.mode}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">Evolution:</span>
            <span className="font-medium">{bot.evolutionMode}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">Status:</span>
            <span className="font-medium">{bot.evolutionStatus}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
