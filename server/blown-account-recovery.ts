import { randomUUID } from "node:crypto";
import { db, withTransaction } from "./db";
import { sql } from "drizzle-orm";
import { logActivityEvent, logBotDemotion } from "./activity-logger";
import type { AccountAttempt, Account, Bot } from "@shared/schema";

const CONSECUTIVE_BLOWN_THRESHOLD = 3;

export interface BlownRecoveryResult {
  action: "IMPROVE_IN_PAPER" | "DEMOTE_TO_TRIALS";
  botId: string;
  botName: string;
  consecutiveBlownCount: number;
  reason: string;
  traceId: string;
}

export interface BlownRecoveryContext {
  accountId: string;
  consecutiveBlownCount: number;
  attempt: AccountAttempt;
  account: Account;
}

async function getBotsForAccount(accountId: string): Promise<Array<{ id: string; name: string; stage: string; userId: string }>> {
  // Use UNION of all possible bot-account relationship sources:
  // 1. bot_instances - the actual runner assignments (primary source)
  // 2. bot_account_pnl - the P&L rollup table (has historical data)
  // 3. bot_accounts - the legacy assignment table (may be empty)
  const result = await db.execute(sql`
    SELECT DISTINCT b.id, b.name, b.stage, b.user_id as "userId"
    FROM bots b
    WHERE b.archived_at IS NULL
      AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
      AND (
        -- Check bot_instances (active runner assignments)
        EXISTS (
          SELECT 1 FROM bot_instances bi 
          WHERE bi.bot_id = b.id AND bi.account_id = ${accountId}::uuid
        )
        -- Check bot_account_pnl (has P&L data for this account)
        OR EXISTS (
          SELECT 1 FROM bot_account_pnl bap 
          WHERE bap.bot_id = b.id AND bap.account_id = ${accountId}::uuid
        )
        -- Check bot_accounts (legacy assignment table)
        OR EXISTS (
          SELECT 1 FROM bot_accounts ba 
          WHERE ba.bot_id = b.id AND ba.account_id = ${accountId}::uuid
        )
      )
  `);
  return result.rows as any[];
}

async function demoteBotToLab(bot: { id: string; name: string; stage: string; userId: string }, reason: string, traceId: string): Promise<void> {
  const fromStage = bot.stage;
  
  try {
    await withTransaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bots SET 
          stage = 'TRIALS', 
          stage_updated_at = NOW(), 
          stage_reason_code = 'BLOWN_ACCOUNT_DEMOTION',
          stage_lock_reason = 'Demoted due to consecutive blown accounts'
        WHERE id = ${bot.id}::uuid
      `);
      
      await tx.execute(sql`
        INSERT INTO bot_stage_events (bot_id, from_stage, to_stage, reason_code, actor, metadata)
        VALUES (
          ${bot.id}::uuid, 
          ${fromStage}, 
          'TRIALS', 
          'BLOWN_ACCOUNT_DEMOTION', 
          'ai_recovery', 
          ${JSON.stringify({ 
            reason,
            traceId,
            automated: true,
            recoveryType: 'BLOWN_ACCOUNT'
          })}::jsonb
        )
      `);
    });
    
    await logBotDemotion(
      bot.userId,
      bot.id,
      bot.name,
      fromStage,
      'TRIALS',
      reason,
      traceId
    );
    
    console.log(`[AI_RECOVERY] Demoted bot ${bot.name} (${bot.id}) from ${fromStage} to TRIALS: ${reason}`);
  } catch (error) {
    console.error(`[AI_RECOVERY] Failed to demote bot ${bot.name} (${bot.id}) to TRIALS:`, error);
  }
}

async function queueImprovementForBot(bot: { id: string; name: string; stage: string; userId: string }, reason: string, traceId: string): Promise<void> {
  try {
    const existingJobs = await db.execute(sql`
      SELECT id FROM bot_jobs 
      WHERE bot_id = ${bot.id}::uuid 
        AND job_type = 'IMPROVING' 
        AND status IN ('QUEUED', 'PENDING', 'RUNNING')
      LIMIT 1
    `);
    
    if (existingJobs.rows.length > 0) {
      console.log(`[AI_RECOVERY] Bot ${bot.name} (${bot.id}) already has an IMPROVING job in progress, skipping`);
      return;
    }
    
    // Late import to avoid circular dependency with storage.ts
    const { storage } = await import("./storage");
    
    await storage.createBotJob({
      botId: bot.id,
      userId: bot.userId,
      jobType: 'IMPROVING',
      status: 'QUEUED',
      priority: 1,
      payload: {
        reason,
        traceId,
        trigger: 'BLOWN_ACCOUNT_RECOVERY',
        automated: true
      },
    });
    
    await logActivityEvent({
      userId: bot.userId,
      botId: bot.id,
      eventType: "BACKTEST_STARTED",
      severity: "INFO",
      title: `AI Recovery: Improvement queued for ${bot.name}`,
      summary: `Bot strategy will be improved after blown account recovery`,
      payload: {
        reason,
        traceId,
        recoveryType: 'BLOWN_ACCOUNT',
        action: 'IMPROVE_IN_PAPER'
      },
      traceId,
      stage: bot.stage,
    });
    
    console.log(`[AI_RECOVERY] Queued improvement job for bot ${bot.name} (${bot.id}): ${reason}`);
  } catch (error) {
    console.error(`[AI_RECOVERY] Failed to queue improvement job for bot ${bot.name} (${bot.id}):`, error);
  }
}

export async function processBlownAccountRecovery(context: BlownRecoveryContext): Promise<BlownRecoveryResult[]> {
  const { accountId, consecutiveBlownCount, attempt, account } = context;
  const traceId = randomUUID();
  const results: BlownRecoveryResult[] = [];
  
  console.log(`[AI_RECOVERY] trace_id=${traceId} Processing blown account recovery for ${accountId}, consecutiveBlownCount=${consecutiveBlownCount}`);
  
  const bots = await getBotsForAccount(accountId);
  
  if (bots.length === 0) {
    console.warn(`[AI_RECOVERY] trace_id=${traceId} WARNING: No active bots found for blown account ${accountId} (${account.name}). This may indicate a configuration issue - check bot_accounts table.`);
    
    await logActivityEvent({
      accountId,
      eventType: "SELF_HEALING_SKIPPED",
      severity: "WARN",
      title: `AI Recovery: No bots found for blown account`,
      summary: `Account "${account.name}" was blown but no bots are assigned to it. Manual investigation required.`,
      payload: {
        accountId,
        accountName: account.name,
        consecutiveBlownCount,
        attemptId: attempt.id,
        issue: 'NO_BOTS_FOUND',
      },
      traceId,
    });
    
    return results;
  }
  
  for (const bot of bots) {
    let action: "IMPROVE_IN_PAPER" | "DEMOTE_TO_LAB";
    let reason: string;
    
    if (consecutiveBlownCount >= CONSECUTIVE_BLOWN_THRESHOLD) {
      action = "DEMOTE_TO_LAB";
      reason = `Account blown ${consecutiveBlownCount} consecutive times (threshold: ${CONSECUTIVE_BLOWN_THRESHOLD}). Strategy requires fundamental rework in LAB.`;
      
      await demoteBotToLab(bot, reason, traceId);
    } else {
      action = "IMPROVE_IN_PAPER";
      reason = `Account blown ${consecutiveBlownCount} time(s). Attempting strategy improvement before next PAPER run. ${CONSECUTIVE_BLOWN_THRESHOLD - consecutiveBlownCount} attempt(s) remaining before LAB demotion.`;
      
      await queueImprovementForBot(bot, reason, traceId);
    }
    
    results.push({
      action,
      botId: bot.id,
      botName: bot.name,
      consecutiveBlownCount,
      reason,
      traceId
    });
  }
  
  await logActivityEvent({
    accountId,
    eventType: consecutiveBlownCount >= CONSECUTIVE_BLOWN_THRESHOLD ? "SELF_HEALING_DEMOTION" : "SELF_HEALING_RECOVERY",
    severity: consecutiveBlownCount >= CONSECUTIVE_BLOWN_THRESHOLD ? "WARN" : "INFO",
    title: `AI Recovery: ${results.length} bot(s) processed after blown account`,
    summary: consecutiveBlownCount >= CONSECUTIVE_BLOWN_THRESHOLD 
      ? `Account blown ${consecutiveBlownCount}x - bots demoted to LAB for fundamental strategy rework`
      : `Account blown ${consecutiveBlownCount}x - bots queued for improvement (${CONSECUTIVE_BLOWN_THRESHOLD - consecutiveBlownCount} attempts left)`,
    payload: {
      accountId,
      accountName: account.name,
      consecutiveBlownCount,
      threshold: CONSECUTIVE_BLOWN_THRESHOLD,
      attemptId: attempt.id,
      results: results.map(r => ({ action: r.action, botId: r.botId, botName: r.botName })),
      metricsSnapshot: attempt.metricsSnapshot,
    },
    traceId,
  });
  
  console.log(`[AI_RECOVERY] trace_id=${traceId} Completed recovery for ${results.length} bots: ${results.map(r => `${r.botName}=${r.action}`).join(', ')}`);
  
  return results;
}
