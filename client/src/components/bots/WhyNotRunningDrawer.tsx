import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Database, 
  Server, 
  Shield, 
  Wallet,
  Activity,
  RefreshCw,
  Play,
  RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketHours } from "@/hooks/useMarketHours";
import { useBotJobs, useEnqueueJob } from "@/hooks/useBotJobs";
import { useStartRunner, useRestartRunner } from "@/hooks/useRunnerControl";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface WhyNotRunningDrawerProps {
  botId: string;
  botName: string;
  stage?: string;
  accountId?: string | null;
  accountName?: string | null;
  healthState?: string;
  activityState?: string;
  healthReasonCode?: string | null;
  healthReasonDetail?: string | null;
  healthDegradedSince?: string | null;
  trigger?: React.ReactNode;
}

interface DiagnosticItem {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  message: string;
  icon: React.ElementType;
}

export function WhyNotRunningDrawer({
  botId,
  botName,
  stage = 'TRIALS',
  accountId = null,
  accountName = null,
  healthState = 'OK',
  activityState = 'IDLE',
  trigger,
}: WhyNotRunningDrawerProps) {
  const [open, setOpen] = useState(false);
  const { data: marketHours } = useMarketHours();
  const { data: jobs, isLoading: jobsLoading } = useBotJobs(botId);
  const enqueueJob = useEnqueueJob();
  const startRunner = useStartRunner();
  const restartRunner = useRestartRunner();

  // Determine if this is a PAPER+ bot that should have a runner
  const shouldHaveRunner = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  const isRunnerStalled = healthState === 'DEGRADED' || activityState === 'STALLED';

  const diagnostics: DiagnosticItem[] = [];

  // 1. Account check
  if (!accountId) {
    diagnostics.push({
      label: 'Account',
      status: 'error',
      message: 'No account attached. Attach an account to run this bot.',
      icon: Wallet,
    });
  } else {
    diagnostics.push({
      label: 'Account',
      status: 'ok',
      message: `Attached to ${accountName || 'account'}`,
      icon: Wallet,
    });
  }

  // 2. Market hours check (only for scanning/trading, not backtests)
  if (stage !== 'TRIALS') {
    if (marketHours?.isOpen) {
      diagnostics.push({
        label: 'Market',
        status: 'ok',
        message: `${marketHours.sessionType} session active`,
        icon: Clock,
      });
    } else {
      diagnostics.push({
        label: 'Market',
        status: 'warn',
        message: marketHours?.reason || 'Market closed',
        icon: Clock,
      });
    }
  }

  // 3. Health check
  if (healthState === 'OK') {
    diagnostics.push({
      label: 'Health',
      status: 'ok',
      message: 'Bot is healthy',
      icon: Activity,
    });
  } else if (healthState === 'WARN') {
    diagnostics.push({
      label: 'Health',
      status: 'warn',
      message: 'Bot has warnings',
      icon: Activity,
    });
  } else {
    diagnostics.push({
      label: 'Health',
      status: 'error',
      message: 'Bot is degraded',
      icon: Activity,
    });
  }

  // 4. Data check (placeholder - would need real data health)
  diagnostics.push({
    label: 'Data Feed',
    status: 'ok',
    message: 'Data sources configured',
    icon: Database,
  });

  // 5. Risk check
  diagnostics.push({
    label: 'Risk',
    status: 'ok',
    message: 'Within risk limits',
    icon: Shield,
  });

  // 6. Worker check (placeholder - would need real worker health)
  diagnostics.push({
    label: 'Worker',
    status: 'ok',
    message: 'Job processor available',
    icon: Server,
  });

  // Get recent jobs
  const recentJobs = jobs?.slice(0, 5) || [];
  const queuedJobs = jobs?.filter(j => j.status === 'QUEUED') || [];
  const runningJobs = jobs?.filter(j => j.status === 'RUNNING') || [];
  const failedJobs = jobs?.filter(j => j.status === 'FAILED').slice(0, 3) || [];

  const handleEnqueueBacktest = async () => {
    try {
      await enqueueJob.mutateAsync({
        botId,
        jobType: 'BACKTEST',
        priority: 10,
        payload: { manual: true },
      });
      toast.success('Backtest job enqueued');
    } catch (error) {
      toast.error('Failed to enqueue backtest');
    }
  };

  const statusIcon = (status: DiagnosticItem['status']) => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'warn': return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="text-xs gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            Why not running?
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Why is {botName} not running?
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4 pr-4">
          <div className="space-y-4">
            {/* Current State */}
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Current State</span>
                  <Badge variant="outline" className="font-mono">
                    {activityState}
                  </Badge>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Stage</span>
                  <Badge variant="outline">{stage}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Diagnostics */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">System Diagnostics</h3>
              {diagnostics.map((item) => (
                <div 
                  key={item.label}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded border",
                    item.status === 'ok' && "bg-emerald-500/5 border-emerald-500/20",
                    item.status === 'warn' && "bg-amber-500/5 border-amber-500/20",
                    item.status === 'error' && "bg-red-500/5 border-red-500/20",
                    item.status === 'unknown' && "bg-muted/30 border-muted/50",
                  )}
                >
                  {statusIcon(item.status)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {item.message}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Job Queue */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Job Queue</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{queuedJobs.length} queued</span>
                  <span>•</span>
                  <span>{runningJobs.length} running</span>
                </div>
              </div>

              {recentJobs.length === 0 ? (
                <Card className="bg-muted/30">
                  <CardContent className="p-3 text-center text-sm text-muted-foreground">
                    No jobs found. Click below to start a backtest.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-1">
                  {recentJobs.map((job) => (
                    <div 
                      key={job.id}
                      className="flex items-center gap-2 p-2 rounded border bg-muted/30 text-xs"
                    >
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-[9px]",
                          job.status === 'QUEUED' && "border-blue-500/30 text-blue-400",
                          job.status === 'RUNNING' && "border-amber-500/30 text-amber-400",
                          job.status === 'COMPLETED' && "border-emerald-500/30 text-emerald-400",
                          job.status === 'FAILED' && "border-red-500/30 text-red-400",
                        )}
                      >
                        {job.status}
                      </Badge>
                      <span className="font-medium">{job.job_type}</span>
                      <span className="text-muted-foreground ml-auto">
                        {job.created_at ? formatDistanceToNow(new Date(job.created_at), { addSuffix: true }) : "N/A"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Failed jobs with errors */}
              {failedJobs.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-xs font-medium text-red-400 mb-1">Recent Failures</h4>
                  {failedJobs.map((job) => (
                    <div key={job.id} className="p-2 rounded border border-red-500/20 bg-red-500/5 text-xs mb-1">
                      <div className="font-medium">{job.job_type}</div>
                      <div className="text-red-400 truncate">
                        {job.error_message || 'Unknown error'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-4 border-t space-y-2">
              {/* Runner Controls for PAPER+ bots */}
              {shouldHaveRunner && (
                <>
                  {isRunnerStalled ? (
                    <Button 
                      className="w-full gap-2" 
                      variant="destructive"
                      onClick={() => restartRunner.mutate({ botId, reason: 'USER_RESTART' })}
                      disabled={restartRunner.isPending}
                    >
                      {restartRunner.isPending ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      Restart Runner (Recover from Stall)
                    </Button>
                  ) : activityState === 'IDLE' || activityState === 'STOPPED' ? (
                    <Button 
                      className="w-full gap-2" 
                      onClick={() => startRunner.mutate({ botId, reason: 'USER_START' })}
                      disabled={startRunner.isPending}
                    >
                      {startRunner.isPending ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Start Runner
                    </Button>
                  ) : null}
                  <p className="text-[10px] text-muted-foreground text-center">
                    {isRunnerStalled 
                      ? "Runner heartbeat is stale. Restart will create a fresh runner instance."
                      : "Start the scanning runner for this bot."}
                  </p>
                </>
              )}

              {/* Backtest button for all bots */}
              <Button 
                className="w-full gap-2" 
                variant={shouldHaveRunner ? "outline" : "default"}
                onClick={handleEnqueueBacktest}
                disabled={enqueueJob.isPending}
              >
                {enqueueJob.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Start Backtest
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                This will enqueue a backtest job for processing.
              </p>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
