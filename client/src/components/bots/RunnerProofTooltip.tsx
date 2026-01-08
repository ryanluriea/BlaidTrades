/**
 * Runner Proof Tooltip - Shows why a bot is/isn't running with evidence
 * Displays heartbeat age, data provider, signals seen, and blocker codes
 */
import { Activity, Clock, Database, Signal, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

interface RunnerProofTooltipProps {
  lastHeartbeatAt: string | null;
  activityState: string | null;
  mode: string | null;
  status: string | null;
  healthState: string | null;
  healthReasonCode: string | null;
  signalsSeenLast15m?: number;
  connectedProvider?: string | null;
  lastQuoteTs?: string | null;
  children: React.ReactNode;
}

export function RunnerProofTooltip({
  lastHeartbeatAt,
  activityState,
  mode,
  status,
  healthState,
  healthReasonCode,
  signalsSeenLast15m = 0,
  connectedProvider,
  lastQuoteTs,
  children,
}: RunnerProofTooltipProps) {
  // Calculate heartbeat age
  const heartbeatAge = lastHeartbeatAt 
    ? formatDistanceToNow(new Date(lastHeartbeatAt), { addSuffix: true })
    : 'Never';

  // Determine blocker code if not trading
  const getBlockerCode = (): { code: string; reason: string } | null => {
    if (activityState === 'TRADING' || activityState === 'SCANNING') {
      return null;
    }

    // Check various blockers
    if (!lastHeartbeatAt) {
      return { code: 'NO_RUNNER', reason: 'Runner process not started' };
    }

    const heartbeatMs = Date.now() - new Date(lastHeartbeatAt).getTime();
    if (heartbeatMs > 5 * 60 * 1000) {
      return { code: 'STALE_HEARTBEAT', reason: `Last heartbeat ${heartbeatAge}` };
    }

    if (signalsSeenLast15m === 0 && connectedProvider) {
      return { code: 'NO_SIGNALS', reason: 'No signals in 15 minutes - check strategy filters' };
    }

    if (!connectedProvider) {
      return { code: 'DATA_DOWN', reason: 'Market data provider not connected' };
    }

    if (healthState === 'DEGRADED') {
      return { code: 'DEGRADED', reason: healthReasonCode || 'Bot health degraded' };
    }

    if (status === 'paused') {
      return { code: 'USER_PAUSED', reason: 'Bot paused by user' };
    }

    // Market hours check would go here
    const hour = new Date().getUTCHours();
    const isMarketClosed = hour < 13 || hour >= 21; // Rough CME hours
    if (isMarketClosed) {
      return { code: 'SESSION_CLOSED', reason: 'Market session closed' };
    }

    // INVARIANT: Always return explicit reason - no "Unknown"
    // If we get here, the bot is healthy and scanning for signals
    return { code: 'HEALTHY', reason: 'Bot is healthy - scanning for signals' };
  };

  const blocker = getBlockerCode();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-64 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Heartbeat:
            </span>
            <span className={lastHeartbeatAt ? 'text-foreground' : 'text-yellow-500'}>
              {heartbeatAge}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Database className="h-3 w-3" /> Provider:
            </span>
            <span className={connectedProvider ? 'text-emerald-500' : 'text-muted-foreground'}>
              {connectedProvider || '—'}
            </span>
          </div>

          {lastQuoteTs && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Activity className="h-3 w-3" /> Last Quote:
              </span>
              <span className="text-foreground">
                {formatDistanceToNow(new Date(lastQuoteTs), { addSuffix: true })}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Signal className="h-3 w-3" /> Signals (15m):
            </span>
            <span className={signalsSeenLast15m > 0 ? 'text-emerald-500' : 'text-yellow-500'}>
              {signalsSeenLast15m}
            </span>
          </div>

          {blocker && (
            <>
              <div className="border-t border-border pt-2 mt-2" />
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <Badge variant="outline" className="text-[10px] mb-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
                    {blocker.code}
                  </Badge>
                  <p className="text-[11px] text-muted-foreground">{blocker.reason}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
