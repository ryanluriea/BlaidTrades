import { 
  Clock, Brain, Search, Microscope, Target, Shield, BarChart3, Zap, 
  CheckCircle2, XCircle, Loader2, ChevronRight, Globe, Lock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { StrategyLabTask, StrategyLabStep } from "@/hooks/useStrategyLab";

// Pipeline step definitions (in order)
const PIPELINE_STEPS = [
  { key: 'DISCOVER', label: 'Discover', icon: Search, desc: 'Scanning instruments' },
  { key: 'RESEARCH', label: 'Research', icon: Globe, desc: 'Gathering insights' },
  { key: 'SYNTHESIZE', label: 'Synthesize', icon: Microscope, desc: 'Building strategies' },
  { key: 'DESIGN', label: 'Design', icon: Brain, desc: 'Defining rules' },
  { key: 'VALIDATE', label: 'Validate', icon: Target, desc: 'Testing robustness' },
  { key: 'EXPORT', label: 'Export', icon: CheckCircle2, desc: 'Ready for lab' },
];

// Map task types to pipeline steps
const TASK_TO_STEP: Record<string, string> = {
  DISCOVER_UNIVERSE: 'DISCOVER',
  OPEN_WEB_RESEARCH: 'RESEARCH',
  CLOSED_WORLD_SYNTHESIS: 'SYNTHESIZE',
  STRATEGY_DESIGN: 'DESIGN',
  PARAMETERIZATION: 'DESIGN',
  VALIDATION_PLAN: 'VALIDATE',
  BACKTEST_SUBMIT: 'VALIDATE',
  RESULTS_ANALYSIS: 'VALIDATE',
  REGIME_BREAKDOWN: 'VALIDATE',
  RISK_MODELING: 'VALIDATE',
  EXPORT_STRATEGY: 'EXPORT',
};

interface StrategyLabExecutionStepsProps {
  tasks: StrategyLabTask[];
  steps: StrategyLabStep[];
  isRunning: boolean;
  isPaused: boolean;
  className?: string;
}

export function StrategyLabExecutionSteps({ 
  tasks, 
  steps, 
  isRunning, 
  isPaused,
  className 
}: StrategyLabExecutionStepsProps) {
  // Compute which steps are complete, running, or pending
  const completedStepKeys = new Set<string>();
  let runningStepKey: string | null = null;
  
  for (const task of tasks) {
    const stepKey = TASK_TO_STEP[task.task_type];
    if (!stepKey) continue;
    
    if (task.status === 'SUCCEEDED') {
      completedStepKeys.add(stepKey);
    } else if (task.status === 'RUNNING') {
      runningStepKey = stepKey;
    }
  }

  // If we have legacy steps, use those too
  for (const step of steps) {
    const stepKey = TASK_TO_STEP[step.step_type] || step.step_type;
    if (step.status === 'DONE') {
      completedStepKeys.add(stepKey);
    } else if (step.status === 'RUNNING') {
      runningStepKey = stepKey;
    }
  }

  const hasAnyActivity = tasks.length > 0 || steps.length > 0;

  return (
    <div className={cn("space-y-3", className)}>
      {/* High-level pipeline progress */}
      <div className="flex items-center gap-1 py-2">
        {PIPELINE_STEPS.map((step, index) => {
          const isCompleted = completedStepKeys.has(step.key);
          const isActive = runningStepKey === step.key;
          const isPending = !isCompleted && !isActive;
          
          return (
            <div key={step.key} className="flex items-center flex-1">
              <div className={cn(
                "flex flex-col items-center flex-1",
                isPending && "opacity-40"
              )}>
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all",
                  isCompleted && "bg-emerald-500/20 border-emerald-500 text-emerald-400",
                  isActive && "bg-blue-500/20 border-blue-500 text-blue-400",
                  isPending && "bg-muted/30 border-border text-muted-foreground"
                )}>
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <step.icon className="h-4 w-4" />
                  )}
                </div>
                <span className={cn(
                  "text-[10px] mt-1 text-center",
                  isCompleted && "text-emerald-400",
                  isActive && "text-blue-400 font-medium",
                  isPending && "text-muted-foreground"
                )}>
                  {step.label}
                </span>
              </div>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className={cn(
                  "h-0.5 flex-1 mx-1",
                  completedStepKeys.has(PIPELINE_STEPS[index + 1]?.key) || 
                  runningStepKey === PIPELINE_STEPS[index + 1]?.key
                    ? "bg-emerald-500/50"
                    : "bg-border"
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed task list */}
      <ScrollArea className="h-[200px]">
        {hasAnyActivity ? (
          <div className="space-y-2">
            {/* Show tasks (new pipeline) */}
            {tasks.map((task) => (
              <TaskDetailCard key={task.id} task={task} />
            ))}
            
            {/* Show legacy steps if no tasks */}
            {tasks.length === 0 && steps.map((step) => (
              <StepDetailCard key={step.id} step={step} />
            ))}
          </div>
        ) : (
          <EmptyPipelineState isRunning={isRunning} isPaused={isPaused} />
        )}
      </ScrollArea>
    </div>
  );
}

function TaskDetailCard({ task }: { task: StrategyLabTask }) {
  const isRunning = task.status === 'RUNNING';
  const isCompleted = task.status === 'SUCCEEDED';
  const isFailed = task.status === 'FAILED';
  
  const stepConfig = PIPELINE_STEPS.find(s => s.key === TASK_TO_STEP[task.task_type]);
  const Icon = stepConfig?.icon || Brain;

  return (
    <div className={cn(
      "p-3 rounded-lg border transition-all",
      isRunning && "border-blue-500/50 bg-blue-500/5",
      isCompleted && "border-emerald-500/30 bg-emerald-500/5",
      isFailed && "border-destructive/30 bg-destructive/5",
      task.status === 'QUEUED' && "border-border/50 bg-muted/20 opacity-60",
      task.status === 'CANCELED' && "border-border/30 opacity-40"
    )}>
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : isFailed ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium flex-1">
          {task.task_type.replace(/_/g, ' ')}
        </span>
        <Badge 
          variant="outline" 
          className={cn(
            "text-[9px]",
            isCompleted && "bg-emerald-500/20 text-emerald-400",
            isRunning && "bg-blue-500/20 text-blue-400",
            isFailed && "bg-destructive/20 text-destructive"
          )}
        >
          {task.status}
        </Badge>
      </div>
      
      {/* Result preview */}
      {task.result && Object.keys(task.result).length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {typeof task.result === 'object' 
            ? JSON.stringify(task.result).slice(0, 150) + '...'
            : String(task.result).slice(0, 150)}
        </p>
      )}
      
      {/* Error message */}
      {task.error_message && (
        <p className="text-xs text-destructive mt-2">
          {task.error_code}: {task.error_message}
        </p>
      )}
      
      {/* Timing */}
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
        {task.started_at && (
          <span>Started: {new Date(task.started_at).toLocaleTimeString()}</span>
        )}
        {task.finished_at && (
          <>
            <span>•</span>
            <span>Finished: {new Date(task.finished_at).toLocaleTimeString()}</span>
          </>
        )}
        {task.attempts > 1 && (
          <>
            <span>•</span>
            <span>Attempts: {task.attempts}</span>
          </>
        )}
      </div>
    </div>
  );
}

function StepDetailCard({ step }: { step: StrategyLabStep }) {
  const isRunning = step.status === 'RUNNING';
  const isDone = step.status === 'DONE';
  const isFailed = step.status === 'FAILED';

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      isRunning && "border-blue-500/50 bg-blue-500/5",
      isDone && "border-emerald-500/30 bg-emerald-500/5",
      isFailed && "border-destructive/30 bg-destructive/5"
    )}>
      <div className="flex items-center gap-2">
        <Brain className={cn(
          "h-4 w-4",
          isRunning && "text-blue-400 animate-pulse",
          isDone && "text-emerald-400",
          isFailed && "text-destructive"
        )} />
        <span className="text-sm font-medium">{step.step_type}</span>
        <Badge variant="outline" className="text-[9px] ml-auto">
          {step.status}
        </Badge>
      </div>
    </div>
  );
}

function EmptyPipelineState({ isRunning, isPaused }: { isRunning: boolean; isPaused: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      {isRunning ? (
        <>
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin mb-3" />
          <p className="text-sm font-medium">Initializing pipeline...</p>
          <p className="text-xs text-muted-foreground mt-1">
            First task will appear momentarily
          </p>
        </>
      ) : isPaused ? (
        <>
          <Clock className="h-8 w-8 text-amber-400 mb-3" />
          <p className="text-sm font-medium text-amber-400">Pipeline paused</p>
          <p className="text-xs text-muted-foreground mt-1">
            Press Play to resume execution
          </p>
        </>
      ) : (
        <>
          <Brain className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">Ready to start</p>
          <p className="text-xs text-muted-foreground mt-1">
            Press Play to begin autonomous discovery
          </p>
        </>
      )}
    </div>
  );
}
