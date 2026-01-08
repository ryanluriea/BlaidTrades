/**
 * Test Database Context - Industry Standard Transaction Rollback Pattern
 * 
 * Each test runs inside a database transaction that gets rolled back after
 * the test completes. This provides:
 * - Real Drizzle queries against real Postgres
 * - Full test isolation (no data persists between tests)
 * - Production-identical query behavior
 */

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, gt, lt, gte, lte, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

const { Pool } = pg;
type PoolClient = pg.PoolClient;

export type TestDb = NodePgDatabase<typeof schema>;

export interface TestContext {
  db: TestDb;
  client: PoolClient;
  time: TimeController;
  seed: SeedHelpers;
  cleanup: () => Promise<void>;
}

export interface TimeController {
  now: Date;
  getCurrentTime: () => Date;
  setTime: (date: Date) => void;
  advanceMinutes: (minutes: number) => void;
  advanceHours: (hours: number) => void;
  advanceDays: (days: number) => void;
}

export interface SeedHelpers {
  seedResearchJob: (overrides?: Partial<schema.InsertResearchJob>) => Promise<schema.ResearchJob>;
  seedFingerprint: (overrides?: Partial<schema.InsertCandidateFingerprint>) => Promise<schema.CandidateFingerprint>;
  seedOrchestratorState: (overrides?: Partial<Omit<schema.ResearchOrchestratorState, 'id'>>) => Promise<schema.ResearchOrchestratorState>;
  seedStrategyCandidate: (overrides?: Partial<schema.InsertStrategyCandidate>) => Promise<schema.StrategyCandidate>;
}

let testPool: pg.Pool | null = null;

function getTestPool(): pg.Pool {
  if (!testPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL must be set for database tests");
    }
    testPool = new Pool({ 
      connectionString,
      max: 10,
    });
  }
  return testPool;
}

export async function closeTestPool(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

function createTimeController(): TimeController {
  let currentTime = new Date();
  
  return {
    get now() { return currentTime; },
    getCurrentTime: () => currentTime,
    setTime: (date: Date) => { currentTime = new Date(date); },
    advanceMinutes: (minutes: number) => {
      currentTime = new Date(currentTime.getTime() + minutes * 60 * 1000);
    },
    advanceHours: (hours: number) => {
      currentTime = new Date(currentTime.getTime() + hours * 60 * 60 * 1000);
    },
    advanceDays: (days: number) => {
      currentTime = new Date(currentTime.getTime() + days * 24 * 60 * 60 * 1000);
    },
  };
}

function createSeedHelpers(db: TestDb, time: TimeController): SeedHelpers {
  return {
    seedResearchJob: async (overrides = {}) => {
      const defaults: schema.InsertResearchJob = {
        mode: 'SENTIMENT_BURST',
        status: 'QUEUED',
        priority: 50,
        costClass: 'LOW',
        ...overrides,
      };
      
      const [job] = await db.insert(schema.researchJobs).values(defaults).returning();
      return job;
    },
    
    seedFingerprint: async (overrides = {}) => {
      const now = time.getCurrentTime();
      const defaults: schema.InsertCandidateFingerprint = {
        fingerprintHash: `test-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        hitCount: 1,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ...overrides,
      };
      
      const [fingerprint] = await db.insert(schema.candidateFingerprints).values(defaults).returning();
      return fingerprint;
    },
    
    seedOrchestratorState: async (overrides = {}) => {
      const now = time.getCurrentTime();
      
      const existing = await db.query.researchOrchestratorState.findFirst();
      
      if (existing) {
        const [updated] = await db
          .update(schema.researchOrchestratorState)
          .set({
            isFullSpectrumEnabled: overrides.isFullSpectrumEnabled ?? existing.isFullSpectrumEnabled,
            lastSentimentAt: overrides.lastSentimentAt ?? existing.lastSentimentAt,
            lastContrarianAt: overrides.lastContrarianAt ?? existing.lastContrarianAt,
            lastDeepReasoningAt: overrides.lastDeepReasoningAt ?? existing.lastDeepReasoningAt,
            updatedAt: now,
          })
          .where(eq(schema.researchOrchestratorState.id, existing.id))
          .returning();
        return updated;
      }
      
      const [state] = await db.insert(schema.researchOrchestratorState).values({
        isFullSpectrumEnabled: overrides.isFullSpectrumEnabled ?? false,
        lastSentimentAt: overrides.lastSentimentAt ?? null,
        lastContrarianAt: overrides.lastContrarianAt ?? null,
        lastDeepReasoningAt: overrides.lastDeepReasoningAt ?? null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return state;
    },
    
    seedStrategyCandidate: async (overrides = {}) => {
      const defaults: schema.InsertStrategyCandidate = {
        strategyName: overrides.strategyName || `Test Strategy ${Date.now()}`,
        archetypeName: 'momentum',
        hypothesis: 'Test hypothesis',
        rulesJson: {},
        disposition: 'PENDING_REVIEW',
        confidenceScore: 75,
        noveltyScore: 80,
        ...overrides,
      };
      
      const [candidate] = await db.insert(schema.strategyCandidates).values(defaults).returning();
      return candidate;
    },
  };
}

/**
 * Create a test context with transaction isolation.
 * 
 * The transaction is NOT auto-committed - you must call cleanup() to rollback.
 * This is typically done in afterEach().
 * 
 * Usage:
 * ```ts
 * let ctx: TestContext;
 * 
 * beforeEach(async () => {
 *   ctx = await createTestContext();
 * });
 * 
 * afterEach(async () => {
 *   await ctx.cleanup();
 * });
 * 
 * it('test', async () => {
 *   const job = await ctx.seed.seedResearchJob({ status: 'QUEUED' });
 *   const found = await ctx.db.query.researchJobs.findFirst({
 *     where: eq(schema.researchJobs.id, job.id)
 *   });
 *   expect(found).toBeDefined();
 * });
 * ```
 */
export async function createTestContext(): Promise<TestContext> {
  const pool = getTestPool();
  const client = await pool.connect();
  
  await client.query('BEGIN');
  
  const db = drizzle(client, { schema }) as unknown as TestDb;
  const time = createTimeController();
  const seed = createSeedHelpers(db, time);
  
  const cleanup = async () => {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  };
  
  return { db, client, time, seed, cleanup };
}

export { schema, eq, and, gt, lt, gte, lte, sql };
