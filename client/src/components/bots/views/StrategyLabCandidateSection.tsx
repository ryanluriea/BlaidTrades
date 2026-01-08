import { useState } from "react";
import { 
  Award, ChevronDown, ChevronUp, TrendingUp, Shield, Clock, 
  DollarSign, Microscope, Target, AlertTriangle, CheckCircle2,
  Play, BarChart3, HelpCircle, X, Dna, Trophy, Sparkles
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CandidateRegimePills } from "@/components/strategy-lab/CandidateRegimePills";
import { CandidateConfidenceBadge } from "@/components/strategy-lab/CandidateConfidenceBadge";
import { CandidateEvolutionBadge } from "@/components/strategy-lab/CandidateEvolutionBadge";
import { CandidateCostBadge } from "@/components/strategy-lab/CandidateCostBadge";
import { CandidateStatusBadge } from "@/components/strategy-lab/CandidateStatusBadge";
import { StrategyNameDisplay } from "@/components/strategy-lab/StrategyNameDisplay";
import { CandidateReasoningPanel } from "@/components/strategy-lab/CandidateReasoningPanel";
import { generateStrategyNames } from "@/lib/strategyNaming";
import type { StrategyLabCandidate } from "@/hooks/useStrategyLab";

interface EnhancedCandidate extends StrategyLabCandidate {
  session_id: string;
  human_name?: string;
  system_codename?: string;
  deployability_score?: number;
  regime_tags?: string[];
  expected_metrics_json?: {
    trades_per_week?: { min: number; max: number };
    max_dd_pct?: { min: number; max: number };
    profit_factor?: { min: number; max: number };
    robustness_score?: number;
  };
  ai_usage_json?: Array<{
    provider: string;
    model: string;
    tokens: number;
    cost_usd: number;
    step: string;
  }>;
  cost_usd?: number;
  capital_sim_json?: {
    recommended_contract: string;
    sizing_by_capital: Array<{
      capital: number;
      contracts: number;
      expected_dd_pct: number;
    }>;
    survivability_score?: number;
    scale_plan?: string;
  };
  reasoning_json?: {
    why_exists?: string;
    why_ranked?: string;
    what_to_test?: string[];
    failure_modes?: string[];
    data_signals?: string[];
    regime_match?: string;
    risk_filters?: string[];
    what_invalidates?: string;
  };
  evidence_json?: {
    sources?: Array<{ title: string; url?: string }>;
    hypotheses?: string[];
  };
  tournament_status?: 'WINNER' | 'SURVIVOR' | 'ELIMINATED' | null;
  evolution_generation?: number;
  parent_strategy_name?: string | null;
}

interface StrategyCandidateCardProps {
  candidate: EnhancedCandidate;
  rank: number;
  onSendToLab: () => void;
  onViewDetails: () => void;
  onSendToEvolution?: () => void;
  onEnterTournament?: () => void;
  onReject?: () => void;
  isExporting?: boolean;
}

function StrategyCandidateCard({ 
  candidate, 
  rank, 
  onSendToLab, 
  onViewDetails,
  onSendToEvolution,
  onEnterTournament,
  onReject,
  isExporting 
}: StrategyCandidateCardProps) {
  const [whyExpanded, setWhyExpanded] = useState(false);
  
  // Generate names
  const archetype = candidate.blueprint?.archetype || "Custom";
  const instrument = candidate.blueprint?.symbol_candidates?.[0] || "MES";
  const regimeTags = candidate.regime_tags || candidate.blueprint?.symbol_candidates || [];
  const regime = regimeTags[0] || "";
  
  const names = candidate.human_name && candidate.system_codename
    ? { humanName: candidate.human_name, systemCodename: candidate.system_codename }
    : generateStrategyNames({
        archetype,
        instrument,
        regime,
        session: 'RTH',
        version: 1,
      });
  
  // Extract metrics
  const expectedMetrics = candidate.expected_metrics_json || {};
  const tradesPerWeek = expectedMetrics.trades_per_week || 
    { min: candidate.scores?.estimated_trades_month ? Math.floor(candidate.scores.estimated_trades_month / 4) : 5, max: 20 };
  const maxDdPct = expectedMetrics.max_dd_pct || 
    { min: candidate.scores?.estimated_max_dd || 6, max: 12 };
  const profitFactor = expectedMetrics.profit_factor || 
    { min: candidate.scores?.estimated_pf || 1.2, max: 1.8 };
  const robustnessScore = expectedMetrics.robustness_score || candidate.scores?.robustness_score || 65;
  
  const deployabilityScore = candidate.deployability_score || candidate.scores?.viability_score || 70;
  const costUsd = candidate.cost_usd || 0;
  const aiUsage = candidate.ai_usage_json || [];
  const reasoning = candidate.reasoning_json || {};
  
  // Capital sim
  const capitalSim = candidate.capital_sim_json;
  const recommendedContract = capitalSim?.recommended_contract || "MES";
  
  // Why this strategy exists
  const whyExists = reasoning.why_exists || 
    candidate.blueprint?.entry_rules || 
    "Exploits repeatable market inefficiency";

  // Check status
  const isSent = candidate.status === 'EXPORTED';
  const isWinner = candidate.tournament_status === 'WINNER';
  const isAutoPromoted = candidate.status === 'EXPORTED' && (candidate as any).auto_promoted === true;

  // Determine trade frequency label
  const tradeFreqLabel = tradesPerWeek.min < 5 ? 'Low' : tradesPerWeek.min < 15 ? 'Medium' : 'High';
  
  // Determine DD profile
  const ddProfile = maxDdPct.max <= 8 ? 'Low' : maxDdPct.max <= 15 ? 'Low–Moderate' : 'Moderate';
  
  // Determine R:R profile
  const rrProfile = profitFactor.min >= 1.5 ? 'Asymmetric' : profitFactor.min >= 1.2 ? 'Balanced' : 'Symmetric';

  return (
    <div className={cn(
      "rounded-xl border border-border/60 bg-gradient-to-br from-card via-card to-card/80 backdrop-blur-sm",
      "hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300",
      isSent && "opacity-60",
      "animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    )}>
      <div className="p-4 space-y-3">
        {/* Header: Rank + Name + Score */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-bold text-sm shrink-0 ring-1 ring-primary/20">
              {rank}
            </div>
            <StrategyNameDisplay 
              humanName={names.humanName}
              systemCodename={names.systemCodename}
              isWinner={isWinner}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {candidate.evolution_generation && candidate.evolution_generation > 1 && (
              <CandidateEvolutionBadge 
                generation={candidate.evolution_generation}
                parentName={candidate.parent_strategy_name}
              />
            )}
            {isAutoPromoted && (
              <Badge className="text-[10px] h-5 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                Auto-promoted to LAB
              </Badge>
            )}
            {candidate.tournament_status && (
              <CandidateStatusBadge status={`TOURNAMENT_${candidate.tournament_status}`} />
            )}
            <CandidateConfidenceBadge score={deployabilityScore} showLabel />
          </div>
        </div>
        
        {/* Target + Regime */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] h-5 bg-muted/30">
            {recommendedContract}
          </Badge>
          <CandidateRegimePills regimes={regimeTags as string[]} maxShow={3} />
        </div>
        
        {/* Summary (2-3 lines) */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {whyExists}
        </p>
        
        {/* Key Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/20 rounded-lg p-2.5">
          <StatItem label="Trade Frequency" value={tradeFreqLabel} />
          <StatItem label="Expected DD" value={ddProfile} />
          <StatItem label="R:R Profile" value={rrProfile} />
          <StatItem label="Session Fit" value="RTH" />
          <StatItem label="Contract Fit" value="Micros Preferred" highlight />
          <StatItem 
            label="Robustness" 
            value={`${robustnessScore.toFixed(0)}%`}
            highlight={robustnessScore >= 70}
          />
        </div>
        
        {/* Why This Exists (expandable) */}
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-8 justify-between text-xs rounded-none hover:bg-muted/50"
            onClick={() => setWhyExpanded(!whyExpanded)}
          >
            <span className="flex items-center gap-1.5">
              <HelpCircle className="h-3 w-3 text-primary" />
              Why This Exists
            </span>
            {whyExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          {whyExpanded && (
            <div className="p-3 text-xs text-muted-foreground bg-muted/20 border-t border-border/40">
              <p>{whyExists}</p>
              {reasoning.what_invalidates && (
                <p className="mt-2 text-amber-400/80 text-[11px]">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  Invalidation: {reasoning.what_invalidates}
                </p>
              )}
            </div>
          )}
        </div>
        
        {/* AI Reasoning Snapshot */}
        <CandidateReasoningPanel reasoning={reasoning} />
        
        {/* AI Usage + Cost */}
        <div className="flex items-center justify-between py-2 border-y border-border/30">
          <div className="flex items-center gap-1">
            {aiUsage.length > 0 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground cursor-help">
                      <Microscope className="h-3 w-3" />
                      <span>{aiUsage.length} AI steps</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      {aiUsage.map((u, i) => (
                        <div key={i} className="flex justify-between gap-4">
                          <span className="capitalize">{u.provider}</span>
                          <span>${u.cost_usd.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-xs text-muted-foreground">Rule-based</span>
            )}
          </div>
          <CandidateCostBadge costUsd={costUsd} aiUsage={aiUsage} />
        </div>
        
        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button 
            size="sm" 
            className="h-8 text-xs gap-1.5"
            onClick={onSendToLab}
            disabled={isExporting || isSent}
          >
            <Play className="h-3 w-3" />
            Send to LAB
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="h-8 text-xs gap-1.5"
            onClick={onViewDetails}
          >
            <BarChart3 className="h-3 w-3" />
            Simulate Capital
          </Button>
          {onSendToEvolution && (
            <Button 
              size="sm" 
              variant="outline" 
              className="h-8 text-xs gap-1.5"
              onClick={onSendToEvolution}
              disabled={isSent}
            >
              <Dna className="h-3 w-3" />
              Send to Evolution
            </Button>
          )}
          {onEnterTournament && (
            <Button 
              size="sm" 
              variant="outline" 
              className="h-8 text-xs gap-1.5"
              onClick={onEnterTournament}
              disabled={isSent}
            >
              <Trophy className="h-3 w-3" />
              Enter Tournament
            </Button>
          )}
        </div>
        
        {/* Reject button (subtle) */}
        {onReject && !isSent && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={onReject}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        )}
      </div>
    </div>
  );
}

function StatItem({ 
  label, 
  value, 
  highlight 
}: { 
  label: string; 
  value: string; 
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", highlight && "text-emerald-400")}>{value}</span>
    </div>
  );
}

// Details Dialog
interface CandidateDetailsDialogProps {
  candidate: EnhancedCandidate | null;
  open: boolean;
  onClose: () => void;
  onSendToLab: () => void;
  onSendToEvolution?: () => void;
  onEnterTournament?: () => void;
}

function CandidateDetailsDialog({ 
  candidate, 
  open, 
  onClose, 
  onSendToLab,
  onSendToEvolution,
  onEnterTournament,
}: CandidateDetailsDialogProps) {
  if (!candidate) return null;
  
  const archetype = candidate.blueprint?.archetype || "Custom";
  const instrument = candidate.blueprint?.symbol_candidates?.[0] || "MES";
  const regime = (candidate.regime_tags || [])[0] || "";
  
  const names = candidate.human_name && candidate.system_codename
    ? { humanName: candidate.human_name, systemCodename: candidate.system_codename }
    : generateStrategyNames({ archetype, instrument, regime, session: 'RTH', version: 1 });
  
  const reasoning = candidate.reasoning_json || {};
  const evidence = candidate.evidence_json || {};
  const capitalSim = candidate.capital_sim_json;
  const failureModes = reasoning.failure_modes || candidate.blueprint?.failure_modes || [];
  
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            <StrategyNameDisplay 
              humanName={names.humanName}
              systemCodename={names.systemCodename}
            />
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-4">
            {/* Strategy Thesis */}
            <Section title="Strategy Thesis">
              <p className="text-sm text-muted-foreground">
                {reasoning.why_exists || candidate.blueprint?.entry_rules || "No thesis available"}
              </p>
            </Section>
            
            {/* Entry/Exit Rules */}
            <Section title="Trading Rules">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium mb-1 text-xs text-muted-foreground">Entry</p>
                  <p>{candidate.blueprint?.entry_rules || "—"}</p>
                </div>
                <div>
                  <p className="font-medium mb-1 text-xs text-muted-foreground">Exit</p>
                  <p>{candidate.blueprint?.exit_rules || "—"}</p>
                </div>
              </div>
            </Section>
            
            {/* Risk Model */}
            <Section title="Risk Model">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Max DD Target</p>
                  <p className="font-medium">{candidate.scores?.estimated_max_dd || "12"}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Win Rate Target</p>
                  <p className="font-medium">{candidate.scores?.estimated_win_rate || "45"}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Trades/Month</p>
                  <p className="font-medium">{candidate.scores?.estimated_trades_month || "40"}</p>
                </div>
              </div>
            </Section>
            
            {/* Capital Simulation */}
            {capitalSim && (
              <Section title="Capital Allocation Simulation">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Recommended: <span className="font-medium text-foreground">{capitalSim.recommended_contract}</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {capitalSim.sizing_by_capital?.map((s, i) => (
                      <div key={i} className="rounded border border-border/50 p-2 text-center">
                        <p className="text-muted-foreground">${(s.capital / 1000).toFixed(0)}k</p>
                        <p className="font-medium">{s.contracts} contracts</p>
                        <p className="text-muted-foreground">~{s.expected_dd_pct.toFixed(0)}% DD</p>
                      </div>
                    ))}
                  </div>
                  {capitalSim.scale_plan && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Scale plan: {capitalSim.scale_plan}
                    </p>
                  )}
                </div>
              </Section>
            )}
            
            {/* Failure Modes */}
            {failureModes.length > 0 && (
              <Section title="Known Failure Modes">
                <ul className="space-y-1 text-sm">
                  {failureModes.map((mode, i) => (
                    <li key={i} className="flex items-start gap-2 text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                      {mode}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            
            {/* Evidence */}
            {evidence.sources && evidence.sources.length > 0 && (
              <Section title="Evidence & Sources">
                <ul className="space-y-1 text-sm">
                  {evidence.sources.map((src, i) => (
                    <li key={i} className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                      {src.title}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            
            {/* Why Ranked Here */}
            {reasoning.why_ranked && (
              <Section title="Why Ranked Here">
                <p className="text-sm text-muted-foreground">{reasoning.why_ranked}</p>
              </Section>
            )}
            
            {/* What to Test Next */}
            {reasoning.what_to_test && reasoning.what_to_test.length > 0 && (
              <Section title="Suggested Next Tests">
                <ul className="space-y-1 text-sm">
                  {reasoning.what_to_test.map((test, i) => (
                    <li key={i} className="flex items-center gap-2 text-muted-foreground">
                      <Target className="h-3 w-3 shrink-0" />
                      {test}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </ScrollArea>
        
        <div className="flex items-center gap-2 pt-4 border-t shrink-0">
          <Button className="flex-1 gap-1" onClick={onSendToLab}>
            <Play className="h-4 w-4" />
            Send to LAB
          </Button>
          {onSendToEvolution && (
            <Button variant="outline" className="gap-1" onClick={onSendToEvolution}>
              <Dna className="h-4 w-4" />
              Evolve
            </Button>
          )}
          {onEnterTournament && (
            <Button variant="outline" className="gap-1" onClick={onEnterTournament}>
              <Trophy className="h-4 w-4" />
              Tournament
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-medium text-sm mb-2">{title}</h4>
      {children}
    </div>
  );
}

// Main Section Component
interface StrategyLabCandidateSectionProps {
  candidates: StrategyLabCandidate[];
  sessionId: string;
  userId?: string;
  onExport: (candidateId: string) => void;
  onSendToEvolution?: (candidateId: string) => void;
  onEnterTournament?: (candidateId: string) => void;
  onReject?: (candidateId: string) => void;
  isExporting: boolean;
}

export function StrategyLabCandidateSection({
  candidates,
  sessionId,
  userId,
  onExport,
  onSendToEvolution,
  onEnterTournament,
  onReject,
  isExporting,
}: StrategyLabCandidateSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedCandidate, setSelectedCandidate] = useState<EnhancedCandidate | null>(null);
  
  // Filter and sort candidates
  const activeCandidates = candidates
    .filter(c => c.status !== "REJECTED")
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));
  
  // Separate sent vs ready candidates
  const readyCandidates = activeCandidates.filter(c => c.status !== 'EXPORTED');
  const sentCandidates = activeCandidates.filter(c => c.status === 'EXPORTED');
  
  if (activeCandidates.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Strategy Candidates ({activeCandidates.length})
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          AI-discovered strategies ready for deployment
        </p>
      </CardHeader>
      
      {expanded && (
        <CardContent>
          <ScrollArea className="h-[500px] pr-2">
            <div className="space-y-3">
              {readyCandidates.map((candidate, idx) => (
                <StrategyCandidateCard
                  key={candidate.id}
                  candidate={{ ...candidate, session_id: sessionId } as EnhancedCandidate}
                  rank={idx + 1}
                  onSendToLab={() => onExport(candidate.id)}
                  onViewDetails={() => setSelectedCandidate({ ...candidate, session_id: sessionId } as EnhancedCandidate)}
                  onSendToEvolution={onSendToEvolution ? () => onSendToEvolution(candidate.id) : undefined}
                  onEnterTournament={onEnterTournament ? () => onEnterTournament(candidate.id) : undefined}
                  onReject={onReject ? () => onReject(candidate.id) : undefined}
                  isExporting={isExporting}
                />
              ))}
              
              {/* Sent candidates (greyed) */}
              {sentCandidates.length > 0 && (
                <>
                  <div className="text-xs text-muted-foreground py-2 border-t border-border/30 mt-4">
                    Previously Deployed ({sentCandidates.length})
                  </div>
                  {sentCandidates.map((candidate, idx) => (
                    <StrategyCandidateCard
                      key={candidate.id}
                      candidate={{ ...candidate, session_id: sessionId } as EnhancedCandidate}
                      rank={readyCandidates.length + idx + 1}
                      onSendToLab={() => {}}
                      onViewDetails={() => setSelectedCandidate({ ...candidate, session_id: sessionId } as EnhancedCandidate)}
                      isExporting={false}
                    />
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
          
          <CandidateDetailsDialog
            candidate={selectedCandidate}
            open={!!selectedCandidate}
            onClose={() => setSelectedCandidate(null)}
            onSendToLab={() => {
              if (selectedCandidate) {
                onExport(selectedCandidate.id);
                setSelectedCandidate(null);
              }
            }}
            onSendToEvolution={onSendToEvolution && selectedCandidate ? () => {
              onSendToEvolution(selectedCandidate.id);
              setSelectedCandidate(null);
            } : undefined}
            onEnterTournament={onEnterTournament && selectedCandidate ? () => {
              onEnterTournament(selectedCandidate.id);
              setSelectedCandidate(null);
            } : undefined}
          />
        </CardContent>
      )}
    </Card>
  );
}
