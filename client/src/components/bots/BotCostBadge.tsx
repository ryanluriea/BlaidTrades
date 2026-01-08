import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cpu, Database, Newspaper, TrendingUp, Loader2, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface CostBreakdown {
  category: string;
  provider: string;
  event_count: string;
  total_input_tokens: string | null;
  total_output_tokens: string | null;
  total_cost_usd: string;
  last_event_at: string | null;
}

interface BotCostsData {
  botId: string;
  totalCostUsd: number;
  breakdown: CostBreakdown[];
}

/** Pre-fetched LLM cost data from bots-overview API */
export interface PreFetchedLLMCost {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  event_count: number;
  last_provider: string | null;
  last_model: string | null;
}

interface BotCostBadgeProps {
  botId: string;
  showDetails?: boolean;
  /** Compact mode for grid box display - shows smaller text */
  compact?: boolean;
  /** Pre-fetched LLM cost data - skip API call if provided */
  llmCostData?: PreFetchedLLMCost | null;
}

function getCategoryIcon(category: string) {
  switch (category) {
    case "llm":
      return <Cpu className="h-3.5 w-3.5 text-purple-400" />;
    case "data_market":
      return <TrendingUp className="h-3.5 w-3.5 text-blue-400" />;
    case "data_options":
      return <TrendingUp className="h-3.5 w-3.5 text-green-400" />;
    case "data_macro":
      return <Database className="h-3.5 w-3.5 text-amber-400" />;
    case "data_news":
      return <Newspaper className="h-3.5 w-3.5 text-cyan-400" />;
    default:
      return <Coins className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getCategoryLabel(category: string) {
  switch (category) {
    case "llm":
      return "AI/LLM";
    case "data_market":
      return "Market Data";
    case "data_options":
      return "Options Flow";
    case "data_macro":
      return "Macro Data";
    case "data_news":
      return "News";
    case "compute":
      return "Compute";
    default:
      return category;
  }
}

function formatCost(cost: number, showDashIfNegligible = false): string {
  // Industry standard: Sub-penny costs are negligible, show dash or $0.00
  if (cost < 0.01) {
    if (showDashIfNegligible) return "-";
    return "$0.00";
  }
  if (cost < 1) {
    return `$${cost.toFixed(2)}`;
  }
  if (cost < 100) {
    return `$${cost.toFixed(2)}`;
  }
  // Large costs: use K/M suffixes
  if (cost < 1000) {
    return `$${cost.toFixed(0)}`;
  }
  if (cost < 1000000) {
    return `$${(cost / 1000).toFixed(1)}K`;
  }
  return `$${(cost / 1000000).toFixed(1)}M`;
}

function CostBreakdownRow({ item }: { item: CostBreakdown }) {
  const cost = parseFloat(item.total_cost_usd) || 0;
  const inputTokens = parseInt(item.total_input_tokens || "0");
  const outputTokens = parseInt(item.total_output_tokens || "0");
  const eventCount = parseInt(item.event_count);

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      {getCategoryIcon(item.category)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">
              {getCategoryLabel(item.category)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {item.provider}
            </span>
          </div>
          <span className={cn(
            "text-xs font-mono font-medium",
            cost < 0.01 && "text-muted-foreground"
          )}>
            {formatCost(cost, true)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{eventCount} call{eventCount !== 1 ? "s" : ""}</span>
          {item.category === "llm" && (inputTokens > 0 || outputTokens > 0) && (
            <span className="font-mono">
              {inputTokens.toLocaleString()}+{outputTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function BotCostBadge({ botId, showDetails = false, compact = false, llmCostData }: BotCostBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Skip API call if pre-fetched data is provided (optimization for bots-overview)
  const { data: costsData, isLoading } = useQuery<{ success: boolean; data: BotCostsData }>({
    queryKey: ["/api/bots", botId, "costs"],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/costs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch bot costs");
      return response.json();
    },
    enabled: !!botId && !llmCostData, // Skip if pre-fetched data provided
    staleTime: 30000,
  });

  // Use pre-fetched data if available, otherwise use API response
  const hasPreFetched = !!llmCostData;
  const costs = costsData?.data;
  const totalCost = hasPreFetched ? (llmCostData.total_cost_usd || 0) : (costs?.totalCostUsd || 0);
  const breakdown = costs?.breakdown || [];

  // When using pre-fetched data, we only have LLM costs (simplified display)
  const llmCost = hasPreFetched 
    ? (llmCostData.total_cost_usd || 0)
    : breakdown
        .filter((b) => b.category === "llm")
        .reduce((sum, b) => sum + parseFloat(b.total_cost_usd || "0"), 0);

  const dataCost = hasPreFetched 
    ? 0 // Pre-fetched data is LLM-only
    : breakdown
        .filter((b) => b.category.startsWith("data_"))
        .reduce((sum, b) => sum + parseFloat(b.total_cost_usd || "0"), 0);

  // Show dash for sub-penny costs (industry standard: negligible costs don't need display)
  const displayCost = formatCost(totalCost, true);
  const hasNegligibleCost = totalCost < 0.01;

  // ===== SHARED POPOVER CONTENT =====
  const popoverContent = (
    <PopoverContent className="w-72 p-0" align="start">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Cost Summary</span>
          </div>
          <span className={cn(
            "text-sm font-mono font-bold",
            hasNegligibleCost && "text-muted-foreground"
          )}>
            {formatCost(totalCost, true)}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Cpu className="h-3 w-3 text-purple-400" />
            <span>LLM: {formatCost(llmCost, true)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Database className="h-3 w-3 text-blue-400" />
            <span>Data: {formatCost(dataCost, true)}</span>
          </div>
        </div>
      </div>

      <div className="max-h-60 overflow-y-auto p-2">
        {breakdown.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No cost events recorded
          </div>
        ) : (
          breakdown.map((item, index) => (
            <CostBreakdownRow key={`${item.category}-${item.provider}-${index}`} item={item} />
          ))
        )}
      </div>
    </PopoverContent>
  );

  const tooltipContent = (
    <TooltipContent side="top" className="max-w-[200px]">
      <p className="text-xs font-medium">Total Cost: {displayCost}</p>
      <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
        <p>LLM: {formatCost(llmCost, true)}</p>
        <p>Data: {formatCost(dataCost, true)}</p>
      </div>
      <p className="text-[10px] text-emerald-400 mt-1">Click for details</p>
    </TooltipContent>
  );

  // ===== COMPACT MODE =====
  if (compact) {
    // Show loading only when fetching from API (not when using pre-fetched data)
    if (isLoading && !hasPreFetched) {
      return (
        <div className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border bg-muted/20 border-muted-foreground/30">
          <span className="text-[9px] uppercase leading-none opacity-70 text-muted-foreground">COST</span>
          <span className="text-[11px] font-mono font-semibold leading-none text-muted-foreground">...</span>
        </div>
      );
    }
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button 
                className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border bg-muted/20 border-muted-foreground/30 cursor-pointer hover:bg-muted/40 transition-all"
                data-testid={`compact-cost-${botId}`}
              >
                <span className="text-[9px] uppercase leading-none opacity-70 text-muted-foreground">COST</span>
                <span className={cn(
                  "text-[11px] font-mono font-semibold leading-none",
                  hasNegligibleCost ? "text-muted-foreground" : "text-foreground"
                )}>
                  {displayCost}
                </span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {tooltipContent}
        </Tooltip>
        {popoverContent}
      </Popover>
    );
  }

  // Only show dash when no data source available (neither API nor pre-fetched)
  if (!costs && !isLoading && !hasPreFetched) {
    return (
      <Badge 
        variant="outline" 
        className="h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30"
        data-testid={`badge-cost-${botId}`}
      >
        <span className="font-mono">-</span>
      </Badge>
    );
  }

  // ===== FULL MODE =====
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-6 px-2 text-xs font-mono",
            hasNegligibleCost && "text-muted-foreground"
          )}
          data-testid={`button-cost-${botId}`}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <span>{displayCost}</span>
          )}
        </Button>
      </PopoverTrigger>
      {popoverContent}
    </Popover>
  );
}
