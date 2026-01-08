import { Activity, Clock, Signal, TrendingUp, AlertTriangle, Pause, Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useBotActivityState } from "@/hooks/useBotHistory";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerClock, formatRelativeTimeWithClock } from "@/contexts/ServerClockContext";

interface BotActivityPanelProps {
  botId: string;
}

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

export function BotActivityPanel({ botId }: BotActivityPanelProps) {
  const { data: activity, isLoading } = useBotActivityState(botId);
  const { serverNow } = useServerClock();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  const state = activity?.state || "IDLE";
  const config = stateConfig[state] || stateConfig.IDLE;
  const StateIcon = config.icon;

  const formatTime = (time: string | null) => {
    if (!time) return "Never";
    return formatRelativeTimeWithClock(time, serverNow);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* State Badge */}
        <div className="flex items-center justify-between">
          <Badge className={`${config.color} gap-1`}>
            <StateIcon className="h-3 w-3" />
            {config.label}
          </Badge>
          {activity?.health_score !== undefined && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Health:</span>
              <Progress value={activity.health_score} className="w-16 h-2" />
              <span>{activity.health_score}%</span>
            </div>
          )}
        </div>

        {/* Current Task */}
        {activity?.current_task && (
          <div className="text-sm">
            <span className="text-muted-foreground">Task: </span>
            <span className="font-mono text-xs">{activity.current_task}</span>
          </div>
        )}

        {/* Stall Reason */}
        {activity?.stall_reason && (
          <div className="p-2 rounded bg-orange-500/10 border border-orange-500/20 text-sm text-orange-400">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            {activity.stall_reason}
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Heartbeat
            </div>
            <div className="font-medium">{formatTime(activity?.last_heartbeat_at || null)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <Signal className="h-3 w-3" />
              Signal
            </div>
            <div className="font-medium">{formatTime(activity?.last_signal_at || null)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Trade
            </div>
            <div className="font-medium">{formatTime(activity?.last_trade_at || null)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
