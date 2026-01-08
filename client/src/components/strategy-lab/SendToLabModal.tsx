import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, AlertTriangle, CheckCircle2, Loader2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { CandidateConfidenceBadge } from "./CandidateConfidenceBadge";
import { useEvaluateCandidateGates, usePromoteCandidate } from "@/hooks/useStrategyLab";
import { useAuth } from "@/contexts/AuthContext";

interface Candidate {
  id: string;
  session_id: string;
  name?: string;
  rank?: number | null;
  status: string;
  deployability_score?: number;
  scores?: {
    viability_score?: number;
    estimated_max_dd?: number;
    robustness_score?: number;
  };
  blueprint?: {
    name?: string;
  };
}

interface GateResult {
  name: string;
  passed: boolean;
  value: number | string | boolean | null;
  threshold: number | string | boolean | null;
  reason: string;
}

interface SendToLabModalProps {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SendToLabModal({
  candidate,
  open,
  onOpenChange,
  onSuccess,
}: SendToLabModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [gates, setGates] = useState<GateResult[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  const { user } = useAuth();
  const evaluateGates = useEvaluateCandidateGates();
  const promoteCandidate = usePromoteCandidate();

  // Fetch gate evaluation when modal opens
  useEffect(() => {
    if (open && candidate) {
      setIsEvaluating(true);
      evaluateGates.mutateAsync(candidate.id)
        .then(result => {
          setGates(result.gates);
        })
        .catch(() => {
          // Fallback to empty gates
          setGates([]);
        })
        .finally(() => setIsEvaluating(false));
    }
  }, [open, candidate?.id]);

  if (!candidate) return null;

  const name = candidate.name || candidate.blueprint?.name || `Candidate ${candidate.rank || '?'}`;
  const deployScore = candidate.deployability_score || candidate.scores?.viability_score || 0;
  const allPassed = gates.length > 0 ? gates.every(g => g.passed) : true;
  const criticalGates = ['MIN_DEPLOYABILITY_SCORE', 'MAX_EXPECTED_DRAWDOWN', 'CRITIQUE_PASSED'];
  const criticalFailed = gates.some(g => !g.passed && criticalGates.includes(g.name));

  const handleConfirm = async () => {
    if (!user?.id) return;
    
    const result = await promoteCandidate.mutateAsync({
      candidate_id: candidate.id,
      session_id: candidate.session_id,
      user_id: user.id,
      force: !allPassed && acknowledged,
    });

    if (!result.needs_confirmation) {
      setAcknowledged(false);
      onOpenChange(false);
      onSuccess?.();
    }
  };

  const isPromoting = promoteCandidate.isPending;

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) setAcknowledged(false);
      onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send to LAB
          </DialogTitle>
          <DialogDescription>
            Create a LAB test session from this strategy candidate
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Candidate Summary */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p className="font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">Rank #{candidate.rank || '?'}</p>
            </div>
            <CandidateConfidenceBadge score={deployScore} />
          </div>

          {/* Gate Results */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Promotion Gates
            </h4>
            {isEvaluating ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : gates.length === 0 ? (
              <p className="text-xs text-muted-foreground">Gate evaluation unavailable</p>
            ) : (
              <div className="space-y-1.5">
                {gates.map((gate) => (
                  <div
                    key={gate.name}
                    className={cn(
                      "flex items-center justify-between p-2 rounded text-sm",
                      gate.passed ? "bg-emerald-500/10" : "bg-amber-500/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {gate.passed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                      )}
                      <span className="text-xs">{gate.name.replace(/_/g, ' ')}</span>
                      {criticalGates.includes(gate.name) && !gate.passed && (
                        <Badge variant="destructive" className="text-[9px] h-4">Critical</Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={cn(
                        "font-mono text-xs",
                        gate.passed ? "text-emerald-400" : "text-amber-400"
                      )}>
                        {typeof gate.value === 'boolean' ? (gate.value ? '✓' : '✗') : gate.value}
                      </span>
                      <span className="text-muted-foreground text-[10px] ml-2">
                        (need {typeof gate.threshold === 'boolean' ? (gate.threshold ? '✓' : '✗') : gate.threshold})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Warning for failed gates */}
          {!allPassed && gates.length > 0 && (
            <Alert variant={criticalFailed ? "destructive" : "default"}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {criticalFailed
                  ? "Critical gates failed. This strategy may not perform as expected in LAB testing."
                  : "Some gates failed. Review carefully before proceeding."}
              </AlertDescription>
            </Alert>
          )}

          {/* What will happen */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">This will:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Create a new LAB bot from this strategy</li>
              <li>Queue short, medium, and long horizon backtests</li>
              <li>Mark this candidate as "Sent to LAB"</li>
              <li>Generate strategy lineage documentation</li>
            </ul>
          </div>

          {/* Acknowledgment for failed gates */}
          {!allPassed && gates.length > 0 && (
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(!!checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I understand the risks and want to proceed with LAB testing anyway
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPromoting || isEvaluating || (!allPassed && !acknowledged)}
          >
            {isPromoting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {allPassed || gates.length === 0 ? 'Send to LAB' : 'Send Anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
