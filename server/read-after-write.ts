/**
 * Read-After-Write Verification
 * 
 * Industry-standard pattern for critical operations to verify
 * that writes have been successfully persisted before acknowledging.
 * 
 * Prevents silent failures and ensures data consistency.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";

export interface VerificationResult {
  success: boolean;
  verified: boolean;
  error?: string;
  retryCount?: number;
}

const MAX_VERIFY_RETRIES = 3;
const VERIFY_DELAY_MS = 50;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function verifyStageTransition(
  botId: string,
  expectedStage: string
): Promise<VerificationResult> {
  const traceId = `raw-stage-${Date.now().toString(36)}`;
  
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    try {
      const result = await db.execute(sql`
        SELECT stage FROM bots WHERE id = ${botId}
      `);

      if (result.rows.length === 0) {
        return { success: false, verified: false, error: "Bot not found" };
      }

      const actualStage = (result.rows[0] as any).stage;

      if (actualStage === expectedStage) {
        console.log(`[RAW] trace_id=${traceId} Stage verified: bot=${botId} stage=${expectedStage}`);
        return { success: true, verified: true, retryCount: retry };
      }

      if (retry < MAX_VERIFY_RETRIES - 1) {
        await delay(VERIFY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[RAW] trace_id=${traceId} Verification error:`, error);
    }
  }

  console.error(
    `[RAW] trace_id=${traceId} Stage verification FAILED: bot=${botId} expected=${expectedStage}`
  );

  await logActivityEvent({
    eventType: "SYSTEM_AUDIT",
    severity: "ERROR",
    title: "Read-after-write verification failed for stage transition",
    traceId,
    payload: { botId, expectedStage },
  });

  return {
    success: false,
    verified: false,
    error: `Stage not verified after ${MAX_VERIFY_RETRIES} attempts`,
    retryCount: MAX_VERIFY_RETRIES,
  };
}

export async function verifyJobCreation(
  jobId: string
): Promise<VerificationResult> {
  const traceId = `raw-job-${Date.now().toString(36)}`;
  
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    try {
      const result = await db.execute(sql`
        SELECT id, status FROM bot_jobs WHERE id = ${jobId}
      `);

      if (result.rows.length > 0) {
        console.log(`[RAW] trace_id=${traceId} Job verified: id=${jobId}`);
        return { success: true, verified: true, retryCount: retry };
      }

      if (retry < MAX_VERIFY_RETRIES - 1) {
        await delay(VERIFY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[RAW] trace_id=${traceId} Verification error:`, error);
    }
  }

  console.error(`[RAW] trace_id=${traceId} Job verification FAILED: id=${jobId}`);

  return {
    success: false,
    verified: false,
    error: `Job not verified after ${MAX_VERIFY_RETRIES} attempts`,
    retryCount: MAX_VERIFY_RETRIES,
  };
}

export async function verifyTradeExecution(
  tradeId: string
): Promise<VerificationResult> {
  const traceId = `raw-trade-${Date.now().toString(36)}`;
  
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    try {
      const result = await db.execute(sql`
        SELECT id, bot_id, side, quantity, entry_price 
        FROM paper_trades 
        WHERE id = ${tradeId}
      `);

      if (result.rows.length > 0) {
        const trade = result.rows[0] as any;
        console.log(
          `[RAW] trace_id=${traceId} Trade verified: id=${tradeId} ` +
          `side=${trade.side} qty=${trade.quantity}`
        );
        return { success: true, verified: true, retryCount: retry };
      }

      if (retry < MAX_VERIFY_RETRIES - 1) {
        await delay(VERIFY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[RAW] trace_id=${traceId} Verification error:`, error);
    }
  }

  console.error(`[RAW] trace_id=${traceId} Trade verification FAILED: id=${tradeId}`);

  await logActivityEvent({
    eventType: "SYSTEM_AUDIT",
    severity: "ERROR",
    title: "Read-after-write verification failed for trade execution",
    traceId,
    payload: { tradeId },
  });

  return {
    success: false,
    verified: false,
    error: `Trade not verified after ${MAX_VERIFY_RETRIES} attempts`,
    retryCount: MAX_VERIFY_RETRIES,
  };
}

export async function verifyGovernanceApproval(
  approvalId: string,
  expectedStatus: string
): Promise<VerificationResult> {
  const traceId = `raw-gov-${Date.now().toString(36)}`;
  
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    try {
      const result = await db.execute(sql`
        SELECT id, status FROM governance_approvals WHERE id = ${approvalId}
      `);

      if (result.rows.length > 0) {
        const approval = result.rows[0] as any;
        if (approval.status === expectedStatus) {
          console.log(`[RAW] trace_id=${traceId} Approval verified: id=${approvalId} status=${expectedStatus}`);
          return { success: true, verified: true, retryCount: retry };
        }
      }

      if (retry < MAX_VERIFY_RETRIES - 1) {
        await delay(VERIFY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[RAW] trace_id=${traceId} Verification error:`, error);
    }
  }

  console.error(
    `[RAW] trace_id=${traceId} Approval verification FAILED: id=${approvalId} expected=${expectedStatus}`
  );

  return {
    success: false,
    verified: false,
    error: `Approval not verified after ${MAX_VERIFY_RETRIES} attempts`,
    retryCount: MAX_VERIFY_RETRIES,
  };
}

export async function verifyBotInstanceUpdate(
  instanceId: string,
  expectedField: string,
  expectedValue: any
): Promise<VerificationResult> {
  const traceId = `raw-instance-${Date.now().toString(36)}`;
  
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    try {
      const result = await db.execute(sql`
        SELECT * FROM bot_instances WHERE id = ${instanceId}
      `);

      if (result.rows.length > 0) {
        const instance = result.rows[0] as any;
        if (String(instance[expectedField]) === String(expectedValue)) {
          console.log(
            `[RAW] trace_id=${traceId} Instance verified: id=${instanceId} ` +
            `${expectedField}=${expectedValue}`
          );
          return { success: true, verified: true, retryCount: retry };
        }
      }

      if (retry < MAX_VERIFY_RETRIES - 1) {
        await delay(VERIFY_DELAY_MS);
      }
    } catch (error) {
      console.error(`[RAW] trace_id=${traceId} Verification error:`, error);
    }
  }

  console.error(
    `[RAW] trace_id=${traceId} Instance verification FAILED: id=${instanceId} ` +
    `field=${expectedField} expected=${expectedValue}`
  );

  return {
    success: false,
    verified: false,
    error: `Instance not verified after ${MAX_VERIFY_RETRIES} attempts`,
    retryCount: MAX_VERIFY_RETRIES,
  };
}
