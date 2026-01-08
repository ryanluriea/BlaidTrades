import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BookOpen, ExternalLink, FileText, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface EvidenceLink {
  title: string;
  url?: string;
  source_type?: string;
  excerpt?: string;
  reliability_score?: number;
}

interface CandidateEvidenceTooltipProps {
  evidence: {
    sources?: EvidenceLink[];
    citations?: string[];
    hypothesis_count?: number;
    research_depth?: string;
  };
  className?: string;
}

export function CandidateEvidenceTooltip({ evidence, className }: CandidateEvidenceTooltipProps) {
  const sources = evidence?.sources || [];
  const citations = evidence?.citations || [];
  const sourceCount = sources.length + citations.length;

  if (sourceCount === 0 && !evidence?.hypothesis_count) {
    return null;
  }

  const getSourceIcon = (type?: string) => {
    switch (type?.toUpperCase()) {
      case 'WEB':
        return Globe;
      case 'PAPER':
        return FileText;
      default:
        return BookOpen;
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("text-[9px] h-5 gap-1 cursor-help", className)}
          >
            <BookOpen className="h-2.5 w-2.5" />
            {sourceCount > 0 ? `${sourceCount} sources` : `${evidence.hypothesis_count || 0} hypotheses`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-sm">
          <p className="font-medium mb-2">Evidence & Sources</p>
          {sources.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {sources.slice(0, 5).map((source, i) => {
                const Icon = getSourceIcon(source.source_type);
                return (
                  <div key={i} className="flex items-start gap-2">
                    <Icon className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{source.title || 'Untitled'}</p>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          View source
                        </a>
                      )}
                      {source.excerpt && (
                        <p className="text-muted-foreground line-clamp-2 text-[10px] mt-0.5">
                          {source.excerpt}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {sources.length > 5 && (
                <p className="text-muted-foreground">+{sources.length - 5} more sources</p>
              )}
            </div>
          ) : evidence?.hypothesis_count ? (
            <p className="text-muted-foreground">
              Generated from {evidence.hypothesis_count} research hypotheses
              {evidence.research_depth && ` (${evidence.research_depth} depth)`}
            </p>
          ) : (
            <p className="text-muted-foreground">No source data available</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
