import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertCircle, 
  AlertTriangle, 
  Info, 
  CheckCircle2, 
  XCircle,
  ChevronRight,
  Microscope,
  Database,
  Shield,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromotionBlockReason, PromotionCTA } from "@/lib/stagePolicies";

interface PromotionBlockedExplainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botName: string;
  currentStage: string;
  targetStage: string;
  reasons: PromotionBlockReason[];
  ctas: PromotionCTA[];
  onAction?: (action: string) => void;
}

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  eligibility: Microscope,
  data: Database,
  risk: Shield,
  performance: TrendingUp,
  capital: Wallet,
};

const severityConfig = {
  error: { icon: XCircle, color: "text-red-500", bgColor: "bg-red-500/10" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bgColor: "bg-amber-500/10" },
  info: { icon: Info, color: "text-blue-500", bgColor: "bg-blue-500/10" },
};

export function PromotionBlockedExplainer({
  open,
  onOpenChange,
  botName,
  currentStage,
  targetStage,
  reasons,
  ctas,
  onAction,
}: PromotionBlockedExplainerProps) {
  // Group reasons by category
  const errorReasons = reasons.filter(r => r.severity === "error");
  const warningReasons = reasons.filter(r => r.severity === "warning");
  const infoReasons = reasons.filter(r => r.severity === "info");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            Why can't I promote this bot?
          </DialogTitle>
          <DialogDescription>
            Promotion from <Badge variant="outline" className="mx-1">{currentStage}</Badge> to <Badge variant="outline" className="mx-1">{targetStage}</Badge> is blocked because this bot hasn't passed the required checks.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4">
          <div className="space-y-4">
            {/* Error Reasons (Blocking) */}
            {errorReasons.length > 0 && (
              <ReasonSection
                title="Blocking Issues"
                icon={XCircle}
                iconColor="text-red-500"
                reasons={errorReasons}
              />
            )}

            {/* Warning Reasons */}
            {warningReasons.length > 0 && (
              <ReasonSection
                title="Performance Thresholds"
                icon={AlertTriangle}
                iconColor="text-amber-500"
                reasons={warningReasons}
              />
            )}

            {/* Info Reasons */}
            {infoReasons.length > 0 && (
              <ReasonSection
                title="Additional Requirements"
                icon={Info}
                iconColor="text-blue-500"
                reasons={infoReasons}
              />
            )}

            {reasons.length === 0 && (
              <div className="flex items-center gap-2 p-4 bg-emerald-500/10 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <div>
                  <p className="font-medium text-emerald-600 dark:text-emerald-400">All checks passed!</p>
                  <p className="text-sm text-muted-foreground">This bot is ready for promotion.</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-4">
          {ctas.map((cta) => (
            <Button
              key={cta.action}
              variant={cta.variant || "outline"}
              onClick={() => onAction?.(cta.action)}
              className="w-full sm:w-auto"
            >
              {cta.label}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ))}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReasonSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  reasons: PromotionBlockReason[];
}

function ReasonSection({ title, icon: Icon, iconColor, reasons }: ReasonSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="secondary" className="text-xs">{reasons.length}</Badge>
      </div>
      <div className="space-y-2 pl-6">
        {reasons.map((reason) => {
          const config = severityConfig[reason.severity];
          const SeverityIcon = config.icon;
          return (
            <div
              key={reason.code}
              className={cn("flex items-start gap-2 p-2 rounded-md", config.bgColor)}
            >
              <SeverityIcon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", config.color)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{reason.title}</p>
                <p className="text-xs text-muted-foreground">{reason.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Button wrapper that opens the explainer when promotion is blocked
 */
interface PromoteButtonProps {
  botId: string;
  botName: string;
  currentStage: string;
  targetStage: string | null;
  isBlocked: boolean;
  blockReasons: PromotionBlockReason[];
  onPromote?: () => void;
  className?: string;
}

export function PromoteButton({
  botId,
  botName,
  currentStage,
  targetStage,
  isBlocked,
  blockReasons,
  onPromote,
  className,
}: PromoteButtonProps) {
  const [showExplainer, setShowExplainer] = useState(false);

  if (!targetStage) {
    return null;
  }

  const handleClick = () => {
    if (isBlocked) {
      setShowExplainer(true);
    } else {
      onPromote?.();
    }
  };

  // Determine CTAs based on reasons
  const getCTAs = (): PromotionCTA[] => {
    const ctas: PromotionCTA[] = [];
    
    if (blockReasons.some(r => r.code === "VIRTUAL_NOT_ELIGIBLE")) {
      ctas.push({ label: "Convert to Simulation", action: "CONVERT_TO_PAPER", variant: "default" });
    }
    if (blockReasons.some(r => r.code === "NO_BROKER_CONNECTION")) {
      ctas.push({ label: "Connect Broker", action: "CONNECT_BROKER", variant: "default" });
    }
    if (blockReasons.some(r => r.code === "STALE_BACKTEST" || r.code === "NO_METRICS")) {
      ctas.push({ label: "Run Backtest", action: "RUN_BACKTEST", variant: "outline" });
    }
    if (blockReasons.some(r => r.code === "DEGRADED_HEALTH")) {
      ctas.push({ label: "View Health Issues", action: "VIEW_HEALTH", variant: "outline" });
    }
    
    ctas.push({ label: "Open Audit Checklist", action: "OPEN_AUDIT", variant: "outline" });
    
    return ctas;
  };

  return (
    <>
      <Button
        variant={isBlocked ? "outline" : "default"}
        size="sm"
        onClick={handleClick}
        className={className}
      >
        {isBlocked ? "Promotion blocked" : `Promote to ${targetStage}`}
      </Button>
      
      {isBlocked && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Click to view requirements
        </p>
      )}

      <PromotionBlockedExplainer
        open={showExplainer}
        onOpenChange={setShowExplainer}
        botName={botName}
        currentStage={currentStage}
        targetStage={targetStage}
        reasons={blockReasons}
        ctas={getCTAs()}
        onAction={(action) => {
          setShowExplainer(false);
          // Handle actions - these would navigate or trigger other dialogs
          console.log("Promotion action:", action);
        }}
      />
    </>
  );
}
