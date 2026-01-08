import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { 
  Clock, 
  Target, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  BarChart3,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";

interface TradeReasoning {
  entry?: {
    conditions?: string[];
    indicators?: Record<string, number | null>;
    signals?: Record<string, any>;
    risk_checks?: string[];
    notes?: string[];
  };
  exit?: {
    conditions?: string[];
    indicators?: Record<string, number | null>;
    signals?: Record<string, any>;
    risk_checks?: string[];
    notes?: string[];
  };
  context?: {
    tf?: string;
    horizon?: string;
    fold_id?: number | null;
    regime_tag?: string | null;
    provider?: string;
    bar_count?: number;
    seed?: string | null;
  };
}

interface Trade {
  id: string;
  instrument: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price?: number;
  entry_time: string;
  exit_time?: string;
  pnl?: number;
  fees?: number;
  timeframe?: string;
  horizon?: string;
  fold_id?: number;
  regime_tag?: string;
  setup_id?: string;
  setup_label?: string;
  reasoning?: TradeReasoning;
  source_type?: string;
  mfe?: number;
  mae?: number;
  slippage_usd?: number;
  backtest_session_id?: string;
}

interface TradeSetupDrawerProps {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TradeSetupDrawer({ trade, open, onOpenChange }: TradeSetupDrawerProps) {
  if (!trade) return null;

  const reasoning = trade.reasoning || {};
  const entryProof = reasoning.entry || {};
  const exitProof = reasoning.exit || {};
  const context = reasoning.context || {};

  const sourceType = trade.source_type || 'BACKTEST';
  const isWin = (trade.pnl || 0) > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="text-lg">{trade.setup_label || 'Trade Setup'}</SheetTitle>
            {trade.timeframe && (
              <Badge variant="outline" className="font-mono text-xs">
                {trade.timeframe}
              </Badge>
            )}
            <Badge variant={sourceType === 'LIVE' ? 'default' : sourceType === 'PAPER' ? 'secondary' : 'outline'}>
              {sourceType}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{trade.instrument}</span>
            <span className={trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}>
              {trade.side}
            </span>
            <PnlDisplay value={trade.pnl || 0} size="sm" />
          </div>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          {/* Session Context */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="w-4 h-4" />
                Session Context
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeframe</span>
                  <span className="font-mono">{trade.timeframe || context.tf || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Horizon</span>
                  <span className="font-mono">{trade.horizon || context.horizon || '—'}</span>
                </div>
                {(trade.fold_id !== undefined || context.fold_id !== undefined) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fold</span>
                    <span className="font-mono">{trade.fold_id ?? context.fold_id ?? '—'}</span>
                  </div>
                )}
                {(trade.regime_tag || context.regime_tag) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Regime</span>
                    <Badge variant="outline" className="text-xs">
                      {trade.regime_tag || context.regime_tag}
                    </Badge>
                  </div>
                )}
                {context.provider && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="text-xs">{context.provider}</span>
                  </div>
                )}
                {context.bar_count && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bars</span>
                    <span className="font-mono">{context.bar_count.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Entry Proof */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Entry Proof
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              {/* Conditions */}
              {entryProof.conditions && entryProof.conditions.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Conditions Met</p>
                  <div className="flex flex-wrap gap-1">
                    {entryProof.conditions.map((cond, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                        {cond.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Indicators */}
              {entryProof.indicators && Object.keys(entryProof.indicators).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Indicator Values</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {Object.entries(entryProof.indicators).map(([key, val]) => (
                      <div key={key} className="flex justify-between bg-muted/30 rounded px-2 py-1">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-mono">
                          {val !== null ? (typeof val === 'number' ? val.toFixed(2) : String(val)) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Checks */}
              {entryProof.risk_checks && entryProof.risk_checks.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Risk Checks</p>
                  <div className="flex flex-wrap gap-1">
                    {entryProof.risk_checks.map((check, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                        {check.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {entryProof.notes && entryProof.notes.length > 0 && (
                <div className="text-xs text-muted-foreground italic">
                  {entryProof.notes.join(' • ')}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Exit Proof */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                {isWin ? (
                  <Target className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                Exit Proof
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              {/* Conditions */}
              {exitProof.conditions && exitProof.conditions.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Exit Conditions</p>
                  <div className="flex flex-wrap gap-1">
                    {exitProof.conditions.map((cond, i) => (
                      <Badge key={i} variant={isWin ? 'default' : 'destructive'} className="text-xs">
                        {cond.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Indicators */}
              {exitProof.indicators && Object.keys(exitProof.indicators).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Exit Values</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {Object.entries(exitProof.indicators).map(([key, val]) => (
                      <div key={key} className="flex justify-between bg-muted/30 rounded px-2 py-1">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-mono">
                          {val !== null ? (typeof val === 'number' ? val.toFixed(2) : String(val)) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {exitProof.notes && exitProof.notes.length > 0 && (
                <div className="text-xs text-muted-foreground italic">
                  {exitProof.notes.join(' • ')}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Execution Details */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Execution
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="font-mono">${Number(trade.entry_price).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exit</span>
                  <span className="font-mono">
                    {trade.exit_price ? `$${Number(trade.exit_price).toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-mono">{trade.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fees</span>
                  <span className="font-mono">${(trade.fees || 0).toFixed(2)}</span>
                </div>
                {trade.mfe !== undefined && trade.mfe !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MFE</span>
                    <span className="font-mono text-green-500">${Number(trade.mfe).toFixed(2)}</span>
                  </div>
                )}
                {trade.mae !== undefined && trade.mae !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MAE</span>
                    <span className="font-mono text-red-500">${Number(trade.mae).toFixed(2)}</span>
                  </div>
                )}
                {trade.slippage_usd !== undefined && trade.slippage_usd !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Slippage</span>
                    <span className="font-mono">${Number(trade.slippage_usd).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator className="my-3" />

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p>Entry Time</p>
                  <p className="font-mono text-foreground">
                    {format(new Date(trade.entry_time), "yyyy-MM-dd HH:mm:ss")}
                  </p>
                </div>
                {trade.exit_time && (
                  <div>
                    <p>Exit Time</p>
                    <p className="font-mono text-foreground">
                      {format(new Date(trade.exit_time), "yyyy-MM-dd HH:mm:ss")}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Session ID for reference */}
          {trade.backtest_session_id && (
            <div className="text-xs text-muted-foreground text-center">
              Session: <span className="font-mono">{trade.backtest_session_id.slice(0, 8)}...</span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
