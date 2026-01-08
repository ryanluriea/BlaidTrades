/**
 * Bot Capital Status Panel - Shows capital allocation for a specific bot
 * Displays: current size, max allowed, next increase conditions, blocking reasons
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  DollarSign, 
  TrendingUp, 
  Lock, 
  AlertTriangle,
  CheckCircle,
  ArrowUp,
  Shield
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import http from "@/lib/http";
import { useAuth } from "@/contexts/AuthContext";

interface BotCapitalStatusProps {
  botId: string;
  botStage: string;
  healthScore: number;
}

interface AllocationData {
  risk_units: number;
  max_contracts: number;
  edge_proof_status: 'PROVEN' | 'PENDING' | 'INSUFFICIENT';
  edge_proof_score: number;
  last_rebalance_at: string | null;
}

export function BotCapitalStatus({ botId, botStage, healthScore }: BotCapitalStatusProps) {
  const { user } = useAuth();

  const { data: allocation, isLoading } = useQuery({
    queryKey: ['bot-capital-allocation', botId],
    queryFn: async (): Promise<AllocationData | null> => {
      if (!user) return null;

      // Use Express API for bot allocation data
      const response = await http.get<any>(`/api/bots/${botId}/allocation`);
      if (!response.ok || !response.data) return null;

      const data = response.data;
      const priorityScore = data.priority_score || 0;
      const edgeStatus = priorityScore >= 60 ? 'PROVEN' : priorityScore >= 30 ? 'PENDING' : 'INSUFFICIENT';

      return {
        risk_units: Math.round((data.weight || 0) * 100),
        max_contracts: data.max_contracts_dynamic || 1,
        edge_proof_status: edgeStatus,
        edge_proof_score: priorityScore,
        last_rebalance_at: data.updated_at,
      };
    },
    enabled: !!user && botStage !== 'TRIALS',
    staleTime: 30000,
  });

  // Compute blocking reasons
  const getBlockingReasons = (): string[] => {
    const reasons: string[] = [];
    
    if (botStage === 'TRIALS') {
      reasons.push('Bot is in TRIALS stage - graduate to PAPER first');
    }
    if (healthScore < 80) {
      reasons.push(`Health score too low (${healthScore}/80 required)`);
    }
    if (allocation?.edge_proof_status === 'INSUFFICIENT') {
      reasons.push('Insufficient edge proof - needs more consistent backtests');
    }
    if (allocation?.edge_proof_status === 'PENDING') {
      reasons.push('Edge proof pending - awaiting more trade data');
    }
    
    return reasons;
  };

  // Compute next increase conditions
  const getNextIncreaseConditions = (): string[] => {
    const conditions: string[] = [];
    
    if (allocation?.edge_proof_status === 'PROVEN') {
      conditions.push('Maintain health score ≥80 for 7 days');
      conditions.push('Complete 2+ consistent backtest windows');
      conditions.push('Keep drawdown within limits');
    } else {
      conditions.push('Achieve PROVEN edge status');
      conditions.push('Complete minimum trade count');
      conditions.push('Pass all graduation gates');
    }
    
    return conditions;
  };

  const blockingReasons = getBlockingReasons();
  const nextConditions = getNextIncreaseConditions();
  const canAllocate = blockingReasons.length === 0;

  // TRIALS bots don't get capital allocation
  if (botStage === 'TRIALS') {
    return (
      <Card className="bg-muted/20 border-border/50">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
            Capital Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="w-4 h-4" />
            <span>TRIALS bots don't receive capital allocation. Graduate to PAPER to enable.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-muted/20 border-border/50">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          Capital Status
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Current Allocation */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-background/50 rounded p-2 text-center">
            <p className="text-[10px] uppercase text-muted-foreground">Risk Units</p>
            <p className="text-lg font-bold tabular-nums">
              {allocation?.risk_units ?? 0}
            </p>
            <p className="text-[9px] text-muted-foreground">of 100 max</p>
          </div>
          <div className="bg-background/50 rounded p-2 text-center">
            <p className="text-[10px] uppercase text-muted-foreground">Max Contracts</p>
            <p className="text-lg font-bold tabular-nums">
              {allocation?.max_contracts ?? 1}
            </p>
            <p className="text-[9px] text-muted-foreground">per trade</p>
          </div>
        </div>

        {/* Edge Proof Status */}
        <div className="flex items-center justify-between p-2 bg-background/50 rounded">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs">Edge Proof</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={
                allocation?.edge_proof_status === 'PROVEN' ? 'default' :
                allocation?.edge_proof_status === 'PENDING' ? 'secondary' : 'destructive'
              }
              className="text-[9px]"
            >
              {allocation?.edge_proof_status || 'PENDING'}
            </Badge>
            <Tooltip>
              <TooltipTrigger>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {allocation?.edge_proof_score?.toFixed(1) || '0.0'}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Edge proof score (0-100)</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Blocking Reasons */}
        {blockingReasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Why Not Increasing
            </p>
            {blockingReasons.map((reason, i) => (
              <div 
                key={i}
                className="text-[10px] text-muted-foreground pl-4 py-0.5 border-l-2 border-amber-500/30"
              >
                {reason}
              </div>
            ))}
          </div>
        )}

        {/* Next Increase Conditions */}
        {canAllocate && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium flex items-center gap-1">
              <ArrowUp className="w-3 h-3 text-emerald-400" />
              To Increase Allocation
            </p>
            {nextConditions.map((condition, i) => (
              <div 
                key={i}
                className="text-[10px] text-muted-foreground pl-4 py-0.5 border-l-2 border-emerald-500/30 flex items-center gap-1"
              >
                <CheckCircle className="w-3 h-3 text-muted-foreground/50" />
                {condition}
              </div>
            ))}
          </div>
        )}

        {/* System Note */}
        <p className="text-[9px] text-muted-foreground/60 text-center border-t border-border/30 pt-2">
          Capital allocation is system-controlled based on performance
        </p>
      </CardContent>
    </Card>
  );
}
