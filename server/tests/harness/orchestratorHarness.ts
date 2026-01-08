/**
 * Orchestrator Test Harness
 * 
 * Provides an in-memory database store with Drizzle-like query interface
 * for true end-to-end orchestrator testing with deterministic time control.
 * 
 * Features:
 * - In-memory storage for all orchestrator-related tables
 * - Drizzle-compatible query interface
 * - Fake timer integration (vi.useFakeTimers)
 * - Seed/reset helpers for test setup
 * - Time advancement utilities with orchestrator tick triggers
 */

import { vi } from 'vitest';

type ResearchJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DEFERRED' | 'CANCELLED';
type ResearchCostClass = 'LOW' | 'MEDIUM' | 'HIGH';
type ResearchMode = 'CONTRARIAN_SCAN' | 'SENTIMENT_BURST' | 'DEEP_REASONING' | 'FULL_SPECTRUM';

export interface MockResearchJob {
  id: string;
  mode: ResearchMode;
  status: ResearchJobStatus;
  costClass: ResearchCostClass;
  priority: number;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  contextJson: any;
  resultJson: any;
  candidatesCreated: number;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  fingerprintHash: string | null;
  deferredReason: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  traceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockCandidateFingerprint {
  id: string;
  fingerprintHash: string;
  candidateId: string | null;
  rulesHash: string | null;
  hypothesisVector: string | null;
  archetypeName: string | null;
  regimeContext: string | null;
  hitCount: number;
  lastSeenAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface MockOrchestratorState {
  id: string;
  isFullSpectrumEnabled: boolean;
  lastContrarianAt: Date | null;
  lastSentimentAt: Date | null;
  lastDeepReasoningAt: Date | null;
  contrarianBackpressure: number;
  sentimentBackpressure: number;
  deepReasoningBackpressure: number;
  totalJobsToday: number;
  totalCostToday: number;
  providerQuotaJson: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockLlmBudget {
  id: number;
  provider: string;
  dailyBudget: number;
  usedToday: number;
  periodBudget: number;
  usedPeriod: number;
  lastResetAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockStrategyCandidate {
  id: string;
  name: string;
  archetypeName: string;
  hypothesis: string;
  rulesJson: any;
  disposition: string;
  confidenceScore: number;
  noveltyScore: number;
  createdAt: Date;
}

export class InMemoryStore {
  researchJobs: Map<string, MockResearchJob> = new Map();
  candidateFingerprints: Map<string, MockCandidateFingerprint> = new Map();
  orchestratorState: Map<string, MockOrchestratorState> = new Map();
  llmBudgets: Map<number, MockLlmBudget> = new Map();
  strategyCandidates: Map<string, MockStrategyCandidate> = new Map();
  
  private idCounter = 1;
  
  generateUUID(): string {
    return `test-uuid-${this.idCounter++}-${Date.now()}`;
  }
  
  generateId(): number {
    return this.idCounter++;
  }
  
  reset(): void {
    this.researchJobs.clear();
    this.candidateFingerprints.clear();
    this.orchestratorState.clear();
    this.llmBudgets.clear();
    this.strategyCandidates.clear();
    this.idCounter = 1;
  }
}

export function createMockDbQuery(store: InMemoryStore) {
  return {
    researchJobs: {
      findFirst: vi.fn().mockImplementation(async (opts?: { where?: any; orderBy?: any }) => {
        const jobs = Array.from(store.researchJobs.values());
        if (opts?.where) {
          return jobs.find(j => matchWhere(j, opts.where)) || null;
        }
        return jobs[0] || null;
      }),
      findMany: vi.fn().mockImplementation(async (opts?: { where?: any; orderBy?: any; limit?: number }) => {
        let jobs = Array.from(store.researchJobs.values());
        if (opts?.where) {
          jobs = jobs.filter(j => matchWhere(j, opts.where));
        }
        if (opts?.limit) {
          jobs = jobs.slice(0, opts.limit);
        }
        return jobs;
      }),
    },
    candidateFingerprints: {
      findFirst: vi.fn().mockImplementation(async (opts?: { where?: any }) => {
        const fingerprints = Array.from(store.candidateFingerprints.values());
        if (opts?.where) {
          return fingerprints.find(f => matchWhere(f, opts.where)) || null;
        }
        return fingerprints[0] || null;
      }),
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(store.candidateFingerprints.values());
      }),
    },
    researchOrchestratorState: {
      findFirst: vi.fn().mockImplementation(async () => {
        const states = Array.from(store.orchestratorState.values());
        return states[0] || null;
      }),
    },
    llmBudgets: {
      findFirst: vi.fn().mockImplementation(async (opts?: { where?: any }) => {
        const budgets = Array.from(store.llmBudgets.values());
        if (opts?.where) {
          return budgets.find(b => matchWhere(b, opts.where)) || null;
        }
        return budgets[0] || null;
      }),
    },
    strategyCandidates: {
      findFirst: vi.fn().mockImplementation(async (opts?: { where?: any }) => {
        const candidates = Array.from(store.strategyCandidates.values());
        if (opts?.where) {
          return candidates.find(c => matchWhere(c, opts.where)) || null;
        }
        return candidates[0] || null;
      }),
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(store.strategyCandidates.values());
      }),
    },
  };
}

/**
 * Match an object against a Drizzle-style where clause.
 * Supports the common patterns used in orchestrator code:
 * - Direct field comparison from eq() calls
 * - Extracting field/value from Drizzle SQL expression objects
 */
function matchWhere(obj: any, where: any): boolean {
  if (!where) return true;
  
  try {
    if (typeof where === 'function') {
      return where(obj);
    }
    
    if (typeof where === 'object') {
      if (where.queryChunks || where.sql) {
        const extracted = extractDrizzleCondition(where);
        if (extracted) {
          return matchConditions(obj, extracted);
        }
      }
      
      if (Array.isArray(where)) {
        return where.every(cond => matchWhere(obj, cond));
      }
      
      if (where.field && 'value' in where) {
        const fieldName = normalizeFieldName(where.field);
        return obj[fieldName] === where.value;
      }
      
      return Object.entries(where).every(([key, value]) => {
        const normalizedKey = normalizeFieldName(key);
        if (value && typeof value === 'object' && 'value' in value) {
          return obj[normalizedKey] === value.value;
        }
        return obj[normalizedKey] === value;
      });
    }
    
    return true;
  } catch {
    return true;
  }
}

function extractDrizzleCondition(expr: any): Record<string, any> | null {
  try {
    if (expr.queryChunks && Array.isArray(expr.queryChunks)) {
      const chunks = expr.queryChunks;
      const conditions: Record<string, any> = {};
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk && typeof chunk === 'object') {
          if (chunk.name && i + 2 < chunks.length) {
            const fieldName = normalizeFieldName(chunk.name);
            const valueChunk = chunks[i + 2];
            if (valueChunk && typeof valueChunk === 'object' && 'value' in valueChunk) {
              conditions[fieldName] = valueChunk.value;
            }
          }
        }
      }
      
      if (Object.keys(conditions).length > 0) {
        return conditions;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

function matchConditions(obj: any, conditions: Record<string, any>): boolean {
  return Object.entries(conditions).every(([key, value]) => {
    const normalizedKey = normalizeFieldName(key);
    return obj[normalizedKey] === value;
  });
}

function normalizeFieldName(field: string): string {
  return field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

export function createMockDb(store: InMemoryStore) {
  const mockQuery = createMockDbQuery(store);
  
  let pendingInsert: { table: string; data: any } | null = null;
  let pendingUpdate: { table: string; data: any; where?: any } | null = null;
  
  const mockDb = {
    query: mockQuery,
    
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table: any) => {
      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(async () => {
          return [];
        }),
      };
    }),
    
    insert: vi.fn().mockImplementation((table: any) => {
      const tableName = getTableName(table);
      return {
        values: vi.fn().mockImplementation((data: any) => {
          pendingInsert = { table: tableName, data };
          return {
            returning: vi.fn().mockImplementation(async () => {
              if (!pendingInsert) return [];
              const { table, data } = pendingInsert;
              const record = insertRecord(store, table, data);
              pendingInsert = null;
              return [record];
            }),
            onConflictDoUpdate: vi.fn().mockReturnThis(),
            onConflictDoNothing: vi.fn().mockReturnThis(),
          };
        }),
      };
    }),
    
    update: vi.fn().mockImplementation((table: any) => {
      const tableName = getTableName(table);
      return {
        set: vi.fn().mockImplementation((data: any) => {
          pendingUpdate = { table: tableName, data };
          return {
            where: vi.fn().mockImplementation(async (whereClause: any) => {
              if (!pendingUpdate) return [];
              const updated = updateRecord(store, pendingUpdate.table, pendingUpdate.data, whereClause);
              pendingUpdate = null;
              return updated;
            }),
            returning: vi.fn().mockImplementation(async () => {
              if (!pendingUpdate) return [];
              const updated = updateRecord(store, pendingUpdate.table, pendingUpdate.data, null);
              pendingUpdate = null;
              return updated;
            }),
          };
        }),
      };
    }),
    
    delete: vi.fn().mockImplementation((table: any) => {
      const tableName = getTableName(table);
      return {
        where: vi.fn().mockImplementation(async (whereClause: any) => {
          return deleteRecord(store, tableName, whereClause);
        }),
      };
    }),
  };
  
  return mockDb;
}

function getTableName(table: any): string {
  if (typeof table === 'string') return table;
  if (table?.name) return table.name;
  if (table?._?.name) return table._.name;
  return 'unknown';
}

function insertRecord(store: InMemoryStore, tableName: string, data: any): any {
  const now = new Date();
  
  switch (tableName) {
    case 'research_jobs':
    case 'researchJobs': {
      const id = store.generateUUID();
      const record: MockResearchJob = {
        id,
        mode: data.mode || 'SENTIMENT_BURST',
        status: data.status || 'QUEUED',
        costClass: data.costClass || 'LOW',
        priority: data.priority ?? 50,
        scheduledFor: data.scheduledFor || null,
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        contextJson: data.contextJson || null,
        resultJson: data.resultJson || null,
        candidatesCreated: data.candidatesCreated ?? 0,
        errorMessage: data.errorMessage || null,
        retryCount: data.retryCount ?? 0,
        maxRetries: data.maxRetries ?? 3,
        fingerprintHash: data.fingerprintHash || null,
        deferredReason: data.deferredReason || null,
        costUsd: data.costUsd || null,
        inputTokens: data.inputTokens || null,
        outputTokens: data.outputTokens || null,
        traceId: data.traceId || null,
        createdAt: now,
        updatedAt: now,
      };
      store.researchJobs.set(id, record);
      return record;
    }
    
    case 'candidate_fingerprints':
    case 'candidateFingerprints': {
      const id = store.generateUUID();
      const record: MockCandidateFingerprint = {
        id,
        fingerprintHash: data.fingerprintHash,
        candidateId: data.candidateId || null,
        rulesHash: data.rulesHash || null,
        hypothesisVector: data.hypothesisVector || null,
        archetypeName: data.archetypeName || null,
        regimeContext: data.regimeContext || null,
        hitCount: data.hitCount ?? 1,
        lastSeenAt: now,
        expiresAt: data.expiresAt || null,
        createdAt: now,
      };
      store.candidateFingerprints.set(id, record);
      return record;
    }
    
    case 'research_orchestrator_state':
    case 'researchOrchestratorState': {
      const id = store.generateUUID();
      const record: MockOrchestratorState = {
        id,
        isFullSpectrumEnabled: data.isFullSpectrumEnabled ?? false,
        lastContrarianAt: data.lastContrarianAt || null,
        lastSentimentAt: data.lastSentimentAt || null,
        lastDeepReasoningAt: data.lastDeepReasoningAt || null,
        contrarianBackpressure: data.contrarianBackpressure ?? 0,
        sentimentBackpressure: data.sentimentBackpressure ?? 0,
        deepReasoningBackpressure: data.deepReasoningBackpressure ?? 0,
        totalJobsToday: data.totalJobsToday ?? 0,
        totalCostToday: data.totalCostToday ?? 0,
        providerQuotaJson: data.providerQuotaJson || null,
        createdAt: now,
        updatedAt: now,
      };
      store.orchestratorState.set(id, record);
      return record;
    }
    
    case 'llm_budgets':
    case 'llmBudgets': {
      const id = store.generateId();
      const record: MockLlmBudget = {
        id,
        provider: data.provider || 'xai',
        dailyBudget: data.dailyBudget ?? 50,
        usedToday: data.usedToday ?? 0,
        periodBudget: data.periodBudget ?? 500,
        usedPeriod: data.usedPeriod ?? 0,
        lastResetAt: now,
        createdAt: now,
        updatedAt: now,
      };
      store.llmBudgets.set(id, record);
      return record;
    }
    
    case 'strategy_candidates':
    case 'strategyCandidates': {
      const id = store.generateUUID();
      const record: MockStrategyCandidate = {
        id,
        name: data.name || 'Test Candidate',
        archetypeName: data.archetypeName || 'momentum',
        hypothesis: data.hypothesis || 'Test hypothesis',
        rulesJson: data.rulesJson || {},
        disposition: data.disposition || 'QUEUED_FOR_QC',
        confidenceScore: data.confidenceScore ?? 75,
        noveltyScore: data.noveltyScore ?? 80,
        createdAt: now,
      };
      store.strategyCandidates.set(id, record);
      return record;
    }
    
    default:
      return { id: store.generateUUID(), ...data };
  }
}

function updateRecord(store: InMemoryStore, tableName: string, data: any, whereClause: any): any[] {
  const now = new Date();
  
  switch (tableName) {
    case 'research_jobs':
    case 'researchJobs': {
      const updated: any[] = [];
      store.researchJobs.forEach((job, id) => {
        Object.assign(job, data, { updatedAt: now });
        updated.push(job);
      });
      return updated;
    }
    
    case 'research_orchestrator_state':
    case 'researchOrchestratorState': {
      const updated: any[] = [];
      store.orchestratorState.forEach((state, id) => {
        Object.assign(state, data, { updatedAt: now });
        updated.push(state);
      });
      return updated;
    }
    
    case 'llm_budgets':
    case 'llmBudgets': {
      const updated: any[] = [];
      store.llmBudgets.forEach((budget, id) => {
        Object.assign(budget, data, { updatedAt: now });
        updated.push(budget);
      });
      return updated;
    }
    
    default:
      return [];
  }
}

function deleteRecord(store: InMemoryStore, tableName: string, whereClause: any): number {
  switch (tableName) {
    case 'research_jobs':
    case 'researchJobs': {
      const sizeBefore = store.researchJobs.size;
      store.researchJobs.clear();
      return sizeBefore;
    }
    
    case 'candidate_fingerprints':
    case 'candidateFingerprints': {
      const sizeBefore = store.candidateFingerprints.size;
      store.candidateFingerprints.clear();
      return sizeBefore;
    }
    
    default:
      return 0;
  }
}

export interface TimeController {
  advanceMinutes: (minutes: number) => Promise<void>;
  advanceHours: (hours: number) => Promise<void>;
  setTime: (date: Date) => void;
  getCurrentTime: () => Date;
  runAllTimers: () => Promise<void>;
}

export function createTimeController(): TimeController {
  let currentTime = new Date('2025-01-05T10:00:00Z');
  
  return {
    advanceMinutes: async (minutes: number) => {
      currentTime = new Date(currentTime.getTime() + minutes * 60 * 1000);
      vi.setSystemTime(currentTime);
      await vi.runAllTimersAsync();
    },
    
    advanceHours: async (hours: number) => {
      currentTime = new Date(currentTime.getTime() + hours * 60 * 60 * 1000);
      vi.setSystemTime(currentTime);
      await vi.runAllTimersAsync();
    },
    
    setTime: (date: Date) => {
      currentTime = date;
      vi.setSystemTime(date);
    },
    
    getCurrentTime: () => currentTime,
    
    runAllTimers: async () => {
      await vi.runAllTimersAsync();
    },
  };
}

export interface SeedHelpers {
  seedLlmBudget: (opts?: Partial<MockLlmBudget>) => MockLlmBudget;
  seedResearchJob: (opts?: Partial<MockResearchJob>) => MockResearchJob;
  seedOrchestratorState: (opts?: Partial<MockOrchestratorState>) => MockOrchestratorState;
  seedFingerprint: (opts?: Partial<MockCandidateFingerprint>) => MockCandidateFingerprint;
  seedCandidate: (opts?: Partial<MockStrategyCandidate>) => MockStrategyCandidate;
}

export function createSeedHelpers(store: InMemoryStore): SeedHelpers {
  const now = new Date();
  
  return {
    seedLlmBudget: (opts = {}) => {
      const id = store.generateId();
      const record: MockLlmBudget = {
        id,
        provider: opts.provider ?? 'xai',
        dailyBudget: opts.dailyBudget ?? 50,
        usedToday: opts.usedToday ?? 0,
        periodBudget: opts.periodBudget ?? 500,
        usedPeriod: opts.usedPeriod ?? 0,
        lastResetAt: opts.lastResetAt ?? now,
        createdAt: opts.createdAt ?? now,
        updatedAt: opts.updatedAt ?? now,
      };
      store.llmBudgets.set(id, record);
      return record;
    },
    
    seedResearchJob: (opts = {}) => {
      const id = store.generateUUID();
      const record: MockResearchJob = {
        id: opts.id ?? id,
        mode: opts.mode ?? 'SENTIMENT_BURST',
        status: opts.status ?? 'QUEUED',
        costClass: opts.costClass ?? 'LOW',
        priority: opts.priority ?? 50,
        scheduledFor: opts.scheduledFor ?? null,
        startedAt: opts.startedAt ?? null,
        completedAt: opts.completedAt ?? null,
        contextJson: opts.contextJson ?? null,
        resultJson: opts.resultJson ?? null,
        candidatesCreated: opts.candidatesCreated ?? 0,
        errorMessage: opts.errorMessage ?? null,
        retryCount: opts.retryCount ?? 0,
        maxRetries: opts.maxRetries ?? 3,
        fingerprintHash: opts.fingerprintHash ?? null,
        deferredReason: opts.deferredReason ?? null,
        costUsd: opts.costUsd ?? null,
        inputTokens: opts.inputTokens ?? null,
        outputTokens: opts.outputTokens ?? null,
        traceId: opts.traceId ?? null,
        createdAt: opts.createdAt ?? now,
        updatedAt: opts.updatedAt ?? now,
      };
      store.researchJobs.set(record.id, record);
      return record;
    },
    
    seedOrchestratorState: (opts = {}) => {
      const id = store.generateUUID();
      const record: MockOrchestratorState = {
        id: opts.id ?? id,
        isFullSpectrumEnabled: opts.isFullSpectrumEnabled ?? false,
        lastContrarianAt: opts.lastContrarianAt ?? null,
        lastSentimentAt: opts.lastSentimentAt ?? null,
        lastDeepReasoningAt: opts.lastDeepReasoningAt ?? null,
        contrarianBackpressure: opts.contrarianBackpressure ?? 0,
        sentimentBackpressure: opts.sentimentBackpressure ?? 0,
        deepReasoningBackpressure: opts.deepReasoningBackpressure ?? 0,
        totalJobsToday: opts.totalJobsToday ?? 0,
        totalCostToday: opts.totalCostToday ?? 0,
        providerQuotaJson: opts.providerQuotaJson ?? null,
        createdAt: opts.createdAt ?? now,
        updatedAt: opts.updatedAt ?? now,
      };
      store.orchestratorState.set(record.id, record);
      return record;
    },
    
    seedFingerprint: (opts = {}) => {
      const id = store.generateUUID();
      const record: MockCandidateFingerprint = {
        id: opts.id ?? id,
        fingerprintHash: opts.fingerprintHash ?? `fp_${id}`,
        candidateId: opts.candidateId ?? null,
        rulesHash: opts.rulesHash ?? null,
        hypothesisVector: opts.hypothesisVector ?? null,
        archetypeName: opts.archetypeName ?? null,
        regimeContext: opts.regimeContext ?? null,
        hitCount: opts.hitCount ?? 1,
        lastSeenAt: opts.lastSeenAt ?? now,
        expiresAt: opts.expiresAt ?? null,
        createdAt: opts.createdAt ?? now,
      };
      store.candidateFingerprints.set(record.id, record);
      return record;
    },
    
    seedCandidate: (opts = {}) => {
      const id = store.generateUUID();
      const record: MockStrategyCandidate = {
        id: opts.id ?? id,
        name: opts.name ?? 'Test Strategy',
        archetypeName: opts.archetypeName ?? 'momentum',
        hypothesis: opts.hypothesis ?? 'Test hypothesis',
        rulesJson: opts.rulesJson ?? {},
        disposition: opts.disposition ?? 'QUEUED_FOR_QC',
        confidenceScore: opts.confidenceScore ?? 75,
        noveltyScore: opts.noveltyScore ?? 80,
        createdAt: opts.createdAt ?? now,
      };
      store.strategyCandidates.set(record.id, record);
      return record;
    },
  };
}

export interface OrchestratorHarness {
  store: InMemoryStore;
  mockDb: ReturnType<typeof createMockDb>;
  time: TimeController;
  seed: SeedHelpers;
  reset: () => void;
  getJobCount: () => number;
  getJobsByStatus: (status: ResearchJobStatus) => MockResearchJob[];
  getTotalCost: () => number;
  getFingerprintCount: () => number;
}

export function createOrchestratorHarness(): OrchestratorHarness {
  const store = new InMemoryStore();
  const mockDb = createMockDb(store);
  const time = createTimeController();
  const seed = createSeedHelpers(store);
  
  return {
    store,
    mockDb,
    time,
    seed,
    
    reset: () => {
      store.reset();
      vi.clearAllMocks();
    },
    
    getJobCount: () => store.researchJobs.size,
    
    getJobsByStatus: (status: ResearchJobStatus) => {
      return Array.from(store.researchJobs.values()).filter(j => j.status === status);
    },
    
    getTotalCost: () => {
      let total = 0;
      store.researchJobs.forEach(job => {
        if (job.costUsd) total += job.costUsd;
      });
      return total;
    },
    
    getFingerprintCount: () => store.candidateFingerprints.size,
  };
}

export function setupFakeTimers(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-05T10:00:00Z'));
}

export function teardownFakeTimers(): void {
  vi.useRealTimers();
}
