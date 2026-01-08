/**
 * FINITE STATE MACHINES - INSTITUTIONAL HARDENING
 * 
 * Enforces strict state transitions. No impossible states.
 * Every transition produces an event.
 */

// =============================================
// BOT LIFECYCLE FSM
// =============================================

export type BotLifecycleState = 
  | 'TRIALS'
  | 'PAPER'
  | 'SHADOW'
  | 'CANARY'
  | 'LIVE'
  | 'QUARANTINED'
  | 'FROZEN'
  | 'USER_PAUSED';

// CANONICAL STAGE ORDER: TRIALS → PAPER → SHADOW → CANARY → LIVE
// Forward promotion: ONE STEP ONLY (no skipping)
// Demotion: Can go back any number of steps
// CRITICAL: TRIALS → SHADOW is NEVER valid (must go through PAPER first)
const BOT_LIFECYCLE_TRANSITIONS: Record<BotLifecycleState, BotLifecycleState[]> = {
  TRIALS: ['PAPER', 'FROZEN', 'USER_PAUSED'],  // TRIALS can only promote to PAPER
  PAPER: ['TRIALS', 'SHADOW', 'FROZEN', 'USER_PAUSED', 'QUARANTINED'],  // PAPER → SHADOW or demote to TRIALS
  SHADOW: ['TRIALS', 'PAPER', 'CANARY', 'FROZEN', 'USER_PAUSED', 'QUARANTINED'],  // SHADOW → CANARY or demote
  CANARY: ['TRIALS', 'PAPER', 'SHADOW', 'LIVE', 'FROZEN', 'USER_PAUSED', 'QUARANTINED'],  // CANARY → LIVE or demote
  LIVE: ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'FROZEN', 'USER_PAUSED', 'QUARANTINED'],  // LIVE can only demote
  QUARANTINED: ['TRIALS', 'PAPER', 'FROZEN'],
  FROZEN: ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE'],
  USER_PAUSED: ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE'],
};

export function canTransitionBotLifecycle(from: BotLifecycleState, to: BotLifecycleState): boolean {
  return BOT_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateBotLifecycleTransition(from: BotLifecycleState, to: BotLifecycleState): { valid: boolean; reason?: string } {
  if (from === to) return { valid: true };
  if (!canTransitionBotLifecycle(from, to)) {
    return { valid: false, reason: `Cannot transition from ${from} to ${to}` };
  }
  return { valid: true };
}

// =============================================
// JOB FSM
// =============================================

export type JobState = 
  | 'QUEUED'
  | 'DISPATCHED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTERED'
  | 'CANCELLED';

const JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  QUEUED: ['DISPATCHED', 'CANCELLED', 'DEAD_LETTERED'],
  DISPATCHED: ['RUNNING', 'QUEUED', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'DEAD_LETTERED'],
  COMPLETED: [], // Terminal
  FAILED: ['QUEUED', 'DEAD_LETTERED'], // Can retry
  DEAD_LETTERED: [], // Terminal
  CANCELLED: [], // Terminal
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateJobTransition(from: JobState, to: JobState): { valid: boolean; reason?: string } {
  if (from === to) return { valid: true };
  if (!canTransitionJob(from, to)) {
    return { valid: false, reason: `Cannot transition job from ${from} to ${to}` };
  }
  return { valid: true };
}

// =============================================
// RUNNER FSM
// =============================================

export type RunnerFSMState = 
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STALLED'
  | 'RESTARTING'
  | 'CIRCUIT_BREAK'
  | 'ERROR';

const RUNNER_TRANSITIONS: Record<RunnerFSMState, RunnerFSMState[]> = {
  STOPPED: ['STARTING'],
  STARTING: ['RUNNING', 'ERROR', 'STOPPED'],
  RUNNING: ['STALLED', 'STOPPED', 'ERROR'],
  STALLED: ['RESTARTING', 'STOPPED', 'CIRCUIT_BREAK'],
  RESTARTING: ['RUNNING', 'ERROR', 'CIRCUIT_BREAK', 'STOPPED'],
  CIRCUIT_BREAK: ['STOPPED', 'STARTING'], // After cooldown
  ERROR: ['STOPPED', 'RESTARTING'],
};

export function canTransitionRunner(from: RunnerFSMState, to: RunnerFSMState): boolean {
  return RUNNER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRunnerTransition(from: RunnerFSMState, to: RunnerFSMState): { valid: boolean; reason?: string } {
  if (from === to) return { valid: true };
  if (!canTransitionRunner(from, to)) {
    return { valid: false, reason: `Cannot transition runner from ${from} to ${to}` };
  }
  return { valid: true };
}

// =============================================
// IMPROVEMENT STATE FSM
// =============================================

export type ImprovementState = 
  | 'IDLE'
  | 'IMPROVING'
  | 'EVOLVING'
  | 'AWAITING_BACKTEST'
  | 'TOURNAMENT'
  | 'COOLDOWN'
  | 'PAUSED'
  | 'FROZEN'
  | 'EXHAUSTED';

const IMPROVEMENT_TRANSITIONS: Record<ImprovementState, ImprovementState[]> = {
  IDLE: ['IMPROVING', 'PAUSED', 'FROZEN'],
  IMPROVING: ['EVOLVING', 'IDLE', 'PAUSED', 'FROZEN', 'EXHAUSTED'],
  EVOLVING: ['AWAITING_BACKTEST', 'IMPROVING', 'PAUSED', 'FROZEN'],
  AWAITING_BACKTEST: ['TOURNAMENT', 'IMPROVING', 'PAUSED', 'FROZEN'],
  TOURNAMENT: ['COOLDOWN', 'IMPROVING', 'PAUSED', 'FROZEN'],
  COOLDOWN: ['IMPROVING', 'IDLE', 'PAUSED', 'FROZEN'],
  PAUSED: ['IDLE', 'IMPROVING', 'FROZEN'],
  FROZEN: ['IDLE', 'PAUSED'],
  EXHAUSTED: ['IDLE', 'FROZEN'],
};

export function canTransitionImprovement(from: ImprovementState, to: ImprovementState): boolean {
  return IMPROVEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================
// INVARIANT VALIDATORS
// =============================================

export interface BotInvariantContext {
  stage: string;
  mode: string;
  is_trading_enabled: boolean;
  has_runner: boolean;
  runner_status?: string;
  health_state?: string;
  improvement_status?: string;
}

export interface InvariantViolation {
  code: string;
  message: string;
  severity: 'CRITICAL' | 'WARNING';
  auto_fixable: boolean;
  fix_action?: string;
}

export function checkBotInvariants(ctx: BotInvariantContext): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // INVARIANT 1: TRIALS bots cannot be TRADING (mode restrictions)
  if (ctx.stage === 'TRIALS' && ctx.mode === 'LIVE') {
    violations.push({
      code: 'TRIALS_INVALID_MODE',
      message: 'TRIALS bots cannot be in LIVE mode',
      severity: 'CRITICAL',
      auto_fixable: true,
      fix_action: 'SET_MODE_BACKTEST_ONLY',
    });
  }

  // INVARIANT 2: PAPER/SHADOW/LIVE require runner if trading enabled
  if (['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(ctx.stage) && ctx.is_trading_enabled && !ctx.has_runner) {
    violations.push({
      code: 'RUNNER_REQUIRED',
      message: `${ctx.stage} bots require a running runner when trading is enabled`,
      severity: 'CRITICAL',
      auto_fixable: true,
      fix_action: 'START_RUNNER',
    });
  }

  // INVARIANT 3: LIVE mode only on LIVE stage
  if (ctx.mode === 'LIVE' && !['CANARY', 'LIVE'].includes(ctx.stage)) {
    violations.push({
      code: 'MODE_STAGE_MISMATCH',
      message: 'LIVE mode only valid for CANARY/LIVE stages',
      severity: 'CRITICAL',
      auto_fixable: true,
      fix_action: 'RECONCILE_MODE',
    });
  }

  // INVARIANT 4: FROZEN health should have runner stopped or paused
  if (ctx.health_state === 'DEGRADED' && ctx.runner_status === 'running' && ctx.is_trading_enabled) {
    violations.push({
      code: 'DEGRADED_SHOULD_PAUSE',
      message: 'DEGRADED bots should have trading disabled',
      severity: 'WARNING',
      auto_fixable: true,
      fix_action: 'DISABLE_TRADING',
    });
  }

  // INVARIANT 5: Improvement PAUSED without valid reason
  if (ctx.improvement_status === 'PAUSED' && !ctx.has_runner && ctx.stage !== 'TRIALS') {
    // This might be fine for TRIALS, but PAPER+ should have reason
    violations.push({
      code: 'ORPHAN_PAUSE',
      message: 'Bot is PAUSED but may need auto-resume',
      severity: 'WARNING',
      auto_fixable: true,
      fix_action: 'CHECK_PAUSE_VALIDITY',
    });
  }

  return violations;
}

// =============================================
// FSM TRANSITION HELPER
// =============================================

export interface TransitionResult {
  success: boolean;
  from_state: string;
  to_state: string;
  event_type: string;
  reason?: string;
  evidence?: Record<string, unknown>;
}

export function createTransitionEvent(
  domain: 'BOT' | 'JOB' | 'RUNNER' | 'IMPROVEMENT',
  from: string,
  to: string,
  reason?: string,
  evidence?: Record<string, unknown>
): TransitionResult & { event_type: string } {
  const eventMap: Record<string, Record<string, string>> = {
    BOT: {
      'TRIALS→PAPER': 'PROMOTED',
      'PAPER→SHADOW': 'PROMOTED',
      'SHADOW→CANARY': 'PROMOTED',
      'CANARY→LIVE': 'PROMOTED',
      'LIVE→SHADOW': 'DEMOTED',
      'SHADOW→PAPER': 'DEMOTED',
      'PAPER→TRIALS': 'DEMOTED',
      '*→FROZEN': 'FROZEN',
      '*→USER_PAUSED': 'PAUSED',
      'USER_PAUSED→*': 'RESUMED',
      'FROZEN→*': 'UNFROZEN',
    },
    JOB: {
      'QUEUED→RUNNING': 'JOB_STARTED',
      'RUNNING→COMPLETED': 'JOB_FINISHED',
      'RUNNING→FAILED': 'JOB_FAILED',
      '*→DEAD_LETTERED': 'JOB_DEAD_LETTERED',
    },
    RUNNER: {
      'STOPPED→STARTING': 'RUNNER_STARTED',
      'STARTING→RUNNING': 'RUNNER_RUNNING',
      'RUNNING→STALLED': 'RUNNER_STALLED',
      'STALLED→RESTARTING': 'RUNNER_RESTARTING',
      '*→CIRCUIT_BREAK': 'RUNNER_CIRCUIT_BREAK',
    },
    IMPROVEMENT: {
      'IDLE→IMPROVING': 'EVOLUTION_STARTED',
      'IMPROVING→COOLDOWN': 'EVOLUTION_COMPLETED',
      '*→PAUSED': 'EVOLUTION_PAUSED',
      '*→EXHAUSTED': 'EVOLUTION_EXHAUSTED',
    },
  };

  const transitionKey = `${from}→${to}`;
  const wildcardTo = `*→${to}`;
  const wildcardFrom = `${from}→*`;
  
  const domainEvents = eventMap[domain] || {};
  const event_type = domainEvents[transitionKey] || domainEvents[wildcardTo] || domainEvents[wildcardFrom] || `${domain}_STATE_CHANGED`;

  return {
    success: true,
    from_state: from,
    to_state: to,
    event_type,
    reason,
    evidence,
  };
}
