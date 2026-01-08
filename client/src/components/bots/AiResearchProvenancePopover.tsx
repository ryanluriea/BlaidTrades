import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, MessageSquareText, Database, Twitter, Newspaper, TrendingUp, Sparkles, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_CONFIG } from "./LLMProviderBadge";

interface ResearchSource {
  type: string;
  label: string;
  detail: string;
}

interface AiResearchProvenancePopoverProps {
  provider?: string | null;
  reasoning?: string | null;
  sources?: ResearchSource[] | null;
  researchDepth?: string | null;
  createdByAi?: string | null;
  compact?: boolean;
}

const DEPTH_CONFIG: Record<string, { label: string; description: string; color: string }> = {
  CONTRARIAN_SCAN: { 
    label: "Contrarian Scan", 
    description: "Detected crowded trades and sentiment extremes that historically precede reversals",
    color: "text-amber-400" 
  },
  SENTIMENT_BURST: { 
    label: "X/Twitter Intelligence", 
    description: "Analyzed real-time social sentiment from X/Twitter and financial media",
    color: "text-cyan-400" 
  },
  DEEP_REASONING: { 
    label: "Deep Reasoning", 
    description: "Institutional-grade multi-timeframe confluence analysis with macro regime integration",
    color: "text-purple-400" 
  },
};

const SOURCE_ICONS: Record<string, typeof Twitter> = {
  "X/Twitter": Twitter,
  "Twitter": Twitter,
  "Social": Twitter,
  "Options Flow": TrendingUp,
  "Options": TrendingUp,
  "Technical": TrendingUp,
  "News": Newspaper,
  "Catalyst": Newspaper,
  "Sentiment": Brain,
  "Research": Database,
};

function getSourceIcon(type: string) {
  const IconComponent = SOURCE_ICONS[type] || HelpCircle;
  return IconComponent;
}

export function AiResearchProvenancePopover({ 
  provider, 
  reasoning, 
  sources, 
  researchDepth,
  createdByAi,
  compact = false 
}: AiResearchProvenancePopoverProps) {
  const [open, setOpen] = useState(false);
  
  // Don't render if no AI provenance data
  if (!provider && !reasoning && !sources) return null;
  
  const normalizedProvider = provider?.toLowerCase() || "other";
  const config = PROVIDER_CONFIG[normalizedProvider] || PROVIDER_CONFIG.other;
  const depthConfig = researchDepth ? DEPTH_CONFIG[researchDepth] : null;
  const parsedSources: ResearchSource[] = Array.isArray(sources) ? sources : [];
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded-full shrink-0 cursor-pointer transition-all",
            compact ? "h-4 min-w-4 px-0.5" : "h-5 px-1.5",
            config.bgColor,
            "hover:ring-2 hover:ring-offset-1 hover:ring-offset-background",
            normalizedProvider === "grok" ? "hover:ring-purple-400" : "hover:ring-cyan-400"
          )}
          data-testid={`button-ai-provenance-${normalizedProvider}`}
        >
          <span className={cn(
            "font-bold text-white leading-none",
            compact ? "text-[9px]" : "text-[10px]"
          )}>
            {normalizedProvider === "grok" ? "G" : config.abbrev.charAt(0)}
          </span>
          {!compact && reasoning && (
            <MessageSquareText className="h-3 w-3 text-white/80" />
          )}
        </button>
      </PopoverTrigger>
      
      <PopoverContent 
        side="top" 
        align="start"
        className="w-80 p-0"
        data-testid="popover-ai-provenance"
      >
        <div className="p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className={cn("h-4 w-4", config.color)} />
            <span className={cn("font-semibold text-sm", config.color)}>
              {createdByAi || config.name}
            </span>
            {depthConfig && (
              <Badge variant="outline" className={cn("text-[9px] h-4", depthConfig.color)}>
                {depthConfig.label}
              </Badge>
            )}
          </div>
          {depthConfig && (
            <p className="text-[10px] text-muted-foreground">
              {depthConfig.description}
            </p>
          )}
        </div>
        
        {reasoning && (
          <div className="p-3 border-b">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Brain className="h-3.5 w-3.5 text-foreground" />
              <span className="text-xs font-medium">Why This Strategy</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {reasoning}
            </p>
          </div>
        )}
        
        {parsedSources.length > 0 && (
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Database className="h-3.5 w-3.5 text-foreground" />
              <span className="text-xs font-medium">Sources Used</span>
            </div>
            <ScrollArea className={parsedSources.length > 4 ? "h-32" : undefined}>
              <div className="space-y-2">
                {parsedSources.map((source, idx) => {
                  const IconComponent = getSourceIcon(source.type);
                  return (
                    <div 
                      key={idx}
                      className="flex items-start gap-2 text-xs"
                      data-testid={`source-item-${idx}`}
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted shrink-0 mt-0.5">
                        <IconComponent className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{source.type}</span>
                          {source.label && source.label !== source.type && (
                            <span className="text-muted-foreground">({source.label})</span>
                          )}
                        </div>
                        {source.detail && (
                          <p className="text-muted-foreground text-[10px] leading-snug mt-0.5">
                            {source.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
        
        {!reasoning && parsedSources.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground">
              AI-generated strategy
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Detailed provenance not available for this candidate
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
