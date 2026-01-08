import { useState } from "react";
import { GitBranch, RotateCcw, Copy, Check, ChevronRight, Dna, ChevronDown, ArrowLeft, Target, Shield, Clock, TrendingUp, AlertTriangle, Zap } from "lucide-react";
import { AlphaDecayBadge } from "../AlphaDecayBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBotGenerations } from "@/hooks/useEvolution";
import { useRevertGeneration, useForkBot, useBranchGeneration } from "@/hooks/useBotHistory";
import { useAccounts } from "@/hooks/useAccounts";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import type { Bot } from "@/hooks/useBots";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface StrategyRulesSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function StrategyRulesSection({ title, icon, children }: StrategyRulesSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="pl-6 space-y-1 text-sm">
        {children}
      </div>
    </div>
  );
}

function RuleItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{String(value)}</span>
    </div>
  );
}

function formatCondition(condition: Record<string, any> | undefined): string {
  if (!condition || Object.keys(condition).length === 0) return "No condition set";
  
  const parts: string[] = [];
  if (condition.type) parts.push(`Type: ${condition.type}`);
  if (condition.lookbackBars) parts.push(`Lookback: ${condition.lookbackBars} bars`);
  if (condition.breakoutThreshold) parts.push(`Threshold: ${condition.breakoutThreshold}`);
  if (condition.maFast) parts.push(`MA Fast: ${condition.maFast}`);
  if (condition.maSlow) parts.push(`MA Slow: ${condition.maSlow}`);
  if (condition.atrPeriod) parts.push(`ATR: ${condition.atrPeriod}`);
  if (condition.rsiPeriod) parts.push(`RSI: ${condition.rsiPeriod}`);
  if (condition.rsiOversold) parts.push(`RSI OS: ${condition.rsiOversold}`);
  if (condition.rsiOverbought) parts.push(`RSI OB: ${condition.rsiOverbought}`);
  
  return parts.length > 0 ? parts.join(" | ") : JSON.stringify(condition);
}

interface BotGenerationsPanelProps {
  bot: Bot;
}

export function BotGenerationsPanel({ bot }: BotGenerationsPanelProps) {
  const { data: generations, isLoading, isError } = useBotGenerations(bot.id);
  const { data: accounts, isLoading: accountsLoading, isError: accountsError } = useAccounts();
  const revertMutation = useRevertGeneration();
  const forkMutation = useForkBot();
  const branchMutation = useBranchGeneration();

  const isDegraded = isError || (!isLoading && generations === undefined);
  const accountsDegraded = accountsError || (!accountsLoading && accounts === undefined);

  const [selectedGen, setSelectedGen] = useState<string | null>(null);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailGen, setDetailGen] = useState<any>(null);
  const [newBotName, setNewBotName] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [branchLabel, setBranchLabel] = useState("");

  const openDetailDialog = (gen: any) => {
    setDetailGen(gen);
    setDetailDialogOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Dna className="h-4 w-4" />
            Generations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Dna className="h-4 w-4" />
            Generations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="Generation data unavailable" />
        </CardContent>
      </Card>
    );
  }

  const handleRevert = (genId: string) => {
    revertMutation.mutate({ botId: bot.id, generationId: genId });
  };

  const handleFork = () => {
    if (!selectedGen || !newBotName.trim()) return;
    forkMutation.mutate({
      botId: bot.id,
      generationId: selectedGen,
      newBotName: newBotName.trim(),
      attachAccountId: selectedAccount && selectedAccount !== "none" ? selectedAccount : undefined,
      mode: "SIM_LIVE",
    }, {
      onSuccess: () => {
        setForkDialogOpen(false);
        setNewBotName("");
        setSelectedAccount("");
        setSelectedGen(null);
      },
    });
  };

  const handleBranch = () => {
    if (!selectedGen) return;
    branchMutation.mutate({
      botId: bot.id,
      generationId: selectedGen,
      label: branchLabel || undefined,
      setAsCurrent: true,
    }, {
      onSuccess: () => {
        setBranchDialogOpen(false);
        setBranchLabel("");
        setSelectedGen(null);
      },
    });
  };

  const openForkDialog = (genId: string) => {
    setSelectedGen(genId);
    setNewBotName(`${bot.name} Fork`);
    setForkDialogOpen(true);
  };

  const openBranchDialog = (genId: string) => {
    setSelectedGen(genId);
    setBranchDialogOpen(true);
  };

  const virtualAccounts = accounts?.filter(a => a.accountType === "VIRTUAL" || a.accountType === "SIM") || [];

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Dna className="h-4 w-4" />
            Generations ({generations?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[250px]">
            {generations && generations.length > 0 ? (
              <div className="space-y-2">
                {generations.map((gen, index) => {
                  const isCurrent = (gen as any).is_current || gen.id === bot.currentGenerationId;
                  const hasParent = gen.parentGenerationId !== null;

                  return (
                    <div
                      key={gen.id}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer hover-elevate ${
                        isCurrent 
                          ? "border-primary/50 bg-primary/5" 
                          : "border-border hover:border-primary/30"
                      }`}
                      onClick={() => openDetailDialog(gen)}
                      data-testid={`generation-row-${gen.generationNumber}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {hasParent && (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          <Badge variant={isCurrent ? "default" : "secondary"} className="text-xs">
                            Gen {gen.generationNumber}
                          </Badge>
                          {gen.mutationReasonCode && (
                            <Badge variant="outline" className="text-[10px]">
                              {gen.mutationReasonCode}
                            </Badge>
                          )}
                          {isCurrent && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Check className="h-2 w-2" />
                              Current
                            </Badge>
                          )}
                          {isCurrent && (
                            <AlphaDecayBadge botId={bot.id} />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {gen.summaryTitle || `Gen ${gen.generationNumber}: Evolution cycle`}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(gen.createdAt), { addSuffix: true })}
                        </span>
                        {gen.parentGenerationNumber && (
                          <span className="text-[10px] text-muted-foreground">
                            From Gen {gen.parentGenerationNumber}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <Dna className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No generations yet</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Fork Dialog */}
      <Dialog open={forkDialogOpen} onOpenChange={setForkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fork Bot</DialogTitle>
            <DialogDescription>
              Create a new bot starting from this generation's configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newBotName">New Bot Name</Label>
              <Input
                id="newBotName"
                value={newBotName}
                onChange={(e) => setNewBotName(e.target.value)}
                placeholder="Enter bot name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account">Attach to Account (Optional)</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account</SelectItem>
                  {virtualAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.accountType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleFork} disabled={!newBotName.trim() || forkMutation.isPending}>
              {forkMutation.isPending ? "Creating..." : "Create Fork"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branch Dialog */}
      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Branch Generation</DialogTitle>
            <DialogDescription>
              Create a new generation based on this one within the same bot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="branchLabel">Branch Label (Optional)</Label>
              <Input
                id="branchLabel"
                value={branchLabel}
                onChange={(e) => setBranchLabel(e.target.value)}
                placeholder="e.g., Experiment with tighter stops"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBranch} disabled={branchMutation.isPending}>
              {branchMutation.isPending ? "Creating..." : "Create Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generation Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dna className="h-5 w-5" />
              Generation {detailGen?.generation_number} Details
            </DialogTitle>
            <DialogDescription>
              {detailGen?.summary_title || `Evolution cycle for ${bot.name}`}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 pr-4">
            {detailGen && (
              <div className="space-y-6 py-4">
                {/* Generation Info */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={detailGen.is_current ? "default" : "secondary"}>
                    Gen {detailGen.generation_number}
                  </Badge>
                  {detailGen.mutation_reason_code && (
                    <Badge variant="outline">{detailGen.mutation_reason_code}</Badge>
                  )}
                  {detailGen.is_current && (
                    <Badge variant="outline" className="gap-1">
                      <Check className="h-3 w-3" />
                      Current
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(detailGen.created_at), { addSuffix: true })}
                  </span>
                </div>

                {/* Evolution Summary */}
                {detailGen.summary_diff && (
                  <>
                    <Separator />
                    <StrategyRulesSection title="Evolution Changes" icon={<TrendingUp className="h-4 w-4" />}>
                      {detailGen.summary_diff.reason && (
                        <p className="text-sm mb-2">{detailGen.summary_diff.reason}</p>
                      )}
                      {detailGen.summary_diff.changes && detailGen.summary_diff.changes.length > 0 ? (
                        <div className="space-y-2">
                          {detailGen.summary_diff.changes.map((change: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-muted-foreground">{change.field}:</span>
                              <span className="text-destructive line-through">{JSON.stringify(change.oldValue)}</span>
                              <ChevronRight className="h-3 w-3" />
                              <span className="text-green-500">{JSON.stringify(change.newValue)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No specific changes recorded</p>
                      )}
                    </StrategyRulesSection>
                  </>
                )}

                {/* Strategy Config */}
                {detailGen.strategy_config && (
                  <>
                    <Separator />
                    
                    {/* Entry Rules */}
                    <StrategyRulesSection title="Entry Rules" icon={<Target className="h-4 w-4" />}>
                      <RuleItem label="Condition" value={formatCondition(detailGen.strategy_config.entry?.condition)} />
                      {detailGen.strategy_config.entry?.confirmations?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">Confirmations:</span>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {detailGen.strategy_config.entry.confirmations.map((c: any, i: number) => (
                              <li key={i}>{c.type}: {JSON.stringify(c)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detailGen.strategy_config.entry?.invalidations?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Invalidations:
                          </span>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {detailGen.strategy_config.entry.invalidations.map((inv: any, i: number) => (
                              <li key={i}>{inv.type}: {JSON.stringify(inv)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </StrategyRulesSection>

                    {/* Exit Rules */}
                    <StrategyRulesSection title="Exit Rules" icon={<Zap className="h-4 w-4" />}>
                      {detailGen.strategy_config.exit?.takeProfit?.length > 0 && (
                        <div>
                          <span className="text-xs text-green-500">Take Profit:</span>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {detailGen.strategy_config.exit.takeProfit.map((tp: any, i: number) => (
                              <li key={i}>{tp.type}: Target {tp.targetTicks ?? tp.targetPercent}ticks @ {tp.portion ?? 100}%</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detailGen.strategy_config.exit?.stopLoss?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-destructive">Stop Loss:</span>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {detailGen.strategy_config.exit.stopLoss.map((sl: any, i: number) => (
                              <li key={i}>{sl.type}: {sl.stopTicks ?? sl.atrMultiplier}ticks</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detailGen.strategy_config.exit?.trailingStop && (
                        <div className="mt-2">
                          <RuleItem label="Trailing Stop Activation" value={`${detailGen.strategy_config.exit.trailingStop.activationTicks} ticks`} />
                          <RuleItem label="Trail Distance" value={`${detailGen.strategy_config.exit.trailingStop.trailDistance} ticks`} />
                        </div>
                      )}
                      {detailGen.strategy_config.exit?.timeStop && (
                        <RuleItem label="Time Stop" value={`${detailGen.strategy_config.exit.timeStop.maxBarsInTrade} bars max`} />
                      )}
                    </StrategyRulesSection>

                    {/* Risk Rules */}
                    <StrategyRulesSection title="Risk Management" icon={<Shield className="h-4 w-4" />}>
                      <RuleItem label="Risk Per Trade" value={`${detailGen.strategy_config.risk?.riskPerTrade ?? 1}%`} />
                      <RuleItem label="Max Daily Loss" value={`${detailGen.strategy_config.risk?.maxDailyLoss ?? 3}%`} />
                      <RuleItem label="Max Position Size" value={detailGen.strategy_config.risk?.maxPositionSize ?? 2} />
                    </StrategyRulesSection>

                    {/* Session Rules */}
                    <StrategyRulesSection title="Session Rules" icon={<Clock className="h-4 w-4" />}>
                      <RuleItem label="RTH Start" value={detailGen.strategy_config.session?.rthStart ?? "09:30"} />
                      <RuleItem label="RTH End" value={detailGen.strategy_config.session?.rthEnd ?? "16:00"} />
                      {detailGen.strategy_config.session?.noTradeWindows?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">No-Trade Windows:</span>
                          <ul className="list-disc list-inside text-xs mt-1">
                            {detailGen.strategy_config.session.noTradeWindows.map((w: any, i: number) => (
                              <li key={i}>{w.reason}: {w.start} - {w.end}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </StrategyRulesSection>
                  </>
                )}

                {/* Fitness Score */}
                {detailGen.fitness_score !== null && detailGen.fitness_score !== undefined && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Fitness Score</span>
                      <Badge variant={detailGen.fitness_score >= 0.5 ? "default" : "secondary"}>
                        {(detailGen.fitness_score * 100).toFixed(1)}%
                      </Badge>
                    </div>
                  </>
                )}
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="flex-row gap-2 pt-4 border-t">
            {detailGen && !detailGen.is_current && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleRevert(detailGen.id);
                  setDetailDialogOpen(false);
                }}
                disabled={revertMutation.isPending}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert to This
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (detailGen) {
                  openBranchDialog(detailGen.id);
                  setDetailDialogOpen(false);
                }
              }}
            >
              <GitBranch className="h-3 w-3 mr-1" />
              Branch
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (detailGen) {
                  openForkDialog(detailGen.id);
                  setDetailDialogOpen(false);
                }
              }}
            >
              <Copy className="h-3 w-3 mr-1" />
              Fork
            </Button>
            <Button variant="default" onClick={() => setDetailDialogOpen(false)} className="ml-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
