import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Trophy,
  Play,
  Loader2,
  Clock,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Settings,
  ArrowUpRight,
  RotateCcw,
  Trash2,
  GitBranch,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useEvolutionTournaments,
  useTournamentEntries,
  useRunTournament,
  useLiveEligibleBots,
  usePromoteToLive,
  useTournamentSchedulerStatus,
  Tournament,
} from "@/hooks/useEvolutionTournaments";
import { format, formatDistanceToNowStrict } from "date-fns";

const statusColors: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  RUNNING: "bg-blue-500/20 text-blue-400",
  COMPLETED: "bg-emerald-500/20 text-emerald-400",
  FAILED: "bg-destructive/20 text-destructive",
  CANCELLED: "bg-amber-500/20 text-amber-400",
};

const actionColors: Record<string, string> = {
  WINNER: "bg-amber-500/20 text-amber-400",
  BREED: "bg-emerald-500/20 text-emerald-400",
  MUTATE: "bg-blue-500/20 text-blue-400",
  ROLLBACK: "bg-orange-500/20 text-orange-400",
  PAUSE: "bg-muted text-muted-foreground",
  RETIRE: "bg-destructive/20 text-destructive",
  NONE: "bg-muted/50 text-muted-foreground",
  KEEP: "bg-muted/50 text-muted-foreground",
};

const actionIcons: Record<string, React.ReactNode> = {
  WINNER: <Trophy className="w-3 h-3" />,
  BREED: <GitBranch className="w-3 h-3" />,
  MUTATE: <Zap className="w-3 h-3" />,
  ROLLBACK: <RotateCcw className="w-3 h-3" />,
  RETIRE: <Trash2 className="w-3 h-3" />,
};

export function TournamentsView() {
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [cadenceType, setCadenceType] = useState<"INCREMENTAL" | "DAILY_MAJOR">("DAILY_MAJOR");
  const [dryRun, setDryRun] = useState(false);
  const [detailTab, setDetailTab] = useState("rankings");
  const [showManualControls, setShowManualControls] = useState(false);

  const { data: tournaments, isLoading: tournamentsLoading } = useEvolutionTournaments();
  const { data: entries, isLoading: entriesLoading } = useTournamentEntries(selectedTournament?.id || null);
  const { data: liveEligible } = useLiveEligibleBots();
  const { data: schedulerStatus } = useTournamentSchedulerStatus();
  const runTournament = useRunTournament();
  const promoteToLive = usePromoteToLive();

  // Get last tournament info
  const lastIncremental = tournaments?.find(t => t.cadence_type === "INCREMENTAL");
  const lastMajor = tournaments?.find(t => t.cadence_type === "DAILY_MAJOR");
  const runningTournament = tournaments?.find(t => t.status === "RUNNING");
  
  // Stats calculations
  const completedTournaments = tournaments?.filter(t => t.status === "COMPLETED") || [];
  const totalEntrants = completedTournaments.reduce((sum, t) => sum + (t.entrants_count || 0), 0);
  const avgEntrants = completedTournaments.length > 0 ? Math.round(totalEntrants / completedTournaments.length) : 0;

  const handleRunTournament = () => {
    runTournament.mutate({
      cadence_type: cadenceType,
      dry_run: dryRun,
    });
  };

  return (
    <div className="h-full flex flex-col gap-3 p-2">
      {/* Top Stats Bar - Terminal Style */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-card/80 border border-border/50 rounded-sm p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Runs</div>
          <div className="text-lg font-mono font-semibold text-foreground">{tournaments?.length || 0}</div>
        </div>
        <div className="bg-card/80 border border-border/50 rounded-sm p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Completed</div>
          <div className="text-lg font-mono font-semibold text-emerald-400">{completedTournaments.length}</div>
        </div>
        <div className="bg-card/80 border border-border/50 rounded-sm p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Entrants</div>
          <div className="text-lg font-mono font-semibold text-foreground">{avgEntrants}</div>
        </div>
        <div className="bg-card/80 border border-border/50 rounded-sm p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</div>
          <div className="text-lg font-mono font-semibold">
            {runningTournament ? (
              <span className="text-blue-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                LIVE
              </span>
            ) : (
              <span className="text-muted-foreground">IDLE</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 min-h-0">
        {/* Left Panel - Schedule + History */}
        <div className="lg:col-span-1 flex flex-col gap-3 min-h-0">
          {/* Schedule Status */}
          <div className="bg-card/80 border border-border/50 rounded-sm">
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-medium uppercase tracking-wide">Schedule</span>
            </div>
            <div className="p-2 space-y-2">
              {/* Eligibility Warning */}
              {schedulerStatus && !schedulerStatus.canRunTournament && (
                <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-sm" data-testid="alert-tournament-eligibility">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <span className="text-xs text-amber-400 font-medium">Cannot Run Tournaments</span>
                      {schedulerStatus.eligibilityIssues.map((issue, i) => (
                        <p key={i} className="text-[10px] text-muted-foreground">{issue}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Eligible Bots Count */}
              {schedulerStatus && schedulerStatus.canRunTournament && (
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-sm" data-testid="status-tournament-ready">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-medium">
                      {schedulerStatus.eligibleBotsCount} eligible bot{schedulerStatus.eligibleBotsCount !== 1 ? "s" : ""} ready
                    </span>
                  </div>
                </div>
              )}

              {/* Incremental */}
              <div className="flex items-center justify-between p-2 bg-muted/20 rounded-sm" data-testid="schedule-incremental">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span className="text-xs font-medium">Incremental</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono h-5">2H</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {lastIncremental ? formatDistanceToNow(new Date(lastIncremental.started_at), { addSuffix: true }) : "Never ran"}
                    </span>
                  </div>
                  {schedulerStatus?.schedule.incremental.nextRun && (
                    <span className="text-[10px] text-blue-400 font-mono" data-testid="text-next-incremental">
                      Next: {formatDistanceToNowStrict(new Date(schedulerStatus.schedule.incremental.nextRun), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>

              {/* Daily Major */}
              <div className="flex items-center justify-between p-2 bg-muted/20 rounded-sm" data-testid="schedule-daily-major">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-xs font-medium">Daily Major</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono h-5">11PM ET</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {lastMajor ? formatDistanceToNow(new Date(lastMajor.started_at), { addSuffix: true }) : "Never ran"}
                    </span>
                  </div>
                  {schedulerStatus?.schedule.dailyMajor.nextRun && (
                    <span className="text-[10px] text-amber-400 font-mono" data-testid="text-next-major">
                      Next: {formatDistanceToNowStrict(new Date(schedulerStatus.schedule.dailyMajor.nextRun), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>

              {/* Running indicator */}
              {runningTournament && (
                <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                    <span className="text-xs text-blue-400 font-mono">
                      {runningTournament.cadence_type} IN PROGRESS
                    </span>
                  </div>
                </div>
              )}

              {/* Manual Controls Toggle */}
              <div className="pt-1 border-t border-border/30">
                <button
                  onClick={() => setShowManualControls(!showManualControls)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 w-full py-1"
                  data-testid="button-toggle-manual-controls"
                >
                  <Settings className="w-3 h-3" />
                  {showManualControls ? "Hide" : "Show"} Manual Controls
                </button>
                
                {showManualControls && (
                  <div className="mt-2 space-y-2 p-2 bg-muted/10 rounded-sm">
                    <Select value={cadenceType} onValueChange={(v) => setCadenceType(v as typeof cadenceType)}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INCREMENTAL">Incremental</SelectItem>
                        <SelectItem value="DAILY_MAJOR">Daily Major</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px]">Dry Run (No Actions)</Label>
                      <Switch checked={dryRun} onCheckedChange={setDryRun} />
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={handleRunTournament}
                      disabled={runTournament.isPending}
                      data-testid="button-run-tournament"
                    >
                      {runTournament.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3 mr-1.5" />
                      )}
                      Execute Tournament
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* History List */}
          <div className="flex-1 bg-card/80 border border-border/50 rounded-sm flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide">History</span>
              <Badge variant="secondary" className="text-[10px] h-4 font-mono">{tournaments?.length || 0}</Badge>
            </div>
            <ScrollArea className="flex-1">
              {tournamentsLoading ? (
                <div className="p-2 space-y-1">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !tournaments?.length ? (
                <div className="p-4 text-center">
                  <Trophy className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No tournaments executed yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Tournaments run automatically on schedule</p>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {tournaments.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTournament(t)}
                      className={`w-full p-2 text-left transition-colors hover-elevate ${
                        selectedTournament?.id === t.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
                      }`}
                      data-testid={`button-tournament-${t.id}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          {t.status === "COMPLETED" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          {t.status === "RUNNING" && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                          {t.status === "FAILED" && <XCircle className="w-3 h-3 text-destructive" />}
                          {t.status === "QUEUED" && <Clock className="w-3 h-3 text-muted-foreground" />}
                          <span className="text-xs font-mono">{t.cadence_type || "DAILY"}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {formatDistanceToNow(new Date(t.started_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-2.5 h-2.5" />
                          {t.entrants_count || 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-2.5 h-2.5" />
                          {(t.summary_json as Record<string, number>)?.avgFitness?.toFixed(0) || "—"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2 bg-card/80 border border-border/50 rounded-sm flex flex-col min-h-0">
          {!selectedTournament ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Trophy className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-xs">Select a tournament to view details</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Click on any entry in the history list</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {selectedTournament.status === "COMPLETED" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {selectedTournament.status === "RUNNING" && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                    {selectedTournament.status === "FAILED" && <XCircle className="w-4 h-4 text-destructive" />}
                    <span className="text-sm font-mono font-medium">{selectedTournament.cadence_type || "TOURNAMENT"}</span>
                  </div>
                  <Badge className={`text-[10px] ${statusColors[selectedTournament.status]}`}>
                    {selectedTournament.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-mono">
                  <span>{selectedTournament.entrants_count} entrants</span>
                  <span>{formatDistanceToNow(new Date(selectedTournament.started_at), { addSuffix: true })}</span>
                </div>
              </div>
              
              {/* Tabs */}
              <div className="flex-1 flex flex-col min-h-0 p-2">
                <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col min-h-0">
                  <TabsList className="h-7 w-fit mb-2">
                    <TabsTrigger value="rankings" className="text-[10px] h-6 px-3" data-testid="tab-rankings">Rankings</TabsTrigger>
                    <TabsTrigger value="actions" className="text-[10px] h-6 px-3" data-testid="tab-actions">Actions</TabsTrigger>
                    <TabsTrigger value="summary" className="text-[10px] h-6 px-3" data-testid="tab-summary">Summary</TabsTrigger>
                    <TabsTrigger value="live" className="text-[10px] h-6 px-3" data-testid="tab-live">Live Queue</TabsTrigger>
                  </TabsList>

                  <TabsContent value="rankings" className="flex-1 mt-0">
                    <ScrollArea className="h-[320px]">
                      {entriesLoading ? (
                        <div className="space-y-1">
                          {[...Array(8)].map((_, i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                          ))}
                        </div>
                      ) : !entries?.length ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Users className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          <p className="text-xs">No entries for this tournament</p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="w-8 text-[10px] font-mono">#</TableHead>
                              <TableHead className="text-[10px]">Bot</TableHead>
                              <TableHead className="text-[10px]">Lane</TableHead>
                              <TableHead className="text-right text-[10px]">Fitness</TableHead>
                              <TableHead className="text-right text-[10px]">Score</TableHead>
                              <TableHead className="text-[10px]">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {entries?.map((entry, idx) => (
                              <TableRow key={entry.id} className={idx === 0 ? "bg-amber-500/5" : ""}>
                                <TableCell className="font-mono text-[10px] text-muted-foreground">
                                  {entry.rank || idx + 1}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {idx === 0 && <Trophy className="w-3 h-3 text-amber-500" />}
                                    <div>
                                      <p className="text-xs font-medium truncate max-w-[140px]">
                                        {entry.bots?.name || "—"}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground font-mono">
                                        {entry.symbol}
                                      </p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-[10px] font-mono h-4">
                                    {entry.lane || "ALL"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  <span className={entry.fitness_v2 && entry.fitness_v2 > 50 ? "text-emerald-400" : ""}>
                                    {entry.fitness_v2?.toFixed(0) || "—"}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {entry.candidate_score || "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge className={`text-[10px] gap-1 h-4 ${actionColors[entry.action_taken || "NONE"]}`}>
                                    {actionIcons[entry.action_taken || "NONE"]}
                                    {entry.action_taken || "—"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="actions" className="mt-0">
                    <ScrollArea className="h-[320px]">
                      {Object.keys(selectedTournament.actions_json || {}).length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          <p className="text-xs">No actions recorded</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(selectedTournament.actions_json || {}).map(([action, bots]) => (
                            <div key={action} className="bg-muted/20 border border-border/30 rounded-sm p-2">
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`p-1 rounded-sm ${actionColors[action.toUpperCase()] || "bg-muted"}`}>
                                  {actionIcons[action.toUpperCase()] || <Zap className="w-3 h-3" />}
                                </div>
                                <span className="text-xs font-mono uppercase">{action}</span>
                                <Badge variant="secondary" className="text-[10px] h-4 ml-auto font-mono">
                                  {Array.isArray(bots) ? bots.length : 0}
                                </Badge>
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {Array.isArray(bots) && bots.length > 0
                                  ? bots.slice(0, 2).join(", ") + (bots.length > 2 ? ` +${bots.length - 2}` : "")
                                  : "None"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="summary" className="mt-0">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted/20 border border-border/30 rounded-sm p-3">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Fitness</div>
                        <div className="text-xl font-mono font-semibold text-foreground">
                          {(selectedTournament.summary_json as Record<string, number>)?.avgFitness?.toFixed(0) || "—"}
                        </div>
                      </div>
                      <div className="bg-muted/20 border border-border/30 rounded-sm p-3">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Entrants</div>
                        <div className="text-xl font-mono font-semibold text-foreground">{selectedTournament.entrants_count || 0}</div>
                      </div>
                      <div className="bg-muted/20 border border-border/30 rounded-sm p-3">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Duration</div>
                        <div className="text-xl font-mono font-semibold text-foreground">
                          {selectedTournament.ended_at 
                            ? `${Math.round((new Date(selectedTournament.ended_at).getTime() - new Date(selectedTournament.started_at).getTime()) / 1000)}s`
                            : "—"
                          }
                        </div>
                      </div>
                      <div className="col-span-3 bg-muted/20 border border-border/30 rounded-sm p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Trophy className="w-4 h-4 text-amber-500" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Tournament Winner</span>
                        </div>
                        <div className="font-mono text-sm font-medium">
                          {(selectedTournament.summary_json as Record<string, { id: string; fitness: number; name?: string }>)?.topBot?.name ||
                           (selectedTournament.summary_json as Record<string, { id: string; fitness: number }>)?.topBot?.id?.slice(0, 8) || 
                           "No winner determined"}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          Fitness: {(selectedTournament.summary_json as Record<string, { id: string; fitness: number }>)?.topBot?.fitness?.toFixed(0) || "—"}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="live" className="mt-0">
                    <ScrollArea className="h-[320px]">
                      <div className="space-y-2">
                        <div className="text-[10px] text-muted-foreground p-2 bg-muted/10 rounded-sm">
                          Bots with 3+ consecutive CANDIDATE passes are eligible for LIVE promotion
                        </div>
                        {!liveEligible?.length ? (
                          <div className="text-center py-8">
                            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
                            <p className="text-xs text-muted-foreground">No bots currently eligible</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">Bots need consistent performance to qualify</p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {liveEligible.map((lc) => (
                              <div key={lc.bot_id} className="flex items-center justify-between p-2 bg-muted/20 border border-border/30 rounded-sm">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  <div>
                                    <p className="text-xs font-medium">
                                      {(lc as { bots?: { name?: string } }).bots?.name || lc.bot_id.slice(0, 8)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground font-mono">
                                      Streak: {lc.candidate_pass_streak} | Score: {lc.live_eligibility_score}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => promoteToLive.mutate(lc.bot_id)}
                                  disabled={promoteToLive.isPending}
                                  data-testid={`button-promote-${lc.bot_id}`}
                                >
                                  <ArrowUpRight className="w-3 h-3" />
                                  Promote to LIVE
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}