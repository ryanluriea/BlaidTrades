import { useState, useEffect } from "react";
import { 
  Play, Pause, Brain, Compass, Search, Microscope, Target, 
  CheckCircle2, Loader2, Zap, Activity, Sparkles, 
  AlertCircle, RefreshCw, Eye, Pencil, Settings2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { StrategyLabSession, StrategyLabTask } from "@/hooks/useStrategyLab";

// Research loop states matching the final spec: DISCOVER → RESEARCH → SYNTHESIZE → DESIGN → VALIDATE → SURFACE
const LOOP_STATES = {
  DISCOVER: {
    icon: Compass,
    label: "Discover",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    narratives: [
      "Scanning CME universe for structural edges…",
      "Analyzing liquidity and volatility patterns…",
      "Identifying regime behavior in index futures…",
      "Monitoring session characteristics…",
    ],
  },
  RESEARCH: {
    icon: Search,
    label: "Research",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    narratives: [
      "Multi-model reasoning in progress…",
      "Claude analyzing market microstructure…",
      "GPT challenging edge hypothesis…",
      "Gemini cross-referencing academic literature…",
    ],
  },
  SYNTHESIZE: {
    icon: Microscope,
    label: "Synthesize",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    narratives: [
      "Merging findings into concrete strategies…",
      "Eliminating duplicate hypotheses…",
      "Normalizing edge assumptions…",
      "Combining multi-model insights…",
    ],
  },
  DESIGN: {
    icon: Pencil,
    label: "Design",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    narratives: [
      "Generating executable strategy specs…",
      "Attaching risk model and sizing logic…",
      "Assigning preferred contract type…",
      "Building entry and exit rules…",
    ],
  },
  VALIDATE: {
    icon: Target,
    label: "Validate",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    narratives: [
      "Sanity checking assumptions…",
      "Rejecting overfit strategies…",
      "Scoring confidence levels…",
      "Assessing micro contract viability…",
    ],
  },
  SURFACE: {
    icon: CheckCircle2,
    label: "Surface",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    narratives: [
      "Creating Strategy Candidate Cards…",
      "Deciding next actions for candidates…",
      "Promoting top strategies for review…",
      "Preparing to loop back to Discovery…",
    ],
  },
};

type LoopState = keyof typeof LOOP_STATES;

// Map task types to loop states
function getLoopStateFromTask(task: StrategyLabTask | null): LoopState {
  if (!task) return "DISCOVER";
  
  const taskType = task.task_type;
  
  if (taskType.includes("DISCOVER") || taskType.includes("UNIVERSE") || taskType.includes("OBSERVE")) return "DISCOVER";
  if (taskType.includes("RESEARCH") || taskType.includes("WEB")) return "RESEARCH";
  if (taskType.includes("SYNTH")) return "SYNTHESIZE";
  if (taskType.includes("DESIGN") || taskType.includes("STRATEGY")) return "DESIGN";
  if (taskType.includes("VALID") || taskType.includes("RISK") || taskType.includes("PARAM")) return "VALIDATE";
  if (taskType.includes("EXPORT") || taskType.includes("RANK") || taskType.includes("SURFACE")) return "SURFACE";
  
  return "RESEARCH";
}

interface StrategyLabResearchDeskProps {
  session: StrategyLabSession;
  tasks: StrategyLabTask[];
  costs: { totalCost: number; byProvider: Record<string, { cost: number; calls: number }> };
  onPlayPause: () => void;
  onToggleAutopilot: (enabled: boolean) => void;
  isControlPending: boolean;
  candidateCount: number;
}

export function StrategyLabResearchDesk({
  session,
  tasks,
  costs,
  onPlayPause,
  onToggleAutopilot,
  isControlPending,
  candidateCount,
}: StrategyLabResearchDeskProps) {
  const [narrativeIndex, setNarrativeIndex] = useState(0);
  const [lastActivity, setLastActivity] = useState<string>("--");
  
  const isRunning = session.status === "RUNNING";
  const isPaused = session.status === "PAUSED";
  const isCompleted = session.status === "COMPLETED";
  const isAutopilot = session.autopilot_enabled;
  
  const currentTask = tasks.find(t => t.status === "RUNNING");
  const currentLoopState = getLoopStateFromTask(currentTask);
  const loopConfig = LOOP_STATES[currentLoopState];
  const LoopIcon = loopConfig.icon;
  
  // Rotate narratives every 4 seconds
  useEffect(() => {
    if (!isRunning) return;
    
    const interval = setInterval(() => {
      setNarrativeIndex(i => (i + 1) % loopConfig.narratives.length);
    }, 4000);
    
    return () => clearInterval(interval);
  }, [isRunning, currentLoopState, loopConfig.narratives.length]);
  
  // Update last activity timer
  useEffect(() => {
    if (!session.last_activity_at) return;
    
    const updateTimer = () => {
      const date = new Date(session.last_activity_at!);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      // Handle clock skew: if timestamp is in the future or very recent, show "just now"
      if (diffSecs < 5) setLastActivity("just now");
      else if (diffSecs < 60) setLastActivity(`${diffSecs}s ago`);
      else if (diffSecs < 3600) setLastActivity(`${Math.floor(diffSecs / 60)}m ago`);
      else setLastActivity(`${Math.floor(diffSecs / 3600)}h ago`);
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session.last_activity_at]);
  
  // Determine current narrative
  const currentNarrative = isRunning 
    ? loopConfig.narratives[narrativeIndex]
    : isPaused 
      ? "Research paused — ready to resume"
      : isCompleted
        ? "Research complete — candidates ready for review"
        : "Waiting to begin research…";

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">STRATEGY LAB</span>
          <span className="text-xs text-muted-foreground">— LIVE RESEARCH DESK</span>
        </div>
      </div>
      
      {/* Main Content - LEFT / CENTER / RIGHT Layout */}
      <div className="p-4">
        <div className="flex items-start gap-4 flex-wrap lg:flex-nowrap">
          {/* LEFT: Primary Control */}
          <div className="flex items-center gap-3 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="lg"
                    variant={isRunning ? "outline" : "default"}
                    className={cn(
                      "h-16 w-16 rounded-full p-0 shadow-lg transition-all duration-300",
                      isRunning && "border-2 border-amber-500 text-amber-500 hover:bg-amber-500/10 animate-pulse",
                      !isRunning && !isPaused && "bg-primary hover:bg-primary/90"
                    )}
                    onClick={onPlayPause}
                    disabled={isControlPending || isCompleted}
                  >
                    {isControlPending ? (
                      <Loader2 className="h-8 w-8 animate-spin" />
                    ) : isRunning ? (
                      <Pause className="h-8 w-8" />
                    ) : (
                      <Play className="h-8 w-8 ml-1" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium">{isRunning ? "Pause Research" : "Start Research"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isRunning 
                      ? "Pause the continuous research loop"
                      : isAutopilot 
                        ? "Begin continuous autonomous research" 
                        : "Run a single research iteration"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <div className="flex flex-col gap-1">
              {/* Autopilot Status Label */}
              <div className={cn(
                "text-sm font-semibold",
                isRunning && isAutopilot && "text-emerald-400",
                isRunning && !isAutopilot && "text-blue-400",
                isPaused && "text-amber-400",
                !isRunning && !isPaused && "text-muted-foreground"
              )}>
                {isRunning && isAutopilot && "AUTOPILOT RUNNING"}
                {isRunning && !isAutopilot && "RUNNING ONCE"}
                {isPaused && "AUTOPILOT PAUSED"}
                {!isRunning && !isPaused && !isCompleted && "READY"}
                {isCompleted && "COMPLETED"}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Continuous strategy discovery & refinement
              </p>
              
              {/* Mode Toggle Buttons */}
              <div className="flex gap-1 mt-1">
                <Button
                  size="sm"
                  variant={!isAutopilot ? "default" : "ghost"}
                  className={cn(
                    "h-6 text-[10px] px-2",
                    !isAutopilot && "bg-primary/20 text-primary hover:bg-primary/30"
                  )}
                  onClick={() => onToggleAutopilot(false)}
                  disabled={isRunning}
                >
                  <Play className="h-2.5 w-2.5 mr-1" />
                  Run Once
                </Button>
                <Button
                  size="sm"
                  variant={isAutopilot ? "default" : "ghost"}
                  className={cn(
                    "h-6 text-[10px] px-2",
                    isAutopilot && "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                  )}
                  onClick={() => onToggleAutopilot(true)}
                  disabled={isRunning}
                >
                  <RefreshCw className="h-2.5 w-2.5 mr-1" />
                  Continuous
                </Button>
              </div>
            </div>
          </div>
          
          {/* CENTER: Live Status Chips */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Active Loop Stage Display */}
            <div className={cn(
              "rounded-lg px-4 py-3 transition-all duration-500",
              loopConfig.bgColor,
              "border",
              loopConfig.borderColor
            )}>
              <div className="flex items-center gap-2 mb-1">
                {isRunning && (
                  <div className="relative">
                    <LoopIcon className={cn("h-4 w-4", loopConfig.color)} />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-emerald-500 rounded-full animate-ping" />
                  </div>
                )}
                <span className={cn("text-xs font-medium uppercase tracking-wide", loopConfig.color)}>
                  {isRunning ? loopConfig.label : isPaused ? "Paused" : isCompleted ? "Complete" : "Ready"}
                </span>
              </div>
              <p className="text-sm text-foreground/90 truncate">
                {currentNarrative}
              </p>
            </div>
            
            {/* Status Chips Row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Loop State Pills */}
              {Object.entries(LOOP_STATES).map(([key, config]) => {
                const StateIcon = config.icon;
                const isActive = isRunning && key === currentLoopState;
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={cn(
                      "text-[10px] h-5 gap-1 transition-all duration-300",
                      isActive 
                        ? `${config.bgColor} ${config.color} border-current` 
                        : "opacity-40"
                    )}
                  >
                    <StateIcon className="h-2.5 w-2.5" />
                    {config.label}
                  </Badge>
                );
              })}
              
              <div className="h-3 w-px bg-border mx-1" />
              
              {/* Config Badges */}
              <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                Research: {session.research_mode || "Hybrid"}
              </Badge>
              <Badge variant="secondary" className="text-[10px] h-5">
                {session.universe?.replace(/_/g, " ") || "CME Core"}
              </Badge>
              <Badge variant="secondary" className="text-[10px] h-5">
                {session.contract_preference?.includes("MICRO") ? "Micros Preferred" : "Minis OK"}
              </Badge>
              
              {isAutopilot && (
                <Badge className="text-[10px] h-5 gap-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <RefreshCw className="h-2.5 w-2.5" />
                  Autopilot: ON
                </Badge>
              )}
            </div>
          </div>
          
          {/* RIGHT: AI Usage Meter + Activity */}
          <div className="shrink-0 space-y-2 min-w-[180px]">
            {/* Cost Panel */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] font-medium text-muted-foreground">AI Usage</span>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]">
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <p className="font-medium text-xs mb-2">Cost Breakdown</p>
                      {Object.entries(costs.byProvider).length > 0 ? (
                        <div className="space-y-1 text-xs">
                          {Object.entries(costs.byProvider).map(([provider, data]) => (
                            <div key={provider} className="flex justify-between gap-4">
                              <span className="capitalize">{provider}</span>
                              <span>${data.cost.toFixed(4)} ({data.calls} calls)</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No charges yet</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">This Session</span>
                  <span className="text-sm font-semibold tabular-nums">
                    ${costs.totalCost.toFixed(4)}
                  </span>
                </div>
                
                {costs.totalCost > 0 && (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {Object.entries(costs.byProvider).slice(0, 3).map(([provider, data]) => {
                      const pct = (data.cost / costs.totalCost * 100).toFixed(0);
                      return (
                        <span key={provider} className="capitalize">{provider}: {pct}%</span>
                      );
                    })}
                  </div>
                )}
                
                {costs.totalCost === 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Cost tracking active — no charges yet
                  </p>
                )}
              </div>
            </div>
            
            {/* Last Activity */}
            <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3 w-3" />
              <span>Last activity: {lastActivity}</span>
            </div>
            
            {/* Candidates Found */}
            {candidateCount > 0 && (
              <div className="flex items-center justify-end gap-1.5 text-xs">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-primary font-medium">{candidateCount} candidates found</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Loop Progress (when running) */}
        {isRunning && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Research loop progress</span>
              <span className="text-muted-foreground">
                {tasks.filter(t => t.status === "SUCCEEDED").length} steps complete
              </span>
            </div>
            <Progress 
              value={
                (Object.keys(LOOP_STATES).indexOf(currentLoopState) + 1) / 
                Object.keys(LOOP_STATES).length * 100
              } 
              className="h-1.5"
            />
          </div>
        )}
        
        {/* No Results Yet Message */}
        {!isRunning && !isPaused && tasks.length === 0 && (
          <div className="mt-4 text-center py-4 border-t border-border/30">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Press play to begin autonomous strategy discovery
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              The lab will continuously search for profitable edges in {session.universe?.replace(/_/g, " ") || "CME futures"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
