import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PROVIDER_CONFIG } from "./LLMProviderBadge";
import { AiResearchProvenancePopover } from "./AiResearchProvenancePopover";
import grokLogoSrc from "@assets/grok-logo.png";

interface ResearchSource {
  type: string;
  label: string;
  detail: string;
}

interface InlineAiProviderBadgeProps {
  provider?: string | null;
  createdByAi?: string | null;
  badge?: boolean | null;
  reasoning?: string | null;
  sources?: ResearchSource[] | null;
  researchDepth?: string | null;
}

const GrokLogo = ({ className }: { className?: string }) => (
  <img 
    src={grokLogoSrc} 
    alt="Grok" 
    className={cn("object-contain", className)}
  />
);

const PerplexityLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path 
      d="M12 2L12 8M12 16L12 22M2 8H8L12 12L16 8H22M2 16H8L12 12L16 16H22M8 8V16M16 8V16" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="square" 
      strokeLinejoin="miter"
      fill="none"
    />
  </svg>
);

const OpenAILogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);

const getProviderLogo = (provider: string | null | undefined) => {
  const normalized = provider?.toLowerCase();
  switch (normalized) {
    case "grok":
    case "xai":
      return { Logo: GrokLogo, color: "text-gray-300", bgColor: "bg-gray-800", name: "xAI Grok" };
    case "perplexity":
      return { Logo: PerplexityLogo, color: "text-cyan-400", bgColor: "bg-cyan-500/20", name: "Perplexity" };
    case "openai":
      return { Logo: OpenAILogo, color: "text-emerald-400", bgColor: "bg-emerald-500/20", name: "OpenAI" };
    default:
      return null;
  }
};

export function InlineAiProviderBadge({ 
  provider, 
  createdByAi, 
  badge,
  reasoning,
  sources,
  researchDepth
}: InlineAiProviderBadgeProps) {
  if (!provider && !createdByAi) return null;
  
  const logoConfig = getProviderLogo(provider);
  const normalizedProvider = provider?.toLowerCase() || "other";
  const config = PROVIDER_CONFIG[normalizedProvider] || PROVIDER_CONFIG.other;
  const providerName = createdByAi || logoConfig?.name || config.name;
  
  if (reasoning || (sources && sources.length > 0)) {
    return (
      <AiResearchProvenancePopover
        provider={provider}
        createdByAi={createdByAi}
        reasoning={reasoning}
        sources={sources}
        researchDepth={researchDepth}
        compact={true}
      />
    );
  }
  
  if (logoConfig) {
    const { Logo, color, bgColor, name } = logoConfig;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={cn(
                "inline-flex items-center justify-center h-5 w-5 rounded shrink-0 transition-opacity hover:opacity-100",
                bgColor,
                "opacity-80"
              )}
              data-testid={`badge-ai-provider-${normalizedProvider}`}
            >
              <Logo className={cn("h-3 w-3", color)} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className={cn("font-medium", color)}>AI Generated</p>
            <p className="text-muted-foreground">Created by {name}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full shrink-0",
              config.bgColor
            )}
            data-testid={`badge-ai-provider-${normalizedProvider}`}
          >
            {normalizedProvider === "grok" || normalizedProvider === "xai" ? (
              <img 
                src={grokLogoSrc} 
                alt="Grok" 
                className="h-2.5 w-2.5 object-contain"
              />
            ) : (
              <span className="text-[9px] font-bold text-white leading-none">
                {config.abbrev.charAt(0)}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className={cn("font-medium", config.color)}>AI Generated</p>
          <p className="text-muted-foreground">Created by {providerName}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
