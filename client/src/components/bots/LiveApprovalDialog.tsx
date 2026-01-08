import { useState, useEffect } from "react";
import { Shield, Clock, AlertTriangle, Check, Copy, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRequestLiveApproval, useUpdateBotStageWithApproval } from "@/hooks/useBotInlineEdit";

interface LiveApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
  accountId?: string;
}

const REVIEW_HOLD_SECONDS = 30;

export function LiveApprovalDialog({
  open,
  onOpenChange,
  botId,
  botName,
  accountId,
}: LiveApprovalDialogProps) {
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [reason, setReason] = useState("");
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [reviewHoldRemaining, setReviewHoldRemaining] = useState<number>(REVIEW_HOLD_SECONDS);
  const [copied, setCopied] = useState(false);
  
  const { toast } = useToast();
  const requestApproval = useRequestLiveApproval();
  const updateStage = useUpdateBotStageWithApproval();

  useEffect(() => {
    if (!expiresAt) return;
    
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      
      if (remaining === 0) {
        setStep("request");
        setApprovalToken(null);
        setExpiresAt(null);
        setReviewHoldRemaining(REVIEW_HOLD_SECONDS);
        toast({ 
          title: "Token expired", 
          description: "Please request a new approval token",
          variant: "destructive"
        });
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [expiresAt, toast]);

  useEffect(() => {
    if (step !== "confirm" || reviewHoldRemaining <= 0) return;
    
    const interval = setInterval(() => {
      setReviewHoldRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [step, reviewHoldRemaining]);

  useEffect(() => {
    if (!open) {
      setStep("request");
      setReason("");
      setApprovalToken(null);
      setExpiresAt(null);
      setReviewHoldRemaining(REVIEW_HOLD_SECONDS);
    }
  }, [open]);

  const handleRequestApproval = () => {
    requestApproval.mutate({ botId, reason }, {
      onSuccess: (data) => {
        setApprovalToken(data.approval_token);
        setExpiresAt(new Date(data.expires_at));
        setReviewHoldRemaining(REVIEW_HOLD_SECONDS);
        setStep("confirm");
      },
    });
  };
  
  const isReviewHoldActive = reviewHoldRemaining > 0;

  const handleConfirmPromotion = () => {
    if (!approvalToken) return;
    
    updateStage.mutate({
      botId,
      oldStage: "CANARY",
      newStage: "LIVE",
      accountId,
      approvalToken,
    }, {
      onSuccess: () => {
        onOpenChange(false);
        toast({
          title: "Bot promoted to LIVE",
          description: `${botName} is now trading with real capital`,
        });
      },
    });
  };

  const handleCopyToken = () => {
    if (approvalToken) {
      navigator.clipboard.writeText(approvalToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-live-approval">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            LIVE Trading Approval
          </DialogTitle>
          <DialogDescription>
            Dual-control approval required for {botName} to trade with real capital
          </DialogDescription>
        </DialogHeader>

        {step === "request" ? (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Institutional Control Required</p>
                  <p className="text-xs text-muted-foreground">
                    CANARY to LIVE promotion requires explicit human approval with cryptographic verification.
                    The approval token expires after 5 minutes.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Approval Reason (Optional)</Label>
              <Textarea
                id="reason"
                placeholder="Describe why this bot is ready for LIVE trading..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="resize-none"
                rows={3}
                data-testid="input-approval-reason"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-approval"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRequestApproval}
                disabled={requestApproval.isPending}
                data-testid="button-request-approval"
              >
                {requestApproval.isPending ? "Requesting..." : "Request Approval Token"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30">
                <Check className="h-3 w-3" />
                Token Generated
              </Badge>
              <Badge variant="outline" className={timeRemaining < 60 ? "text-red-500 border-red-500/30" : "text-amber-500 border-amber-500/30"}>
                <Clock className="h-3 w-3 mr-1" />
                {formatTime(timeRemaining)} remaining
              </Badge>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Approval Token</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={handleCopyToken}
                  data-testid="button-copy-token"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <code className="text-xs font-mono break-all block" data-testid="text-approval-token">
                {approvalToken}
              </code>
            </div>

            <div className={`rounded-md border p-4 ${isReviewHoldActive ? "border-amber-500/30 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}`}>
              <div className="flex gap-3">
                {isReviewHoldActive ? (
                  <Clock className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <ArrowRight className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {isReviewHoldActive ? "Mandatory Review Period" : "Ready to Promote"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isReviewHoldActive 
                      ? `Review the approval token and bot metrics. Confirmation enabled in ${reviewHoldRemaining}s.`
                      : `Click confirm to promote ${botName} to LIVE stage. This action will be logged for audit.`
                    }
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("request");
                  setApprovalToken(null);
                  setExpiresAt(null);
                  setReviewHoldRemaining(REVIEW_HOLD_SECONDS);
                }}
                data-testid="button-back"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirmPromotion}
                disabled={updateStage.isPending || timeRemaining === 0 || isReviewHoldActive}
                className="bg-green-600 hover:bg-green-700"
                data-testid="button-confirm-live"
              >
                {updateStage.isPending 
                  ? "Promoting..." 
                  : isReviewHoldActive 
                    ? `Review (${reviewHoldRemaining}s)` 
                    : "Confirm LIVE Promotion"
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
