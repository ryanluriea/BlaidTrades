import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StrategyLabUsage } from "@/hooks/useStrategyLab";
import { cn } from "@/lib/utils";

interface StrategyLabAILogosProps {
  usage: StrategyLabUsage[] | undefined;
  maxLogos?: number;
  className?: string;
}

// Provider logo components (monochrome, subtle)
const PROVIDER_LOGOS: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  anthropic: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M17.604 3.312L12 18.687l-5.604-15.375h-3.75L12 23.063l9.354-19.75h-3.75z" />
      </svg>
    ),
    label: "Anthropic Claude",
    color: "text-orange-400",
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
    label: "Google Gemini",
    color: "text-blue-400",
  },
  openai: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    ),
    label: "OpenAI GPT",
    color: "text-emerald-400",
  },
  xai: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    label: "xAI Grok",
    color: "text-gray-400",
  },
  lovable: {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
    label: "Lovable AI Gateway",
    color: "text-pink-400",
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
  },
};

export function StrategyLabAILogos({ usage, maxLogos = 3, className }: StrategyLabAILogosProps) {
  if (!usage || usage.length === 0) return null;

  // Compute provider stats
  const providerMap = new Map<string, { calls: number; cost: number; tasks: Set<string> }>();
  for (const u of usage) {
    const existing = providerMap.get(u.provider) || { calls: 0, cost: 0, tasks: new Set() };
    existing.calls++;
    existing.cost += u.cost_usd || 0;
    existing.tasks.add(u.task_type);
    providerMap.set(u.provider, existing);
  }

  const providers = Array.from(providerMap.entries())
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, maxLogos);

  const totalProviders = providerMap.size;
  const overflow = totalProviders - maxLogos;
  const totalCost = usage.reduce((sum, u) => sum + (u.cost_usd || 0), 0);
  const totalCalls = usage.length;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {providers.map(([provider, stats]) => {
        const config = PROVIDER_LOGOS[provider] || PROVIDER_LOGOS.lovable;
        const percentage = Math.round((stats.calls / totalCalls) * 100);

        return (
          <Tooltip key={provider}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "p-1 rounded transition-opacity opacity-60 hover:opacity-100",
                  config.color
                )}
              >
                {config.icon}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="font-medium">{config.label}</div>
              <div className="text-muted-foreground">
                {stats.calls} calls ({percentage}%)
              </div>
              <div className="text-muted-foreground">
                Tasks: {Array.from(stats.tasks).join(", ")}
              </div>
              {stats.cost > 0 && (
                <div className="text-muted-foreground">${stats.cost.toFixed(4)}</div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[10px] text-muted-foreground px-1">+{overflow}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div>{totalProviders} providers total</div>
            <div>{totalCalls} AI calls</div>
            {totalCost > 0 && <div>${totalCost.toFixed(4)} total cost</div>}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
