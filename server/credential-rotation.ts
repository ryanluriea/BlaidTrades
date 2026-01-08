/**
 * Credential Rotation Service
 * 
 * INSTITUTIONAL STANDARD: Key rotation policies for API credentials
 * - Double-buffered credentials for zero-downtime rotation
 * - Rotation schedules and expiry tracking
 * - Audit trail for all credential changes
 * - Health checks to validate credentials before activation
 * 
 * SEC/CFTC Best Practice: Regular credential rotation with audit trail
 */

import { logActivityEvent } from "./activity-logger";
import { db } from "./db";
import { immutableAuditLog } from "@shared/schema";
import * as crypto from "crypto";

export interface CredentialConfig {
  name: string;
  envVarPrimary: string;
  envVarSecondary?: string;
  rotationIntervalDays: number;
  lastRotatedAt?: Date;
  nextRotationAt?: Date;
  healthCheckFn?: () => Promise<boolean>;
}

export interface CredentialHealth {
  name: string;
  isHealthy: boolean;
  lastCheckedAt: Date;
  error?: string;
}

export interface RotationEvent {
  credentialName: string;
  rotationType: "SCHEDULED" | "MANUAL" | "EMERGENCY";
  previousKeyHash: string;
  newKeyHash: string;
  rotatedAt: Date;
  rotatedBy: string;
}

const CREDENTIAL_CONFIGS: CredentialConfig[] = [
  {
    name: "IRONBEAM_API",
    envVarPrimary: "IRONBEAM_API_KEY_1",
    envVarSecondary: "IRONBEAM_API_KEY_2",
    rotationIntervalDays: 90,
  },
  {
    name: "OPENAI_API",
    envVarPrimary: "OPENAI_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "ANTHROPIC_API",
    envVarPrimary: "ANTHROPIC_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "DATABENTO_API",
    envVarPrimary: "DATABENTO_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "POLYGON_API",
    envVarPrimary: "POLYGON_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "GROQ_API",
    envVarPrimary: "GROQ_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "PERPLEXITY_API",
    envVarPrimary: "PERPLEXITY_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "XAI_API",
    envVarPrimary: "XAI_API_KEY",
    rotationIntervalDays: 90,
  },
  {
    name: "FINNHUB_API",
    envVarPrimary: "FINNHUB_API_KEY",
    rotationIntervalDays: 180,
  },
  {
    name: "FRED_API",
    envVarPrimary: "FRED_API_KEY",
    rotationIntervalDays: 365,
  },
];

const credentialHealthCache = new Map<string, CredentialHealth>();
const rotationSchedule = new Map<string, Date>();

export const ROTATION_POLICIES: Record<string, { rotationIntervalDays: number; warningDays: number }> = {};
for (const config of CREDENTIAL_CONFIGS) {
  ROTATION_POLICIES[config.name] = {
    rotationIntervalDays: config.rotationIntervalDays,
    warningDays: 14,
  };
}

export interface RotationScheduleEntry {
  credentialName: string;
  nextRotation: Date;
  daysUntilRotation: number;
  isOverdue: boolean;
  daysOverdue: number;
  isExpiringSoon: boolean;
}

export function getRotationSchedule(): RotationScheduleEntry[] {
  const now = new Date();
  const entries: RotationScheduleEntry[] = [];
  
  for (const config of CREDENTIAL_CONFIGS) {
    const nextRotation = rotationSchedule.get(config.name) || new Date(now.getTime() + config.rotationIntervalDays * 24 * 60 * 60 * 1000);
    const daysUntilRotation = Math.ceil((nextRotation.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    entries.push({
      credentialName: config.name,
      nextRotation,
      daysUntilRotation,
      isOverdue: daysUntilRotation < 0,
      daysOverdue: daysUntilRotation < 0 ? Math.abs(daysUntilRotation) : 0,
      isExpiringSoon: daysUntilRotation >= 0 && daysUntilRotation <= 14,
    });
  }
  
  return entries;
}

function hashCredential(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function getCredentialValue(envVar: string): string | undefined {
  return process.env[envVar];
}

export function getCredentialStatus(): {
  credentials: Array<{
    name: string;
    configured: boolean;
    primary: boolean;
    secondary: boolean;
    lastRotated?: Date;
    nextRotation?: Date;
    daysUntilRotation?: number;
    health?: CredentialHealth;
  }>;
  overdue: string[];
  expiringSoon: string[];
} {
  const now = new Date();
  const credentials = [];
  const overdue: string[] = [];
  const expiringSoon: string[] = [];
  
  for (const config of CREDENTIAL_CONFIGS) {
    const primaryValue = getCredentialValue(config.envVarPrimary);
    const secondaryValue = config.envVarSecondary 
      ? getCredentialValue(config.envVarSecondary) 
      : undefined;
    
    const nextRotation = rotationSchedule.get(config.name);
    const health = credentialHealthCache.get(config.name);
    
    let daysUntilRotation: number | undefined;
    if (nextRotation) {
      daysUntilRotation = Math.ceil((nextRotation.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilRotation < 0) {
        overdue.push(config.name);
      } else if (daysUntilRotation <= 14) {
        expiringSoon.push(config.name);
      }
    }
    
    credentials.push({
      name: config.name,
      configured: !!primaryValue,
      primary: !!primaryValue,
      secondary: !!secondaryValue,
      lastRotated: config.lastRotatedAt,
      nextRotation,
      daysUntilRotation,
      health,
    });
  }
  
  return { credentials, overdue, expiringSoon };
}

export async function checkCredentialHealth(credentialName: string): Promise<CredentialHealth> {
  const config = CREDENTIAL_CONFIGS.find(c => c.name === credentialName);
  if (!config) {
    throw new Error(`Unknown credential: ${credentialName}`);
  }
  
  const value = getCredentialValue(config.envVarPrimary);
  const now = new Date();
  
  if (!value) {
    const health: CredentialHealth = {
      name: credentialName,
      isHealthy: false,
      lastCheckedAt: now,
      error: "Credential not configured",
    };
    credentialHealthCache.set(credentialName, health);
    return health;
  }
  
  let isHealthy = true;
  let error: string | undefined;
  
  if (config.healthCheckFn) {
    try {
      isHealthy = await config.healthCheckFn();
    } catch (e: any) {
      isHealthy = false;
      error = e.message;
    }
  }
  
  const health: CredentialHealth = {
    name: credentialName,
    isHealthy,
    lastCheckedAt: now,
    error,
  };
  
  credentialHealthCache.set(credentialName, health);
  return health;
}

export async function recordRotationEvent(event: RotationEvent): Promise<void> {
  const traceId = crypto.randomUUID();
  
  const payloadHash = crypto.createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  
  await db.transaction(async (tx) => {
    await tx.execute(`SELECT pg_advisory_xact_lock(42)`);
    
    const seqResult = await tx.execute<{ max: number }>(
      `SELECT COALESCE(MAX(sequence_number), 0) as max FROM immutable_audit_log`
    );
    const sequenceNumber = ((seqResult.rows[0] as any)?.max || 0) + 1;
    
    const prevResult = await tx.execute<{ id: string; chain_hash: string }>(
      `SELECT id, chain_hash FROM immutable_audit_log ORDER BY sequence_number DESC LIMIT 1`
    );
    const previousEntry = prevResult.rows && prevResult.rows.length > 0
      ? { id: (prevResult.rows[0] as any).id, hash: (prevResult.rows[0] as any).chain_hash }
      : null;
    
    const chainHash = crypto.createHash("sha256")
      .update(`${sequenceNumber}:${payloadHash}:${previousEntry?.hash || "GENESIS"}`)
      .digest("hex");
    
    await tx.insert(immutableAuditLog).values({
      sequenceNumber,
      eventType: "CREDENTIAL_ROTATION",
      entityType: "SYSTEM",
      entityId: event.credentialName,
      actorType: event.rotationType === "SCHEDULED" ? "SCHEDULER" : "USER",
      actorId: event.rotatedBy,
      eventPayload: {
        rotationType: event.rotationType,
        previousKeyHash: event.previousKeyHash,
        newKeyHash: event.newKeyHash,
        rotatedAt: event.rotatedAt.toISOString(),
      },
      previousState: { keyHash: event.previousKeyHash },
      newState: { keyHash: event.newKeyHash },
      payloadHash,
      previousHash: previousEntry?.hash || null,
      chainHash,
      traceId,
    });
  });
  
  await logActivityEvent({
    eventType: "SECURITY_AUDIT",
    severity: "INFO",
    title: `Credential Rotated: ${event.credentialName}`,
    summary: `${event.rotationType} rotation completed by ${event.rotatedBy}`,
    payload: {
      credentialName: event.credentialName,
      rotationType: event.rotationType,
      previousKeyHash: event.previousKeyHash,
      newKeyHash: event.newKeyHash,
    },
    traceId,
  });
  
  console.log(`[CREDENTIAL_ROTATION] ${event.credentialName} rotated by=${event.rotatedBy} type=${event.rotationType}`);
}

export function initializeRotationSchedule(): void {
  const now = new Date();
  
  for (const config of CREDENTIAL_CONFIGS) {
    const lastRotated = config.lastRotatedAt || now;
    const nextRotation = new Date(lastRotated.getTime() + config.rotationIntervalDays * 24 * 60 * 60 * 1000);
    rotationSchedule.set(config.name, nextRotation);
  }
  
  console.log(`[CREDENTIAL_ROTATION] initialized rotation schedule for ${CREDENTIAL_CONFIGS.length} credentials`);
}

export async function checkRotationDue(): Promise<string[]> {
  const now = new Date();
  const due: string[] = [];
  
  for (const [name, nextRotation] of rotationSchedule.entries()) {
    if (now >= nextRotation) {
      due.push(name);
    }
  }
  
  if (due.length > 0) {
    await logActivityEvent({
      eventType: "SECURITY_AUDIT",
      severity: "WARN",
      title: "Credential Rotation Due",
      summary: `${due.length} credential(s) require rotation: ${due.join(", ")}`,
      payload: { credentials: due },
    });
  }
  
  return due;
}

export function getRotationPolicy(): {
  policies: Array<{
    name: string;
    rotationIntervalDays: number;
    hasSecondarySlot: boolean;
  }>;
} {
  return {
    policies: CREDENTIAL_CONFIGS.map(c => ({
      name: c.name,
      rotationIntervalDays: c.rotationIntervalDays,
      hasSecondarySlot: !!c.envVarSecondary,
    })),
  };
}

initializeRotationSchedule();
