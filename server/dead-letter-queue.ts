/**
 * Dead Letter Queue (DLQ)
 * 
 * Industry-standard pattern for handling failed jobs that have
 * exceeded maximum retry attempts. Jobs in the DLQ require
 * manual review before being retried or discarded.
 * 
 * Features:
 * - Automatic routing after max retries exceeded
 * - Manual review workflow
 * - Retry with reset or discard options
 * - Full audit trail
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";

export interface DeadLetterEntry {
  id: string;
  originalJobId: string;
  jobType: string;
  botId: string;
  botName?: string;
  payload: Record<string, any>;
  failureReason: string;
  failureCount: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  status: "PENDING_REVIEW" | "RETRY_SCHEDULED" | "DISCARDED" | "RESOLVED";
  reviewedBy?: string;
  reviewedAt?: Date;
  resolution?: string;
  createdAt: Date;
}

export async function routeToDLQ(
  jobId: string,
  jobType: string,
  botId: string,
  payload: Record<string, any>,
  failureReason: string,
  failureCount: number
): Promise<string> {
  const traceId = `dlq-${Date.now().toString(36)}`;
  
  try {
    const result = await db.execute(sql`
      INSERT INTO dead_letter_queue (
        id,
        original_job_id,
        job_type,
        bot_id,
        payload,
        failure_reason,
        failure_count,
        first_failure_at,
        last_failure_at,
        status,
        created_at
      ) VALUES (
        gen_random_uuid(),
        ${jobId},
        ${jobType},
        ${botId},
        ${JSON.stringify(payload)}::jsonb,
        ${failureReason},
        ${failureCount},
        NOW(),
        NOW(),
        'PENDING_REVIEW',
        NOW()
      )
      ON CONFLICT (original_job_id) DO UPDATE SET
        failure_count = dead_letter_queue.failure_count + 1,
        last_failure_at = NOW(),
        failure_reason = ${failureReason}
      RETURNING id
    `);

    const dlqId = (result.rows[0] as any)?.id || jobId;

    console.log(`[DLQ] trace_id=${traceId} Routed job=${jobId} type=${jobType} bot=${botId} failures=${failureCount}`);

    await logActivityEvent({
      eventType: "SYSTEM_AUDIT",
      severity: "WARN",
      title: `Job routed to Dead Letter Queue`,
      traceId,
      payload: {
        dlqId,
        jobId,
        jobType,
        botId,
        failureReason,
        failureCount,
      },
    });

    return dlqId;
  } catch (error) {
    console.error(`[DLQ] trace_id=${traceId} Error routing job:`, error);
    throw error;
  }
}

export async function getDLQEntries(
  status?: DeadLetterEntry["status"],
  limit: number = 50
): Promise<DeadLetterEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT 
        dlq.*,
        b.name as bot_name
      FROM dead_letter_queue dlq
      LEFT JOIN bots b ON dlq.bot_id = b.id
      WHERE ${status ? sql`dlq.status = ${status}` : sql`1=1`}
      ORDER BY dlq.created_at DESC
      LIMIT ${limit}
    `);

    return result.rows.map((row: any) => ({
      id: row.id,
      originalJobId: row.original_job_id,
      jobType: row.job_type,
      botId: row.bot_id,
      botName: row.bot_name,
      payload: row.payload,
      failureReason: row.failure_reason,
      failureCount: row.failure_count,
      firstFailureAt: new Date(row.first_failure_at),
      lastFailureAt: new Date(row.last_failure_at),
      status: row.status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      resolution: row.resolution,
      createdAt: new Date(row.created_at),
    }));
  } catch (error) {
    console.error("[DLQ] Error fetching entries:", error);
    return [];
  }
}

export async function retryDLQEntry(
  dlqId: string,
  reviewedBy: string
): Promise<{ success: boolean; newJobId?: string; error?: string }> {
  const traceId = `dlq-retry-${Date.now().toString(36)}`;
  
  try {
    const entryResult = await db.execute(sql`
      SELECT * FROM dead_letter_queue 
      WHERE id = ${dlqId}
      FOR UPDATE
    `);

    if (entryResult.rows.length === 0) {
      return { success: false, error: "DLQ entry not found" };
    }

    const entry = entryResult.rows[0] as any;

    if (entry.status !== "PENDING_REVIEW") {
      return { 
        success: false, 
        error: `Cannot retry entry with status ${entry.status}. Only PENDING_REVIEW entries can be retried.` 
      };
    }

    const jobResult = await db.execute(sql`
      INSERT INTO bot_jobs (
        id,
        bot_id,
        job_type,
        status,
        priority,
        created_at,
        metadata
      ) VALUES (
        gen_random_uuid(),
        ${entry.bot_id},
        ${entry.job_type},
        'PENDING',
        5,
        NOW(),
        ${JSON.stringify({ ...entry.payload, dlq_retry: true, dlq_id: dlqId })}::jsonb
      )
      RETURNING id
    `);

    const newJobId = (jobResult.rows[0] as any)?.id;

    await db.execute(sql`
      UPDATE dead_letter_queue
      SET 
        status = 'RETRY_SCHEDULED',
        reviewed_by = ${reviewedBy},
        reviewed_at = NOW(),
        resolution = ${'Retried as job ' + newJobId}
      WHERE id = ${dlqId}
    `);

    console.log(`[DLQ] trace_id=${traceId} Retried dlq=${dlqId} as job=${newJobId} by=${reviewedBy}`);

    return { success: true, newJobId };
  } catch (error) {
    console.error(`[DLQ] trace_id=${traceId} Error retrying:`, error);
    return { success: false, error: String(error) };
  }
}

export async function discardDLQEntry(
  dlqId: string,
  reviewedBy: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const traceId = `dlq-discard-${Date.now().toString(36)}`;
  
  try {
    const result = await db.execute(sql`
      UPDATE dead_letter_queue
      SET 
        status = 'DISCARDED',
        reviewed_by = ${reviewedBy},
        reviewed_at = NOW(),
        resolution = ${reason}
      WHERE id = ${dlqId}
        AND status = 'PENDING_REVIEW'
    `);

    if ((result as any).rowCount === 0) {
      return { 
        success: false, 
        error: "DLQ entry not found or already processed" 
      };
    }

    console.log(`[DLQ] trace_id=${traceId} Discarded dlq=${dlqId} by=${reviewedBy} reason=${reason}`);

    return { success: true };
  } catch (error) {
    console.error(`[DLQ] trace_id=${traceId} Error discarding:`, error);
    return { success: false, error: String(error) };
  }
}

export async function getDLQStats(): Promise<{
  pending: number;
  pendingReview: number;
  retryScheduled: number;
  discarded: number;
  resolved: number;
  oldestPending?: Date;
}> {
  try {
    const result = await db.execute(sql`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest
      FROM dead_letter_queue
      GROUP BY status
    `);

    const stats = {
      pending: 0,
      pendingReview: 0,
      retryScheduled: 0,
      discarded: 0,
      resolved: 0,
      oldestPending: undefined as Date | undefined,
    };

    for (const row of result.rows as any[]) {
      switch (row.status) {
        case "PENDING_REVIEW":
          stats.pendingReview = parseInt(row.count);
          stats.pending = parseInt(row.count);
          stats.oldestPending = row.oldest ? new Date(row.oldest) : undefined;
          break;
        case "RETRY_SCHEDULED":
          stats.retryScheduled = parseInt(row.count);
          break;
        case "DISCARDED":
          stats.discarded = parseInt(row.count);
          break;
        case "RESOLVED":
          stats.resolved = parseInt(row.count);
          break;
      }
    }

    return stats;
  } catch (error) {
    console.error("[DLQ] Error getting stats:", error);
    return { pending: 0, pendingReview: 0, retryScheduled: 0, discarded: 0, resolved: 0 };
  }
}

export async function cleanupOldDiscarded(olderThanDays: number = 30): Promise<number> {
  const traceId = `dlq-cleanup-${Date.now().toString(36)}`;
  
  try {
    const result = await db.execute(sql`
      DELETE FROM dead_letter_queue
      WHERE status = 'DISCARDED'
        AND reviewed_at < NOW() - INTERVAL '${olderThanDays} days'
      RETURNING id
    `);

    const deleted = result.rows.length;
    
    if (deleted > 0) {
      console.log(`[DLQ] trace_id=${traceId} Cleaned up ${deleted} old discarded entries`);
    }

    return deleted;
  } catch (error) {
    console.error(`[DLQ] trace_id=${traceId} Error cleaning up:`, error);
    return 0;
  }
}
