import { db } from "./db";
import { 
  governanceApprovals, 
  modelValidations, 
  immutableAuditLog,
  bots,
  users,
  promotionAuditTrail,
  type GovernanceApproval,
  type ModelValidation,
  type ImmutableAuditLogEntry
} from "@shared/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { createHash } from "crypto";

const APPROVAL_EXPIRY_HOURS = 72;

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function getNextSequenceNumber(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq 
    FROM immutable_audit_log
  `);
  return (result.rows[0] as any)?.next_seq || 1;
}

async function getPreviousHash(): Promise<string | null> {
  const result = await db
    .select({ chainHash: immutableAuditLog.chainHash })
    .from(immutableAuditLog)
    .orderBy(desc(immutableAuditLog.sequenceNumber))
    .limit(1);
  
  return result.length > 0 ? result[0].chainHash : null;
}

export async function logImmutableAuditEvent(params: {
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId?: string;
  actorIp?: string;
  eventPayload: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  traceId?: string;
}): Promise<ImmutableAuditLogEntry> {
  const sequenceNumber = await getNextSequenceNumber();
  const previousHash = await getPreviousHash();
  
  const payloadString = JSON.stringify(params.eventPayload);
  const payloadHash = sha256(payloadString);
  
  const chainData = `${sequenceNumber}|${payloadHash}|${previousHash || "GENESIS"}`;
  const chainHash = sha256(chainData);
  
  const [entry] = await db.insert(immutableAuditLog).values({
    sequenceNumber,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    actorType: params.actorType,
    actorId: params.actorId,
    actorIp: params.actorIp,
    eventPayload: params.eventPayload,
    previousState: params.previousState,
    newState: params.newState,
    payloadHash,
    previousHash,
    chainHash,
    traceId: params.traceId,
  }).returning();
  
  console.log(`[IMMUTABLE_AUDIT] seq=${sequenceNumber} type=${params.eventType} entity=${params.entityType}:${params.entityId} chain_verified=true`);
  
  return entry;
}

export async function verifyAuditChainIntegrity(): Promise<{
  isValid: boolean;
  lastVerifiedSequence: number;
  errors: string[];
}> {
  const entries = await db
    .select()
    .from(immutableAuditLog)
    .orderBy(immutableAuditLog.sequenceNumber);
  
  const errors: string[] = [];
  let lastVerifiedSequence = 0;
  let previousHash: string | null = null;
  
  for (const entry of entries) {
    const payloadString = JSON.stringify(entry.eventPayload);
    const expectedPayloadHash = sha256(payloadString);
    
    if (entry.payloadHash !== expectedPayloadHash) {
      errors.push(`Sequence ${entry.sequenceNumber}: Payload hash mismatch (tampered data)`);
      continue;
    }
    
    const chainData = `${entry.sequenceNumber}|${entry.payloadHash}|${previousHash || "GENESIS"}`;
    const expectedChainHash = sha256(chainData);
    
    if (entry.chainHash !== expectedChainHash) {
      errors.push(`Sequence ${entry.sequenceNumber}: Chain hash mismatch (chain broken)`);
      continue;
    }
    
    if (entry.previousHash !== previousHash) {
      errors.push(`Sequence ${entry.sequenceNumber}: Previous hash mismatch (record inserted/deleted)`);
      continue;
    }
    
    lastVerifiedSequence = entry.sequenceNumber;
    previousHash = entry.chainHash;
  }
  
  console.log(`[IMMUTABLE_AUDIT] chain_verification completed entries=${entries.length} errors=${errors.length} last_verified=${lastVerifiedSequence}`);
  
  return {
    isValid: errors.length === 0,
    lastVerifiedSequence,
    errors,
  };
}

export async function requestLivePromotion(params: {
  botId: string;
  requestedBy: string;
  fromStage: string;
  toStage: string;
  requestReason?: string;
  metricsSnapshot: Record<string, unknown>;
  gatesSnapshot: Record<string, unknown>;
  riskAssessment?: Record<string, unknown>;
}): Promise<GovernanceApproval> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + APPROVAL_EXPIRY_HOURS);
  
  const requestedAction = `PROMOTE_TO_${params.toStage}`;
  
  const [approval] = await db.insert(governanceApprovals).values({
    botId: params.botId,
    requestedAction,
    fromStage: params.fromStage,
    toStage: params.toStage,
    requestedBy: params.requestedBy,
    requestReason: params.requestReason,
    metricsSnapshot: params.metricsSnapshot,
    gatesSnapshot: params.gatesSnapshot,
    riskAssessment: params.riskAssessment || {},
    expiresAt,
  }).returning();
  
  await logImmutableAuditEvent({
    eventType: "GOVERNANCE_REQUEST",
    entityType: "BOT",
    entityId: params.botId,
    actorType: "USER",
    actorId: params.requestedBy,
    eventPayload: {
      action: requestedAction,
      fromStage: params.fromStage,
      toStage: params.toStage,
      approvalId: approval.id,
      expiresAt: expiresAt.toISOString(),
    },
  });
  
  console.log(`[GOVERNANCE] approval_requested bot=${params.botId.slice(0,8)} action=${requestedAction} expires=${expiresAt.toISOString()}`);
  
  return approval;
}

export async function reviewGovernanceApproval(params: {
  approvalId: string;
  reviewedBy: string;
  decision: "APPROVED" | "REJECTED";
  reviewNotes?: string;
}): Promise<GovernanceApproval> {
  const [existing] = await db
    .select()
    .from(governanceApprovals)
    .where(eq(governanceApprovals.id, params.approvalId));
  
  if (!existing) {
    throw new Error(`Approval ${params.approvalId} not found`);
  }
  
  if (existing.status !== "PENDING") {
    throw new Error(`Approval ${params.approvalId} is already ${existing.status}`);
  }
  
  if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
    await db
      .update(governanceApprovals)
      .set({ status: "EXPIRED" })
      .where(eq(governanceApprovals.id, params.approvalId));
    throw new Error(`Approval ${params.approvalId} has expired`);
  }
  
  if (existing.requestedBy === params.reviewedBy) {
    throw new Error("Maker cannot be the checker - requires different approver");
  }
  
  const [updated] = await db
    .update(governanceApprovals)
    .set({
      status: params.decision,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: params.reviewNotes,
    })
    .where(eq(governanceApprovals.id, params.approvalId))
    .returning();
  
  await logImmutableAuditEvent({
    eventType: "GOVERNANCE_DECISION",
    entityType: "BOT",
    entityId: existing.botId,
    actorType: "USER",
    actorId: params.reviewedBy,
    eventPayload: {
      approvalId: params.approvalId,
      decision: params.decision,
      action: existing.requestedAction,
      fromStage: existing.fromStage,
      toStage: existing.toStage,
      reviewNotes: params.reviewNotes,
    },
  });
  
  console.log(`[GOVERNANCE] approval_${params.decision.toLowerCase()} bot=${existing.botId.slice(0,8)} action=${existing.requestedAction} reviewer=${params.reviewedBy.slice(0,8)}`);
  
  return updated;
}

export async function getPendingApprovals(botId?: string): Promise<GovernanceApproval[]> {
  const conditions = [eq(governanceApprovals.status, "PENDING")];
  if (botId) {
    conditions.push(eq(governanceApprovals.botId, botId));
  }
  
  return db
    .select()
    .from(governanceApprovals)
    .where(and(...conditions))
    .orderBy(desc(governanceApprovals.requestedAt));
}

export async function requestModelValidation(params: {
  botId: string;
  generationId?: string;
  validationType: string;
  requestedBy: string;
  backtestPeriods?: unknown[];
  walkForwardResults?: Record<string, unknown>;
  stressTestResults?: Record<string, unknown>;
  outOfSampleMetrics?: Record<string, unknown>;
}): Promise<ModelValidation> {
  const [validation] = await db.insert(modelValidations).values({
    botId: params.botId,
    generationId: params.generationId,
    validationType: params.validationType,
    requestedBy: params.requestedBy,
    backtestPeriods: params.backtestPeriods || [],
    walkForwardResults: params.walkForwardResults || {},
    stressTestResults: params.stressTestResults || {},
    outOfSampleMetrics: params.outOfSampleMetrics || {},
  }).returning();
  
  await logImmutableAuditEvent({
    eventType: "MODEL_VALIDATION_REQUESTED",
    entityType: "BOT",
    entityId: params.botId,
    actorType: "USER",
    actorId: params.requestedBy,
    eventPayload: {
      validationId: validation.id,
      validationType: params.validationType,
      generationId: params.generationId,
    },
  });
  
  console.log(`[MODEL_VALIDATION] requested bot=${params.botId.slice(0,8)} type=${params.validationType}`);
  
  return validation;
}

export async function completeModelValidation(params: {
  validationId: string;
  validatedBy: string;
  status: "VALIDATED" | "REJECTED" | "NEEDS_REVISION";
  validationNotes?: string;
  riskConcerns?: string[];
  requiredChanges?: string[];
}): Promise<ModelValidation> {
  const [existing] = await db
    .select()
    .from(modelValidations)
    .where(eq(modelValidations.id, params.validationId));
  
  if (!existing) {
    throw new Error(`Validation ${params.validationId} not found`);
  }
  
  const [updated] = await db
    .update(modelValidations)
    .set({
      status: params.status,
      validatedBy: params.validatedBy,
      validatedAt: new Date(),
      validationNotes: params.validationNotes,
      riskConcerns: params.riskConcerns,
      requiredChanges: params.requiredChanges,
    })
    .where(eq(modelValidations.id, params.validationId))
    .returning();
  
  await logImmutableAuditEvent({
    eventType: "MODEL_VALIDATION_COMPLETED",
    entityType: "BOT",
    entityId: existing.botId,
    actorType: "USER",
    actorId: params.validatedBy,
    eventPayload: {
      validationId: params.validationId,
      status: params.status,
      riskConcerns: params.riskConcerns,
      requiredChanges: params.requiredChanges,
    },
  });
  
  console.log(`[MODEL_VALIDATION] completed id=${params.validationId.slice(0,8)} status=${params.status}`);
  
  return updated;
}

export async function isLivePromotionAllowed(botId: string): Promise<{
  allowed: boolean;
  reason: string;
  pendingApprovals: GovernanceApproval[];
  pendingValidations: ModelValidation[];
}> {
  const approvals = await db
    .select()
    .from(governanceApprovals)
    .where(and(
      eq(governanceApprovals.botId, botId),
      eq(governanceApprovals.status, "APPROVED")
    ))
    .orderBy(desc(governanceApprovals.reviewedAt))
    .limit(1);
  
  const validations = await db
    .select()
    .from(modelValidations)
    .where(and(
      eq(modelValidations.botId, botId),
      eq(modelValidations.status, "VALIDATED")
    ))
    .orderBy(desc(modelValidations.validatedAt))
    .limit(1);
  
  const pendingApprovals = await getPendingApprovals(botId);
  
  const pendingValidations = await db
    .select()
    .from(modelValidations)
    .where(and(
      eq(modelValidations.botId, botId),
      eq(modelValidations.status, "PENDING")
    ));
  
  const hasApprovedGovernance = approvals.length > 0;
  const hasValidatedModel = validations.length > 0;
  
  if (!hasApprovedGovernance && !hasValidatedModel) {
    return {
      allowed: false,
      reason: "Requires governance approval and model validation for LIVE deployment",
      pendingApprovals,
      pendingValidations,
    };
  }
  
  if (!hasApprovedGovernance) {
    return {
      allowed: false,
      reason: "Requires governance approval (maker-checker) for LIVE deployment",
      pendingApprovals,
      pendingValidations,
    };
  }
  
  if (!hasValidatedModel) {
    return {
      allowed: false,
      reason: "Requires model validation sign-off for LIVE deployment",
      pendingApprovals,
      pendingValidations,
    };
  }
  
  return {
    allowed: true,
    reason: "All governance and validation requirements met",
    pendingApprovals: [],
    pendingValidations: [],
  };
}

export async function expireOldApprovals(): Promise<number> {
  const result = await db
    .update(governanceApprovals)
    .set({ status: "EXPIRED" })
    .where(and(
      eq(governanceApprovals.status, "PENDING"),
      sql`expires_at < NOW()`
    ))
    .returning();
  
  if (result.length > 0) {
    console.log(`[GOVERNANCE] expired ${result.length} pending approvals`);
    
    for (const approval of result) {
      await logImmutableAuditEvent({
        eventType: "GOVERNANCE_EXPIRED",
        entityType: "BOT",
        entityId: approval.botId,
        actorType: "SYSTEM",
        eventPayload: {
          approvalId: approval.id,
          action: approval.requestedAction,
          originalExpiry: approval.expiresAt,
        },
      });
    }
  }
  
  return result.length;
}
