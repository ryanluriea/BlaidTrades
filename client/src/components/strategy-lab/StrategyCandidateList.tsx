import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StrategyCandidateCard } from "./StrategyCandidateCard";
import { CandidateDetailsDrawer } from "./CandidateDetailsDrawer";
import { SendToLabModal } from "./SendToLabModal";
import { Search, SortAsc, Filter, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  session_id: string;
  name?: string;
  rank?: number | null;
  status: string;
  deployability_score?: number;
  regime_tags?: string[];
  contract_preference?: string;
  cost_usd?: number;
  created_at?: string;
  blueprint?: {
    name?: string;
    archetype?: string;
    symbol_candidates?: string[];
  };
  scores?: {
    viability_score?: number;
  };
  [key: string]: unknown;
}

interface StrategyCandidateListProps {
  candidates: Candidate[];
  isLoading?: boolean;
  sessionId: string;
  onRefresh?: () => void;
  className?: string;
}

import { useRejectCandidate } from "@/hooks/useStrategyLab";

type SortField = 'rank' | 'score' | 'cost' | 'name';
type FilterStatus = 'all' | 'ready' | 'sent' | 'rejected';

export function StrategyCandidateList({
  candidates,
  isLoading,
  sessionId,
  onRefresh,
  className,
}: StrategyCandidateListProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>('rank');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [sendToLabCandidate, setSendToLabCandidate] = useState<Candidate | null>(null);
  
  const rejectCandidate = useRejectCandidate();

  // Filter and sort candidates
  const filteredCandidates = candidates
    .filter((c) => {
      // Search filter
      const name = c.name || c.blueprint?.name || '';
      const archetype = c.blueprint?.archetype || '';
      const searchLower = search.toLowerCase();
      if (search && !name.toLowerCase().includes(searchLower) && !archetype.toLowerCase().includes(searchLower)) {
        return false;
      }
      // Status filter
      if (filterStatus === 'ready' && c.status !== 'READY' && c.status !== 'FINALIST') return false;
      if (filterStatus === 'sent' && c.status !== 'SENT_TO_LAB' && c.status !== 'EXPORTED') return false;
      if (filterStatus === 'rejected' && c.status !== 'REJECTED') return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return (b.deployability_score || b.scores?.viability_score || 0) - 
                 (a.deployability_score || a.scores?.viability_score || 0);
        case 'cost':
          return (a.cost_usd || 0) - (b.cost_usd || 0);
        case 'name':
          return (a.name || a.blueprint?.name || '').localeCompare(b.name || b.blueprint?.name || '');
        case 'rank':
        default:
          return (a.rank || 999) - (b.rank || 999);
      }
    });

  const readyCount = candidates.filter(c => c.status === 'READY' || c.status === 'FINALIST').length;
  const sentCount = candidates.filter(c => c.status === 'SENT_TO_LAB' || c.status === 'EXPORTED').length;

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
        <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-sm font-medium mb-1">No candidates yet</h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          Strategy candidates will appear here as the pipeline discovers and validates strategies.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Candidates</h3>
          <Badge variant="secondary" className="h-5 text-[10px]">
            {candidates.length} total
          </Badge>
          {readyCount > 0 && (
            <Badge variant="outline" className="h-5 text-[10px] text-emerald-400 border-emerald-500/30">
              {readyCount} ready
            </Badge>
          )}
          {sentCount > 0 && (
            <Badge variant="outline" className="h-5 text-[10px] text-blue-400 border-blue-500/30">
              {sentCount} sent
            </Badge>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search candidates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={sortBy} onValueChange={(v: SortField) => setSortBy(v)}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SortAsc className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rank">Rank</SelectItem>
            <SelectItem value="score">Score</SelectItem>
            <SelectItem value="cost">Cost</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v: FilterStatus) => setFilterStatus(v)}>
          <SelectTrigger className="h-8 w-24 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Candidate Cards */}
      <ScrollArea className="h-[500px]">
        <div className="space-y-3 pr-2">
          {filteredCandidates.map((candidate) => (
            <StrategyCandidateCard
              key={candidate.id}
              candidate={candidate}
              onSendToLab={() => setSendToLabCandidate({ ...candidate, session_id: sessionId })}
              onViewDetails={() => setSelectedCandidate(candidate)}
              onClone={() => {/* TODO: implement clone */}}
              onReject={() => rejectCandidate.mutate({ candidate_id: candidate.id, session_id: sessionId })}
            />
          ))}
          {filteredCandidates.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No candidates match your filters
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Details Drawer */}
      <CandidateDetailsDrawer
        candidate={selectedCandidate}
        open={!!selectedCandidate}
        onOpenChange={(open) => !open && setSelectedCandidate(null)}
        onSendToLab={() => {
          if (selectedCandidate) {
            setSendToLabCandidate({ ...selectedCandidate, session_id: sessionId });
            setSelectedCandidate(null);
          }
        }}
      />

      {/* Send to Lab Modal */}
      <SendToLabModal
        candidate={sendToLabCandidate}
        open={!!sendToLabCandidate}
        onOpenChange={(open) => !open && setSendToLabCandidate(null)}
        onSuccess={() => onRefresh?.()}
      />
    </div>
  );
}
