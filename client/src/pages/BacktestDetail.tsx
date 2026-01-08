import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay, PnlPercent } from "@/components/ui/pnl-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useBacktest } from "@/hooks/useBacktests";
import { ConfidenceBadge, StatisticalWarning, parseConfidence } from "@/components/ui/confidence-badge";
import { Calendar, TrendingUp, TrendingDown, BarChart3, ChevronLeft, Activity, Zap, Shield, CheckCircle, XCircle, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";

export default function BacktestDetail() {
  const { id } = useParams();
  const { data: backtest, isLoading } = useBacktest(id);

  if (isLoading) {
    return (
      <AppLayout title="Loading...">
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!backtest) {
    return (
      <AppLayout title="Backtest Not Found">
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">Backtest not found</p>
          <Button asChild><Link to="/backtests">Back to Backtests</Link></Button>
        </div>
      </AppLayout>
    );
  }

  const equityCurve = (backtest.equity_curve as { date: string; equity: number }[] | null) || [];
  const netPnl = Number(backtest.net_pnl) || 0;
  const initialCapital = Number(backtest.initial_capital) || 50000;
  const finalCapital = Number(backtest.final_capital) || initialCapital + netPnl;
  const winRate = Number(backtest.win_rate) || 0;
  const profitFactor = Number(backtest.profit_factor) || 0;
  const maxDrawdownPct = Number(backtest.max_drawdown_pct) || 0;
  const maxDrawdown = Number(backtest.max_drawdown) || 0;
  const sharpeRatio = Number(backtest.sharpe_ratio) || 0;
  const avgTradePnl = Number(backtest.avg_trade_pnl) || 0;
  const grossProfit = Number(backtest.gross_profit) || 0;
  const grossLoss = Number(backtest.gross_loss) || 0;
  
  // New institutional metrics
  const sortinoRatio = Number((backtest as any).sortino_ratio) || null;
  const calmarRatio = Number((backtest as any).calmar_ratio) || null;
  const ulcerIndex = Number((backtest as any).ulcer_index) || null;
  const maxConsecutiveWins = Number((backtest as any).max_consecutive_wins) || null;
  const maxConsecutiveLosses = Number((backtest as any).max_consecutive_losses) || null;
  const expectancyR = Number((backtest as any).expectancy_r) || null;
  const sharpeConfidence = (backtest as any).sharpe_confidence as string | null;
  const statisticalSignificance = (backtest as any).statistical_significance as boolean | null;
  
  const confidence = parseConfidence(sharpeConfidence);
  const isReliable = statisticalSignificance !== false;

  // Prepare chart data
  const chartData = equityCurve.map((point, idx) => ({
    name: idx,
    date: new Date(point.date).toLocaleDateString(),
    equity: point.equity + initialCapital,
  }));

  return (
    <AppLayout title={backtest.name || `Backtest ${backtest.instrument}`}>
      <div className="space-y-6">
        {/* Back link */}
        <Link to="/backtests" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Backtests
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={backtest.status as any} />
              <span className="text-muted-foreground">
                {(backtest as any).bot?.name || 'Unknown Bot'} • {backtest.instrument}
              </span>
              {confidence !== 'INSUFFICIENT' && (
                <ConfidenceBadge confidence={confidence} showLabel />
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              {backtest.start_date} → {backtest.end_date}
            </div>
          </div>
        </div>

        {/* Statistical Warning */}
        <StatisticalWarning 
          isSignificant={isReliable} 
          sampleSize={backtest.total_trades || undefined}
          minRequired={30}
        />

        {/* Key Metrics */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Net P&L</p>
              <PnlDisplay value={netPnl} size="lg" />
              <PnlPercent 
                value={(netPnl / initialCapital) * 100} 
                className="mt-1 block"
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Win Rate</p>
              <p className="text-2xl font-bold font-mono">{winRate.toFixed(1)}%</p>
              <p className="text-sm text-muted-foreground mt-1">
                {backtest.winning_trades || 0}W / {backtest.losing_trades || 0}L
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Profit Factor</p>
              <p className={cn(
                "text-2xl font-bold font-mono",
                profitFactor >= 1.5 ? 'text-emerald-500' : profitFactor >= 1.0 ? 'text-amber-500' : 'text-loss'
              )}>{profitFactor.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Max Drawdown</p>
              <p className="text-2xl font-bold font-mono text-loss">
                -{maxDrawdownPct.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                ${maxDrawdown.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Risk-Adjusted Metrics Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Risk-Adjusted Returns
              {confidence !== 'INSUFFICIENT' && (
                <ConfidenceBadge confidence={confidence} showLabel size="md" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Sharpe</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  sharpeRatio >= 1.0 ? 'text-emerald-500' : sharpeRatio >= 0.5 ? 'text-amber-500' : 'text-foreground'
                )}>{sharpeRatio.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Risk-adjusted return</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Sortino</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  sortinoRatio && sortinoRatio >= 1.5 ? 'text-emerald-500' : sortinoRatio && sortinoRatio >= 1.0 ? 'text-amber-500' : 'text-foreground'
                )}>{sortinoRatio?.toFixed(2) || '—'}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Downside-only volatility</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Calmar</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  calmarRatio && calmarRatio >= 1.0 ? 'text-emerald-500' : calmarRatio && calmarRatio >= 0.5 ? 'text-amber-500' : 'text-foreground'
                )}>{calmarRatio?.toFixed(2) || '—'}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Return / Max DD</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Ulcer Index</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  ulcerIndex && ulcerIndex <= 5 ? 'text-emerald-500' : ulcerIndex && ulcerIndex <= 10 ? 'text-amber-500' : 'text-loss'
                )}>{ulcerIndex?.toFixed(1) || '—'}</p>
                <p className="text-[10px] text-muted-foreground mt-1">DD depth & duration</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Metrics Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Trading Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Expectancy (R)</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  expectancyR && expectancyR >= 0.3 ? 'text-emerald-500' : expectancyR && expectancyR > 0 ? 'text-amber-500' : 'text-loss'
                )}>{expectancyR ? `${expectancyR.toFixed(2)}R` : '—'}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Expected R per trade</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Avg Trade</p>
                <PnlDisplay value={avgTradePnl} className="justify-center text-xl" />
                <p className="text-[10px] text-muted-foreground mt-1">Per trade P&L</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1 flex items-center justify-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-500" />
                  Max Win Streak
                </p>
                <p className="text-xl font-bold font-mono text-emerald-500">
                  {maxConsecutiveWins ?? '—'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Consecutive wins</p>
              </div>
              <div className="text-center bg-muted/30 rounded-lg p-4">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1 flex items-center justify-center gap-1">
                  <TrendingDown className="w-3 h-3 text-loss" />
                  Max Loss Streak
                </p>
                <p className="text-xl font-bold font-mono text-loss">
                  {maxConsecutiveLosses ?? '—'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Consecutive losses</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Equity Curve */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Equity Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 12 }} 
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }} 
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, 'Equity']}
                      labelFormatter={(label) => chartData[label]?.date || ''}
                    />
                    <ReferenceLine y={initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    <Line 
                      type="monotone" 
                      dataKey="equity" 
                      stroke={netPnl >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))"} 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Strategy Provenance Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Strategy Provenance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/30">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-2">Verification Status</p>
                <div className="flex items-center gap-2">
                  {(backtest as any).provenanceStatus === 'VERIFIED' ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                      <span className="font-semibold text-emerald-500">VERIFIED</span>
                    </>
                  ) : (backtest as any).provenanceStatus === 'MISMATCH' ? (
                    <>
                      <XCircle className="w-5 h-5 text-loss" />
                      <span className="font-semibold text-loss">MISMATCH</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-5 h-5 text-muted-foreground" />
                      <span className="font-semibold text-muted-foreground">PENDING</span>
                    </>
                  )}
                </div>
              </div>
              <div className="p-4 rounded-lg bg-muted/30">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-2">Entry Condition</p>
                <p className="font-mono text-sm">
                  {(backtest as any).expectedEntryCondition || (backtest as any).actualEntryCondition || 'N/A'}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-2">Rules Hash</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {(backtest as any).rulesHash || 'N/A'}
                </p>
              </div>
            </div>
            {(backtest as any).rulesSummary && (
              <div className="mt-4 p-4 rounded-lg bg-muted/30">
                <p className="text-xs uppercase text-muted-foreground font-medium mb-2">Rules Summary</p>
                <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                  {(backtest as any).rulesSummary}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detailed Stats */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Performance Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Initial Capital</span>
                <span className="font-mono">${initialCapital.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Final Capital</span>
                <span className="font-mono">${finalCapital.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Total Trades</span>
                <span className="font-mono">{backtest.total_trades || 0}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Average Trade P&L</span>
                <PnlDisplay value={avgTradePnl} size="sm" />
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Statistical Significance</span>
                <span className={cn(
                  "font-medium",
                  isReliable ? 'text-emerald-500' : 'text-amber-500'
                )}>
                  {isReliable ? 'Yes' : 'No'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-profit" />
                Profit / Loss Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-profit" />
                  Gross Profit
                </span>
                <span className="font-mono text-profit">
                  +${grossProfit.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-loss" />
                  Gross Loss
                </span>
                <span className="font-mono text-loss">
                  -${grossLoss.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Winning Trades</span>
                <span className="font-mono text-profit">{backtest.winning_trades || 0}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Losing Trades</span>
                <span className="font-mono text-loss">{backtest.losing_trades || 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
