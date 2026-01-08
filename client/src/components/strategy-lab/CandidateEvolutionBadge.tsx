import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dna } from "lucide-react";
import { cn } from "@/lib/utils";

interface CandidateEvolutionBadgeProps {
  generation: number;
  parentName?: string | null;
  className?: string;
}

export function CandidateEvolutionBadge({ 
  generation, 
  parentName, 
  className 
}: CandidateEvolutionBadgeProps) {
  if (generation <= 1) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center justify-center",
              "text-violet-400",
              className
            )}
            data-testid="icon-evolution"
          >
            <Dna className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          <p className="font-medium">AI-Evolved (Gen {generation})</p>
          <p className="text-muted-foreground">
            Auto-improved from QC failure
          </p>
          {parentName && (
            <p className="text-muted-foreground mt-1 truncate">
              Parent: {parentName}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
