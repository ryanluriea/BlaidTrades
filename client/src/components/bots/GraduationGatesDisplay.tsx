import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, TrendingUp, Target, BarChart3, Activity, DollarSign } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { computeGraduationStatus, type BotMetricsInput, type GraduationGate } from "@/lib/graduationGates";

interface GraduationGatesDisplayProps {
  metrics: BotMetricsInput;
  compact?: boolean;
  showBucket?: boolean;
}

const GATE_ICONS: Record<string, React.ElementType> = {
  trades: Activity,
  winRate: Target,
  profitFactor: TrendingUp,
  maxDrawdown: BarChart3,
  expectancy: DollarSign,
};

const BUCKET_COLORS: Record<string, string> = {
  'A+': 'bg-emerald-500 text-white',
  'A': 'bg-green-500 text-white',
  'B': 'bg-blue-500 text-white',
  'C': 'bg-yellow-500 text-black',
  'D': 'bg-orange-500 text-white',
  'UNRATED': 'bg-muted text-muted-foreground',
};

function GateRow({ gate, compact }: { gate: GraduationGate; compact?: boolean }) {
  const Icon = GATE_ICONS[gate.id] || Activity;
  const progressValue = gate.direction === 'min'
    ? Math.min(100, (gate.current / gate.required) * 100)
    : gate.current <= gate.required 
      ? 100 
      : Math.max(0, 100 - ((gate.current - gate.required) / gate.required) * 100);

  const formatValue = (val: number, unit: string) => {
    if (unit === '%') return `${val.toFixed(1)}%`;
    if (unit === 'x') return `${val.toFixed(2)}x`;
    if (unit === '$') return `$${val.toFixed(0)}`;
    return val.toString();
  };

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
            gate.passed ? "bg-profit/10 text-profit" : "bg-muted text-muted-foreground"
          )}>
            {gate.passed ? (
              <Check className="w-3 h-3" />
            ) : (
              <X className="w-3 h-3" />
            )}
            <span className="font-mono">{formatValue(gate.current, gate.unit)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs max-w-[200px]">
            <div className="font-medium">{gate.name}</div>
            <div className="text-muted-foreground mb-1">{gate.description}</div>
            <div>{formatValue(gate.current, gate.unit)} / {formatValue(gate.required, gate.unit)} {gate.direction === 'min' ? 'min' : 'max'}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 cursor-help">
          <div className={cn(
            "p-1 rounded",
            gate.passed ? "bg-profit/10" : "bg-muted"
          )}>
            <Icon className={cn(
              "w-3.5 h-3.5",
              gate.passed ? "text-profit" : "text-muted-foreground"
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate">{gate.name}</span>
              <span className={cn(
                "font-mono",
                gate.passed ? "text-profit" : "text-foreground"
              )}>
                {formatValue(gate.current, gate.unit)}
                <span className="text-muted-foreground">/{formatValue(gate.required, gate.unit)}</span>
              </span>
            </div>
            <Progress 
              value={progressValue} 
              className="h-1 mt-0.5"
            />
          </div>
          {gate.passed ? (
            <Check className="w-3.5 h-3.5 text-profit flex-shrink-0" />
          ) : (
            <X className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs max-w-[220px]">
          <div className="font-medium">{gate.name}</div>
          <div className="text-muted-foreground">{gate.description}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function GraduationGatesDisplay({ metrics, compact, showBucket = true }: GraduationGatesDisplayProps) {
  const status = computeGraduationStatus(metrics);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {showBucket && (
          <Badge className={cn("text-[10px] px-1.5 py-0", BUCKET_COLORS[status.bucket])}>
            {status.bucket}
          </Badge>
        )}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {status.gatesPassed}/{status.gatesTotal}
          </span>
          {status.gates.slice(0, 3).map(gate => (
            <GateRow key={gate.id} gate={gate} compact />
          ))}
        </div>
        {status.blockers.length > 0 && (
          <Tooltip>
            <TooltipTrigger>
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <div className="font-medium mb-1">Blocked by:</div>
                {status.blockers.map(b => (
                  <div key={b}>• {b}</div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with bucket and overall progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showBucket && (
            <Badge className={cn("text-xs", BUCKET_COLORS[status.bucket])}>
              {status.bucket}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {status.gatesPassed}/{status.gatesTotal} gates passed
          </span>
        </div>
        <span className={cn(
          "text-sm font-medium",
          status.isEligible ? "text-profit" : "text-muted-foreground"
        )}>
          {status.isEligible ? "Eligible" : "Not Eligible"}
        </span>
      </div>

      {/* Gate rows */}
      <div className="space-y-2">
        {status.gates.map(gate => (
          <GateRow key={gate.id} gate={gate} />
        ))}
      </div>

      {/* Blockers summary */}
      {status.blockers.length > 0 && (
        <div className="flex items-start gap-2 p-2 bg-warning/10 rounded text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Blocked by: </span>
            {status.blockers.join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}
