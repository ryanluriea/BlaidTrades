import crypto from "crypto";
import { db } from "./db";
import { 
  researchJobs, 
  candidateFingerprints, 
  researchOrchestratorState,
  strategyCandidates,
  llmBudgets,
  type ResearchJob,
  type CandidateFingerprint,
} from "@shared/schema";
import { eq, and, sql, desc, isNull, lt, gte, or } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { runGrokResearch, type GrokResearchDepth, type GrokResearchContext } from "./grok-research-engine";
import { detectMarketRegime } from "./regime-detector";

const LOG_PREFIX = "[RESEARCH_ORCHESTRATOR]";

export type ResearchMode = "CONTRARIAN_SCAN" | "SENTIMENT_BURST" | "DEEP_REASONING" | "FULL_SPECTRUM";

interface OrchestratorConfig {
  contrarianIntervalMs: number;
  sentimentIntervalMs: number;
  deepReasoningIntervalMs: number;
  maxConcurrentJobs: number;
  maxDailyCostUsd: number;
  deduplicationTtlHours: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  contrarianIntervalMs: 2 * 60 * 60_000,      // 2 hours
  sentimentIntervalMs: 30 * 60_000,            // 30 minutes
  deepReasoningIntervalMs: 6 * 60 * 60_000,   // 6 hours
  maxConcurrentJobs: 3,
  maxDailyCostUsd: 50,
  deduplicationTtlHours: 24,
};

const STAGGERED_OFFSETS: Record<GrokResearchDepth, number> = {
  SENTIMENT_BURST: 5,    // Run at :05 and :35
  CONTRARIAN_SCAN: 20,   // Run at :20
  DEEP_REASONING: 50,    // Run at :50
};

const COST_CLASS_MAP: Record<GrokResearchDepth, "LOW" | "MEDIUM" | "HIGH"> = {
  SENTIMENT_BURST: "LOW",
  CONTRARIAN_SCAN: "MEDIUM",
  DEEP_REASONING: "HIGH",
};

const PRIORITY_MAP: Record<GrokResearchDepth, number> = {
  SENTIMENT_BURST: 80,   // Highest priority - time sensitive
  CONTRARIAN_SCAN: 60,   // Medium priority
  DEEP_REASONING: 40,    // Lower priority - can be deferred
};

interface OrchestratorState {
  isFullSpectrumEnabled: boolean;
  lastContrarianAt: Date | null;
  lastSentimentAt: Date | null;
  lastDeepReasoningAt: Date | null;
  runningJobs: Map<string, ResearchJob>;
  dailyCostUsd: number;
  dailyJobCount: number;
}

let orchestratorState: OrchestratorState = {
  isFullSpectrumEnabled: false,
  lastContrarianAt: null,
  lastSentimentAt: null,
  lastDeepReasoningAt: null,
  runningJobs: new Map(),
  dailyCostUsd: 0,
  dailyJobCount: 0,
};

let orchestratorInterval: NodeJS.Timeout | null = null;
const config = { ...DEFAULT_CONFIG };

function getNextScheduledRun(mode: GrokResearchDepth): number | null {
  const lastRun = mode === "CONTRARIAN_SCAN" ? orchestratorState.lastContrarianAt
    : mode === "SENTIMENT_BURST" ? orchestratorState.lastSentimentAt
    : orchestratorState.lastDeepReasoningAt;
  
  const interval = mode === "CONTRARIAN_SCAN" ? config.contrarianIntervalMs
    : mode === "SENTIMENT_BURST" ? config.sentimentIntervalMs
    : config.deepReasoningIntervalMs;
  
  if (!lastRun) return 0;
  
  const nextRunAt = lastRun.getTime() + interval;
  const now = Date.now();
  return Math.max(0, nextRunAt - now);
}

export function getOrchestratorStatus(): {
  isEnabled: boolean;
  isFullSpectrum: boolean;
  runningJobs: number;
  dailyCost: number;
  dailyJobs: number;
  lastRuns: Record<string, Date | null>;
  nextRuns: Record<string, number | null>;
} {
  return {
    isEnabled: orchestratorInterval !== null,
    isFullSpectrum: orchestratorState.isFullSpectrumEnabled,
    runningJobs: orchestratorState.runningJobs.size,
    dailyCost: orchestratorState.dailyCostUsd,
    dailyJobs: orchestratorState.dailyJobCount,
    lastRuns: {
      CONTRARIAN_SCAN: orchestratorState.lastContrarianAt,
      SENTIMENT_BURST: orchestratorState.lastSentimentAt,
      DEEP_REASONING: orchestratorState.lastDeepReasoningAt,
    },
    nextRuns: orchestratorState.isFullSpectrumEnabled ? {
      CONTRARIAN_SCAN: getNextScheduledRun("CONTRARIAN_SCAN"),
      SENTIMENT_BURST: getNextScheduledRun("SENTIMENT_BURST"),
      DEEP_REASONING: getNextScheduledRun("DEEP_REASONING"),
    } : {},
  };
}

const ORCHESTRATOR_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

export async function enableFullSpectrum(enabled: boolean): Promise<void> {
  orchestratorState.isFullSpectrumEnabled = enabled;
  
  try {
    const existing = await db.query.researchOrchestratorState.findFirst({
      where: eq(researchOrchestratorState.id, ORCHESTRATOR_SINGLETON_ID),
    });

    if (existing) {
      await db.update(researchOrchestratorState)
        .set({ 
          isFullSpectrumEnabled: enabled,
          updatedAt: new Date(),
        })
        .where(eq(researchOrchestratorState.id, ORCHESTRATOR_SINGLETON_ID));
    } else {
      await db.insert(researchOrchestratorState)
        .values({
          id: ORCHESTRATOR_SINGLETON_ID,
          isFullSpectrumEnabled: enabled,
          updatedAt: new Date(),
        });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to persist state:`, err);
  }

  await logActivityEvent({
    eventType: "RESEARCH_ORCHESTRATOR_TOGGLE",
    title: enabled ? "Full Spectrum mode ENABLED" : "Full Spectrum mode DISABLED",
    summary: enabled ? "All 3 research modes running concurrently" : "Single mode operation",
    severity: "INFO",
    provider: "research-orchestrator",
    payload: { fullSpectrum: enabled },
  });

  if (enabled && !orchestratorInterval) {
    await startOrchestrator();
  }

  console.log(`${LOG_PREFIX} Full Spectrum mode ${enabled ? "ENABLED" : "DISABLED"}`);
}

export function generateCandidateFingerprint(candidate: {
  strategyName?: string;
  archetypeName?: string;
  hypothesis?: string;
  rulesJson?: any;
  regimeContext?: string;
}): string {
  const components = [
    candidate.archetypeName || "",
    candidate.hypothesis?.toLowerCase().substring(0, 200) || "",
    JSON.stringify(candidate.rulesJson?.entry || []).substring(0, 300),
    JSON.stringify(candidate.rulesJson?.exit || []).substring(0, 300),
    candidate.regimeContext || "",
  ];
  
  const normalized = components.join("|").toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex").substring(0, 32);
}

export async function checkDuplicate(fingerprint: string): Promise<{ isDuplicate: boolean; existingId?: string }> {
  const existing = await db.query.candidateFingerprints.findFirst({
    where: and(
      eq(candidateFingerprints.fingerprintHash, fingerprint),
      or(
        isNull(candidateFingerprints.expiresAt),
        gte(candidateFingerprints.expiresAt, new Date())
      )
    ),
  });
  
  if (existing) {
    await db.update(candidateFingerprints)
      .set({ 
        hitCount: sql`${candidateFingerprints.hitCount} + 1`,
        lastSeenAt: new Date(),
      })
      .where(eq(candidateFingerprints.id, existing.id));
    
    return { isDuplicate: true, existingId: existing.candidateId ?? undefined };
  }
  
  return { isDuplicate: false };
}

export async function registerFingerprint(
  fingerprint: string, 
  candidateId: string,
  metadata: { rulesHash?: string; archetypeName?: string; regimeContext?: string }
): Promise<void> {
  const expiresAt = new Date(Date.now() + config.deduplicationTtlHours * 60 * 60 * 1000);
  
  await db.insert(candidateFingerprints)
    .values({
      fingerprintHash: fingerprint,
      candidateId,
      rulesHash: metadata.rulesHash,
      archetypeName: metadata.archetypeName,
      regimeContext: metadata.regimeContext,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [candidateFingerprints.fingerprintHash],
      set: {
        hitCount: sql`${candidateFingerprints.hitCount} + 1`,
        lastSeenAt: new Date(),
        candidateId,
      },
    });
}

async function checkProviderQuota(): Promise<{ allowed: boolean; reason?: string }> {
  const budget = await db.query.llmBudgets.findFirst({
    where: eq(llmBudgets.provider, "xai" as any),
  });
  
  if (!budget) return { allowed: true };
  if (!budget.isEnabled || budget.isPaused) {
    return { allowed: false, reason: "xAI/Grok is disabled or paused" };
  }
  if (budget.isAutoThrottled) {
    return { allowed: false, reason: "xAI/Grok budget exceeded" };
  }
  
  return { allowed: true };
}

async function checkDailyCostLimit(): Promise<{ allowed: boolean; reason?: string }> {
  if (orchestratorState.dailyCostUsd >= config.maxDailyCostUsd) {
    return { allowed: false, reason: `Daily cost limit of $${config.maxDailyCostUsd} exceeded` };
  }
  return { allowed: true };
}

function shouldRunMode(mode: GrokResearchDepth, now: Date): boolean {
  const lastRun = mode === "CONTRARIAN_SCAN" ? orchestratorState.lastContrarianAt
    : mode === "SENTIMENT_BURST" ? orchestratorState.lastSentimentAt
    : orchestratorState.lastDeepReasoningAt;
  
  if (!lastRun) return true;
  
  const interval = mode === "CONTRARIAN_SCAN" ? config.contrarianIntervalMs
    : mode === "SENTIMENT_BURST" ? config.sentimentIntervalMs
    : config.deepReasoningIntervalMs;
  
  return now.getTime() - lastRun.getTime() >= interval;
}

function getCurrentMinuteOffset(): number {
  return new Date().getMinutes();
}

function isStaggeredSlot(mode: GrokResearchDepth): boolean {
  const currentMinute = getCurrentMinuteOffset();
  const targetOffset = STAGGERED_OFFSETS[mode];
  
  if (mode === "SENTIMENT_BURST") {
    return currentMinute === 5 || currentMinute === 35;
  }
  
  return currentMinute >= targetOffset && currentMinute < targetOffset + 5;
}

async function queueResearchJob(mode: GrokResearchDepth, context?: GrokResearchContext): Promise<string | null> {
  const quotaCheck = await checkProviderQuota();
  if (!quotaCheck.allowed) {
    console.log(`${LOG_PREFIX} Quota blocked for ${mode}: ${quotaCheck.reason}`);
    return null;
  }
  
  const costCheck = await checkDailyCostLimit();
  if (!costCheck.allowed) {
    console.log(`${LOG_PREFIX} Cost limit blocked for ${mode}: ${costCheck.reason}`);
    return null;
  }
  
  if (orchestratorState.runningJobs.size >= config.maxConcurrentJobs) {
    console.log(`${LOG_PREFIX} Max concurrent jobs (${config.maxConcurrentJobs}) reached, deferring ${mode}`);
    
    const [job] = await db.insert(researchJobs)
      .values({
        mode: mode as any,
        status: "DEFERRED",
        costClass: COST_CLASS_MAP[mode],
        priority: PRIORITY_MAP[mode],
        contextJson: context,
        deferredReason: "Max concurrent jobs reached",
        traceId: crypto.randomUUID(),
      })
      .returning();
    
    return job.id;
  }
  
  const traceId = crypto.randomUUID();
  const [job] = await db.insert(researchJobs)
    .values({
      mode: mode as any,
      status: "QUEUED",
      costClass: COST_CLASS_MAP[mode],
      priority: PRIORITY_MAP[mode],
      scheduledFor: new Date(),
      contextJson: context,
      traceId,
    })
    .returning();
  
  console.log(`${LOG_PREFIX} Queued ${mode} job ${job.id}`);
  return job.id;
}

async function executeJob(job: ResearchJob): Promise<void> {
  const mode = job.mode as GrokResearchDepth;
  
  await db.update(researchJobs)
    .set({ 
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(researchJobs.id, job.id));
  
  orchestratorState.runningJobs.set(job.id, job);
  
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const regime = await detectMarketRegime("MES", thirtyDaysAgo, now, job.traceId || crypto.randomUUID());
    const context: GrokResearchContext = {
      grokDepth: mode,
      currentRegime: regime.regime,
      ...(job.contextJson as GrokResearchContext || {}),
    };
    
    console.log(`${LOG_PREFIX} Executing ${mode} job ${job.id}`);
    const result = await runGrokResearch(context);
    
    if (mode === "CONTRARIAN_SCAN") orchestratorState.lastContrarianAt = new Date();
    else if (mode === "SENTIMENT_BURST") orchestratorState.lastSentimentAt = new Date();
    else orchestratorState.lastDeepReasoningAt = new Date();
    
    const costUsd = result.usage?.costUsd || 0;
    orchestratorState.dailyCostUsd += costUsd;
    orchestratorState.dailyJobCount++;
    
    let candidatesCreated = 0;
    if (result.success && result.candidates.length > 0) {
      for (const candidate of result.candidates) {
        const fingerprint = generateCandidateFingerprint({
          archetypeName: candidate.archetypeName,
          hypothesis: candidate.hypothesis,
          rulesJson: candidate.rules,
          regimeContext: regime.regime,
        });
        
        const { isDuplicate, existingId } = await checkDuplicate(fingerprint);
        if (isDuplicate) {
          console.log(`${LOG_PREFIX} Duplicate candidate detected, linking to ${existingId}`);
          continue;
        }
        
        candidatesCreated++;
      }
    }
    
    await db.update(researchJobs)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        resultJson: { 
          success: result.success, 
          candidateCount: result.candidates.length,
          xInsights: result.xInsights,
        },
        candidatesCreated,
        costUsd,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, job.id));
    
    await logActivityEvent({
      eventType: "RESEARCH_JOB_COMPLETED",
      title: `${mode} research completed`,
      summary: `${candidatesCreated} new candidates, ${result.candidates.length - candidatesCreated} duplicates filtered`,
      severity: "INFO",
      provider: "research-orchestrator",
      payload: { 
        mode, 
        jobId: job.id, 
        candidatesCreated, 
        costUsd,
        duplicatesFiltered: result.candidates.length - candidatesCreated,
      },
    });
    
  } catch (error) {
    const retryCount = (job.retryCount ?? 0) + 1;
    const maxRetries = job.maxRetries ?? 3;
    
    await db.update(researchJobs)
      .set({
        status: retryCount < maxRetries ? "QUEUED" : "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        retryCount,
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, job.id));
    
    console.error(`${LOG_PREFIX} Job ${job.id} failed:`, error);
  } finally {
    orchestratorState.runningJobs.delete(job.id);
  }
}

async function processJobQueue(): Promise<void> {
  if (orchestratorState.runningJobs.size >= config.maxConcurrentJobs) {
    return;
  }
  
  const pendingJobs = await db.query.researchJobs.findMany({
    where: and(
      eq(researchJobs.status, "QUEUED"),
      or(
        isNull(researchJobs.scheduledFor),
        lt(researchJobs.scheduledFor, new Date())
      )
    ),
    orderBy: [desc(researchJobs.priority)],
    limit: config.maxConcurrentJobs - orchestratorState.runningJobs.size,
  });
  
  for (const job of pendingJobs) {
    executeJob(job);
  }
}

async function checkAndScheduleJobs(): Promise<void> {
  if (!orchestratorState.isFullSpectrumEnabled) return;
  
  const now = new Date();
  const modes: GrokResearchDepth[] = ["SENTIMENT_BURST", "CONTRARIAN_SCAN", "DEEP_REASONING"];
  
  for (const mode of modes) {
    if (shouldRunMode(mode, now) && isStaggeredSlot(mode)) {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const regime = await detectMarketRegime("MES", thirtyDaysAgo, now, crypto.randomUUID());
      await queueResearchJob(mode, { currentRegime: regime.regime });
    }
  }
  
  await processJobQueue();
}

async function resetDailyCounters(): Promise<void> {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() < 5) {
    orchestratorState.dailyCostUsd = 0;
    orchestratorState.dailyJobCount = 0;
    console.log(`${LOG_PREFIX} Daily counters reset`);
  }
}

export async function startOrchestrator(): Promise<void> {
  if (orchestratorInterval) {
    console.log(`${LOG_PREFIX} Orchestrator already running`);
    return;
  }
  
  const state = await db.query.researchOrchestratorState.findFirst({
    orderBy: [desc(researchOrchestratorState.createdAt)],
  });
  
  if (state) {
    orchestratorState.isFullSpectrumEnabled = state.isFullSpectrumEnabled ?? false;
    orchestratorState.lastContrarianAt = state.lastContrarianAt;
    orchestratorState.lastSentimentAt = state.lastSentimentAt;
    orchestratorState.lastDeepReasoningAt = state.lastDeepReasoningAt;
    orchestratorState.dailyCostUsd = state.totalCostToday ?? 0;
    orchestratorState.dailyJobCount = state.totalJobsToday ?? 0;
  }
  
  orchestratorInterval = setInterval(async () => {
    try {
      await resetDailyCounters();
      await checkAndScheduleJobs();
    } catch (error) {
      console.error(`${LOG_PREFIX} Orchestrator tick error:`, error);
    }
  }, 60_000);
  
  console.log(`${LOG_PREFIX} Started - Full Spectrum: ${orchestratorState.isFullSpectrumEnabled}`);
  
  await logActivityEvent({
    eventType: "RESEARCH_ORCHESTRATOR_STARTED",
    title: "Research Orchestrator started",
    summary: `Full Spectrum mode: ${orchestratorState.isFullSpectrumEnabled ? "ENABLED" : "DISABLED"}`,
    severity: "INFO",
    provider: "research-orchestrator",
    payload: { fullSpectrum: orchestratorState.isFullSpectrumEnabled },
  });

  try {
    const { startObservabilityLoop } = await import("./orchestrator-observability");
    startObservabilityLoop();
    console.log(`${LOG_PREFIX} Observability loop started`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to start observability loop:`, err);
  }
}

export async function stopOrchestrator(): Promise<void> {
  if (orchestratorInterval) {
    clearInterval(orchestratorInterval);
    orchestratorInterval = null;
    console.log(`${LOG_PREFIX} Stopped`);
  }

  try {
    const { stopObservabilityLoop } = await import("./orchestrator-observability");
    stopObservabilityLoop();
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to stop observability loop:`, err);
  }
}

export async function triggerManualRun(mode: GrokResearchDepth): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const quotaCheck = await checkProviderQuota();
  if (!quotaCheck.allowed) {
    return { success: false, error: quotaCheck.reason };
  }
  
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const regime = await detectMarketRegime("MES", thirtyDaysAgo, now, crypto.randomUUID());
  const jobId = await queueResearchJob(mode, { 
    grokDepth: mode,
    currentRegime: regime.regime,
  });
  
  if (jobId) {
    processJobQueue();
    return { success: true, jobId };
  }
  
  return { success: false, error: "Failed to queue job" };
}

export async function getRecentJobs(limit = 20): Promise<ResearchJob[]> {
  return db.query.researchJobs.findMany({
    orderBy: [desc(researchJobs.createdAt)],
    limit,
  });
}

export async function cleanupExpiredFingerprints(): Promise<number> {
  const result = await db.delete(candidateFingerprints)
    .where(lt(candidateFingerprints.expiresAt, new Date()))
    .returning();
  
  return result.length;
}
