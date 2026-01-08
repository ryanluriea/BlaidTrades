/**
 * Immutable Audit Snapshots Service
 * 
 * INSTITUTIONAL STANDARD: Before/after snapshots for all parameter changes.
 * - Complete state capture before any configuration change
 * - Cryptographic hash chain for tamper detection via immutableAuditLog
 * - Full diff generation for compliance review
 * - Risk override tracking with justification requirements
 * 
 * SEC/CFTC Best Practice: Complete audit trail with immutable database-backed snapshots.
 */

import { db } from "./db";
import { 
  bots,
  immutableAuditLog,
} from "@shared/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import * as crypto from "crypto";

export interface ConfigSnapshot {
  id: string;
  timestamp: Date;
  entityType: "BOT" | "ACCOUNT" | "INSTANCE" | "SYSTEM";
  entityId: string;
  configType: "PARAMETERS" | "RISK_LIMITS" | "STRATEGY_RULES" | "EXECUTION_SETTINGS";
  configData: Record<string, any>;
  hash: string;
  previousSnapshotId: string | null;
  previousHash: string | null;
}

export interface ConfigChange {
  id: string;
  timestamp: Date;
  entityType: string;
  entityId: string;
  actorId: string;
  actorType: "USER" | "SYSTEM" | "GOVERNANCE";
  changeType: "CREATE" | "UPDATE" | "DELETE" | "OVERRIDE";
  changedFields: string[];
  diff: Record<string, { before: any; after: any }>;
  justification: string | null;
}

export interface RiskOverride {
  id: string;
  timestamp: Date;
  botId: string;
  instanceId?: string;
  overrideType: "POSITION_LIMIT" | "LOSS_LIMIT" | "EXPOSURE_LIMIT" | "CIRCUIT_BREAKER";
  originalValue: number;
  newValue: number;
  expiresAt: Date;
  justification: string;
  approvedBy: string;
  revokedAt?: Date;
  revokedBy?: string;
}

function generateHash(data: Record<string, any>, previousHash: string | null): string {
  const content = JSON.stringify(data, Object.keys(data).sort());
  const toHash = previousHash ? `${previousHash}:${content}` : content;
  return crypto.createHash("sha256").update(toHash).digest("hex");
}

async function getNextSequenceNumber(): Promise<number> {
  const result = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${immutableAuditLog.sequenceNumber}), 0)` })
    .from(immutableAuditLog);
  return (result[0]?.maxSeq || 0) + 1;
}

async function getPreviousLogEntry(): Promise<{ hash: string; id: string } | null> {
  const result = await db
    .select({ 
      id: immutableAuditLog.id, 
      chainHash: immutableAuditLog.chainHash 
    })
    .from(immutableAuditLog)
    .orderBy(desc(immutableAuditLog.sequenceNumber))
    .limit(1);
  
  if (result.length === 0) return null;
  return { id: result[0].id, hash: result[0].chainHash };
}

export async function captureConfigSnapshot(params: {
  entityType: "BOT" | "ACCOUNT" | "INSTANCE" | "SYSTEM";
  entityId: string;
  configType: "PARAMETERS" | "RISK_LIMITS" | "STRATEGY_RULES" | "EXECUTION_SETTINGS";
  configData: Record<string, any>;
}): Promise<ConfigSnapshot> {
  const previousEntry = await getPreviousLogEntry();
  const sequenceNumber = await getNextSequenceNumber();
  
  const payloadHash = crypto.createHash("sha256")
    .update(JSON.stringify(params.configData, Object.keys(params.configData).sort()))
    .digest("hex");
  
  const chainHash = crypto.createHash("sha256")
    .update(`${sequenceNumber}:${payloadHash}:${previousEntry?.hash || "GENESIS"}`)
    .digest("hex");
  
  const [logEntry] = await db.insert(immutableAuditLog).values({
    sequenceNumber,
    eventType: `CONFIG_SNAPSHOT_${params.configType}`,
    entityType: params.entityType,
    entityId: params.entityId,
    actorType: "SYSTEM",
    actorId: "audit-snapshots",
    eventPayload: params.configData,
    previousState: null,
    newState: params.configData,
    payloadHash,
    previousHash: previousEntry?.hash || null,
    chainHash,
  }).returning();
  
  const snapshot: ConfigSnapshot = {
    id: logEntry.id,
    timestamp: logEntry.createdAt || new Date(),
    entityType: params.entityType,
    entityId: params.entityId,
    configType: params.configType,
    configData: params.configData,
    hash: chainHash,
    previousSnapshotId: previousEntry?.id || null,
    previousHash: previousEntry?.hash || null,
  };
  
  console.log(`[AUDIT_SNAPSHOT] captured entity=${params.entityType}:${params.entityId.slice(0,8)} type=${params.configType} hash=${chainHash.slice(0,16)}`);
  
  return snapshot;
}

export async function recordConfigChange(params: {
  entityType: string;
  entityId: string;
  actorId: string;
  actorType: "USER" | "SYSTEM" | "GOVERNANCE";
  changeType: "CREATE" | "UPDATE" | "DELETE" | "OVERRIDE";
  beforeConfig: Record<string, any>;
  afterConfig: Record<string, any>;
  justification?: string;
}): Promise<ConfigChange> {
  const previousEntry = await getPreviousLogEntry();
  const sequenceNumber = await getNextSequenceNumber();
  
  const changedFields: string[] = [];
  const diff: Record<string, { before: any; after: any }> = {};
  
  const allKeys = new Set([
    ...Object.keys(params.beforeConfig),
    ...Object.keys(params.afterConfig),
  ]);
  
  for (const key of allKeys) {
    const before = params.beforeConfig[key];
    const after = params.afterConfig[key];
    
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedFields.push(key);
      diff[key] = { before, after };
    }
  }
  
  const eventPayload = {
    changeType: params.changeType,
    changedFields,
    diff,
    justification: params.justification,
  };
  
  const payloadHash = crypto.createHash("sha256")
    .update(JSON.stringify(eventPayload))
    .digest("hex");
  
  const chainHash = crypto.createHash("sha256")
    .update(`${sequenceNumber}:${payloadHash}:${previousEntry?.hash || "GENESIS"}`)
    .digest("hex");
  
  const [logEntry] = await db.insert(immutableAuditLog).values({
    sequenceNumber,
    eventType: "CONFIG_CHANGED",
    entityType: params.entityType,
    entityId: params.entityId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventPayload,
    previousState: params.beforeConfig,
    newState: params.afterConfig,
    payloadHash,
    previousHash: previousEntry?.hash || null,
    chainHash,
  }).returning();
  
  const change: ConfigChange = {
    id: logEntry.id,
    timestamp: logEntry.createdAt || new Date(),
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: params.actorId,
    actorType: params.actorType,
    changeType: params.changeType,
    changedFields,
    diff,
    justification: params.justification || null,
  };
  
  console.log(`[AUDIT_CHANGE] entity=${params.entityType}:${params.entityId.slice(0,8)} by=${params.actorId} fields=${changedFields.join(",")}`);
  
  return change;
}

export async function recordRiskOverride(params: {
  botId: string;
  instanceId?: string;
  overrideType: "POSITION_LIMIT" | "LOSS_LIMIT" | "EXPOSURE_LIMIT" | "CIRCUIT_BREAKER";
  originalValue: number;
  newValue: number;
  durationMinutes: number;
  justification: string;
  approvedBy: string;
}): Promise<RiskOverride> {
  const previousEntry = await getPreviousLogEntry();
  const sequenceNumber = await getNextSequenceNumber();
  const expiresAt = new Date(Date.now() + params.durationMinutes * 60 * 1000);
  
  const eventPayload = {
    overrideType: params.overrideType,
    instanceId: params.instanceId,
    originalValue: params.originalValue,
    newValue: params.newValue,
    durationMinutes: params.durationMinutes,
    expiresAt: expiresAt.toISOString(),
    justification: params.justification,
    approvedBy: params.approvedBy,
    status: "ACTIVE",
  };
  
  const payloadHash = crypto.createHash("sha256")
    .update(JSON.stringify(eventPayload))
    .digest("hex");
  
  const chainHash = crypto.createHash("sha256")
    .update(`${sequenceNumber}:${payloadHash}:${previousEntry?.hash || "GENESIS"}`)
    .digest("hex");
  
  const [logEntry] = await db.insert(immutableAuditLog).values({
    sequenceNumber,
    eventType: "RISK_OVERRIDE",
    entityType: "BOT",
    entityId: params.botId,
    actorType: "USER",
    actorId: params.approvedBy,
    eventPayload,
    previousState: { value: params.originalValue },
    newState: { value: params.newValue },
    payloadHash,
    previousHash: previousEntry?.hash || null,
    chainHash,
  }).returning();
  
  const override: RiskOverride = {
    id: logEntry.id,
    timestamp: logEntry.createdAt || new Date(),
    botId: params.botId,
    instanceId: params.instanceId,
    overrideType: params.overrideType,
    originalValue: params.originalValue,
    newValue: params.newValue,
    expiresAt,
    justification: params.justification,
    approvedBy: params.approvedBy,
  };
  
  console.log(`[RISK_OVERRIDE] bot=${params.botId.slice(0,8)} type=${params.overrideType} ${params.originalValue}->${params.newValue} expires=${expiresAt.toISOString()}`);
  
  return override;
}

export async function revokeRiskOverride(overrideId: string, revokedBy: string): Promise<void> {
  const [original] = await db
    .select()
    .from(immutableAuditLog)
    .where(eq(immutableAuditLog.id, overrideId));
  
  if (!original || original.eventType !== "RISK_OVERRIDE") {
    throw new Error(`Override ${overrideId} not found`);
  }
  
  const previousEntry = await getPreviousLogEntry();
  const sequenceNumber = await getNextSequenceNumber();
  
  const eventPayload = {
    originalOverrideId: overrideId,
    originalPayload: original.eventPayload,
    revokedBy,
    revokedAt: new Date().toISOString(),
    status: "REVOKED",
  };
  
  const payloadHash = crypto.createHash("sha256")
    .update(JSON.stringify(eventPayload))
    .digest("hex");
  
  const chainHash = crypto.createHash("sha256")
    .update(`${sequenceNumber}:${payloadHash}:${previousEntry?.hash || "GENESIS"}`)
    .digest("hex");
  
  await db.insert(immutableAuditLog).values({
    sequenceNumber,
    eventType: "RISK_OVERRIDE_REVOKED",
    entityType: "BOT",
    entityId: original.entityId,
    actorType: "USER",
    actorId: revokedBy,
    eventPayload,
    previousState: original.eventPayload,
    newState: { status: "REVOKED" },
    payloadHash,
    previousHash: previousEntry?.hash || null,
    chainHash,
  });
  
  console.log(`[RISK_OVERRIDE_REVOKED] id=${overrideId} by=${revokedBy}`);
}

export async function getActiveOverrides(botId?: string): Promise<RiskOverride[]> {
  const now = new Date();
  
  const overrideEntries = await db
    .select()
    .from(immutableAuditLog)
    .where(eq(immutableAuditLog.eventType, "RISK_OVERRIDE"))
    .orderBy(desc(immutableAuditLog.createdAt));
  
  const revokedIds = new Set(
    (await db
      .select({ payload: immutableAuditLog.eventPayload })
      .from(immutableAuditLog)
      .where(eq(immutableAuditLog.eventType, "RISK_OVERRIDE_REVOKED"))
    ).map(r => (r.payload as any)?.originalOverrideId)
  );
  
  const activeOverrides: RiskOverride[] = [];
  
  for (const entry of overrideEntries) {
    if (revokedIds.has(entry.id)) continue;
    
    const payload = entry.eventPayload as any;
    if (!payload) continue;
    
    const expiresAt = new Date(payload.expiresAt);
    if (expiresAt < now) continue;
    
    if (botId && entry.entityId !== botId) continue;
    
    activeOverrides.push({
      id: entry.id,
      timestamp: entry.createdAt || new Date(),
      botId: entry.entityId,
      instanceId: payload.instanceId,
      overrideType: payload.overrideType,
      originalValue: payload.originalValue,
      newValue: payload.newValue,
      expiresAt,
      justification: payload.justification,
      approvedBy: payload.approvedBy,
    });
  }
  
  return activeOverrides;
}

export async function getChangeHistory(entityId: string, limit: number = 50): Promise<ConfigChange[]> {
  const entries = await db
    .select()
    .from(immutableAuditLog)
    .where(and(
      eq(immutableAuditLog.entityId, entityId),
      eq(immutableAuditLog.eventType, "CONFIG_CHANGED")
    ))
    .orderBy(desc(immutableAuditLog.createdAt))
    .limit(limit);
  
  return entries.map(entry => {
    const payload = entry.eventPayload as any;
    return {
      id: entry.id,
      timestamp: entry.createdAt || new Date(),
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorId: entry.actorId || "unknown",
      actorType: entry.actorType as "USER" | "SYSTEM" | "GOVERNANCE",
      changeType: payload?.changeType || "UPDATE",
      changedFields: payload?.changedFields || [],
      diff: payload?.diff || {},
      justification: payload?.justification || null,
    };
  });
}

export function getSnapshot(snapshotId: string): ConfigSnapshot | null {
  return null;
}

export async function verifyHashChain(entityId?: string, _configType?: string): Promise<{ valid: boolean; brokenAt?: string; entriesVerified: number }> {
  const entries = await db
    .select({
      id: immutableAuditLog.id,
      sequenceNumber: immutableAuditLog.sequenceNumber,
      payloadHash: immutableAuditLog.payloadHash,
      previousHash: immutableAuditLog.previousHash,
      chainHash: immutableAuditLog.chainHash,
      entityId: immutableAuditLog.entityId,
    })
    .from(immutableAuditLog)
    .orderBy(immutableAuditLog.sequenceNumber);
  
  if (entries.length === 0) {
    return { valid: true, entriesVerified: 0 };
  }
  
  const firstEntry = entries[0];
  if (firstEntry.previousHash !== null) {
    return { valid: false, brokenAt: firstEntry.id, entriesVerified: 0 };
  }
  
  const expectedFirstHash = crypto.createHash("sha256")
    .update(`${firstEntry.sequenceNumber}:${firstEntry.payloadHash}:GENESIS`)
    .digest("hex");
  
  if (firstEntry.chainHash !== expectedFirstHash) {
    return { valid: false, brokenAt: firstEntry.id, entriesVerified: 0 };
  }
  
  for (let i = 1; i < entries.length; i++) {
    const current = entries[i];
    const previous = entries[i - 1];
    
    if (current.previousHash !== previous.chainHash) {
      return { valid: false, brokenAt: current.id, entriesVerified: i };
    }
    
    const expectedChainHash = crypto.createHash("sha256")
      .update(`${current.sequenceNumber}:${current.payloadHash}:${previous.chainHash}`)
      .digest("hex");
    
    if (current.chainHash !== expectedChainHash) {
      return { valid: false, brokenAt: current.id, entriesVerified: i };
    }
  }
  
  const verifiedEntries = entityId 
    ? entries.filter(e => e.entityId === entityId).length 
    : entries.length;
  
  return { valid: true, entriesVerified: verifiedEntries };
}

export async function captureBotConfigSnapshot(botId: string): Promise<ConfigSnapshot> {
  const [bot] = await db
    .select()
    .from(bots)
    .where(eq(bots.id, botId));
  
  if (!bot) {
    throw new Error(`Bot ${botId} not found`);
  }
  
  const configData = {
    name: bot.name,
    stage: bot.stage,
    symbol: bot.symbol,
    strategyConfig: bot.strategyConfig,
    riskConfig: bot.riskConfig,
    evolutionStatus: bot.evolutionStatus,
    evolutionMode: bot.evolutionMode,
    promotionMode: bot.promotionMode,
    sessionMode: bot.sessionMode,
    sessionTimezone: bot.sessionTimezone,
    isTradingEnabled: bot.isTradingEnabled,
    archivedAt: bot.archivedAt,
  };
  
  return captureConfigSnapshot({
    entityType: "BOT",
    entityId: botId,
    configType: "PARAMETERS",
    configData,
  });
}
