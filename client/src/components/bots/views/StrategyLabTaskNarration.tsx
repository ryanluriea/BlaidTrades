import { Loader2, Brain, Search, Microscope, Target, Shield, BarChart3, Zap, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyLabTask } from "@/hooks/useStrategyLab";

// Human-readable narrations for each task type
const TASK_NARRATIONS: Record<string, {
  running: string;
  completed: string;
  icon: typeof Brain;
  color: string;
}> = {
  DISCOVER_UNIVERSE: {
    running: "Scanning CME micros for repeatable intraday edges...",
    completed: "Completed universe discovery and instrument ranking",
    icon: Search,
    color: "text-blue-400",
  },
  OPEN_WEB_RESEARCH: {
    running: "Researching academic papers and practitioner insights...",
    completed: "Gathered research from multiple sources",
    icon: Search,
    color: "text-cyan-400",
  },
  CLOSED_WORLD_SYNTHESIS: {
    running: "Synthesizing strategy patterns from internal reasoning...",
    completed: "Synthesized strategy blueprints from research",
    icon: Microscope,
    color: "text-purple-400",
  },
  STRATEGY_DESIGN: {
    running: "Designing executable strategy rules and logic...",
    completed: "Strategy rules designed and validated",
    icon: Brain,
    color: "text-violet-400",
  },
  PARAMETERIZATION: {
    running: "Optimizing parameters for instrument families...",
    completed: "Parameter ranges computed for all instruments",
    icon: Zap,
    color: "text-yellow-400",
  },
  VALIDATION_PLAN: {
    running: "Creating multi-window validation plan...",
    completed: "Validation plan ready for backtesting",
    icon: Target,
    color: "text-amber-400",
  },
  BACKTEST_SUBMIT: {
    running: "Submitting backtests across multiple windows...",
    completed: "Backtests submitted and queued",
    icon: BarChart3,
    color: "text-emerald-400",
  },
  RESULTS_ANALYSIS: {
    running: "Comparing volatility-adjusted expectancy across regimes...",
    completed: "Results analyzed and ranked by robustness",
    icon: BarChart3,
    color: "text-teal-400",
  },
  REGIME_BREAKDOWN: {
    running: "Filtering strategies with unstable drawdown profiles...",
    completed: "Regime analysis complete with stability scores",
    icon: BarChart3,
    color: "text-indigo-400",
  },
  RISK_MODELING: {
    running: "Building safe sizing templates for each strategy...",
    completed: "Risk models created with position limits",
    icon: Shield,
    color: "text-orange-400",
  },
  EXPORT_STRATEGY: {
    running: "Preparing strategy for Lab export...",
    completed: "Strategy exported to Lab for testing",
    icon: CheckCircle2,
    color: "text-green-400",
  },
};

interface StrategyLabTaskNarrationProps {
  currentTask: StrategyLabTask | null;
  tasks: StrategyLabTask[];
  isRunning: boolean;
  isPaused: boolean;
  className?: string;
}

export function StrategyLabTaskNarration({ 
  currentTask, 
  tasks, 
  isRunning, 
  isPaused,
  className 
}: StrategyLabTaskNarrationProps) {
  // Find the running task or the latest task
  const runningTask = tasks.find(t => t.status === 'RUNNING');
  const latestTask = runningTask || tasks[tasks.length - 1];
  
  // Get narration config
  const config = latestTask 
    ? TASK_NARRATIONS[latestTask.task_type] || {
        running: `Processing ${latestTask.task_type.toLowerCase().replace(/_/g, ' ')}...`,
        completed: `Completed ${latestTask.task_type.toLowerCase().replace(/_/g, ' ')}`,
        icon: Brain,
        color: "text-muted-foreground",
      }
    : null;

  // Determine the narration text
  let narration = "";
  let showSpinner = false;

  if (isPaused) {
    narration = "Pipeline paused — press Play to resume";
  } else if (runningTask) {
    narration = config?.running || `Working on ${runningTask.task_type}...`;
    showSpinner = true;
  } else if (isRunning && tasks.some(t => t.status === 'QUEUED')) {
    narration = "Preparing next step...";
    showSpinner = true;
  } else if (latestTask?.status === 'SUCCEEDED') {
    narration = config?.completed || "Step completed";
  } else if (latestTask?.status === 'FAILED') {
    narration = `Failed: ${latestTask.error_message || latestTask.error_code || 'Unknown error'}`;
  } else if (tasks.length === 0) {
    narration = isRunning 
      ? "Initializing discovery pipeline..." 
      : "Ready to start — press Play to begin";
    showSpinner = isRunning;
  } else {
    narration = "Waiting for next task...";
  }

  const Icon = runningTask 
    ? config?.icon || Brain 
    : latestTask?.status === 'FAILED' 
      ? AlertTriangle 
      : Brain;

  const iconColor = runningTask 
    ? config?.color 
    : latestTask?.status === 'FAILED' 
      ? "text-destructive" 
      : "text-muted-foreground";

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-lg border",
      isRunning && !isPaused && "bg-primary/5 border-primary/30",
      isPaused && "bg-amber-500/5 border-amber-500/30",
      !isRunning && !isPaused && "bg-muted/30 border-border/50",
      className
    )}>
      {showSpinner ? (
        <Loader2 className={cn("h-5 w-5 animate-spin", iconColor)} />
      ) : (
        <Icon className={cn("h-5 w-5", iconColor)} />
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium",
          isPaused && "text-amber-400",
          latestTask?.status === 'FAILED' && "text-destructive"
        )}>
          {narration}
        </p>
        {runningTask && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Step {tasks.filter(t => t.status === 'SUCCEEDED').length + 1} of pipeline
          </p>
        )}
      </div>
      
      {/* Task progress indicator */}
      <div className="flex items-center gap-1">
        {tasks.slice(-5).map((task, i) => (
          <div
            key={task.id}
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              task.status === 'SUCCEEDED' && "bg-emerald-400",
              task.status === 'RUNNING' && "bg-blue-400 animate-pulse",
              task.status === 'FAILED' && "bg-destructive",
              task.status === 'QUEUED' && "bg-muted-foreground/30",
              task.status === 'CANCELED' && "bg-muted-foreground/20"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// Compact inline version
export function TaskNarrationInline({ task, isRunning }: { task: StrategyLabTask | null; isRunning: boolean }) {
  if (!task) {
    return (
      <span className="text-muted-foreground">
        {isRunning ? "Starting..." : "Ready"}
      </span>
    );
  }

  const config = TASK_NARRATIONS[task.task_type];
  
  if (task.status === 'RUNNING') {
    return (
      <span className="text-blue-400">
        {config?.running || `Processing ${task.task_type}...`}
      </span>
    );
  }

  if (task.status === 'FAILED') {
    return (
      <span className="text-destructive">
        Failed: {task.error_message || task.error_code}
      </span>
    );
  }

  return (
    <span className="text-muted-foreground">
      {config?.completed || task.task_type}
    </span>
  );
}
