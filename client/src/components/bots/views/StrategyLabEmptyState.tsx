import { Microscope, Brain, Compass, Search, Target, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StrategyLabEmptyStateProps {
  hasSession: boolean;
  isIdle: boolean;
}

export function StrategyLabEmptyState({ hasSession, isIdle }: StrategyLabEmptyStateProps) {
  if (!hasSession) {
    return (
      <Card className="h-[500px] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="relative inline-block mb-6">
            <Brain className="h-16 w-16 text-primary/30" />
            <Sparkles className="h-6 w-6 text-primary absolute -top-1 -right-1 animate-pulse" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Strategy Lab</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Your autonomous quant research desk. Create a session to begin discovering profitable edges in CME futures.
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-1">
              <Compass className="h-5 w-5" />
              <span>Discover</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Search className="h-5 w-5" />
              <span>Research</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Target className="h-5 w-5" />
              <span>Validate</span>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (isIdle) {
    return (
      <div className="text-center py-8">
        <Microscope className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Press play to begin autonomous strategy discovery
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          The lab will think continuously until paused
        </p>
      </div>
    );
  }

  return null;
}

// "Thinking" state when running but no candidates yet
export function StrategyLabThinkingState() {
  const steps = [
    { icon: Compass, label: "Observing markets", delay: 0 },
    { icon: Sparkles, label: "Forming hypotheses", delay: 200 },
    { icon: Search, label: "Researching edges", delay: 400 },
    { icon: Microscope, label: "Synthesizing logic", delay: 600 },
    { icon: Target, label: "Validating quality", delay: 800 },
  ];

  return (
    <Card className="p-6">
      <div className="text-center mb-6">
        <Brain className="h-10 w-10 mx-auto mb-2 text-primary animate-pulse" />
        <p className="text-sm font-medium">Searching for edges…</p>
        <p className="text-xs text-muted-foreground mt-1">
          The lab is actively researching profitable strategies
        </p>
      </div>
      
      <div className="flex justify-center gap-4">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div
              key={i}
              className={cn(
                "flex flex-col items-center gap-1 text-xs text-muted-foreground",
                "animate-pulse"
              )}
              style={{ animationDelay: `${step.delay}ms` }}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{step.label}</span>
            </div>
          );
        })}
      </div>
      
      <p className="text-center text-xs text-muted-foreground mt-6">
        No edges meet quality bar yet — continuing to search…
      </p>
    </Card>
  );
}
