/**
 * CANONICAL STATE EVALUATOR - SINGLE SOURCE OF TRUTH
 * 
 * This is the ONLY place where bot state is computed.
 * UI MUST render from this object. No local derivation.
 * 
 * BULLETPROOF AUTONOMY INVARIANTS:
 * 1. Every state has a reason
 * 2. Every problem has a suggested action
 * 3. Auto-healable issues are marked
 * 4. No contradictory states possible
 */

// =============================================
// CANONICAL STATE TYPES
// =============================================

export type RunnerState = 
  | 'SCANNING'      // Active, heartbeat fresh
  | 'TRADING'       // In active trade
  | 'RUNNING'       // Runner running (generic)
  | 'STALLED'       // Heartbeat stale (legacy)
  | 'STALE'         // Heartbeat stale (canonical)
  | 'STOPPED'       // Explicitly stopped
  | 'PAUSED'        // User paused
  | 'STARTING'      // Start job queued
  | 'RESTARTING'    // Restart job queued
  | 'ERROR'         // In error state
  | 'BLOCKED'       // Blocked by gates
  | 'REQUIRED'      // Runner required but not present
  | 'CIRCUIT_BREAK' // Too many restarts
  | 'UNKNOWN'       // Unknown state (botNow missing)
  | 'NO_RUNNER';    // No runner exists

export type JobState = 
  | 'IDLE'          // No active jobs
  | 'BACKTEST_RUNNING'
  | 'BACKTEST_QUEUED'
  | 'EVOLVING'
  | 'EVALUATING'
  | 'QUEUED'        // Other job queued
  | 'NEEDS_BACKTEST' // Needs baseline backtest
  | 'UNKNOWN';      // Unknown state (botNow missing)

export type EvolutionState =
  | 'IDLE'
  | 'EVOLVING'
  | 'TOURNAMENT_RUNNING'
  | 'AWAITING_BACKTEST'
  | 'MUTATION_PENDING'
  | 'COOLDOWN'
  | 'UNKNOWN';      // Unknown state (botNow missing)

export type HealthState = 'OK' | 'WARN' | 'DEGRADED';

export interface BlockerCode {
  code: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  suggested_action: string;
  auto_healable: boolean;
  evidence?: Record<string, unknown>;
}

export interface CanonicalBotState {
  // Core states
  runner_state: RunnerState;
  job_state: JobState;
  evolution_state: EvolutionState;
  health_state: HealthState;
  health_score: number;
  
  // Reasons (always present)
  runner_reason?: string;
  job_reason?: string;
  evolution_reason?: string;
  health_reason?: string;
  health_reason_code?: string;
  
  // Blockers
  blockers: BlockerCode[];
  why_not_trading: string[];
  why_not_promoted: string[];
  
  // Remediation
  is_auto_healable: boolean;
  suggested_actions: string[];
  
  // Timestamps
  last_heartbeat_at?: string | null;
  next_action_at?: string | null;
  promoted_at?: string | null;
  
  // Auto-heal tracking
  auto_heal_attempts?: number;
  is_healing?: boolean;
  
  // Raw context (for debugging)
  _context?: {
    stage: string;
    mode: string;
    has_runner: boolean;
    runner_status?: string;
    active_jobs: number;
    kill_state?: string;
    kill_reason_code?: string;
    kill_until?: string;
  };
}

// =============================================
// INPUT TYPES
// =============================================

export interface BotContext {
  bot_id: string;
  stage: string;
  mode: string;
  is_trading_enabled: boolean;
  health_state?: string;
  health_reason?: string;
  health_score?: number;
  evolution_mode?: string;
  kill_state?: string;
  kill_reason_code?: string;
  kill_until?: string;
  frozen_reason_code?: string;
  frozen_at?: string;
}

export interface InstanceContext {
  id?: string;
  status?: string;
  activity_state?: string;
  last_heartbeat_at?: string | null;
  is_primary_runner?: boolean;
  runner_signature?: string | null;
  restart_count?: number;
  restart_count_hour?: number;
  next_restart_allowed_at?: string | null;
  circuit_breaker_open?: boolean;
  circuit_breaker_until?: string | null;
}

export interface ImprovementContext {
  status?: string;
  why_not_promoted?: Record<string, string>;
  consecutive_failures?: number;
  next_action?: string;
  pause_scope?: 'EVOLUTION_ONLY' | 'ALL' | null;
  paused_by?: 'AUTO' | 'USER' | null;
  next_retry_at?: string | null;
}

// Validate if a pause is legitimate
export function isValidPause(improvement?: ImprovementContext): { valid: boolean; reason: string } {
  if (!improvement) {
    return { valid: false, reason: 'No improvement state' };
  }
  
  if (!['PAUSED', 'FROZEN'].includes(improvement.status || '')) {
    return { valid: true, reason: 'Not paused' };
  }
  
  // Check if explicitly paused by user
  if (improvement.paused_by === 'USER') {
    return { valid: true, reason: 'Paused by user' };
  }
  
  // Check if in valid cooldown
  if (improvement.next_retry_at && new Date(improvement.next_retry_at) > new Date()) {
    const timeLeft = Math.round((new Date(improvement.next_retry_at).getTime() - Date.now()) / 1000);
    return { valid: true, reason: `Cooldown (${timeLeft}s remaining)` };
  }
  
  // INVALID PAUSE
  return { valid: false, reason: 'Invalid pause state - should auto-fix' };
}

export interface JobsSummary {
  backtest_queued: number;
  backtest_running: number;
  evaluate_queued: number;
  evaluate_running: number;
  evolve_queued: number;
  evolve_running: number;
  runner_start_queued: number;
  runner_restart_queued: number;
  priority_compute_queued: number;
  total_queued: number;
  total_running: number;
}

export interface JobsSummary {
  backtest_queued: number;
  backtest_running: number;
  evaluate_queued: number;
  evaluate_running: number;
  evolve_queued: number;
  evolve_running: number;
  runner_start_queued: number;
  runner_restart_queued: number;
  priority_compute_queued: number;
  total_queued: number;
  total_running: number;
}

// =============================================
// CONSTANTS - Import from unified source
// =============================================

import { HEARTBEAT_THRESHOLDS, HEALTH_THRESHOLDS, computeHealthStateFromScore } from './healthConstants';

const HEARTBEAT_STALE_THRESHOLD_MS = HEARTBEAT_THRESHOLDS.STALE_MS;
const HEARTBEAT_WARNING_THRESHOLD_MS = HEARTBEAT_THRESHOLDS.WARNING_MS;

// Stages that require a running runner
const RUNNER_REQUIRED_STAGES = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'];

// Valid stage/mode combinations
const VALID_STAGE_MODES: Record<string, string[]> = {
  TRIALS: ['BACKTEST_ONLY', 'SIM_LIVE'],
  PAPER: ['SIM_LIVE'],
  SHADOW: ['SIM_LIVE', 'SHADOW'],
  CANARY: ['LIVE'],
  LIVE: ['LIVE'],
};

// =============================================
// CORE EVALUATOR
// =============================================

export function evaluateCanonicalState(
  bot: BotContext,
  instance: InstanceContext | null,
  jobs: JobsSummary,
  improvement?: ImprovementContext
): CanonicalBotState {
  const blockers: BlockerCode[] = [];
  const why_not_trading: string[] = [];
  const why_not_promoted: string[] = [];
  const suggested_actions: string[] = [];

  // =============================================
  // 1. RUNNER STATE
  // =============================================
  
  let runner_state: RunnerState = 'NO_RUNNER';
  let runner_reason: string | undefined;
  let heartbeatAge: number | null = null;

  // TRIALS bots should NEVER have runners - if one exists it's a zombie
  const isTrialsBot = bot.stage === 'TRIALS';

  if (instance) {
    heartbeatAge = instance.last_heartbeat_at 
      ? Date.now() - new Date(instance.last_heartbeat_at).getTime()
      : null;
    
    // TRIALS bots with any runner instance should show NO_RUNNER (zombie cleanup pending)
    if (isTrialsBot) {
      runner_state = 'NO_RUNNER';
      runner_reason = 'TRIALS bots do not use runners';
      // Don't process further runner states for TRIALS bots
    } else {
      // Check circuit breaker first
      if (instance.circuit_breaker_open) {
        runner_state = 'CIRCUIT_BREAK';
        runner_reason = `Circuit breaker open until ${instance.circuit_breaker_until}`;
        blockers.push({
          code: 'CIRCUIT_BREAKER_OPEN',
          severity: 'CRITICAL',
          message: 'Too many restarts - circuit breaker engaged',
          suggested_action: 'Wait for cooldown or manually reset',
          auto_healable: false,
          evidence: { until: instance.circuit_breaker_until, restarts: instance.restart_count_hour },
        });
        why_not_trading.push('Circuit breaker open');
      } else if (instance.status === 'paused') {
        // Check if this is a SYSTEM pause (due to failures) vs USER pause
        const healthReason = bot.health_reason || '';
        const isSystemPause = healthReason.includes('CONSECUTIVE_FAILURES') || 
                              healthReason.includes('RUNNER_ERROR') ||
                              (instance as any).consecutive_tick_failures >= 5;
        if (isSystemPause) {
          runner_state = 'CIRCUIT_BREAK';
          runner_reason = 'Auto-paused due to repeated failures';
          blockers.push({
            code: 'RUNNER_AUTO_PAUSED',
            severity: 'CRITICAL',
            message: 'Bot auto-paused after repeated failures',
            suggested_action: 'Check logs and restart manually',
            auto_healable: false,
            evidence: { reason: healthReason },
          });
          why_not_trading.push('Auto-paused (failures)');
        } else {
          runner_state = 'PAUSED';
          runner_reason = 'User paused';
          why_not_trading.push('Runner paused');
        }
      } else if (instance.status === 'error') {
        runner_state = 'ERROR';
        runner_reason = 'Runner in error state';
        blockers.push({
          code: 'RUNNER_ERROR',
          severity: 'CRITICAL',
          message: 'Runner in error state',
          suggested_action: 'Check logs and restart runner',
          auto_healable: true,
        });
        why_not_trading.push('Runner error');
      } else if (instance.status === 'starting') {
        runner_state = 'STARTING';
        runner_reason = 'Starting up';
      } else if (instance.status === 'running') {
        // Check heartbeat freshness
        if (heartbeatAge === null || heartbeatAge > HEARTBEAT_STALE_THRESHOLD_MS) {
          runner_state = 'STALLED';
          runner_reason = heartbeatAge ? `Heartbeat stale (${Math.round(heartbeatAge / 1000)}s)` : 'No heartbeat';
          blockers.push({
            code: 'RUNNER_STALLED',
            severity: 'CRITICAL',
            message: `Runner heartbeat stale (${heartbeatAge ? Math.round(heartbeatAge / 1000) : '?'}s old)`,
            suggested_action: 'Auto-restart queued',
            auto_healable: true,
            evidence: { heartbeat_age_ms: heartbeatAge },
          });
          why_not_trading.push('Runner stalled');
        } else if (heartbeatAge > HEARTBEAT_WARNING_THRESHOLD_MS) {
          runner_state = instance.activity_state === 'TRADING' ? 'TRADING' : 'SCANNING';
          runner_reason = `Heartbeat aging (${Math.round(heartbeatAge / 1000)}s)`;
          blockers.push({
            code: 'RUNNER_HEARTBEAT_WARNING',
            severity: 'WARNING',
            message: `Runner heartbeat aging (${Math.round(heartbeatAge / 1000)}s old)`,
            suggested_action: 'Monitor for stall',
            auto_healable: false,
          });
        } else {
          runner_state = instance.activity_state === 'TRADING' ? 'TRADING' : 'SCANNING';
          runner_reason = 'Active';
        }
      } else if (instance.status === 'stopped') {
        runner_state = 'STOPPED';
        runner_reason = 'Stopped';
      }
    }
  }

  // Override for queued jobs
  if (jobs.runner_start_queued > 0 && runner_state === 'NO_RUNNER') {
    runner_state = 'STARTING';
    runner_reason = 'Start job queued';
  }
  if (jobs.runner_restart_queued > 0 && runner_state === 'STALLED') {
    runner_state = 'RESTARTING';
    runner_reason = 'Restart job queued';
  }

  // =============================================
  // 2. JOB STATE
  // =============================================

  let job_state: JobState = 'IDLE';
  let job_reason: string | undefined;

  if (jobs.backtest_running > 0) {
    job_state = 'BACKTEST_RUNNING';
    job_reason = `${jobs.backtest_running} backtest(s) running`;
  } else if (jobs.evolve_running > 0) {
    job_state = 'EVOLVING';
    job_reason = 'Evolution in progress';
  } else if (jobs.evaluate_running > 0) {
    job_state = 'EVALUATING';
    job_reason = 'Evaluation in progress';
  } else if (jobs.backtest_queued > 0) {
    job_state = 'BACKTEST_QUEUED';
    job_reason = `${jobs.backtest_queued} backtest(s) queued`;
  } else if (jobs.total_queued > 0) {
    job_state = 'QUEUED';
    job_reason = `${jobs.total_queued} job(s) queued`;
  }

  // =============================================
  // 3. EVOLUTION STATE
  // =============================================

  let evolution_state: EvolutionState = 'IDLE';
  let evolution_reason: string | undefined;

  if (jobs.evolve_running > 0) {
    evolution_state = 'EVOLVING';
    evolution_reason = 'Mutation in progress';
  } else if (jobs.evolve_queued > 0) {
    evolution_state = 'MUTATION_PENDING';
    evolution_reason = 'Evolution queued';
  } else if (improvement?.status === 'EVOLVING') {
    evolution_state = 'TOURNAMENT_RUNNING';
    evolution_reason = 'Tournament comparing generations';
  } else if (improvement?.status === 'AWAITING_BACKTEST') {
    evolution_state = 'AWAITING_BACKTEST';
    evolution_reason = 'Waiting for backtest results';
  } else if (improvement?.status === 'COOLDOWN') {
    evolution_state = 'COOLDOWN';
    evolution_reason = 'In cooldown after evolution';
  }

  // =============================================
  // 4. HEALTH STATE - Use unified thresholds
  // =============================================

  const health_score = bot.health_score ?? 100;
  const criticalBlockers = blockers.filter(b => b.severity === 'CRITICAL');
  const warningBlockers = blockers.filter(b => b.severity === 'WARNING');

  // Compute health state using unified function
  let health_state = computeHealthStateFromScore(
    health_score,
    criticalBlockers.length > 0,
    warningBlockers.length > 0
  );
  
  let health_reason: string | undefined;
  if (health_state === 'DEGRADED') {
    health_reason = criticalBlockers[0]?.code || 'Health score critical';
  } else if (health_state === 'WARN') {
    health_reason = warningBlockers[0]?.code || 'Health score warning';
  }

  // Only override with stored DEGRADED if score still critically low (prevents sticky degraded)
  if (bot.health_state === 'DEGRADED' && health_score < HEALTH_THRESHOLDS.DEGRADED) {
    health_state = 'DEGRADED';
    health_reason = bot.health_reason || health_reason;
  }

  // =============================================
  // 5. INVARIANT CHECKS
  // =============================================

  // INVARIANT 1: PAPER+ bots must have primary runner OR be explicitly PAUSED
  if (RUNNER_REQUIRED_STAGES.includes(bot.stage)) {
    if (runner_state === 'NO_RUNNER' && bot.is_trading_enabled) {
      blockers.push({
        code: 'NO_PRIMARY_RUNNER',
        severity: 'CRITICAL',
        message: `${bot.stage} bot requires a primary runner`,
        suggested_action: 'Start runner',
        auto_healable: true,
      });
      suggested_actions.push('START_RUNNER');
      why_not_trading.push('No runner');
    }
  }

  // INVARIANT 2: Mode must match stage
  const validModes = VALID_STAGE_MODES[bot.stage] || [];
  if (!validModes.includes(bot.mode)) {
    blockers.push({
      code: 'MODE_STAGE_MISMATCH',
      severity: 'CRITICAL',
      message: `Mode ${bot.mode} is not valid for stage ${bot.stage}`,
      suggested_action: `Set mode to ${validModes[0] || 'BACKTEST_ONLY'}`,
      auto_healable: true,
    });
    suggested_actions.push('FIX_MODE');
    why_not_trading.push('Invalid mode');
  }

  // INVARIANT 3: TRIALS bot should not have running runner
  if (bot.stage === 'TRIALS' && instance?.status === 'running') {
    blockers.push({
      code: 'TRIALS_RUNNER_ACTIVE',
      severity: 'WARNING',
      message: 'TRIALS bot has active runner (should be stopped)',
      suggested_action: 'Stop runner',
      auto_healable: true,
    });
    suggested_actions.push('STOP_RUNNER');
  }

  // INVARIANT 4: Trading disabled but runner active
  if (!bot.is_trading_enabled && runner_state === 'SCANNING') {
    blockers.push({
      code: 'TRADING_DISABLED_RUNNER_ACTIVE',
      severity: 'WARNING',
      message: 'Trading is disabled but runner is active',
      suggested_action: 'Pause or stop the runner',
      auto_healable: true,
    });
  }

  // =============================================
  // 6. WHY NOT PROMOTED
  // =============================================

  if (improvement?.why_not_promoted) {
    for (const [gate, value] of Object.entries(improvement.why_not_promoted)) {
      why_not_promoted.push(`${gate}: ${value}`);
    }
  }

  if (health_score < 60) {
    why_not_promoted.push('Health score too low');
  }

  if (blockers.some(b => b.severity === 'CRITICAL')) {
    why_not_promoted.push('Critical blockers present');
  }

  // =============================================
  // 7. COMPUTE FINAL STATE
  // =============================================

  const is_auto_healable = blockers.some(b => b.auto_healable);

  return {
    runner_state,
    job_state,
    evolution_state,
    health_state,
    health_score,
    runner_reason,
    job_reason,
    evolution_reason,
    health_reason,
    blockers,
    why_not_trading,
    why_not_promoted,
    is_auto_healable,
    suggested_actions,
    last_heartbeat_at: instance?.last_heartbeat_at,
    next_action_at: instance?.next_restart_allowed_at,
    _context: {
      stage: bot.stage,
      mode: bot.mode,
      has_runner: !!instance,
      runner_status: instance?.status,
      active_jobs: jobs.total_running + jobs.total_queued,
      kill_state: bot.kill_state,
      kill_reason_code: bot.kill_reason_code,
      kill_until: bot.kill_until,
    },
  };
}

// =============================================
// AUTO-HEAL ACTIONS
// =============================================

export interface AutoHealAction {
  action: string;
  job_type?: string;
  payload?: Record<string, unknown>;
  db_update?: {
    table: string;
    id: string;
    updates: Record<string, unknown>;
  };
}

export function getAutoHealActions(
  bot: BotContext,
  instance: InstanceContext | null,
  state: CanonicalBotState
): AutoHealAction[] {
  const actions: AutoHealAction[] = [];

  for (const blocker of state.blockers) {
    if (!blocker.auto_healable) continue;

    switch (blocker.code) {
      case 'RUNNER_STALLED':
        // Check backoff
        if (instance?.next_restart_allowed_at) {
          const nextAllowed = new Date(instance.next_restart_allowed_at).getTime();
          if (Date.now() < nextAllowed) continue; // Still in cooldown
        }
        actions.push({
          action: 'QUEUE_RUNNER_RESTART',
          job_type: 'RUNNER_RESTART',
          payload: { bot_id: bot.bot_id, reason: 'STALE_HEARTBEAT' },
        });
        break;

      case 'NO_PRIMARY_RUNNER':
        actions.push({
          action: 'QUEUE_RUNNER_START',
          job_type: 'RUNNER_START',
          payload: { bot_id: bot.bot_id, reason: 'NO_RUNNER' },
        });
        break;

      case 'MODE_STAGE_MISMATCH':
        const validModes = VALID_STAGE_MODES[bot.stage] || ['BACKTEST_ONLY'];
        actions.push({
          action: 'FIX_MODE',
          db_update: {
            table: 'bots',
            id: bot.bot_id,
            updates: { mode: validModes[0] },
          },
        });
        break;

      case 'TRIALS_RUNNER_ACTIVE':
        actions.push({
          action: 'STOP_RUNNER',
          db_update: {
            table: 'bot_instances',
            id: instance?.id || '',
            updates: { status: 'stopped', activity_state: 'STOPPED' },
          },
        });
        break;

      case 'RUNNER_ERROR':
        actions.push({
          action: 'QUEUE_RUNNER_RESTART',
          job_type: 'RUNNER_RESTART',
          payload: { bot_id: bot.bot_id, reason: 'ERROR_STATE' },
        });
        break;
    }
  }

  return actions;
}

// =============================================
// RESTART BACKOFF CALCULATOR
// =============================================

export function calculateRestartBackoff(restartCount: number): {
  delay_ms: number;
  next_allowed_at: Date;
} {
  // Exponential backoff: 30s, 1m, 2m, 4m, 8m, max 15m
  const baseDelay = 30_000;
  const maxDelay = 15 * 60_000;
  
  const delay_ms = Math.min(baseDelay * Math.pow(2, restartCount), maxDelay);
  const jitter = delay_ms * (0.8 + Math.random() * 0.4);
  
  return {
    delay_ms: Math.round(jitter),
    next_allowed_at: new Date(Date.now() + jitter),
  };
}
