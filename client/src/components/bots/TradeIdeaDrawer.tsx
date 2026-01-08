import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Separator } from "@/components/ui/separator";
import { format, formatDistanceToNow } from "date-fns";
import { 
  Target, 
  TrendingUp, 
  TrendingDown, 
  Clock,
  AlertTriangle,
  DollarSign,
  Activity,
  Zap,
} from "lucide-react";

interface OpenPosition {
  quantity: number;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  entryReasonCode?: string;
  openedAt?: string;
  stopPrice?: number;
  targetPrice?: number;
  symbol?: string;
  entryMetadata?: {
    conditions?: string[];
    indicators?: Record<string, number | null>;
    notes?: string[];
    expectedHoldBars?: number;
    timeframe?: string;
  };
}

interface TradeIdeaDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: OpenPosition | null;
  botName?: string;
  stage?: string;
}

export function TradeIdeaDrawer({ 
  open, 
  onOpenChange, 
  position,
  botName,
  stage = 'PAPER',
}: TradeIdeaDrawerProps) {
  if (!position) return null;

  const isLong = position.side === 'BUY';
  const isProfitable = position.unrealizedPnl > 0;
  const entryMeta = position.entryMetadata || {};
  
  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const calculateRiskReward = () => {
    if (!position.stopPrice || !position.targetPrice) return null;
    const risk = Math.abs(position.entryPrice - position.stopPrice);
    const reward = Math.abs(position.targetPrice - position.entryPrice);
    if (risk === 0) return null;
    return (reward / risk).toFixed(1);
  };

  const riskReward = calculateRiskReward();

  const formatEntryReason = (code: string) => {
    return code
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="text-lg">Active Position</SheetTitle>
            <Badge variant={stage === 'LIVE' ? 'default' : 'secondary'}>
              {stage}
            </Badge>
          </div>
          <SheetDescription>
            {botName ? `${botName} - ` : ''}{position.symbol || 'Unknown Symbol'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Position Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {isLong ? (
                    <TrendingUp className="w-5 h-5 text-profit" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-loss" />
                  )}
                  <span className="font-semibold text-lg">
                    {isLong ? 'LONG' : 'SHORT'} x{position.quantity}
                  </span>
                </div>
                <PnlDisplay value={position.unrealizedPnl} size="lg" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="font-mono">${formatPrice(position.entryPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current</span>
                  <span className={`font-mono ${isProfitable ? 'text-profit' : 'text-loss'}`}>
                    ${formatPrice(position.currentPrice)}
                  </span>
                </div>
                {position.openedAt && (
                  <div className="col-span-2 flex justify-between">
                    <span className="text-muted-foreground">Opened</span>
                    <span className="text-xs">
                      {formatDistanceToNow(new Date(position.openedAt), { addSuffix: true })}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {position.entryReasonCode && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Entry Reason
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <Badge variant="secondary" className="text-sm">
                  {formatEntryReason(position.entryReasonCode)}
                </Badge>
                
                {entryMeta.conditions && entryMeta.conditions.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Conditions Met</p>
                    <div className="flex flex-wrap gap-1">
                      {entryMeta.conditions.map((cond, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {cond.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {entryMeta.indicators && Object.keys(entryMeta.indicators).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Indicator Snapshot</p>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {Object.entries(entryMeta.indicators).map(([key, val]) => (
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

                {entryMeta.notes && entryMeta.notes.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground italic">
                    {entryMeta.notes.join(' • ')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(position.stopPrice || position.targetPrice) && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Risk Management
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-3">
                  {position.stopPrice && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-loss" />
                        <span className="text-sm text-muted-foreground">Stop Loss</span>
                      </div>
                      <span className="font-mono text-loss">
                        ${formatPrice(position.stopPrice)}
                      </span>
                    </div>
                  )}
                  {position.targetPrice && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-profit" />
                        <span className="text-sm text-muted-foreground">Take Profit</span>
                      </div>
                      <span className="font-mono text-profit">
                        ${formatPrice(position.targetPrice)}
                      </span>
                    </div>
                  )}
                  {riskReward && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Risk/Reward</span>
                        <Badge variant="outline" className="font-mono">
                          1:{riskReward}
                        </Badge>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {(entryMeta.expectedHoldBars || entryMeta.timeframe) && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Expected Duration
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {entryMeta.timeframe && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Timeframe</span>
                      <span className="font-mono">{entryMeta.timeframe}</span>
                    </div>
                  )}
                  {entryMeta.expectedHoldBars && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Bars</span>
                      <span className="font-mono">{entryMeta.expectedHoldBars}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {position.openedAt && (
            <div className="text-xs text-muted-foreground text-center pt-2">
              Position opened {format(new Date(position.openedAt), "yyyy-MM-dd HH:mm:ss")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
