import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { 
  Wrench,
  ArrowRight,
  Target,
  TrendingUp,
  Loader2,
} from "lucide-react";

interface ImprovementDetailsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName?: string;
  generationNumber?: number;
}

interface Generation {
  id: string;
  generationNumber: number;
  mutationReasonCode?: string;
  mutationObjective?: string;
  summaryDiff?: string;
  summaryTitle?: string;
  performanceSnapshot?: {
    generation?: number;
    snapshotAt?: string;
    performanceMetrics?: {
      totalTrades?: number;
      winRate?: number;
      profitFactor?: number;
      maxDrawdownPct?: number;
    };
  };
  mutationsSummary?: {
    direction?: string;
    changeCount?: number;
    fields?: string[];
  };
  createdAt?: string;
  stage?: string;
}

export function ImprovementDetailsDrawer({ 
  open, 
  onOpenChange, 
  botId,
  botName,
  generationNumber,
}: ImprovementDetailsDrawerProps) {
  const { data: generations, isLoading } = useQuery<Generation[]>({
    queryKey: [`/api/bot-generations/${botId}`],
    queryFn: async () => {
      const res = await fetch(`/api/bot-generations/${botId}`, { credentials: 'include' });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
    enabled: open && !!botId,
  });

  // Get latest generation (API returns ascending order, so last element is newest)
  // Ensure generations is an array before processing
  const generationsArray = Array.isArray(generations) ? generations : [];
  const sortedGens = generationsArray.slice().sort((a, b) => b.generationNumber - a.generationNumber);
  const latestGen = sortedGens[0];

  const formatDirection = (code?: string) => {
    if (!code) return 'Unknown';
    return code
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  };

  const parseDiffLine = (line: string) => {
    // Format: "field: oldValue → newValue"
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) return { field: line, change: '' };
    const field = line.substring(0, colonIdx);
    const change = line.substring(colonIdx + 2);
    return { field, change };
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="text-lg flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Improvement Details
            </SheetTitle>
          </div>
          <SheetDescription>
            {botName || 'Bot'} - Generation {latestGen?.generationNumber || generationNumber || '?'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !latestGen ? (
            <div className="text-center py-8 text-muted-foreground">
              No improvement data available
            </div>
          ) : (
            <>
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Evolution Goal
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="space-y-2">
                    {latestGen.mutationReasonCode && (
                      <Badge variant="outline" className="text-xs">
                        {formatDirection(latestGen.mutationReasonCode)}
                      </Badge>
                    )}
                    {latestGen.mutationObjective && (
                      <p className="text-sm text-muted-foreground">
                        {latestGen.mutationObjective}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {latestGen.summaryDiff && (
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ArrowRight className="w-4 h-4" />
                      Parameter Changes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="space-y-3 font-mono text-xs">
                      {latestGen.summaryDiff.split('\n').filter(line => line.trim()).map((line, idx) => {
                        const { field, change } = parseDiffLine(line);
                        return (
                          <div key={idx} className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-semibold">{field}</span>
                            <span className="text-foreground">{change}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {latestGen.performanceSnapshot?.performanceMetrics && (
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Pre-Evolution Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Win Rate</span>
                        <p className="font-medium">
                          {latestGen.performanceSnapshot.performanceMetrics.winRate != null 
                            ? `${(latestGen.performanceSnapshot.performanceMetrics.winRate * 100).toFixed(1)}%`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Profit Factor</span>
                        <p className="font-medium">
                          {latestGen.performanceSnapshot.performanceMetrics.profitFactor?.toFixed(2) || '-'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max Drawdown</span>
                        <p className="font-medium">
                          {latestGen.performanceSnapshot.performanceMetrics.maxDrawdownPct != null
                            ? `${latestGen.performanceSnapshot.performanceMetrics.maxDrawdownPct.toFixed(1)}%`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Trades</span>
                        <p className="font-medium">
                          {latestGen.performanceSnapshot.performanceMetrics.totalTrades ?? '-'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Separator />

              <div className="text-xs text-muted-foreground text-center">
                {latestGen.createdAt && (
                  <>
                    Created {formatDistanceToNow(new Date(latestGen.createdAt), { addSuffix: true })}
                    <span className="mx-1">·</span>
                    {format(new Date(latestGen.createdAt), 'MMM d, yyyy h:mm a')}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
