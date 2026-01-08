import { useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, AlertTriangle, Target, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CandidateReasoningPanelProps {
  reasoning: {
    why_exists?: string;
    why_ranked?: string;
    data_signals?: string[];
    regime_match?: string;
    risk_filters?: string[];
    what_invalidates?: string;
  };
  className?: string;
}

export function CandidateReasoningPanel({ reasoning, className }: CandidateReasoningPanelProps) {
  const [expanded, setExpanded] = useState(false);
  
  const hasContent = reasoning.data_signals?.length || reasoning.regime_match || reasoning.risk_filters?.length;
  
  if (!hasContent) return null;
  
  return (
    <div className={cn("border border-border/50 rounded-lg overflow-hidden", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-8 justify-between text-xs rounded-none hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          <Brain className="h-3 w-3 text-primary" />
          AI Reasoning Snapshot
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </Button>
      
      {expanded && (
        <div className="p-3 space-y-3 text-xs bg-muted/20">
          {/* Data Signals */}
          {reasoning.data_signals && reasoning.data_signals.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1.5 flex items-center gap-1">
                <Target className="h-3 w-3" />
                Data Signals Used
              </p>
              <div className="flex flex-wrap gap-1">
                {reasoning.data_signals.map((signal, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] h-4">
                    {signal}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {/* Regime Match */}
          {reasoning.regime_match && (
            <div>
              <p className="text-muted-foreground mb-1 flex items-center gap-1">
                <Lightbulb className="h-3 w-3" />
                Regime Match
              </p>
              <p className="text-foreground">{reasoning.regime_match}</p>
            </div>
          )}
          
          {/* Risk Filters */}
          {reasoning.risk_filters && reasoning.risk_filters.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Risk Filters
              </p>
              <ul className="space-y-0.5">
                {reasoning.risk_filters.map((filter, i) => (
                  <li key={i} className="text-foreground">• {filter}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* What Invalidates */}
          {reasoning.what_invalidates && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-muted-foreground mb-1">What would invalidate this edge:</p>
              <p className="text-amber-400 text-[11px]">{reasoning.what_invalidates}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
