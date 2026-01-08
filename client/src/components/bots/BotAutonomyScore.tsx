import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Shield,
  Lock,
  Eye,
  Gauge,
  Zap,
  Info,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface AutonomyScore {
  id: string;
  bot_id: string;
  tier: "LOCKED" | "SUPERVISED" | "LIMITED_AUTONOMY" | "FULL_AUTONOMY";
  total_score: number;
  gate_results: Record<string, boolean>;
  breakdown: Record<string, number>;
  computed_at: string;
  trace_id: string;
}

interface BotAutonomyScoreProps {
  botId: string;
  compact?: boolean;
}

const TIER_CONFIG = {
  LOCKED: {
    icon: Lock,
    color: "text-loss",
    bgColor: "bg-loss/10",
    borderColor: "border-loss",
    label: "Locked",
    description: "Bot cannot trade. Critical gates failed.",
  },
  SUPERVISED: {
    icon: Eye,
    color: "text-warning",
    bgColor: "bg-warning/10",
    borderColor: "border-warning",
    label: "Supervised",
    description: "Human approval required for trades.",
  },
  LIMITED_AUTONOMY: {
    icon: Gauge,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500",
    label: "Limited Autonomy",
    description: "Can trade within strict position limits.",
  },
  FULL_AUTONOMY: {
    icon: Zap,
    color: "text-profit",
    bgColor: "bg-profit/10",
    borderColor: "border-profit",
    label: "Full Autonomy",
    description: "Unrestricted autonomous trading.",
  },
};

const GATE_LABELS: Record<string, string> = {
  config_valid: "Valid Configuration",
  stage_eligible: "Stage Eligible",
  risk_within_limits: "Risk Within Limits",
  integration_connected: "Integrations Connected",
  no_kill_state: "No Kill State",
  backtest_passed: "Backtest Passed",
  paper_verified: "Paper Trading Verified",
  max_drawdown_ok: "Max Drawdown OK",
};

export function BotAutonomyScore({ botId, compact = false }: BotAutonomyScoreProps) {
  const { data: scoreData, isLoading, isError } = useQuery<{
    success: boolean;
    data: AutonomyScore | null;
    error?: string;
    trace_id: string;
  }>({
    queryKey: [`/api/bots/${botId}/autonomy-score`],
  });

  const hasError = isError || scoreData?.success === false;
  const score = scoreData?.success ? scoreData?.data : null;

  if (isLoading) {
    return compact ? (
      <Skeleton className="h-6 w-24" />
    ) : (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (hasError) {
    if (compact) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Error
        </Badge>
      );
    }
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Autonomy Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4 text-sm">
            Unable to load autonomy score. Check bot permissions.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!score) {
    if (compact) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Lock className="w-3 h-3 mr-1" />
          No Score
        </Badge>
      );
    }
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Autonomy Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4 text-sm">
            No autonomy score computed yet. Score is calculated when the bot is evaluated for promotion.
          </div>
        </CardContent>
      </Card>
    );
  }

  const tierConfig = TIER_CONFIG[score.tier];
  const TierIcon = tierConfig.icon;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Badge variant="outline" className={`${tierConfig.color} ${tierConfig.borderColor}`}>
            <TierIcon className="w-3 h-3 mr-1" />
            {tierConfig.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-sm">
            <div className="font-medium mb-1">Autonomy: {Math.round(score.total_score * 100)}%</div>
            <div className="text-muted-foreground">{tierConfig.description}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  const gateResults = score.gate_results || {};
  const breakdown = score.breakdown || {};
  const passedGates = Object.values(gateResults).filter(Boolean).length;
  const totalGates = Object.keys(gateResults).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Autonomy Score
        </CardTitle>
        <Badge variant="outline" className={`${tierConfig.color} ${tierConfig.borderColor}`}>
          <TierIcon className="w-3 h-3 mr-1" />
          {tierConfig.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`p-3 rounded ${tierConfig.bgColor}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Score</span>
            <span className={`text-lg font-bold ${tierConfig.color}`}>
              {Math.round(score.total_score * 100)}%
            </span>
          </div>
          <Progress value={score.total_score * 100} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">{tierConfig.description}</p>
        </div>

        {totalGates > 0 && (
        <div>
          <div className="flex items-center gap-1 text-sm font-medium mb-2">
            <Info className="w-3 h-3" />
            Gate Status ({passedGates}/{totalGates})
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(gateResults).map(([gate, passed]) => (
              <div
                key={gate}
                className="flex items-center gap-2 text-xs p-2 bg-muted/30 rounded"
              >
                {passed ? (
                  <CheckCircle className="w-3 h-3 text-profit flex-shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-loss flex-shrink-0" />
                )}
                <span className={passed ? "" : "text-muted-foreground"}>
                  {GATE_LABELS[gate] || gate}
                </span>
              </div>
            ))}
          </div>
        </div>
        )}

        {Object.keys(breakdown).length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-sm font-medium mb-2">
              <Gauge className="w-3 h-3" />
              Score Breakdown
            </div>
            <div className="space-y-2">
              {Object.entries(breakdown).map(([component, value]) => (
                <div key={component} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{component.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-2">
                    <Progress value={value * 100} className="w-20 h-1.5" />
                    <span className="w-10 text-right">{Math.round(value * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground pt-2 border-t">
          Last computed: {new Date(score.computed_at).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
