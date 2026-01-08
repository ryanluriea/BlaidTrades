import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useExportBotpack } from "@/hooks/useBots";
import { Bot } from "@/hooks/useBots";
import { BotSettingsModal } from "../BotSettingsModal";
import http from "@/lib/http";
import { 
  ArrowUpCircle, 
  FlaskConical,
  Download,
  ExternalLink,
  Loader2,
  Settings2
} from "lucide-react";

interface BotInlineControlsProps {
  bot: Bot;
}

export function BotInlineControls({ bot }: BotInlineControlsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const exportBotpack = useExportBotpack();
  const [promoting, setPromoting] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    <>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="w-3 h-3" />
          <span className="hidden sm:inline ml-1">Settings</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={handleRunBacktest}
          disabled={runningBacktest}
        >
          {runningBacktest ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FlaskConical className="w-3 h-3" />
          )}
          <span className="hidden sm:inline ml-1">Backtest</span>
        </Button>

        {canPromoteToShadow && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handlePromoteToShadow}
            disabled={promoting}
          >
            {promoting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ArrowUpCircle className="w-3 h-3" />
            )}
            <span className="hidden sm:inline ml-1">→ SHADOW</span>
          </Button>
        )}

        {canPromoteToLive && (
          <Button
            variant="default"
            size="sm"
            className="h-8 text-xs"
            onClick={handlePromoteToLive}
            disabled={promoting}
          >
            {promoting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ArrowUpCircle className="w-3 h-3" />
            )}
            <span className="hidden sm:inline ml-1">→ LIVE</span>
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={handleExport}
          disabled={exportBotpack.isPending}
        >
          {exportBotpack.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          asChild
        >
          <Link to={`/bots/${bot.id}`}>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </Button>
      </div>
      
      <BotSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        bot={bot}
      />
    </>
  );
}
