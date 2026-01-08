import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Send, Target, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, 
  BookOpen, Shield, Zap, Clock, DollarSign, ExternalLink, Copy
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CandidateRegimePills } from "./CandidateRegimePills";
import { CandidateConfidenceBadge } from "./CandidateConfidenceBadge";
import { CandidateCostBadge } from "./CandidateCostBadge";

interface Candidate {
  id: string;
  name?: string;
  description?: string;
  rank?: number | null;
  status: string;
  deployability_score?: number;
  regime_tags?: string[];
  contract_preference?: string;
  instruments?: unknown;
  expected_metrics_json?: {
    trades_per_week?: { min: number; max: number };
    max_dd_pct?: { min: number; max: number };
    profit_factor?: { min: number; max: number };
    robustness?: number;
  };
  ai_usage_json?: unknown[];
  cost_usd?: number;
  evidence_json?: {
    sources?: { title: string; url?: string; excerpt?: string }[];
    hypothesis_count?: number;
  };
  reasoning_json?: {
    why_ranked?: string;
    why_exists?: string;
    adversarial_critique?: string[];
    what_to_test?: string[];
  };
  capital_sim_json?: {
    recommended_contract?: string;
    base_contracts_by_capital?: Record<string, number>;
    survivability_score?: number;
    scale_plan?: string;
  };
  blueprint?: {
    name?: string;
    archetype?: string;
    symbol_candidates?: string[];
    timeframe_candidates?: string[];
    entry_rules?: string;
    exit_rules?: string;
    failure_modes?: string[];
  };
  ruleset?: {
    entry?: string;
    exit?: string;
    filters?: string[];
  };
  risk_model?: {
    stop_type?: string;
    stop_value?: number;
    target_type?: string;
    target_value?: number;
    max_daily_loss?: number;
  };
  scores?: {
    viability_score?: number;
    estimated_pf?: number;
    estimated_win_rate?: number;
    estimated_max_dd?: number;
    robustness_score?: number;
  };
  created_at?: string;
}

interface CandidateDetailsDrawerProps {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendToLab: () => void;
}

export function CandidateDetailsDrawer({
  candidate,
  open,
  onOpenChange,
  onSendToLab,
}: CandidateDetailsDrawerProps) {
  if (!candidate) return null;

  const name = candidate.name || candidate.blueprint?.name || `Candidate ${candidate.rank || '?'}`;
  const deployScore = candidate.deployability_score || candidate.scores?.viability_score || 0;
  const reasoning = candidate.reasoning_json || {};
  const evidence = candidate.evidence_json || {};
  const capitalSim = candidate.capital_sim_json || {};
  const blueprint = candidate.blueprint || {};
  const ruleset = candidate.ruleset || {};
  const riskModel = candidate.risk_model || {};
  const isSent = candidate.status === 'SENT_TO_LAB' || candidate.status === 'EXPORTED';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <SheetTitle className="text-lg">{name}</SheetTitle>
              <SheetDescription className="mt-1">
                {blueprint.archetype || 'Strategy Candidate'} • Rank #{candidate.rank || '?'}
              </SheetDescription>
            </div>
            <CandidateConfidenceBadge score={deployScore} />
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)] mt-4 pr-4">
          <div className="space-y-6">
            {/* Strategy Thesis */}
            <Section title="Strategy Thesis" icon={Target}>
              <p className="text-sm text-muted-foreground">
                {reasoning.why_exists || candidate.description || 'No thesis available'}
              </p>
            </Section>

            {/* Regime Profile */}
            <Section title="Regime Profile" icon={TrendingUp}>
              <CandidateRegimePills regimes={candidate.regime_tags || []} maxShow={10} />
              {reasoning.why_ranked && (
                <p className="text-xs text-muted-foreground mt-2">
                  <strong>Ranking rationale:</strong> {reasoning.why_ranked}
                </p>
              )}
            </Section>

            {/* Entry / Exit Rules */}
            <Section title="Entry & Exit Logic" icon={Zap}>
              <div className="space-y-3 text-sm">
                <div>
                  <Label>Entry Rules</Label>
                  <p className="text-muted-foreground">
                    {ruleset.entry || blueprint.entry_rules || 'Not specified'}
                  </p>
                </div>
                <div>
                  <Label>Exit Rules</Label>
                  <p className="text-muted-foreground">
                    {ruleset.exit || blueprint.exit_rules || 'Not specified'}
                  </p>
                </div>
                {ruleset.filters && ruleset.filters.length > 0 && (
                  <div>
                    <Label>Filters</Label>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {ruleset.filters.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </Section>

            {/* Risk Model */}
            <Section title="Risk Model" icon={Shield}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Stop Type" value={riskModel.stop_type || 'ATR-based'} />
                <Stat label="Stop Value" value={riskModel.stop_value ? `${riskModel.stop_value}` : '—'} />
                <Stat label="Target Type" value={riskModel.target_type || 'R-multiple'} />
                <Stat label="Target Value" value={riskModel.target_value ? `${riskModel.target_value}` : '—'} />
                <Stat label="Max Daily Loss" value={riskModel.max_daily_loss ? `$${riskModel.max_daily_loss}` : '—'} />
              </div>
            </Section>

            {/* Capital Simulation */}
            {capitalSim.base_contracts_by_capital && (
              <Section title="Capital Sizing" icon={DollarSign}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{capitalSim.recommended_contract || 'MES'}</Badge>
                    {capitalSim.survivability_score !== undefined && (
                      <Badge variant="outline" className="text-xs">
                        Survivability: {capitalSim.survivability_score}%
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {Object.entries(capitalSim.base_contracts_by_capital).map(([cap, contracts]) => (
                      <div key={cap} className="p-2 rounded bg-muted/50 text-center">
                        <div className="font-medium">{contracts}</div>
                        <div className="text-muted-foreground">${Number(cap).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                  {capitalSim.scale_plan && (
                    <p className="text-xs text-muted-foreground">{capitalSim.scale_plan}</p>
                  )}
                </div>
              </Section>
            )}

            {/* Known Failure Modes */}
            {(blueprint.failure_modes?.length || reasoning.adversarial_critique?.length) && (
              <Section title="Known Failure Modes" icon={AlertTriangle}>
                <ul className="list-disc list-inside text-sm text-amber-400 space-y-1">
                  {(blueprint.failure_modes || reasoning.adversarial_critique || []).map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* What to Test Next */}
            {reasoning.what_to_test && reasoning.what_to_test.length > 0 && (
              <Section title="What to Test Next" icon={CheckCircle2}>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {reasoning.what_to_test.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </Section>
            )}

            {/* Evidence & Sources */}
            {evidence.sources && evidence.sources.length > 0 && (
              <Section title="Evidence & Sources" icon={BookOpen}>
                <div className="space-y-2">
                  {evidence.sources.slice(0, 5).map((source, i) => (
                    <div key={i} className="p-2 rounded bg-muted/50">
                      <p className="text-sm font-medium">{source.title || 'Untitled'}</p>
                      {source.excerpt && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{source.excerpt}</p>
                      )}
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline flex items-center gap-1 mt-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Cost */}
            <Section title="Cost to Produce" icon={DollarSign}>
              <div className="flex items-center gap-2">
                <CandidateCostBadge 
                  costUsd={candidate.cost_usd || 0} 
                  aiUsage={candidate.ai_usage_json as never[]} 
                />
                <span className="text-xs text-muted-foreground">
                  Created {new Date(candidate.created_at).toLocaleString()}
                </span>
              </div>
            </Section>
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t">
          <Button className="flex-1" onClick={onSendToLab} disabled={isSent}>
            <Send className="h-4 w-4 mr-2" />
            {isSent ? 'Already Sent' : 'Send to LAB'}
          </Button>
          <Button variant="outline" size="icon">
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Target; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-foreground mb-0.5">{children}</p>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
