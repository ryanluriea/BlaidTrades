/**
 * EVENT EMITTER - NO SILENT STATE CHANGES
 * 
 * Every state mutation MUST go through this emitter.
 * NOTE: Currently a no-op since Supabase is not connected.
 * Events are logged to console for debugging.
 */

import { createTransitionEvent } from './fsm';

// =============================================
// EVENT TYPES
// =============================================

export type SystemEventType =
  // Job events
  | 'JOB_QUEUED'
  | 'JOB_STARTED'
  | 'JOB_FINISHED'
  | 'JOB_FAILED'
  | 'JOB_DEAD_LETTERED'
  // Runner events
  | 'RUNNER_STARTED'
  | 'RUNNER_HEARTBEAT'
  | 'RUNNER_STALLED'
  | 'RUNNER_RESTARTED'
  | 'RUNNER_STOPPED'
  | 'RUNNER_CIRCUIT_BREAK'
  // Lifecycle events
  | 'PROMOTED'
  | 'DEMOTED'
  | 'FROZEN'
  | 'UNFROZEN'
  | 'PAUSED'
  | 'RESUMED'
  // Provider events
  | 'PROVIDER_CIRCUIT_OPEN'
  | 'PROVIDER_CIRCUIT_CLOSED'
  | 'PROVIDER_RATE_LIMITED'
  // Evolution events
  | 'EVOLUTION_STARTED'
  | 'EVOLUTION_COMPLETED'
  | 'EVOLUTION_FAILED'
  | 'MUTATION_APPLIED'
  | 'TOURNAMENT_COMPLETED'
  // Health events
  | 'HEALTH_DEGRADED'
  | 'HEALTH_RECOVERED'
  // System events
  | 'AUDIT_STARTED'
  | 'AUDIT_COMPLETED'
  | 'CHAOS_TEST_STARTED'
  | 'CHAOS_TEST_COMPLETED';

// DB uses lowercase severity
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface SystemEventPayload {
  event_type: SystemEventType;
  severity: EventSeverity;
  title: string;
  message?: string;
  bot_id?: string;
  job_id?: string;
  account_id?: string;
  metadata?: Record<string, unknown>;
}

// =============================================
// EVENT EMITTER (no-op, logs to console)
// =============================================

export async function emitSystemEvent(payload: SystemEventPayload): Promise<{ success: boolean; event_id?: string; error?: string }> {
  console.log('[EventEmitter] Event (no-op):', payload.event_type, payload.title);
  return { success: true, event_id: `local-${Date.now()}` };
}

// =============================================
// STATE TRANSITION HELPERS
// =============================================

export async function emitStateTransition(
  domain: 'BOT' | 'JOB' | 'RUNNER' | 'IMPROVEMENT',
  entityId: string,
  from: string,
  to: string,
  reason?: string,
  evidence?: Record<string, unknown>
): Promise<{ success: boolean; event_id?: string }> {
  const transition = createTransitionEvent(domain, from, to, reason, evidence);
  console.log('[EventEmitter] State transition:', domain, from, '->', to, reason);
  return { success: true, event_id: `local-${Date.now()}` };
}

// =============================================
// CONVENIENCE EMITTERS
// =============================================

export async function emitJobEvent(
  jobId: string,
  botId: string,
  eventType: 'JOB_QUEUED' | 'JOB_STARTED' | 'JOB_FINISHED' | 'JOB_FAILED' | 'JOB_DEAD_LETTERED',
  jobType: string,
  details?: Record<string, unknown>
): Promise<void> {
  console.log('[EventEmitter] Job event:', eventType, jobType, jobId);
}

export async function emitRunnerEvent(
  botId: string,
  instanceId: string,
  eventType: 'RUNNER_STARTED' | 'RUNNER_HEARTBEAT' | 'RUNNER_STALLED' | 'RUNNER_RESTARTED' | 'RUNNER_STOPPED' | 'RUNNER_CIRCUIT_BREAK',
  details?: Record<string, unknown>
): Promise<void> {
  console.log('[EventEmitter] Runner event:', eventType, botId, instanceId);
}

export async function emitPromotionEvent(
  botId: string,
  fromStage: string,
  toStage: string,
  evidence?: Record<string, unknown>
): Promise<void> {
  console.log('[EventEmitter] Promotion event:', fromStage, '->', toStage, botId);
}

export async function emitHealthEvent(
  botId: string,
  healthState: 'OK' | 'WARN' | 'DEGRADED',
  previousState: string,
  reason?: string
): Promise<void> {
  console.log('[EventEmitter] Health event:', previousState, '->', healthState, botId, reason);
}

// =============================================
// BATCH EVENT EMITTER (no-op)
// =============================================

export async function emitSystemEvents(payloads: SystemEventPayload[]): Promise<{ success: boolean; count: number }> {
  console.log('[EventEmitter] Batch events (no-op):', payloads.length);
  return { success: true, count: payloads.length };
}
