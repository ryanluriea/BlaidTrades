import { useState, useEffect, useRef } from "react";
import { Check, X, Lock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdateBotStage } from "@/hooks/useBotInlineEdit";
import { cn } from "@/lib/utils";
import { LiveApprovalDialog } from "./LiveApprovalDialog";

interface InlineStageEditProps {
  botId: string;
  botName?: string;
  currentStage: string;
  accountId?: string | null;
  accountType?: string | null;
  isLocked?: boolean;
  lockReason?: string;
}

interface StageConfig {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
  subtitle: string;
  capabilities: string[];
  restrictions: string[];
}

const stageConfig: Record<string, StageConfig> = {
  TRIALS: { 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10", 
    borderColor: "border-amber-500/30", 
    label: 'TRIALS',
    description: "Research & Backtesting",
    subtitle: "Proving strategy viability with historical data",
    capabilities: ["Run backtests", "Evolve strategies", "Scan markets"],
    restrictions: ["No live execution", "No broker connection"]
  },
  PAPER: { 
    color: "text-blue-400", 
    bgColor: "bg-blue-500/10", 
    borderColor: "border-blue-500/30", 
    label: "PAPER",
    description: "Simulated Trading",
    subtitle: "Real-time execution with virtual capital",
    capabilities: ["Live market data", "Simulated orders", "Track P&L"],
    restrictions: ["No real capital at risk", "No broker execution"]
  },
  SHADOW: { 
    color: "text-purple-400", 
    bgColor: "bg-purple-500/10", 
    borderColor: "border-purple-500/30", 
    label: "SHADOW",
    description: "Parallel Validation",
    subtitle: "Live signals, orders built but not sent",
    capabilities: ["Broker connectivity", "Order construction", "Risk checks"],
    restrictions: ["Orders NOT submitted", "No capital at risk"]
  },
  CANARY: { 
    color: "text-orange-400", 
    bgColor: "bg-orange-500/10", 
    borderColor: "border-orange-500/30", 
    label: "CANARY",
    description: "Small Real Position",
    subtitle: "Minimal size live trading with auto-kill",
    capabilities: ["Real broker execution", "Live capital (small)", "Auto-revert on anomaly"],
    restrictions: ["Strict position limits", "Enhanced monitoring"]
  },
  LIVE: { 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10", 
    borderColor: "border-amber-500/30", 
    label: "LIVE",
    description: "Full Production",
    subtitle: "Live execution with production safeguards",
    capabilities: ["Full broker execution", "Production capital", "All safeguards active"],
    restrictions: []
  },
};

// Valid transitions - CANONICAL STAGE ORDER: TRIALS → PAPER → SHADOW → CANARY → LIVE
// Forward promotion: ONE STEP ONLY (no skipping stages)
// Demotion: Can go back to any earlier stage
const validTransitions: Record<string, string[]> = {
  TRIALS: ["PAPER"],                                    // TRIALS can only promote to PAPER
  PAPER: ["TRIALS", "SHADOW"],                          // PAPER → SHADOW (forward) or TRIALS (demote)
  SHADOW: ["TRIALS", "PAPER", "CANARY"],                // SHADOW → CANARY (forward) - NOT directly to LIVE!
  CANARY: ["TRIALS", "PAPER", "SHADOW", "LIVE"],        // CANARY → LIVE (forward) or demote
  LIVE: ["TRIALS", "PAPER", "SHADOW", "CANARY"],        // LIVE can only demote
};

export function InlineStageEdit({
  botId,
  botName,
  currentStage,
  accountId,
  accountType,
  isLocked = false,
  lockReason,
}: InlineStageEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedStage, setSelectedStage] = useState(currentStage);
  const [error, setError] = useState<string | null>(null);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const updateStage = useUpdateBotStage();

  const availableTransitions = validTransitions[currentStage] || [];

  useEffect(() => {
    setSelectedStage(currentStage);
    setError(null);
  }, [currentStage]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };

    if (isEditing) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditing]);

  const validateTransition = (newStage: string): string | null => {
    if (newStage === "LIVE" && accountType !== "LIVE") {
      return "LIVE stage requires a LIVE account";
    }
    if (newStage === "PAPER" && !accountId) {
      return "PAPER stage requires an account";
    }
    if (newStage === "SHADOW" && !accountId) {
      return "SHADOW stage requires an account";
    }
    return null;
  };

  const handleSelect = (stage: string) => {
    const validationError = validateTransition(stage);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setSelectedStage(stage);
    setError(null);
    
    // INSTITUTIONAL: CANARY→LIVE requires dual-control approval
    if (currentStage === "CANARY" && stage === "LIVE") {
      setIsEditing(false);
      setShowApprovalDialog(true);
      return;
    }
    
    // Auto-save on selection
    updateStage.mutate({
      botId,
      oldStage: currentStage,
      newStage: stage,
      accountId: accountId || undefined,
    }, {
      onSuccess: () => setIsEditing(false),
      onError: () => {}, // Toast handles error display
    });
  };

  const handleCancel = () => {
    setSelectedStage(currentStage);
    setError(null);
    setIsEditing(false);
  };

  const display = stageConfig[currentStage] || stageConfig.TRIALS;

  // Render stage capabilities tooltip content
  const renderStageTooltip = () => (
    <div className="w-56">
      <div className="pb-1.5 mb-1.5 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-semibold", display.color)}>{display.label}</span>
          <span className="text-xs text-muted-foreground">-</span>
          <span className="text-xs text-foreground">{display.description}</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{display.subtitle}</div>
      </div>
      
      <div className="space-y-2">
        {display.capabilities.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground font-medium">Can:</div>
            {display.capabilities.map((cap, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                <span className="text-foreground">{cap}</span>
              </div>
            ))}
          </div>
        )}
        
        {display.restrictions.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground font-medium">Cannot:</div>
            {display.restrictions.map((restriction, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <X className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                <span className="text-muted-foreground">{restriction}</span>
              </div>
            ))}
          </div>
        )}
        
        <div className="text-[9px] text-muted-foreground pt-1 border-t border-border/30">
          Click to change stage
        </div>
      </div>
    </div>
  );

  if (isLocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "text-[10px] flex items-center gap-1 cursor-not-allowed px-2 py-0.5 rounded border font-semibold",
            display.color,
            display.bgColor,
            display.borderColor
          )}>
            {display.label}
            <Lock className="w-2.5 h-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="p-2">
          {renderStageTooltip()}
          <div className="text-[9px] text-destructive mt-1.5 pt-1.5 border-t border-border/30">
            {lockReason || "Editing locked"}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (isEditing) {
    return (
      <div ref={containerRef} className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {availableTransitions.map((stage) => {
          const config = stageConfig[stage];
          const validationError = validateTransition(stage);
          const isDisabled = !!validationError;
          
          return (
            <Tooltip key={stage}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => !isDisabled && handleSelect(stage)}
                  disabled={isDisabled || updateStage.isPending}
                  className={cn(
                    "px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors",
                    isDisabled 
                      ? "bg-muted/30 text-muted-foreground/50 border-muted/50 cursor-not-allowed"
                      : cn(config.bgColor, config.borderColor, config.color, "hover:opacity-80 cursor-pointer")
                  )}
                >
                  {config.label}
                </button>
              </TooltipTrigger>
              {isDisabled && (
                <TooltipContent side="top" className="text-xs">
                  {validationError}
                </TooltipContent>
              )}
            </Tooltip>
          );
        })}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleCancel}
        >
          <X className="w-3 h-3" />
        </Button>
        {error && (
          <span className="text-[9px] text-red-400 ml-1">{error}</span>
        )}
      </div>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors hover:opacity-80 cursor-help",
              display.color,
              display.bgColor,
              display.borderColor
            )}
          >
            {display.label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="p-2" sideOffset={8}>
          {renderStageTooltip()}
        </TooltipContent>
      </Tooltip>
      
      <LiveApprovalDialog
        open={showApprovalDialog}
        onOpenChange={setShowApprovalDialog}
        botId={botId}
        botName={botName || "Bot"}
        accountId={accountId || undefined}
      />
    </>
  );
}
