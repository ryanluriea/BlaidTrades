/**
 * BOT BRAIN PANEL - Compact header showing bot health at a glance
 * 
 * Shows only if there's an issue. Nothing shows "OK".
 * 
 * Components:
 * 1. Health Score Ring (0-100)
 * 2. Primary Blocker (one-line)
 * 3. Capital Status (if PAPER+)
 */

import { AlertCircle, DollarSign } from 'lucide-react';
import { BotBrainHealthRing } from './BotBrainHealthRing';
import { WhyNotTradingDrawer } from './WhyNotTradingDrawer';
import { Badge } from '@/components/ui/badge';
import { BotRowViewModel } from '@/lib/botViewModel';
import { useState } from 'react';
import type { HealthState } from '@/lib/canonicalStateEvaluator';

interface BotBrainPanelProps {
  viewModel: BotRowViewModel;
  allocation?: {
    weight: number;
    max_contracts: number;
    is_eligible: boolean;
  } | null;
}

// Map DisplayHealthState to HealthState for the ring component
function toHealthState(displayState: string): HealthState {
  if (displayState === 'BLOCKED' || displayState === 'DEGRADED') return 'DEGRADED';
  if (displayState === 'WARN') return 'WARN';
  return 'OK';
}

export function BotBrainPanel({ viewModel, allocation }: BotBrainPanelProps) {
  const { healthState, healthScore, primaryBlocker, stage } = viewModel;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Show panel only if there's something to report
  const hasHealthIssue = healthState !== 'OK';
  const hasBlocker = !!primaryBlocker;
  const showCapital = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage) && allocation;

  if (!hasHealthIssue && !hasBlocker && !showCapital) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 rounded-lg border border-border/50">
      {/* Health Score Ring */}
      {hasHealthIssue && (
        <BotBrainHealthRing
          score={healthScore}
          state={toHealthState(healthState)}
          hasCriticalBlockers={healthState === 'BLOCKED'}
          components={{
            runner_reliability: 85,
            backtest_success: healthScore,
            evolution_stability: 75,
            promotion_readiness: 60,
            drawdown_discipline: 90,
            error_frequency: 95,
          }}
        />
      )}

      {/* Primary Blocker */}
      {hasBlocker && primaryBlocker && (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <AlertCircle className={`w-4 h-4 shrink-0 ${
            primaryBlocker.severity === 'CRITICAL' ? 'text-red-400' :
            primaryBlocker.severity === 'WARNING' ? 'text-amber-400' : 'text-blue-400'
          }`} />
          <span className="text-sm text-muted-foreground truncate">
            {primaryBlocker.message}
          </span>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Details
          </button>
        </div>
      )}

      {/* Capital Status (PAPER+ only) */}
      {showCapital && allocation && (
        <div className="flex items-center gap-2 pl-3 border-l border-border/50">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <div className="text-sm">
            <span className="text-muted-foreground">Alloc:</span>{' '}
            <span className="font-medium">{Math.round(allocation.weight * 100)}%</span>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Max:</span>{' '}
            <span className="font-medium">{allocation.max_contracts}</span>
          </div>
          {!allocation.is_eligible && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30">
              Ineligible
            </Badge>
          )}
        </div>
      )}

      {/* WhyNotTrading Drawer */}
      <WhyNotTradingDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        bot={{
          id: viewModel.bot_id,
          name: viewModel.name,
          stage: viewModel.stage,
          mode: viewModel._canonicalState._context?.mode || null,
          is_trading_enabled: viewModel._canonicalState._context?.has_runner,
          health_state: viewModel._canonicalState.health_state,
        }}
      />
    </div>
  );
}

/**
 * Compact version for bot list rows
 */
export function BotBrainIndicator({ viewModel }: { viewModel: BotRowViewModel }) {
  const { healthState, healthScore, primaryBlocker } = viewModel;
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (healthState === 'OK' && !primaryBlocker) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {healthState !== 'OK' && (
        <BotBrainHealthRing
          score={healthScore}
          state={toHealthState(healthState)}
          hasCriticalBlockers={healthState === 'BLOCKED'}
          size="sm"
        />
      )}
      {primaryBlocker && (
        <>
          <button 
            onClick={() => setDrawerOpen(true)}
            className="text-amber-400 hover:text-amber-300"
          >
            <AlertCircle className="w-4 h-4" />
          </button>
          <WhyNotTradingDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            bot={{
              id: viewModel.bot_id,
              name: viewModel.name,
              stage: viewModel.stage,
              mode: viewModel._canonicalState._context?.mode || null,
              is_trading_enabled: viewModel._canonicalState._context?.has_runner,
              health_state: viewModel._canonicalState.health_state,
            }}
          />
        </>
      )}
    </div>
  );
}
