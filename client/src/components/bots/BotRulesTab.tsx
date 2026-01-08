import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from "@/components/ui/collapsible";
import { 
  translateRules, 
  getPromotionRequirements, 
  calculateRiskReward,
  type TranslatedRule,
  type PromotionRequirement,
} from "@/lib/ruleTranslator";
import { 
  ChevronDown, 
  ChevronRight,
  Target,
  Shield,
  Clock,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Circle,
  AlertTriangle,
  Zap,
  Activity,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface BotRulesTabProps {
  bot: {
    id: string;
    stage?: string;
    strategy_config?: Record<string, any>;
    risk_config?: Record<string, any>;
    total_trades?: number;
    profit_factor?: number;
    win_rate?: number;
    max_drawdown?: number;
    backtest_total_trades?: number;
    backtest_profit_factor?: number;
    backtest_win_rate?: number;
    backtest_max_drawdown?: number;
  };
  instrument?: {
    contract_size?: number;
    tick_size?: number;
  };
}

const CATEGORY_CONFIG = {
  entry: { 
    icon: Target, 
    label: 'Entry Conditions', 
    description: 'When to enter trades',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
  },
  exit: { 
    icon: TrendingUp, 
    label: 'Exit Conditions', 
    description: 'When to close trades',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
  },
  risk: { 
    icon: Shield, 
    label: 'Risk Management', 
    description: 'Position sizing & loss limits',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  time: { 
    icon: Clock, 
    label: 'Time Filters', 
    description: 'Session & timing rules',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  regime: { 
    icon: Activity, 
    label: 'Regime Filters', 
    description: 'Market condition rules',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  promotion: { 
    icon: Zap, 
    label: 'Promotion Requirements', 
    description: 'Gates to next stage',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'passing':
      return <CheckCircle2 className="w-4 h-4 text-profit" />;
    case 'failing':
      return <XCircle className="w-4 h-4 text-loss" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-warning" />;
    case 'active':
      return <CheckCircle2 className="w-4 h-4 text-cyan-500" />;
    case 'inactive':
      return <Circle className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Circle className="w-4 h-4 text-muted-foreground" />;
  }
}

function RuleItem({ rule }: { rule: TranslatedRule }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <StatusIcon status={rule.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{rule.name}</span>
          {rule.isBoolean ? (
            <Badge variant={rule.value ? "default" : "secondary"} className="text-xs">
              {rule.value ? 'Enabled' : 'Disabled'}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-xs">
              {rule.formattedValue}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{rule.description}</p>
      </div>
    </div>
  );
}

function PromotionRequirementItem({ req }: { req: PromotionRequirement }) {
  return (
    <div className="space-y-2 py-3 border-b border-border/50 last:border-0">
      <div className="flex items-start gap-3">
        <StatusIcon status={req.isPassing ? 'passing' : 'failing'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm">{req.name}</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-mono text-sm",
                req.isPassing ? "text-profit" : "text-loss"
              )}>
                {req.current}
              </span>
              <span className="text-muted-foreground text-xs">/ {req.required}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{req.description}</p>
        </div>
      </div>
      {req.percentage !== undefined && (
        <Progress 
          value={req.percentage} 
          className={cn(
            "h-2 ml-7",
            req.isPassing ? "[&>div]:bg-profit" : "[&>div]:bg-loss"
          )} 
        />
      )}
    </div>
  );
}

function RuleCategory({ 
  category, 
  rules,
  defaultOpen = true,
}: { 
  category: keyof typeof CATEGORY_CONFIG;
  rules: TranslatedRule[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  
  const activeCount = rules.filter(r => r.status === 'active' || r.status === 'passing').length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50 rounded-lg transition-colors">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", config.bgColor)}>
            <Icon className={cn("w-5 h-5", config.color)} />
          </div>
          <div className="text-left">
            <h3 className="font-semibold">{config.label}</h3>
            <p className="text-sm text-muted-foreground">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono">
            {activeCount}/{rules.length}
          </Badge>
          {isOpen ? (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4">
          <div className="border rounded-lg p-4 bg-muted/20">
            {rules.map((rule) => (
              <RuleItem key={rule.key} rule={rule} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function BotRulesTab({ bot, instrument }: BotRulesTabProps) {
  const strategyConfig = (bot.strategy_config as Record<string, any>) || {};
  const riskConfig = (bot.risk_config as Record<string, any>) || {};
  
  const context = {
    contractSize: instrument?.contract_size ?? 5,
    tickSize: instrument?.tick_size ?? 0.25,
    instrument: strategyConfig.instrument || 'MES',
    botMetrics: {
      totalTrades: bot.backtest_total_trades ?? bot.total_trades ?? 0,
      winRate: bot.backtest_win_rate ?? bot.win_rate ?? 0,
      profitFactor: bot.backtest_profit_factor ?? bot.profit_factor ?? 0,
      maxDrawdown: bot.backtest_max_drawdown ?? bot.max_drawdown ?? 0,
    },
  };

  const rules = translateRules(strategyConfig, riskConfig, context);
  
  // Group rules by category
  const rulesByCategory = rules.reduce((acc, rule) => {
    if (!acc[rule.category]) acc[rule.category] = [];
    acc[rule.category].push(rule);
    return acc;
  }, {} as Record<string, TranslatedRule[]>);

  // Get promotion requirements
  const promotionReqs = getPromotionRequirements(bot.stage || 'TRIALS', context.botMetrics);
  const passingReqs = promotionReqs.filter(r => r.isPassing).length;

  // Calculate R:R ratio
  const rrRatio = calculateRiskReward(
    riskConfig.stop_loss_ticks || 0, 
    riskConfig.profit_target_ticks || 0
  );

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-500" />
            Trading Rules Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Strategy Type</p>
              <p className="font-semibold text-sm mt-1">
                {strategyConfig.type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Unknown'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Risk/Reward</p>
              <p className="font-semibold text-sm mt-1 font-mono">{rrRatio}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Timeframe</p>
              <p className="font-semibold text-sm mt-1">{strategyConfig.timeframe || 'N/A'}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Promotion Progress</p>
              <p className="font-semibold text-sm mt-1">
                <span className={passingReqs === promotionReqs.length ? 'text-profit' : 'text-warning'}>
                  {passingReqs}/{promotionReqs.length}
                </span>
                <span className="text-muted-foreground text-xs ml-1">gates</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rules Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Rules Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Entry Rules */}
          {rulesByCategory.entry && rulesByCategory.entry.length > 0 && (
            <RuleCategory category="entry" rules={rulesByCategory.entry} />
          )}

          {/* Exit Rules */}
          {rulesByCategory.exit && rulesByCategory.exit.length > 0 && (
            <RuleCategory category="exit" rules={rulesByCategory.exit} />
          )}

          {/* Risk Rules */}
          {rulesByCategory.risk && rulesByCategory.risk.length > 0 && (
            <RuleCategory category="risk" rules={rulesByCategory.risk} />
          )}

          {/* Time Rules */}
          {rulesByCategory.time && rulesByCategory.time.length > 0 && (
            <RuleCategory category="time" rules={rulesByCategory.time} defaultOpen={false} />
          )}

          {/* Regime Rules */}
          {rulesByCategory.regime && rulesByCategory.regime.length > 0 && (
            <RuleCategory category="regime" rules={rulesByCategory.regime} defaultOpen={false} />
          )}
        </CardContent>
      </Card>

      {/* Promotion Requirements */}
      {promotionReqs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Promotion Requirements
              </CardTitle>
              <Badge 
                variant={passingReqs === promotionReqs.length ? "default" : "secondary"}
                className={cn(
                  passingReqs === promotionReqs.length && "bg-profit"
                )}
              >
                {passingReqs === promotionReqs.length ? 'READY' : `${promotionReqs.length - passingReqs} remaining`}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {bot.stage === 'TRIALS' 
                ? 'Requirements to promote from TRIALS to PAPER trading'
                : 'Current promotion status'}
            </p>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg p-4 bg-muted/20">
              {promotionReqs.map((req) => (
                <PromotionRequirementItem key={req.name} req={req} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Why Isn't This Bot Trading More?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(strategyConfig.entry_deviation_pct ?? 0) > 0.005 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Entry threshold may be too strict</p>
                  <p className="text-sm text-muted-foreground">
                    Current: {((strategyConfig.entry_deviation_pct ?? 0) * 100).toFixed(2)}%. 
                    Consider lowering to 0.1-0.2% for more trades.
                  </p>
                </div>
              </div>
            )}
            {(riskConfig.max_trades_per_day ?? 0) < 10 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Max trades per day is limiting</p>
                  <p className="text-sm text-muted-foreground">
                    Current: {riskConfig.max_trades_per_day}. Consider increasing to 20+ for faster backtesting.
                  </p>
                </div>
              </div>
            )}
            {(strategyConfig.require_retest || strategyConfig.require_htf_alignment || strategyConfig.regime_detection_enabled) && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Activity className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Multiple filters are active</p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      strategyConfig.require_retest && 'Retest required',
                      strategyConfig.require_htf_alignment && 'HTF alignment required',
                      strategyConfig.regime_detection_enabled && 'Regime detection active',
                    ].filter(Boolean).join(', ')}. These reduce trade frequency.
                  </p>
                </div>
              </div>
            )}
            {!((strategyConfig.entry_deviation_pct ?? 0) > 0.005) && 
             !((riskConfig.max_trades_per_day ?? 0) < 10) && 
             !strategyConfig.require_retest && 
             !strategyConfig.require_htf_alignment && 
             !strategyConfig.regime_detection_enabled && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Rules look optimized for trade frequency</p>
                  <p className="text-sm text-muted-foreground">
                    No obvious restrictions detected. If trades are still low, check market data availability.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
