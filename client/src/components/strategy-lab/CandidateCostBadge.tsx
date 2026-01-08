import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface AIUsageItem {
  provider: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  task_type?: string;
}

interface CandidateCostBadgeProps {
  costUsd: number;
  aiUsage?: AIUsageItem[];
  className?: string;
}

export function CandidateCostBadge({ costUsd, aiUsage, className }: CandidateCostBadgeProps) {
  const cost = costUsd || 0;

  // Group usage by provider
  const providerSummary = (aiUsage || []).reduce((acc, item) => {
    const provider = item.provider || 'unknown';
    if (!acc[provider]) {
      acc[provider] = { calls: 0, cost: 0, tokens: 0 };
    }
    acc[provider].calls++;
    acc[provider].cost += item.cost_usd || 0;
    acc[provider].tokens += (item.tokens_in || 0) + (item.tokens_out || 0);
    return acc;
  }, {} as Record<string, { calls: number; cost: number; tokens: number }>);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] h-5 gap-1 tabular-nums font-mono",
              cost > 0.5 ? "text-amber-400 border-amber-500/30" : "text-muted-foreground",
              className
            )}
          >
            <DollarSign className="h-2.5 w-2.5" />
            {cost.toFixed(3)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          <p className="font-medium mb-2">Cost to produce: ${cost.toFixed(4)}</p>
          {Object.keys(providerSummary).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(providerSummary).map(([provider, data]) => (
                <div key={provider} className="flex justify-between gap-4">
                  <span className="capitalize">{provider}</span>
                  <span className="text-muted-foreground">
                    {data.calls} calls • ${data.cost.toFixed(4)} • {data.tokens.toLocaleString()} tokens
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No AI usage data</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
