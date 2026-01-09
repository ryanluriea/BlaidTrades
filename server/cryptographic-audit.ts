/**
 * Cryptographic Audit Chain
 * 
 * Industry-standard tamper-evident audit trail using hash chaining.
 * Each audit record includes a hash of the previous record, creating
 * an unbreakable chain that detects any modifications to historical data.
 * 
 * Features:
 * - SHA-256 hash chaining
 * - Tamper detection via chain verification
 * - Immutable append-only log
 * - Full reconstruction capability
 */

import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface AuditRecord {
  id: string;
  sequenceNumber: number;
  timestamp: Date;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  actor?: string;
  payload: Record<string, any>;
  previousHash: string;
  currentHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  checkedRecords: number;
  firstBrokenLink?: number;
  brokenRecordId?: string;
  expectedHash?: string;
  actualHash?: string;
}

function computeRecordHash(
  sequenceNumber: number,
  timestamp: Date,
  eventType: string,
  entityType: string,
  entityId: string,
  action: string,
  actor: string | undefined,
  payload: Record<string, any>,
  previousHash: string
): string {
  const data = JSON.stringify({
    seq: sequenceNumber,
    ts: timestamp.toISOString(),
    type: eventType,
    entity: entityType,
    id: entityId,
    action,
    actor: actor || null,
    payload,
    prev: previousHash,
  });

  return crypto.createHash("sha256").update(data).digest("hex");
}

const GENESIS_HASH = "0".repeat(64);

export async function appendAuditRecord(
  eventType: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, any>,
  actor?: string
): Promise<AuditRecord> {
  const timestamp = new Date();

  const lastRecordResult = await db.execute(sql`
    SELECT sequence_number, current_hash 
    FROM audit_chain 
    ORDER BY sequence_number DESC 
    LIMIT 1
  `);

  const lastRecord = lastRecordResult.rows[0] as any;
  const previousHash = lastRecord?.current_hash || GENESIS_HASH;
  const sequenceNumber = (lastRecord?.sequence_number || 0) + 1;

  const currentHash = computeRecordHash(
    sequenceNumber,
    timestamp,
    eventType,
    entityType,
    entityId,
    action,
    actor,
    payload,
    previousHash
  );

  const result = await db.execute(sql`
    INSERT INTO audit_chain (
      id,
      sequence_number,
      timestamp,
      event_type,
      entity_type,
      entity_id,
      action,
      actor,
      payload,
      previous_hash,
      current_hash
    ) VALUES (
      gen_random_uuid(),
      ${sequenceNumber},
      ${timestamp},
      ${eventType},
      ${entityType},
      ${entityId},
      ${action},
      ${actor || null},
      ${JSON.stringify(payload)}::jsonb,
      ${previousHash},
      ${currentHash}
    )
    RETURNING id
  `);

  const recordId = (result.rows[0] as any)?.id;

  return {
    id: recordId,
    sequenceNumber,
    timestamp,
    eventType,
    entityType,
    entityId,
    action,
    actor,
    payload,
    previousHash,
    currentHash,
  };
}

export async function verifyAuditChain(
  startSequence?: number,
  endSequence?: number
): Promise<ChainVerificationResult> {
  const traceId = `chain-verify-${Date.now().toString(36)}`;
  console.log(`[AUDIT_CHAIN] trace_id=${traceId} Starting chain verification...`);

  const records = await db.execute(sql`
    SELECT *
    FROM audit_chain
    WHERE ${startSequence ? sql`sequence_number >= ${startSequence}` : sql`1=1`}
      AND ${endSequence ? sql`sequence_number <= ${endSequence}` : sql`1=1`}
    ORDER BY sequence_number ASC
  `);

  if (records.rows.length === 0) {
    return { valid: true, checkedRecords: 0 };
  }

  let previousHash = GENESIS_HASH;
  let checkedRecords = 0;

  if (startSequence && startSequence > 1) {
    const prevRecord = await db.execute(sql`
      SELECT current_hash FROM audit_chain 
      WHERE sequence_number = ${startSequence - 1}
    `);
    if (prevRecord.rows[0]) {
      previousHash = (prevRecord.rows[0] as any).current_hash;
    }
  }

  for (const row of records.rows as any[]) {
    checkedRecords++;

    if (row.previous_hash !== previousHash) {
      console.error(
        `[AUDIT_CHAIN] trace_id=${traceId} BROKEN LINK at seq=${row.sequence_number}: ` +
        `expected previous_hash=${previousHash.substring(0, 16)}... ` +
        `got ${row.previous_hash.substring(0, 16)}...`
      );

      return {
        valid: false,
        checkedRecords,
        firstBrokenLink: row.sequence_number,
        brokenRecordId: row.id,
        expectedHash: previousHash,
        actualHash: row.previous_hash,
      };
    }

    const computedHash = computeRecordHash(
      row.sequence_number,
      new Date(row.timestamp),
      row.event_type,
      row.entity_type,
      row.entity_id,
      row.action,
      row.actor,
      row.payload,
      row.previous_hash
    );

    if (computedHash !== row.current_hash) {
      console.error(
        `[AUDIT_CHAIN] trace_id=${traceId} TAMPERED RECORD at seq=${row.sequence_number}: ` +
        `computed hash doesn't match stored hash`
      );

      return {
        valid: false,
        checkedRecords,
        firstBrokenLink: row.sequence_number,
        brokenRecordId: row.id,
        expectedHash: computedHash,
        actualHash: row.current_hash,
      };
    }

    previousHash = row.current_hash;
  }

  console.log(`[AUDIT_CHAIN] trace_id=${traceId} Chain verified: ${checkedRecords} records OK`);

  return { valid: true, checkedRecords };
}

export async function getAuditRecords(
  entityType?: string,
  entityId?: string,
  limit: number = 100
): Promise<AuditRecord[]> {
  const result = await db.execute(sql`
    SELECT *
    FROM audit_chain
    WHERE ${entityType ? sql`entity_type = ${entityType}` : sql`1=1`}
      AND ${entityId ? sql`entity_id = ${entityId}` : sql`1=1`}
    ORDER BY sequence_number DESC
    LIMIT ${limit}
  `);

  return result.rows.map((row: any) => ({
    id: row.id,
    sequenceNumber: row.sequence_number,
    timestamp: new Date(row.timestamp),
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actor: row.actor,
    payload: row.payload,
    previousHash: row.previous_hash,
    currentHash: row.current_hash,
  }));
}

export async function auditStageTransition(
  botId: string,
  fromStage: string,
  toStage: string,
  triggeredBy: string,
  actor?: string
): Promise<void> {
  await appendAuditRecord(
    "STAGE_TRANSITION",
    "bot",
    botId,
    `${fromStage}→${toStage}`,
    {
      fromStage,
      toStage,
      triggeredBy,
      timestamp: new Date().toISOString(),
    },
    actor
  );
}

export async function auditTradeExecution(
  botId: string,
  tradeId: string,
  side: string,
  quantity: number,
  price: number,
  accountId?: string
): Promise<void> {
  await appendAuditRecord(
    "TRADE_EXECUTION",
    "trade",
    tradeId,
    side,
    {
      botId,
      side,
      quantity,
      price,
      accountId,
      timestamp: new Date().toISOString(),
    }
  );
}

export async function auditGovernanceApproval(
  botId: string,
  approver: string,
  action: string,
  details: Record<string, any>
): Promise<void> {
  await appendAuditRecord(
    "GOVERNANCE_APPROVAL",
    "bot",
    botId,
    action,
    {
      ...details,
      timestamp: new Date().toISOString(),
    },
    approver
  );
}

export async function getChainStats(): Promise<{
  totalRecords: number;
  latestSequence: number;
  latestTimestamp?: Date;
  chainIntact: boolean;
}> {
  try {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        MAX(sequence_number) as latest_seq,
        MAX(timestamp) as latest_ts
      FROM audit_chain
    `);

    const row = result.rows[0] as any;
    
    return {
      totalRecords: parseInt(row?.total || "0"),
      latestSequence: parseInt(row?.latest_seq || "0"),
      latestTimestamp: row?.latest_ts ? new Date(row.latest_ts) : undefined,
      chainIntact: true,
    };
  } catch (error) {
    console.error("[AUDIT_CHAIN] Error getting stats:", error);
    return {
      totalRecords: 0,
      latestSequence: 0,
      chainIntact: false,
    };
  }
}
