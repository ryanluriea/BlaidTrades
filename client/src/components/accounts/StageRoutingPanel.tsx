import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { FileText, Eye, Zap, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DegradedBanner } from "@/components/ui/degraded-banner";

// TRIALS stage excluded - it uses internal sandbox/backtest, no account assignment needed
const STAGES = [
  { 
    key: "PAPER", 
    label: "PAPER", 
    icon: FileText, 
    description: "Paper trading", 
    suggestedTypes: ["SIM", "VIRTUAL"] 
  },
  { 
    key: "SHADOW", 
    label: "SHADOW", 
    icon: Eye, 
    description: "Staging (mirrors live)", 
    suggestedTypes: ["SIM", "LIVE"] 
  },
  { 
    key: "LIVE", 
    label: "LIVE", 
    icon: Zap, 
    description: "Real execution", 
    suggestedTypes: ["LIVE"] 
  },
];

interface StageRoutingPanelProps {
  defaultAccounts: Record<string, string | null>;
  onDefaultChange: (stage: string, accountId: string | null) => void;
  compact?: boolean;
}

export function StageRoutingPanel({ 
  defaultAccounts, 
  onDefaultChange, 
  compact = false 
}: StageRoutingPanelProps) {
  const { data: accountsRaw, isLoading, isError } = useAccounts();
  const accounts = accountsRaw ?? [];

  const isDegraded = isError || (!isLoading && !accountsRaw);

  const getAccountsForStage = (stage: typeof STAGES[number]) => {
    return accounts.filter(acc => {
      const type = acc.accountType;
      // TRIALS/PAPER can use VIRTUAL/SIM, SHADOW can use SIM/LIVE, LIVE requires LIVE
      if (stage.key === "LIVE") return type === "LIVE";
      if (stage.key === "SHADOW") return type === "SIM" || type === "LIVE";
      return type === "VIRTUAL" || type === "SIM";
    });
  };

  if (isDegraded) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-3">
          <DegradedBanner message="Account data unavailable - routing disabled" />
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-medium">Stage → Account Defaults</p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-3 h-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">
                    Default accounts used when promoting bots or auto-assigning during creation.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {STAGES.map((stage) => {
              const Icon = stage.icon;
              const available = getAccountsForStage(stage);
              const current = defaultAccounts[stage.key];
              
              return (
                <div key={stage.key} className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icon className="w-3 h-3" />
                    {stage.label}
                  </div>
                  <Select 
                    value={current || "none"} 
                    onValueChange={(v) => onDefaultChange(stage.key, v === "none" ? null : v)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {available.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          Stage Routing Defaults
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">
                  Set default accounts for each lifecycle stage. Used when promoting bots 
                  or auto-assigning during creation. TRIALS→PAPER→SHADOW→LIVE progression.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const available = getAccountsForStage(stage);
            const current = defaultAccounts[stage.key];
            const currentAccount = accounts.find(a => a.id === current);
            
            return (
              <div key={stage.key} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="p-1.5 rounded bg-muted">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">{stage.label}</p>
                    <p className="text-[10px] text-muted-foreground">{stage.description}</p>
                  </div>
                </div>
                <Select 
                  value={current || "none"} 
                  onValueChange={(v) => onDefaultChange(stage.key, v === "none" ? null : v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">No default</span>
                    </SelectItem>
                    {available.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <span className="flex items-center gap-2">
                          {acc.name}
                          <span className="text-[10px] text-muted-foreground">
                            ({acc.accountType})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {available.length === 0 && (
                  <p className="text-[10px] text-warning">
                    No {stage.suggestedTypes.join("/")} accounts
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
