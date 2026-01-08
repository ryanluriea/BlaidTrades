import { Activity, AlertTriangle, Clock, Signal, TrendingUp, Play, Pause, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAllBotActivity } from "@/hooks/useBotHistory";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

const stateConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  IDLE: { color: "bg-muted text-muted-foreground", icon: Square, label: "Idle" },
  SCANNING: { color: "bg-blue-500/20 text-blue-400", icon: Activity, label: "Scanning" },
  BACKTESTING: { color: "bg-purple-500/20 text-purple-400", icon: TrendingUp, label: "Backtesting" },
  TRADING: { color: "bg-green-500/20 text-green-400", icon: Play, label: "Trading" },
  PAUSED: { color: "bg-yellow-500/20 text-yellow-400", icon: Pause, label: "Paused" },
  STOPPED: { color: "bg-muted text-muted-foreground", icon: Square, label: "Stopped" },
  ERROR: { color: "bg-destructive/20 text-destructive", icon: AlertTriangle, label: "Error" },
  STALLED: { color: "bg-orange-500/20 text-orange-400", icon: AlertTriangle, label: "Stalled" },
};

export function FleetActivityPanel() {
  const { data: bots, isLoading } = useAllBotActivity();

  const stalledBots = bots?.filter(b => b.activity?.state === "STALLED") || [];
  const activeBots = bots?.filter(b => 
    b.activity?.state && ["SCANNING", "BACKTESTING", "TRADING"].includes(b.activity.state)
  ) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Fleet Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatTime = (time: string | null) => {
    if (!time) return "—";
    return formatDistanceToNow(new Date(time), { addSuffix: true });
  };

  return (
    <div className="space-y-4">
      {/* Stalling Radar */}
      {stalledBots.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-orange-400">
              <AlertTriangle className="h-4 w-4" />
              Stalling Radar ({stalledBots.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stalledBots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between p-2 rounded bg-orange-500/10"
                >
                  <Link 
                    to={`/bots/${bot.id}`}
                    className="font-medium text-sm hover:underline"
                  >
                    {bot.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {bot.activity?.stall_reason || "Heartbeat timeout"}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fleet Activity Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Fleet Activity
            {activeBots.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {activeBots.length} active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Heartbeat
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Signal className="h-3 w-3" />
                      Signal
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Trade
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots?.map((bot) => {
                  const state = bot.activity?.state || "IDLE";
                  const config = stateConfig[state] || stateConfig.IDLE;
                  const StateIcon = config.icon;

                  return (
                    <TableRow key={bot.id}>
                      <TableCell>
                        <Link 
                          to={`/bots/${bot.id}`}
                          className="font-medium hover:underline"
                        >
                          {bot.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${config.color} gap-1`}>
                          <StateIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(bot.activity?.last_heartbeat_at || null)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(bot.activity?.last_signal_at || null)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(bot.activity?.last_trade_at || null)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!bots || bots.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No bots found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
