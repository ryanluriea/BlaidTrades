import { DollarSign, Brain, Zap, Search, Shield, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StrategyLabCostEvent } from "@/hooks/useStrategyLab";
import { cn } from "@/lib/utils";

interface StrategyLabAICostBarProps {
  costs: StrategyLabCostEvent[] | undefined;
  className?: string;
}

// Provider configurations with logos and colors
const PROVIDER_CONFIG: Record<string, { 
  icon: React.ReactNode; 
  label: string; 
  color: string;
  bgColor: string;
  role: string;
}> = {
  anthropic: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M17.604 3.312L12 18.687l-5.604-15.375h-3.75L12 23.063l9.354-19.75h-3.75z" />
      </svg>
    ),
    label: "Claude",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    role: "Deep reasoning & strategy critique",
  },
  google: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    ),
    label: "Gemini",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    role: "Open-world research & discovery",
  },
  openai: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494z" />
      </svg>
    ),
    label: "GPT",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    role: "Strategy structuring & parameters",
  },
  xai: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    label: "Grok",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    role: "Rapid comparisons & ranking",
  },
  groq: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="currentColor" fill="none" />
        <path d="M8 12h8M12 8v8" strokeWidth="2" stroke="currentColor" />
      </svg>
    ),
    label: "Groq",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    role: "Fast inference & sanity checks",
  },
  perplexity: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="currentColor" fill="none" />
        <path d="M12 6v6l4 2" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
    ),
    label: "Perplexity",
    color: "text-teal-400",
    bgColor: "bg-teal-500/10",
    role: "Web-grounded research with citations",
  },
  lovable: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
    label: "Lovable AI",
    color: "text-pink-400",
    bgColor: "bg-pink-500/10",
    role: "General AI gateway",
  },
};

// Task type to purpose mapping
const TASK_PURPOSE: Record<string, string> = {
  DISCOVER_UNIVERSE: "Discovery",
  OPEN_WEB_RESEARCH: "Research",
  CLOSED_WORLD_SYNTHESIS: "Synthesis",
  STRATEGY_DESIGN: "Design",
  PARAMETERIZATION: "Parameters",
  VALIDATION_PLAN: "Validation",
  RESULTS_ANALYSIS: "Analysis",
  REGIME_BREAKDOWN: "Regimes",
  RISK_MODELING: "Risk",
  EXPORT_STRATEGY: "Export",
  RESEARCH: "Research",
  SYNTHESIS: "Synthesis",
  CRITIQUE: "Critique",
  MUTATION: "Mutation",
};

interface ProviderStats {
  calls: number;
  cost: number;
  tokens_in: number;
  tokens_out: number;
  tasks: Set<string>;
  latency_total: number;
}

export function StrategyLabAICostBar({ costs, className }: StrategyLabAICostBarProps) {
  if (!costs || costs.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50", className)}>
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No AI usage yet</span>
      </div>
    );
  }

  // Compute provider stats
  const providerMap = new Map<string, ProviderStats>();
  let totalCost = 0;
  let totalCalls = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const c of costs) {
    const provider = c.provider.toLowerCase();
    const existing = providerMap.get(provider) || { 
      calls: 0, 
      cost: 0, 
      tokens_in: 0, 
      tokens_out: 0, 
      tasks: new Set(), 
      latency_total: 0 
    };
    existing.calls++;
    existing.cost += c.cost_usd || 0;
    existing.tokens_in += c.tokens_in || 0;
    existing.tokens_out += c.tokens_out || 0;
    existing.tasks.add(c.model || 'unknown');
    existing.latency_total += c.latency_ms || 0;
    providerMap.set(provider, existing);
    
    totalCost += c.cost_usd || 0;
    totalCalls++;
    totalTokensIn += c.tokens_in || 0;
    totalTokensOut += c.tokens_out || 0;
  }

  const providers = Array.from(providerMap.entries())
    .sort((a, b) => b[1].calls - a[1].calls);

  return (
    <TooltipProvider>
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg bg-gradient-to-r from-muted/50 to-muted/30 border border-border/60",
        className
      )}>
        {/* Provider breakdown */}
        <div className="flex items-center gap-2">
          {providers.map(([provider, stats]) => {
            const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.lovable;
            const percentage = Math.round((stats.calls / totalCalls) * 100);
            const costPct = totalCost > 0 ? Math.round((stats.cost / totalCost) * 100) : 0;

            return (
              <Tooltip key={provider}>
                <TooltipTrigger asChild>
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all cursor-help",
                    config.bgColor,
                    "hover:ring-1 hover:ring-border"
                  )}>
                    <div className={config.color}>{config.icon}</div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium leading-tight">{percentage}%</span>
                      <span className="text-[9px] text-muted-foreground leading-tight">
                        ${stats.cost.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="w-56">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={config.color}>{config.icon}</div>
                      <span className="font-medium">{config.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{config.role}</div>
                    <div className="border-t border-border/50 pt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Calls:</span>
                        <span>{stats.calls} ({percentage}%)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost:</span>
                        <span>${stats.cost.toFixed(4)} ({costPct}%)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tokens:</span>
                        <span>{(stats.tokens_in + stats.tokens_out).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg latency:</span>
                        <span>{Math.round(stats.latency_total / stats.calls)}ms</span>
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border/60" />

        {/* Total cost */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 cursor-help">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold tabular-nums">${totalCost.toFixed(2)}</span>
                <span className="text-[9px] text-muted-foreground leading-tight">session cost</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-48">
            <div className="space-y-1 text-xs">
              <div className="font-medium">Session Totals</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI Calls:</span>
                <span>{totalCalls}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Input tokens:</span>
                <span>{totalTokensIn.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Output tokens:</span>
                <span>{totalTokensOut.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-medium pt-1 border-t border-border/50">
                <span>Total Cost:</span>
                <span className="text-emerald-400">${totalCost.toFixed(4)}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// Compact version for session cards
export function StrategyLabAICostBadge({ costs }: { costs: StrategyLabCostEvent[] | undefined }) {
  if (!costs || costs.length === 0) return null;

  const totalCost = costs.reduce((sum, c) => sum + (c.cost_usd || 0), 0);
  const providerCount = new Set(costs.map(c => c.provider.toLowerCase())).size;

  return (
    <Badge variant="outline" className="text-[10px] gap-1">
      <DollarSign className="h-3 w-3 text-emerald-400" />
      ${totalCost.toFixed(2)}
      {providerCount > 1 && (
        <span className="text-muted-foreground">· {providerCount} AI</span>
      )}
    </Badge>
  );
}
