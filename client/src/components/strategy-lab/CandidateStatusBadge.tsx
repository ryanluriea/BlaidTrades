import { Badge } from "@/components/ui/badge";
import { Send, Dna, Trophy, Archive, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CandidateStatus = 
  | 'DRAFT' 
  | 'SCREENED' 
  | 'REJECTED' 
  | 'FINALIST' 
  | 'EXPORTED' 
  | 'VALIDATING' 
  | 'PASSED' 
  | 'FAILED'
  | 'SENT_TO_LAB'
  | 'EVOLVING'
  | 'TOURNAMENT_WINNER'
  | 'TOURNAMENT_SURVIVOR'
  | 'TOURNAMENT_ELIMINATED';

interface CandidateStatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Send; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  SENT_TO_LAB: { label: 'Sent to LAB', icon: Send, variant: 'secondary' },
  EVOLVING: { label: 'Evolving', icon: Dna, variant: 'secondary' },
  TOURNAMENT_WINNER: { label: 'Winner', icon: Trophy, variant: 'default' },
  TOURNAMENT_SURVIVOR: { label: 'Survivor', icon: CheckCircle2, variant: 'outline' },
  TOURNAMENT_ELIMINATED: { label: 'Eliminated', icon: X, variant: 'destructive' },
  EXPORTED: { label: 'Exported', icon: Send, variant: 'secondary' },
  REJECTED: { label: 'Rejected', icon: X, variant: 'destructive' },
  ARCHIVED: { label: 'Archived', icon: Archive, variant: 'outline' },
};

export function CandidateStatusBadge({ status, className }: CandidateStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  
  if (!config) return null;
  
  const Icon = config.icon;
  
  return (
    <Badge 
      variant={config.variant}
      className={cn("text-[10px] h-5 gap-1", className)}
    >
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </Badge>
  );
}
