import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTradeTrace } from "@/hooks/useProductionScorecard";
import { formatDistanceToNow } from "date-fns";
import { 
  GitBranch, 
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface TradeTraceDrawerProps {
  botId: string;
  trigger?: React.ReactNode;
}

export function TradeTraceDrawer({ botId, trigger }: TradeTraceDrawerProps) {
  const [open, setOpen] = useState(false);
  const { data: traces, isLoading, isError } = useTradeTrace(botId);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  const isDegraded = isError || (!isLoading && traces === undefined);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <GitBranch className="w-4 h-4 mr-2" />
            Trade Traces
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Trade Trace History
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-8rem)] mt-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : isDegraded ? (
            <DegradedBanner message="Trade trace data unavailable" />
          ) : traces && traces.length > 0 ? (
            <div className="space-y-4">
              {traces.map((trace) => {
                const isExpanded = expandedTrace === trace.trade_id;
                const isProfitable = (trace.pnl ?? 0) > 0;

                return (
                  <div 
                    key={trace.trade_id}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Header */}
                    <button
                      onClick={() => setExpandedTrace(isExpanded ? null : trace.trade_id)}
                      className="w-full p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      
                      {trace.direction === 'BUY' || trace.direction === 'LONG' ? (
                        <TrendingUp className="w-5 h-5 text-profit" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-loss" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{trace.symbol}</span>
                          <Badge variant="outline" className="text-xs">
                            {trace.direction}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {formatDistanceToNow(new Date(trace.entry_time), { addSuffix: true })}
                          </span>
                          {trace.provenance?.timeframe && (
                            <>
                              <span>•</span>
                              <span>{trace.provenance.timeframe}</span>
                            </>
                          )}
                          {trace.provenance?.regime && (
                            <>
                              <span>•</span>
                              <span>{trace.provenance.regime}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {trace.pnl !== undefined && (
                        <div className={`font-mono font-medium ${isProfitable ? 'text-profit' : 'text-loss'}`}>
                          {isProfitable ? '+' : ''}${trace.pnl.toFixed(2)}
                        </div>
                      )}
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t p-4 bg-muted/20 space-y-4">
                        {/* Chain Visualization */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">ORDER LIFECYCLE</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {trace.chain.decision && (
                              <>
                                <Badge variant="secondary" className="text-xs">
                                  Decision
                                </Badge>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                              </>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {trace.chain.orders?.length || 0} Orders
                            </Badge>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <Badge variant="secondary" className="text-xs">
                              {trace.chain.fills?.length || 0} Fills
                            </Badge>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            {trace.chain.position && (
                              <>
                                <Badge variant="secondary" className="text-xs">
                                  Position
                                </Badge>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                              </>
                            )}
                            <Badge className={isProfitable ? 'bg-profit/20 text-profit' : 'bg-loss/20 text-loss'}>
                              <DollarSign className="w-3 h-3 mr-1" />
                              PnL
                            </Badge>
                          </div>
                        </div>

                        {/* Provenance */}
                        {trace.provenance && Object.keys(trace.provenance).length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">PROVENANCE</p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              {trace.provenance.timeframe && (
                                <div>
                                  <span className="text-muted-foreground">Timeframe:</span>{' '}
                                  <span className="font-mono">{trace.provenance.timeframe}</span>
                                </div>
                              )}
                              {trace.provenance.horizon && (
                                <div>
                                  <span className="text-muted-foreground">Horizon:</span>{' '}
                                  <span className="font-mono">{trace.provenance.horizon}</span>
                                </div>
                              )}
                              {trace.provenance.regime && (
                                <div>
                                  <span className="text-muted-foreground">Regime:</span>{' '}
                                  <span className="font-mono">{trace.provenance.regime}</span>
                                </div>
                              )}
                              {trace.provenance.signal_sources && (
                                <div className="col-span-2">
                                  <span className="text-muted-foreground">Sources:</span>{' '}
                                  <span className="font-mono">
                                    {trace.provenance.signal_sources.join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Raw Chain Data */}
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            View Raw Chain Data
                          </summary>
                          <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-40">
                            {JSON.stringify(trace.chain, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No trade traces available</p>
              <p className="text-sm">Traces appear after trades are executed</p>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
