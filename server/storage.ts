import { db } from "./db";
import { eq, desc, and, or, isNull, sql, gte, lte, lt, gt, count, avg, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import { processBlownAccountRecovery } from "./blown-account-recovery";

export interface IStorage {
  getUser(id: string): Promise<schema.User | undefined>;
  getUserByEmail(email: string): Promise<schema.User | undefined>;
  createUser(user: schema.InsertUser): Promise<schema.User>;
  updateUser(id: string, updates: Partial<schema.User>): Promise<schema.User | undefined>;
  updateUserProfile(id: string, profile: { username: string }): Promise<void>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  updateUserEmail(id: string, email: string): Promise<void>;
  
  getBots(userId: string): Promise<schema.Bot[]>;
  getAllActiveBots(): Promise<schema.Bot[]>;
  getBot(id: string): Promise<schema.Bot | undefined>;
  createBot(bot: schema.InsertBot): Promise<schema.Bot>;
  updateBot(id: string, updates: Partial<schema.Bot>): Promise<schema.Bot | undefined>;
  deleteBot(id: string): Promise<boolean>;
  
  getAccounts(userId: string): Promise<schema.Account[]>;
  getAccount(id: string): Promise<schema.Account | undefined>;
  createAccount(account: schema.InsertAccount): Promise<schema.Account>;
  updateAccount(id: string, updates: Partial<schema.Account>): Promise<schema.Account | undefined>;
  deleteAccount(id: string): Promise<boolean>;
  
  getBacktestSessions(botId: string): Promise<schema.BacktestSession[]>;
  getAllBacktestSessions(userId?: string): Promise<schema.BacktestSession[]>;
  getBacktestSession(id: string): Promise<schema.BacktestSession | undefined>;
  getLatestBacktestSession(botId: string): Promise<schema.BacktestSession | undefined>;
  getLatestBacktestSessionForGeneration(botId: string, generationId: string): Promise<schema.BacktestSession | undefined>;
  createBacktestSession(session: schema.InsertBacktestSession): Promise<schema.BacktestSession>;
  updateBacktestSession(id: string, updates: Partial<schema.BacktestSession>): Promise<schema.BacktestSession | undefined>;
  deleteBacktestSession(id: string): Promise<boolean>;
  
  getBotJobs(filters?: { botId?: string; status?: string }): Promise<schema.BotJob[]>;
  createBotJob(job: schema.InsertBotJob): Promise<schema.BotJob>;
  updateBotJob(id: string, updates: Partial<schema.BotJob>): Promise<schema.BotJob | undefined>;
  acquireJobWithLease(jobId: string | null, workerId: string, leaseDurationSeconds: number, jobType?: string): Promise<schema.BotJob | null>;
  renewJobLease(jobId: string, workerId: string, leaseDurationSeconds: number): Promise<boolean>;
  releaseJobLease(jobId: string, workerId: string): Promise<boolean>;
  getStuckJobs(thresholdMinutes?: number): Promise<StuckJobInfo[]>;
  getJobQueueStats(): Promise<JobQueueStats>;
  
  getAlerts(userId: string, status?: string): Promise<schema.Alert[]>;
  createAlert(alert: schema.InsertAlert): Promise<schema.Alert>;
  updateAlert(id: string, updates: Partial<schema.Alert>): Promise<schema.Alert | undefined>;
  
  getIntegrations(userId: string): Promise<schema.Integration[]>;
  createIntegration(integration: schema.InsertIntegration): Promise<schema.Integration>;
  updateIntegration(id: string, updates: Partial<schema.Integration>): Promise<schema.Integration | undefined>;
  
  getBotGenerations(botId: string): Promise<schema.BotGeneration[]>;
  createBotGeneration(generation: schema.InsertBotGeneration): Promise<schema.BotGeneration>;
  updateGenerationPerformance(generationId: string, performanceSnapshot: Record<string, any>): Promise<schema.BotGeneration | undefined>;
  getSystemEvents(limit?: number): Promise<schema.SystemEvent[]>;
  
  getBotInstances(filters?: { botId?: string; accountId?: string }): Promise<schema.BotInstance[]>;
  getBotInstance(id: string): Promise<schema.BotInstance | undefined>;
  createBotInstance(instance: schema.InsertBotInstance): Promise<schema.BotInstance>;
  updateBotInstance(id: string, updates: Partial<schema.BotInstance>): Promise<schema.BotInstance | undefined>;
  deleteBotInstance(id: string): Promise<boolean>;
  
  getTradeLogs(filters: TradeLogFilters): Promise<schema.TradeLog[]>;
  getTradeLogsByBot(botId: string, excludeInvalid?: boolean): Promise<schema.TradeLog[]>;
  createTradeLog(trade: schema.InsertTradeLog): Promise<schema.TradeLog>;
  updateBotLiveMetrics(botId: string): Promise<void>;
  
  getBotsOverview(userId: string): Promise<BotOverviewRow[]>;
  getHealthSummary(userId: string): Promise<HealthSummary>;
  getAutonomyLoops(): Promise<schema.AutonomyLoop[]>;
  getEconomicEvents(filters: EconomicEventFilters): Promise<EconomicEventRow[]>;
  upsertEconomicEvents(events: schema.InsertEconomicEvent[]): Promise<number>;
  
  getAppSettings(userId: string): Promise<schema.AppSettings | undefined>;
  upsertAppSettings(userId: string, settings: Partial<schema.AppSettings>): Promise<schema.AppSettings>;
  getStageRoutingDefault(userId: string, stage: string): Promise<string | null>;
  
  getKillEvents(botId: string): Promise<schema.KillEvent[]>;
  createKillEvent(event: schema.InsertKillEvent): Promise<schema.KillEvent>;
  
  getInstruments(): Promise<schema.Instrument[]>;
  getInstrument(symbol: string): Promise<schema.Instrument | undefined>;
  createInstrument(instrument: schema.InsertInstrument): Promise<schema.Instrument>;
  seedInstruments(): Promise<void>;
  
  getBrokerAccountEvents(accountId: string): Promise<schema.BrokerAccountEvent[]>;
  createBrokerAccountEvent(event: schema.InsertBrokerAccountEvent): Promise<schema.BrokerAccountEvent>;
  
  getEvaluationRuns(limit?: number): Promise<schema.EvaluationRun[]>;
  createEvaluationRun(run: schema.InsertEvaluationRun): Promise<schema.EvaluationRun>;
  updateEvaluationRun(id: string, updates: Partial<schema.EvaluationRun>): Promise<schema.EvaluationRun | undefined>;
  
  getBotStageChanges(botId: string, limit?: number): Promise<schema.BotStageChange[]>;
  createBotStageChange(change: schema.InsertBotStageChange): Promise<schema.BotStageChange>;
  
  getSchedulerStates(userId: string): Promise<schema.SchedulerState[]>;
  getSchedulerState(userId: string, schedulerType: string): Promise<schema.SchedulerState | undefined>;
  upsertSchedulerState(state: Partial<schema.SchedulerState> & { userId: string; schedulerType: string }): Promise<schema.SchedulerState>;
  initializeSchedulerStates(userId: string, schedulerTypes: string[]): Promise<schema.SchedulerState[]>;
  
  getUserSecurity(userId: string): Promise<schema.UserSecurity | undefined>;
  upsertUserSecurity(security: Partial<schema.UserSecurity> & { userId: string }): Promise<schema.UserSecurity>;
  
  getLatestReadinessRun(userId?: string): Promise<schema.ReadinessRun | undefined>;
  getReadinessHistory(userId: string | undefined, limit?: number): Promise<schema.ReadinessRun[]>;
  createReadinessRun(run: schema.InsertReadinessRun): Promise<schema.ReadinessRun>;
  
  getStrategyArchetypes(): Promise<schema.StrategyArchetype[]>;
  getPromotionLogs(entityId?: string, limit?: number): Promise<any[]>;
  getBotAllocations(accountId?: string): Promise<any[]>;
  getTradeDecisions(botId?: string, limit?: number): Promise<any[]>;
  
  recordJobHeartbeat(jobId: string): Promise<void>;
  getTimedOutJobs(thresholdMinutes?: number): Promise<schema.BotJob[]>;
  logJobStateTransition(transition: JobStateTransition): Promise<void>;
  timeoutStaleJobs(thresholdMinutes?: number): Promise<number>;
  
  getLatestBotJob(botId: string, jobType?: string): Promise<schema.BotJob | undefined>;
  getActiveRunnerInstance(botId: string): Promise<schema.BotInstance | undefined>;
  getBotJob(id: string): Promise<schema.BotJob | undefined>;
  
  createAuthTempToken(data: { userId: string; tokenHash: string; purpose?: string; ip?: string; userAgent?: string; expiresAt: Date }): Promise<{ id: string }>;
  validateAuthTempToken(tokenHash: string): Promise<{ userId: string; purpose: string; expired: boolean; consumed: boolean; ip?: string; userAgent?: string } | null>;
  consumeAuthTempToken(tokenHash: string): Promise<{ userId: string; email: string; username?: string } | null>;
  cleanupExpiredTempTokens(): Promise<number>;
  
  getLatestWalkForwardRun(botId: string): Promise<schema.WalkForwardRun | undefined>;
  getWalkForwardRuns(botId: string, limit?: number): Promise<schema.WalkForwardRun[]>;
  createWalkForwardRun(run: schema.InsertWalkForwardRun): Promise<schema.WalkForwardRun>;
  updateWalkForwardRun(id: string, updates: Partial<schema.WalkForwardRun>): Promise<schema.WalkForwardRun | undefined>;
  
  getStressTestPresets(symbol?: string): Promise<schema.StressTestPreset[]>;
  getLatestStressTestResults(botId: string): Promise<schema.StressTestResult[]>;
  createStressTestResult(result: schema.InsertStressTestResult): Promise<schema.StressTestResult>;
  getStressTestResultsForBot(botId: string, generationId?: string): Promise<schema.StressTestResult[]>;
  
  getOpenPaperPosition(botId: string): Promise<schema.PaperPosition | undefined>;
  getPaperTrade(tradeId: string): Promise<schema.PaperTrade | undefined>;
  
  getBotAccountPnl(botId: string, accountId: string): Promise<schema.BotAccountPnl | undefined>;
  upsertBotAccountPnl(botId: string, accountId: string, pnlUpdate: BotAccountPnlUpdate): Promise<schema.BotAccountPnl>;
  getAccountBotsPnl(accountId: string): Promise<schema.BotAccountPnl[]>;
  getAccountWithComputedBalance(accountId: string): Promise<AccountWithComputedBalance | undefined>;
  getAccountsWithComputedBalance(userId: string): Promise<schema.EnrichedAccount[]>;
  
  // Account attempts for blown account tracking
  getAccountAttempts(accountId: string): Promise<schema.AccountAttempt[]>;
  createAccountAttempt(data: schema.InsertAccountAttempt): Promise<schema.AccountAttempt>;
  markAttemptBlown(attemptId: string, blowDetails: {
    endingBalance: number;
    blownReason: string;
    blownReasonCode?: string;
    botGenerationAtBlow?: number;
    botStageAtBlow?: string;
    metricsSnapshot?: Record<string, unknown>;
    aiRecommendation?: string;
    aiAnalysis?: Record<string, unknown>;
  }): Promise<schema.AccountAttempt>;
  resetAccountForNewAttempt(accountId: string, newInitialBalance: number): Promise<schema.Account>;
  checkAndHandleBlownAccount(accountId: string): Promise<{ isBlown: boolean; attempt?: schema.AccountAttempt }>;
  
  createGovernanceApproval(approval: schema.InsertGovernanceApproval): Promise<schema.GovernanceApproval>;
  getGovernanceApproval(id: string): Promise<schema.GovernanceApproval | undefined>;
  getGovernanceApprovalsByBot(botId: string, limit?: number): Promise<schema.GovernanceApproval[]>;
  getPendingGovernanceApprovals(userId?: string): Promise<schema.GovernanceApproval[]>;
  updateGovernanceApproval(id: string, updates: Partial<schema.GovernanceApproval>): Promise<schema.GovernanceApproval | undefined>;
}

export interface JobStateTransition {
  runId: string;
  fromStatus: string | null;
  toStatus: string;
  reasonCode?: string;
  reason?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface TradeLogFilters {
  botId?: string;
  botInstanceId?: string;
  backtestSessionId?: string;
  excludeInvalid?: boolean;
  excludeTest?: boolean;
  isOpen?: boolean;
  limit?: number;
}

export interface StuckJobInfo {
  id: string;
  botId: string | null;
  jobType: string;
  status: string | null;
  startedAt: Date | null;
  minutesStuck: number;
}

export interface JobQueueStats {
  queued: number;
  running: number;
  failed: number;
}

export interface BotAccountPnlUpdate {
  realizedPnl: number;
  fees: number;
  isWin: boolean;
}

export interface AccountWithComputedBalance {
  account: schema.Account;
  initialBalance: number;
  totalBotPnl: number;
  computedBalance: number;
  botsPnl: schema.BotAccountPnl[];
}


export interface BotOverviewRow {
  id: string;
  name: string;
  symbol: string | null;
  status: string | null;
  mode: string | null;
  stage: string | null;
  evolutionStatus: string | null;
  healthScore: number | null;
  priorityScore: number | null;
  isCandidate: boolean | null;
  generation: number;
  backtestsCompleted: number;
  sessionWinRatePct: number | null;
  sessionMaxDdPct: number | null;
  sessionMaxDdUsd: number | null;
  sessionPnlUsd: number | null;
  sessionTrades: number | null;
  sessionProfitFactor: number | null;
  sessionSharpe: number | null;
  livePnl: number | null;
  liveTotalTrades: number | null;
  liveWinRate: number | null;
  liveProfitFactor: number | null;
  liveMaxDrawdownPct: number | null;
  blockerCode: string | null;
  lastBacktestAt: Date | null;
  lastTradeAt: Date | null;
  createdAt: Date | null;
  metricsSource: string;
  /** Status of metrics availability: 'AVAILABLE' | 'AWAITING_EVIDENCE' | 'NEW_GENERATION_PENDING' */
  metricsStatus: string;
  metricsAsof: Date | null;
  /** Last backtest data source: 'DATABENTO_REAL' | 'SIMULATED_FALLBACK' | null */
  lastDataSource: string | null;
  /** Matrix aggregate data (from promoted matrix results) */
  matrixAggregate: unknown | null;
  /** Best performing matrix cell */
  matrixBestCell: unknown | null;
  /** Worst performing matrix cell */
  matrixWorstCell: unknown | null;
  /** When matrix data was last updated */
  matrixUpdatedAt: Date | null;
  /** Peak generation tracking for auto-revert system */
  peakGeneration: number | null;
  peakSharpe: number | null;
  isRevertCandidate: boolean;
  declineFromPeakPct: number | null;
  trendDirection: string | null;
  /** Strategy config (contains fullName for tooltip) */
  strategyConfig: Record<string, unknown> | null;
  /** Generation's locked timeframe (from bot_generations.timeframe - the ACTUAL timeframe used for this generation) */
  generationTimeframe: string | null;
  /** Bot's configured timeframe */
  timeframe: string | null;
  /** Reason why bot is idle (for visibility) */
  idleReason: string | null;
  /** Current job queue status */
  queuedJobType: string | null;
  /** Is there a job currently running? */
  hasRunningJob: boolean;
  /** Running job timestamps for elapsed time display */
  backtestStartedAt: Date | null;
  evolveStartedAt: Date | null;
  improveStartedAt: Date | null;
  /** AI Provider that created this bot (GROK, PERPLEXITY, etc) */
  aiProvider: string | null;
  /** Was this bot created by AI? (text description like "Grok xAI") */
  createdByAi: string | null;
  /** AI provider badge state */
  aiProviderBadge: boolean | null;
  /** AI research sources */
  aiResearchSources: unknown | null;
  /** AI reasoning */
  aiReasoning: string | null;
  /** AI research depth */
  aiResearchDepth: string | null;
}

export interface EconomicEventFilters {
  from?: string;
  to?: string;
  impact?: string;
  impacts?: string[];
  country?: string;
}

export interface EconomicEventRow {
  id: string;
  source: string;
  eventName: string;
  eventType: string | null;
  country: string | null;
  currency: string | null;
  impactLevel: string | null;
  scheduledAt: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

export interface HealthSummary {
  totalBots: number;
  healthyBots: number;
  degradedBots: number;
  criticalBots: number;
  avgHealthScore: number;
  autonomyLoopsHealthy: number;
  autonomyLoopsTotal: number;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<schema.User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<schema.User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return user;
  }

  async createUser(user: schema.InsertUser): Promise<schema.User> {
    const [created] = await db.insert(schema.users).values(user).returning();
    return created;
  }

  async updateUser(id: string, updates: Partial<schema.User>): Promise<schema.User | undefined> {
    const [updated] = await db.update(schema.users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return updated;
  }

  async updateUserProfile(id: string, profile: { username: string }): Promise<void> {
    await db.update(schema.users)
      .set({ username: profile.username, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(schema.users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
  }

  async updateUserEmail(id: string, email: string): Promise<void> {
    await db.update(schema.users)
      .set({ email, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
  }

  async getBots(userId: string): Promise<schema.Bot[]> {
    return db.select().from(schema.bots)
      .where(and(eq(schema.bots.userId, userId), isNull(schema.bots.archivedAt)))
      .orderBy(desc(schema.bots.createdAt));
  }

  async getAllActiveBots(): Promise<schema.Bot[]> {
    return db.select().from(schema.bots)
      .where(isNull(schema.bots.archivedAt))
      .orderBy(desc(schema.bots.createdAt));
  }

  async getBot(id: string): Promise<schema.Bot | undefined> {
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, id));
    return bot;
  }

  async createBot(bot: schema.InsertBot): Promise<schema.Bot> {
    const [created] = await db.insert(schema.bots).values(bot).returning();
    return created;
  }

  async updateBot(id: string, updates: Partial<schema.Bot>): Promise<schema.Bot | undefined> {
    // If strategyConfig is being updated, MERGE with existing config to preserve fields like timeframe
    // This prevents accidental removal of timeframe when clients send partial config updates
    let mergedUpdates = { ...updates };
    if (updates.strategyConfig !== undefined && updates.strategyConfig !== null && typeof updates.strategyConfig === 'object') {
      const [currentBot] = await db.select({ strategyConfig: schema.bots.strategyConfig })
        .from(schema.bots)
        .where(eq(schema.bots.id, id))
        .limit(1);
      
      if (currentBot?.strategyConfig && typeof currentBot.strategyConfig === 'object') {
        // Merge: existing config + new updates (new values override existing)
        mergedUpdates.strategyConfig = {
          ...(currentBot.strategyConfig as object),
          ...(updates.strategyConfig as object)
        };
      }
    }
    
    const [updated] = await db.update(schema.bots)
      .set({ ...mergedUpdates, updatedAt: new Date() })
      .where(eq(schema.bots.id, id))
      .returning();
    return updated;
  }

  async getAccounts(userId: string): Promise<schema.Account[]> {
    return db.select().from(schema.accounts)
      .where(eq(schema.accounts.userId, userId))
      .orderBy(desc(schema.accounts.createdAt));
  }

  async getAccount(id: string): Promise<schema.Account | undefined> {
    const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    return account;
  }

  async createAccount(account: schema.InsertAccount): Promise<schema.Account> {
    const [created] = await db.insert(schema.accounts).values({
      ...account,
      currentAttemptNumber: 1,
    }).returning();
    
    // Create the initial attempt record for tracking
    await this.createAccountAttempt({
      accountId: created.id,
      attemptNumber: 1,
      status: 'ACTIVE',
      startingBalance: account.initialBalance || 0,
    });
    
    return created;
  }

  async updateAccount(id: string, updates: Partial<schema.Account>): Promise<schema.Account | undefined> {
    // Map snake_case fields from frontend to camelCase for Drizzle
    const mappedUpdates: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      initial_balance: 'initialBalance',
      current_balance: 'currentBalance',
      peak_balance: 'peakBalance',
      account_type: 'accountType',
      broker_account_id: 'brokerAccountId',
      broker_connection_id: 'brokerConnectionId',
      armed_live: 'armedLive',
      is_active: 'isActive',
      risk_tier: 'riskTier',
      risk_profile: 'riskProfile',
      max_daily_loss_percent: 'maxDailyLossPercent',
      max_daily_loss_dollars: 'maxDailyLossDollars',
      max_drawdown: 'maxDrawdown',
      max_contracts_per_trade: 'maxContractsPerTrade',
      allowed_stages: 'allowedStages',
      user_id: 'userId',
    };
    
    for (const [key, value] of Object.entries(updates)) {
      const mappedKey = fieldMap[key] || key;
      mappedUpdates[mappedKey] = value;
    }
    
    const [updated] = await db.update(schema.accounts)
      .set({ ...mappedUpdates, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id))
      .returning();
    return updated;
  }

  async deleteAccount(id: string): Promise<boolean> {
    const result = await db.delete(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .returning();
    return result.length > 0;
  }

  async getBacktestSessions(botId: string): Promise<schema.BacktestSession[]> {
    // INSTITUTIONAL: Deterministic ordering for consistent list display
    return db.select().from(schema.backtestSessions)
      .where(eq(schema.backtestSessions.botId, botId))
      .orderBy(
        sql`${schema.backtestSessions.completedAt} DESC NULLS LAST`,
        desc(schema.backtestSessions.id)
      );
  }

  async getAllBacktestSessions(userId?: string): Promise<schema.BacktestSession[]> {
    if (userId) {
      return db.select().from(schema.backtestSessions)
        .innerJoin(schema.bots, eq(schema.backtestSessions.botId, schema.bots.id))
        .where(eq(schema.bots.userId, userId))
        .orderBy(desc(schema.backtestSessions.createdAt))
        .then(rows => rows.map(r => r.backtest_sessions));
    }
    return db.select().from(schema.backtestSessions)
      .orderBy(desc(schema.backtestSessions.createdAt));
  }

  async getBacktestSession(id: string): Promise<schema.BacktestSession | undefined> {
    const [session] = await db.select().from(schema.backtestSessions)
      .where(eq(schema.backtestSessions.id, id));
    return session;
  }

  async getLatestBacktestSession(botId: string): Promise<schema.BacktestSession | undefined> {
    // INSTITUTIONAL: Deterministic ordering with multiple tie-breakers
    // ORDER BY completedAt DESC NULLS LAST, id DESC
    // This ensures the same session is always returned, even with timestamp collisions
    const [session] = await db.select().from(schema.backtestSessions)
      .where(and(
        eq(schema.backtestSessions.botId, botId),
        eq(schema.backtestSessions.status, "completed")
      ))
      .orderBy(
        sql`${schema.backtestSessions.completedAt} DESC NULLS LAST`,
        desc(schema.backtestSessions.id)
      )
      .limit(1);
    return session;
  }

  // INSTITUTIONAL: Get the LATEST baseline session for specific generation
  // Returns the most RECENT baseline session to reflect current evolved strategy state
  // Matrix cells are excluded to prevent test data from overriding canonical metrics
  // Sessions with <50 trades will show metricsStatus=AWAITING_EVIDENCE in the UI
  // CRITICAL: Uses deterministic ordering to prevent non-deterministic query results
  async getLatestBacktestSessionForGeneration(botId: string, generationId: string): Promise<schema.BacktestSession | undefined> {
    // Priority: Latest baseline session (excludes matrix cells) by completion time
    // INSTITUTIONAL: Deterministic ordering - completedAt DESC NULLS LAST, id DESC
    // This ensures the same session is ALWAYS returned, preventing UI metric flickering
    const [baselineSession] = await db.select().from(schema.backtestSessions)
      .where(and(
        eq(schema.backtestSessions.botId, botId),
        eq(schema.backtestSessions.generationId, generationId),
        eq(schema.backtestSessions.status, "completed"),
        // Exclude matrix cells: only include sessions where matrixCell is NULL or not 'true'
        or(
          sql`${schema.backtestSessions.configSnapshot}->>'matrixCell' IS NULL`,
          sql`${schema.backtestSessions.configSnapshot}->>'matrixCell' != 'true'`
        )
      ))
      // CRITICAL: Deterministic ordering prevents PostgreSQL from returning different rows
      .orderBy(
        sql`${schema.backtestSessions.completedAt} DESC NULLS LAST`,
        desc(schema.backtestSessions.id)
      )
      .limit(1);
    
    if (baselineSession) {
      return baselineSession;
    }
    
    // Fallback: If no baseline session exists, use latest matrix session
    // This ensures we always return something if any sessions exist for this generation
    // CRITICAL: Also uses deterministic ordering
    const [anySession] = await db.select().from(schema.backtestSessions)
      .where(and(
        eq(schema.backtestSessions.botId, botId),
        eq(schema.backtestSessions.generationId, generationId),
        eq(schema.backtestSessions.status, "completed")
      ))
      .orderBy(
        sql`${schema.backtestSessions.completedAt} DESC NULLS LAST`,
        desc(schema.backtestSessions.id)
      )
      .limit(1);
    return anySession;
  }

  async createBacktestSession(session: schema.InsertBacktestSession): Promise<schema.BacktestSession> {
    const [created] = await db.insert(schema.backtestSessions).values(session).returning();
    return created;
  }

  async updateBacktestSession(id: string, updates: Partial<schema.BacktestSession>): Promise<schema.BacktestSession | undefined> {
    const [updated] = await db.update(schema.backtestSessions)
      .set(updates)
      .where(eq(schema.backtestSessions.id, id))
      .returning();
    return updated;
  }

  async deleteBacktestSession(id: string): Promise<boolean> {
    const result = await db.delete(schema.backtestSessions)
      .where(eq(schema.backtestSessions.id, id))
      .returning();
    return result.length > 0;
  }

  async getBotJobs(filters?: { botId?: string; status?: string }): Promise<schema.BotJob[]> {
    const conditions = [];
    if (filters?.botId) {
      conditions.push(eq(schema.botJobs.botId, filters.botId));
    }
    if (filters?.status) {
      conditions.push(eq(schema.botJobs.status, filters.status as any));
    }
    
    let query = db.select().from(schema.botJobs);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query.orderBy(desc(schema.botJobs.createdAt)).limit(50);
  }

  async createBotJob(job: schema.InsertBotJob): Promise<schema.BotJob> {
    const [created] = await db.insert(schema.botJobs).values(job).returning();
    return created;
  }

  async updateBotJob(id: string, updates: Partial<schema.BotJob>): Promise<schema.BotJob | undefined> {
    const [updated] = await db.update(schema.botJobs)
      .set(updates)
      .where(eq(schema.botJobs.id, id))
      .returning();
    return updated;
  }

  async acquireJobWithLease(jobId: string | null, workerId: string, leaseDurationSeconds: number, jobType?: string): Promise<schema.BotJob | null> {
    if (!workerId || typeof workerId !== 'string' || workerId.trim().length === 0) {
      console.error('[STORAGE] acquireJobWithLease: Invalid workerId provided');
      return null;
    }
    
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + leaseDurationSeconds * 1000);
    const trimmedWorkerId = workerId.trim();
    
    if (jobId) {
      const [acquired] = await db.update(schema.botJobs)
        .set({
          status: 'RUNNING' as any,
          leaseOwner: trimmedWorkerId,
          leaseExpiresAt: leaseExpires,
          lastHeartbeatAt: now,
          startedAt: now,
          attempts: sql`COALESCE(${schema.botJobs.attempts}, 0) + 1`,
        })
        .where(and(
          eq(schema.botJobs.id, jobId),
          eq(schema.botJobs.status, 'QUEUED' as any),
          or(
            isNull(schema.botJobs.leaseOwner),
            lt(schema.botJobs.leaseExpiresAt, now)
          )
        ))
        .returning();
      
      return acquired || null;
    }
    
    const jobTypeFilter = jobType ? `AND job_type = '${jobType}'` : '';
    const result = await db.execute(sql`
      UPDATE bot_jobs
      SET 
        status = 'RUNNING',
        lease_owner = ${trimmedWorkerId},
        lease_expires_at = ${leaseExpires},
        last_heartbeat_at = ${now},
        started_at = ${now},
        attempts = COALESCE(attempts, 0) + 1
      WHERE id = (
        SELECT id FROM bot_jobs 
        WHERE status = 'QUEUED' 
          AND (lease_owner IS NULL OR lease_expires_at < ${now})
          ${sql.raw(jobTypeFilter)}
        ORDER BY priority DESC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    
    const rows = result.rows || [];
    return rows.length > 0 ? rows[0] as schema.BotJob : null;
  }

  async renewJobLease(jobId: string, workerId: string, leaseDurationSeconds: number): Promise<boolean> {
    if (!workerId || typeof workerId !== 'string' || workerId.trim().length === 0) {
      console.error('[STORAGE] renewJobLease: Invalid workerId provided');
      return false;
    }
    if (!jobId || typeof jobId !== 'string') {
      console.error('[STORAGE] renewJobLease: Invalid jobId provided');
      return false;
    }
    
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + leaseDurationSeconds * 1000);
    
    const [renewed] = await db.update(schema.botJobs)
      .set({
        leaseExpiresAt: leaseExpires,
        lastHeartbeatAt: now,
      })
      .where(and(
        eq(schema.botJobs.id, jobId),
        sql`${schema.botJobs.leaseOwner} = ${workerId.trim()}`,
        eq(schema.botJobs.status, 'RUNNING' as any)
      ))
      .returning();
    
    return !!renewed;
  }

  async releaseJobLease(jobId: string, workerId: string): Promise<boolean> {
    if (!workerId || typeof workerId !== 'string' || workerId.trim().length === 0) {
      console.error('[STORAGE] releaseJobLease: Invalid workerId provided');
      return false;
    }
    if (!jobId || typeof jobId !== 'string') {
      console.error('[STORAGE] releaseJobLease: Invalid jobId provided');
      return false;
    }
    
    const [released] = await db.update(schema.botJobs)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(and(
        eq(schema.botJobs.id, jobId),
        sql`${schema.botJobs.leaseOwner} = ${workerId.trim()}`
      ))
      .returning();
    
    return !!released;
  }

  async getJobQueueStats(): Promise<JobQueueStats> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const jobs = await db.select({ status: schema.botJobs.status })
      .from(schema.botJobs)
      .where(and(
        inArray(schema.botJobs.status, ['QUEUED', 'RUNNING', 'FAILED']),
        gte(schema.botJobs.createdAt, oneDayAgo)
      ));
    
    return {
      queued: jobs.filter(j => j.status === 'QUEUED').length,
      running: jobs.filter(j => j.status === 'RUNNING').length,
      failed: jobs.filter(j => j.status === 'FAILED').length,
    };
  }

  async getAlerts(userId: string, status?: string): Promise<schema.Alert[]> {
    let conditions = [eq(schema.alerts.userId, userId)];
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        conditions.push(eq(schema.alerts.status, statuses[0] as any));
      } else {
        conditions.push(inArray(schema.alerts.status, statuses as any[]));
      }
    }
    return db.select().from(schema.alerts)
      .where(and(...conditions))
      .orderBy(desc(schema.alerts.createdAt))
      .limit(50);
  }

  async createAlert(alert: schema.InsertAlert): Promise<schema.Alert> {
    const [created] = await db.insert(schema.alerts).values(alert).returning();
    return created;
  }

  async updateAlert(id: string, updates: Partial<schema.Alert>): Promise<schema.Alert | undefined> {
    const [updated] = await db.update(schema.alerts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.alerts.id, id))
      .returning();
    return updated;
  }

  async getIntegrations(userId: string): Promise<schema.Integration[]> {
    return db.select().from(schema.integrations)
      .where(eq(schema.integrations.userId, userId))
      .orderBy(desc(schema.integrations.createdAt));
  }

  async createIntegration(integration: schema.InsertIntegration): Promise<schema.Integration> {
    const [created] = await db.insert(schema.integrations).values(integration).returning();
    return created;
  }

  async updateIntegration(id: string, updates: Partial<schema.Integration>): Promise<schema.Integration | undefined> {
    const [updated] = await db.update(schema.integrations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.integrations.id, id))
      .returning();
    return updated;
  }

  async getBotGenerations(botId: string): Promise<schema.BotGeneration[]> {
    return db.select().from(schema.botGenerations)
      .where(eq(schema.botGenerations.botId, botId))
      .orderBy(desc(schema.botGenerations.generationNumber));
  }

  async createBotGeneration(generation: schema.InsertBotGeneration): Promise<schema.BotGeneration> {
    // INSTITUTIONAL: Validate timeframe is always present after full reset
    // If missing, extract from strategyConfig or use sensible default
    if (!generation.timeframe) {
      const strategyTimeframe = (generation.strategyConfig as any)?.timeframe;
      if (strategyTimeframe) {
        (generation as any).timeframe = strategyTimeframe;
      } else {
        console.warn(`[STORAGE] createBotGeneration: timeframe missing for bot ${generation.botId}, using default '5m'`);
        (generation as any).timeframe = '5m';
      }
    }
    
    // Upsert: if a generation with same (botId, generationNumber) exists, update it
    // This prevents duplicate generation records from being created
    const existing = await db.query.botGenerations.findFirst({
      where: and(
        eq(schema.botGenerations.botId, generation.botId),
        eq(schema.botGenerations.generationNumber, generation.generationNumber ?? 1)
      ),
      orderBy: [desc(schema.botGenerations.createdAt)],
    });
    
    if (existing) {
      // Update existing generation with ALL mutable columns from incoming data
      // Only keep immutable columns: id, botId, generationNumber, createdAt
      // Use 'in' check to allow null overwrites (don't use ?? which ignores nulls)
      // Columns per schema.ts bot_generations table (verified Dec 2024)
      const [updated] = await db.update(schema.botGenerations)
        .set({
          // Parent generation tracking
          parentGenerationNumber: 'parentGenerationNumber' in generation ? generation.parentGenerationNumber : existing.parentGenerationNumber,
          parentGenerationId: 'parentGenerationId' in generation ? generation.parentGenerationId : existing.parentGenerationId,
          // Job and mutation metadata
          createdByJobId: 'createdByJobId' in generation ? generation.createdByJobId : existing.createdByJobId,
          mutationReasonCode: 'mutationReasonCode' in generation ? generation.mutationReasonCode : existing.mutationReasonCode,
          mutationObjective: 'mutationObjective' in generation ? generation.mutationObjective : existing.mutationObjective,
          mutationsSummary: 'mutationsSummary' in generation ? generation.mutationsSummary : existing.mutationsSummary,
          // Summary and diff
          summaryTitle: 'summaryTitle' in generation ? generation.summaryTitle : existing.summaryTitle,
          summaryDiff: 'summaryDiff' in generation ? generation.summaryDiff : existing.summaryDiff,
          // Configuration
          strategyConfig: 'strategyConfig' in generation ? generation.strategyConfig : existing.strategyConfig,
          riskConfig: 'riskConfig' in generation ? generation.riskConfig : existing.riskConfig,
          humanRulesMd: 'humanRulesMd' in generation ? generation.humanRulesMd : existing.humanRulesMd,
          // Fitness and performance
          fitnessScore: 'fitnessScore' in generation ? generation.fitnessScore : existing.fitnessScore,
          fitnessDetails: 'fitnessDetails' in generation ? generation.fitnessDetails : existing.fitnessDetails,
          performanceSnapshot: 'performanceSnapshot' in generation ? generation.performanceSnapshot : existing.performanceSnapshot,
          performanceDeltas: 'performanceDeltas' in generation ? generation.performanceDeltas : existing.performanceDeltas,
          // Institutional rules versioning (SEV-0)
          beforeRulesHash: 'beforeRulesHash' in generation ? generation.beforeRulesHash : existing.beforeRulesHash,
          afterRulesHash: 'afterRulesHash' in generation ? generation.afterRulesHash : existing.afterRulesHash,
          rulesDiffSummary: 'rulesDiffSummary' in generation ? generation.rulesDiffSummary : existing.rulesDiffSummary,
          // Timeframe tracking
          timeframe: 'timeframe' in generation ? generation.timeframe : existing.timeframe,
        })
        .where(eq(schema.botGenerations.id, existing.id))
        .returning();
      return updated;
    }
    
    // Create new generation
    const [created] = await db.insert(schema.botGenerations).values(generation).returning();
    return created;
  }

  /**
   * Update generation performance snapshot after backtest completion
   * INSTITUTIONAL: This updates the performanceSnapshot with validated post-evolution metrics
   */
  async updateGenerationPerformance(generationId: string, performanceSnapshot: Record<string, any>): Promise<schema.BotGeneration | undefined> {
    const [updated] = await db.update(schema.botGenerations)
      .set({ performanceSnapshot })
      .where(eq(schema.botGenerations.id, generationId))
      .returning();
    return updated;
  }

  async getSystemEvents(limit: number = 50): Promise<schema.SystemEvent[]> {
    return db.select().from(schema.systemEvents)
      .orderBy(desc(schema.systemEvents.createdAt))
      .limit(limit);
  }

  async getBotsOverview(userId: string): Promise<BotOverviewRow[]> {
    const bots = await db.select().from(schema.bots)
      .where(and(eq(schema.bots.userId, userId), isNull(schema.bots.archivedAt)))
      .orderBy(desc(schema.bots.priorityScore));

    // Compute live profit factor from paper_trades for all bots (PAPER+ stages)
    // Note: Max drawdown requires complex high-water mark calculation, so we keep it null for now
    const livePFMap = new Map<string, { profitFactor: number | null }>();
    
    // Fetch peak generation tracking data for revert candidate detection
    const peakGenMap = new Map<string, { 
      peakGeneration: number | null; 
      peakSharpe: number | null;
      isRevertCandidate: boolean;
      declineFromPeakPct: number | null;
      trendDirection: string | null;
    }>();
    try {
      const peakGenResult = await db.execute(sql`
        SELECT DISTINCT ON (bot_id)
          bot_id,
          peak_generation,
          peak_sharpe,
          is_revert_candidate,
          decline_from_peak_pct,
          trend_direction
        FROM generation_metrics_history
        WHERE peak_generation IS NOT NULL
        ORDER BY bot_id, created_at DESC NULLS LAST, id DESC
      `) as { rows: { 
        bot_id: string; 
        peak_generation: number | null; 
        peak_sharpe: number | null;
        is_revert_candidate: boolean | null;
        decline_from_peak_pct: number | null;
        trend_direction: string | null;
      }[] };
      
      for (const row of peakGenResult.rows) {
        peakGenMap.set(row.bot_id, {
          peakGeneration: row.peak_generation,
          peakSharpe: row.peak_sharpe,
          isRevertCandidate: row.is_revert_candidate ?? false,
          declineFromPeakPct: row.decline_from_peak_pct,
          trendDirection: row.trend_direction,
        });
      }
    } catch (e) {
      console.error("[STORAGE] Failed to fetch peak generation tracking data:", e);
    }
    try {
      const pfResult = await db.execute(sql`
        SELECT 
          bot_id,
          CASE WHEN gross_loss > 0 THEN gross_profit / gross_loss ELSE NULL END as profit_factor
        FROM (
          SELECT 
            bot_id,
            SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as gross_profit,
            ABS(SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END)) as gross_loss
          FROM paper_trades
          WHERE exit_time IS NOT NULL
          GROUP BY bot_id
        ) metrics
      `) as { rows: { bot_id: string; profit_factor: number | null }[] };
      
      for (const row of pfResult.rows) {
        livePFMap.set(row.bot_id, { profitFactor: row.profit_factor });
      }
    } catch (e) {
      console.error("[STORAGE] Failed to compute live profit factors:", e);
    }

    // Compute live max drawdown percentage using high-water mark calculation
    // This tracks the maximum peak-to-trough decline as a percentage of the peak
    // CRITICAL: Uses 10000 initial capital baseline (same as backtest-executor.ts)
    // This ensures bots that only lose money still show proper drawdown percentages
    const liveMaxDdMap = new Map<string, number>();
    try {
      // Calculate max drawdown for each bot using window functions for running peak
      // CRITICAL: Use identical ordering in peak calculation as cumulative sum to prevent
      // future trades from inflating the peak (causality violation)
      // CRITICAL: Start with initialCapital of 10000 to match backtest-executor.ts
      const ddResult = await db.execute(sql`
        WITH trade_equity AS (
          SELECT 
            bot_id,
            id,
            exit_time,
            -- Start with 10000 initial capital (matches backtest-executor.ts)
            10000 + SUM(pnl) OVER (PARTITION BY bot_id ORDER BY exit_time ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as equity
          FROM paper_trades
          WHERE exit_time IS NOT NULL
            AND (exit_reason_code IS NULL OR exit_reason_code != 'ORPHAN_RECONCILE')
        ),
        equity_with_peak AS (
          SELECT
            bot_id,
            equity,
            -- Peak equity starts at 10000 (initial capital) and tracks highest equity reached
            GREATEST(10000, MAX(equity) OVER (PARTITION BY bot_id ORDER BY exit_time ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) as peak_equity
          FROM trade_equity
        ),
        drawdowns AS (
          SELECT
            bot_id,
            peak_equity,
            equity,
            -- Drawdown = (peak - current) / peak * 100
            -- Peak is always >= 10000, so this always works
            ((peak_equity - equity) / peak_equity) * 100 as drawdown_pct
          FROM equity_with_peak
        )
        SELECT 
          bot_id,
          COALESCE(MAX(drawdown_pct), 0) as max_drawdown_pct
        FROM drawdowns
        GROUP BY bot_id
      `) as { rows: { bot_id: string; max_drawdown_pct: number }[] };
      
      for (const row of ddResult.rows) {
        liveMaxDdMap.set(row.bot_id, Number(row.max_drawdown_pct) || 0);
      }
    } catch (e) {
      console.error("[STORAGE] Failed to compute live max drawdown:", e);
    }

    // INSTITUTIONAL: Bulk fetch generation timeframes AND performanceSnapshots for all bots with currentGenerationId
    // This is the SOURCE OF TRUTH for the timeframe each generation uses
    // Single query for O(1) lookup instead of O(n) per-bot queries
    const generationTimeframeMap = new Map<string, string | null>();
    const generationSnapshotMap = new Map<string, Record<string, unknown>>();
    const currentGenIds = bots.map(b => b.currentGenerationId).filter((id): id is string => !!id);
    if (currentGenIds.length > 0) {
      try {
        const genDataResult = await db.select({ 
          id: schema.botGenerations.id, 
          timeframe: schema.botGenerations.timeframe,
          performanceSnapshot: schema.botGenerations.performanceSnapshot,
        })
          .from(schema.botGenerations)
          .where(inArray(schema.botGenerations.id, currentGenIds));
        
        for (const row of genDataResult) {
          generationTimeframeMap.set(row.id, row.timeframe);
          if (row.performanceSnapshot) {
            generationSnapshotMap.set(row.id, row.performanceSnapshot as Record<string, unknown>);
          }
        }
      } catch (e) {
        console.error("[STORAGE] Failed to bulk fetch generation data:", e);
      }
    }

    const result: BotOverviewRow[] = [];
    
    for (const bot of bots) {
      const [genCount] = await db.select({ count: count() })
        .from(schema.botGenerations)
        .where(eq(schema.botGenerations.botId, bot.id));
      
      // INSTITUTIONAL: Generation timeframe is the SOLE source of truth
      // After full reset, all bots MUST have currentGenerationId - no legacy fallbacks
      const generationTimeframe = bot.currentGenerationId 
        ? (generationTimeframeMap.get(bot.currentGenerationId) ?? null)
        : null;
      
      const [btCount] = await db.select({ count: count() })
        .from(schema.backtestSessions)
        .where(and(
          eq(schema.backtestSessions.botId, bot.id),
          eq(schema.backtestSessions.status, "completed")
        ));

      // Get job queue status for idle reason visibility
      const queuedJobs = await db.select()
        .from(schema.botJobs)
        .where(and(
          eq(schema.botJobs.botId, bot.id),
          eq(schema.botJobs.status, "QUEUED")
        ))
        .orderBy(desc(schema.botJobs.createdAt))
        .limit(1);
      
      // Get all running jobs with startedAt for elapsed time display
      // Order by startedAt ASC so we get the oldest-running job first per type
      const runningJobs = await db.select({
        jobType: schema.botJobs.jobType,
        startedAt: schema.botJobs.startedAt,
      })
        .from(schema.botJobs)
        .where(and(
          eq(schema.botJobs.botId, bot.id),
          eq(schema.botJobs.status, "RUNNING")
        ))
        .orderBy(schema.botJobs.startedAt);
      
      const queuedJobType = queuedJobs[0]?.jobType ?? null;
      const hasRunningJob = runningJobs.length > 0;
      
      // Extract start timestamps by job type for elapsed time display
      // Only set the first (oldest) startedAt per job type
      let backtestStartedAt: Date | null = null;
      let evolveStartedAt: Date | null = null;
      let improveStartedAt: Date | null = null;
      
      for (const job of runningJobs) {
        if (job.jobType === 'BACKTESTER' && job.startedAt && !backtestStartedAt) {
          backtestStartedAt = job.startedAt;
        } else if (job.jobType === 'EVOLVING' && job.startedAt && !evolveStartedAt) {
          evolveStartedAt = job.startedAt;
        } else if (job.jobType === 'IMPROVING' && job.startedAt && !improveStartedAt) {
          improveStartedAt = job.startedAt;
        }
      }
      
      // Compute idle reason for visibility
      let idleReason: string | null = null;
      const runningJobTypes = runningJobs.map(j => j.jobType).filter(Boolean);
      if (hasRunningJob && runningJobTypes.length > 0) {
        idleReason = `Running: ${runningJobTypes[0]}`;
      } else if (queuedJobType) {
        idleReason = `Queued: ${queuedJobType}`;
      } else if (bot.blockerCode) {
        idleReason = `Blocked: ${bot.blockerCode}`;
      } else if (btCount.count === 0) {
        idleReason = "Awaiting first backtest";
      } else if (bot.stage === "TRIALS") {
        idleReason = "Waiting for autonomy cycle";
      }

      // INSTITUTIONAL: Stage-specific metrics scoping
      // - TRIALS: MUST use current generation only (for promotion gate evaluation)
      // - PAPER+: Uses cumulative metrics across all generations (real trading performance)
      const EVIDENCE_THRESHOLD = 50;
      let latestSession: schema.BacktestSession | undefined;
      let metricsStatus: string;
      let isFromCurrentGeneration = false;
      const isLabStage = bot.stage === 'TRIALS';

      if (bot.currentGenerationId) {
        // Try to get current generation session first
        latestSession = await this.getLatestBacktestSessionForGeneration(bot.id, bot.currentGenerationId);
        isFromCurrentGeneration = !!latestSession;
        
        if (!latestSession && !isLabStage) {
          // PAPER+ stages: Fall back to latest session from any generation (cumulative view)
          // TRIALS stage: NO FALLBACK - must show current gen metrics only for promotion gates
          latestSession = await this.getLatestBacktestSession(bot.id);
        }
        // TRIALS stage without current gen session: latestSession stays undefined (AWAITING_EVIDENCE)
      } else if (!isLabStage) {
        // Legacy fallback: Only for PAPER+ bots without generation tracking
        // TRIALS bots without generation tracking should not show metrics (broken lineage)
        latestSession = await this.getLatestBacktestSession(bot.id);
        isFromCurrentGeneration = true; // No generation tracking, so treat as current
      }
      // TRIALS stage without currentGenerationId: latestSession stays undefined (broken lineage)

      // FALLBACK: If no backtest session, use performanceSnapshot from current generation
      // This ensures grid shows same data as Generation modal
      const genSnapshot = bot.currentGenerationId 
        ? generationSnapshotMap.get(bot.currentGenerationId) 
        : undefined;
      
      // Extract metrics from performanceSnapshot (fallback when no session)
      const snapshotTrades = genSnapshot?.totalTrades as number | null | undefined;
      const snapshotWinRate = genSnapshot?.winRate as number | null | undefined;
      const snapshotPnl = (genSnapshot?.netPnl ?? genSnapshot?.backtestPnl ?? genSnapshot?.pnl) as number | null | undefined;
      const snapshotPf = (genSnapshot?.profitFactor ?? genSnapshot?.backtestProfitFactor) as number | null | undefined;
      const snapshotSharpe = (genSnapshot?.sharpeRatio ?? genSnapshot?.backtestSharpe) as number | null | undefined;
      const snapshotMaxDd = (genSnapshot?.maxDrawdownPct ?? genSnapshot?.backtestMaxDd) as number | null | undefined;
      
      // Determine metrics status for UI display
      // INSTITUTIONAL: Explicit status tells UI what kind of data it's showing
      const hasFallbackMetrics = genSnapshot && (snapshotTrades ?? 0) > 0;
      if (!latestSession && !hasFallbackMetrics) {
        // No sessions and no snapshot with trades
        metricsStatus = "AWAITING_EVIDENCE";
      } else if (!latestSession && hasFallbackMetrics) {
        // No session but snapshot has data - show with SNAPSHOT source
        metricsStatus = "AVAILABLE";
      } else if (!isFromCurrentGeneration) {
        // Session exists but it's from a prior generation - stale data indicator
        metricsStatus = "PRIOR_GENERATION";
      } else if ((latestSession?.totalTrades ?? 0) >= EVIDENCE_THRESHOLD) {
        // Current gen session with sufficient trades for statistical significance
        metricsStatus = "AVAILABLE";
      } else {
        // Current gen session but insufficient trades - still gathering evidence
        metricsStatus = "AWAITING_EVIDENCE";
      }
      
      // Use session metrics if available, otherwise fall back to snapshot
      const finalWinRatePct = latestSession?.winRate 
        ? latestSession.winRate * 100 
        : (snapshotWinRate !== null && snapshotWinRate !== undefined 
            ? (snapshotWinRate <= 1 ? snapshotWinRate * 100 : snapshotWinRate)
            : null);
      const finalPnl = latestSession?.netPnl ?? snapshotPnl ?? null;
      const finalTrades = latestSession?.totalTrades ?? snapshotTrades ?? null;
      const finalPf = latestSession?.profitFactor ?? snapshotPf ?? null;
      const finalSharpe = latestSession?.sharpeRatio ?? snapshotSharpe ?? null;
      const finalMaxDd = latestSession?.maxDrawdownPct ?? snapshotMaxDd ?? null;
      const metricsSource = latestSession ? "BACKTEST_SESSION" : (hasFallbackMetrics ? "GENERATION_SNAPSHOT" : "BOT_RECORD");

      result.push({
        id: bot.id,
        name: bot.name,
        symbol: bot.symbol,
        status: bot.status,
        mode: bot.mode,
        stage: bot.stage,
        evolutionStatus: bot.evolutionStatus,
        healthScore: bot.healthScore,
        priorityScore: bot.priorityScore,
        isCandidate: bot.isCandidate,
        generation: bot.currentGeneration ?? genCount.count ?? 1,
        backtestsCompleted: btCount.count,
        sessionWinRatePct: finalWinRatePct,
        // max_drawdown_pct is already stored as percentage (3.01 = 3.01%), NOT decimal
        sessionMaxDdPct: finalMaxDd,
        sessionMaxDdUsd: latestSession?.maxDrawdown ?? null,
        sessionPnlUsd: finalPnl,
        sessionTrades: finalTrades,
        sessionProfitFactor: finalPf,
        sessionSharpe: finalSharpe,
        livePnl: bot.livePnl,
        liveTotalTrades: bot.liveTotalTrades,
        liveWinRate: bot.liveWinRate,
        liveProfitFactor: livePFMap.get(bot.id)?.profitFactor ?? null,
        liveMaxDrawdownPct: liveMaxDdMap.get(bot.id) ?? null, // High-water mark calculation from paper trades
        blockerCode: bot.blockerCode,
        lastBacktestAt: bot.lastBacktestAt,
        lastTradeAt: bot.lastTradeAt,
        createdAt: bot.createdAt,
        metricsSource,
        metricsStatus,
        metricsAsof: latestSession?.completedAt ?? bot.updatedAt,
        lastDataSource: latestSession?.dataSource ?? null,
        matrixAggregate: (bot as any).matrixAggregate ?? null,
        matrixBestCell: (bot as any).matrixBestCell ?? null,
        matrixWorstCell: (bot as any).matrixWorstCell ?? null,
        matrixUpdatedAt: (bot as any).matrixUpdatedAt ?? null,
        peakGeneration: peakGenMap.get(bot.id)?.peakGeneration ?? null,
        peakSharpe: peakGenMap.get(bot.id)?.peakSharpe ?? null,
        isRevertCandidate: peakGenMap.get(bot.id)?.isRevertCandidate ?? false,
        declineFromPeakPct: peakGenMap.get(bot.id)?.declineFromPeakPct ?? null,
        trendDirection: peakGenMap.get(bot.id)?.trendDirection ?? null,
        strategyConfig: (bot.strategyConfig as Record<string, unknown>) ?? null,
        timeframe: ((bot.strategyConfig as Record<string, unknown>)?.timeframe as string) ?? null,
        generationTimeframe,
        idleReason,
        queuedJobType,
        hasRunningJob,
        backtestStartedAt,
        evolveStartedAt,
        improveStartedAt,
        aiProvider: bot.aiProvider ?? null,
        createdByAi: bot.createdByAi ?? null,
        aiProviderBadge: bot.aiProviderBadge ?? null,
        aiResearchSources: bot.aiResearchSources ?? null,
        aiReasoning: bot.aiReasoning ?? null,
        aiResearchDepth: bot.aiResearchDepth ?? null,
      });
    }

    return result;
  }

  async getHealthSummary(userId: string): Promise<HealthSummary> {
    const bots = await this.getBots(userId);
    
    const totalBots = bots.length;
    const healthyBots = bots.filter(b => (b.healthScore ?? 100) >= 80).length;
    const degradedBots = bots.filter(b => (b.healthScore ?? 100) >= 50 && (b.healthScore ?? 100) < 80).length;
    const criticalBots = bots.filter(b => (b.healthScore ?? 100) < 50).length;
    const avgHealthScore = totalBots > 0 
      ? bots.reduce((sum, b) => sum + (b.healthScore ?? 100), 0) / totalBots 
      : 100;
    
    // FIX: Read autonomy loop stats from autonomy_planner_runs (actual tick persistence)
    // instead of autonomy_loops table (legacy/empty)
    let autonomyLoopsTotal = 0;
    let autonomyLoopsHealthy = 0;
    try {
      const autonomyStatsResult = await db.execute(sql`
        SELECT 
          COUNT(*) as total_runs,
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND error_json IS NULL) as healthy_runs,
          MAX(finished_at) as last_finished_at
        FROM autonomy_planner_runs
        WHERE started_at > NOW() - INTERVAL '10 minutes'
      `);
      const stats = autonomyStatsResult.rows[0] as any;
      autonomyLoopsTotal = parseInt(stats?.total_runs || "0");
      autonomyLoopsHealthy = parseInt(stats?.healthy_runs || "0");
    } catch (e) {
      console.error("[STORAGE] Failed to get autonomy stats from autonomy_planner_runs:", e);
    }
    
    return {
      totalBots,
      healthyBots,
      degradedBots,
      criticalBots,
      avgHealthScore,
      autonomyLoopsHealthy,
      autonomyLoopsTotal,
    };
  }

  async getAutonomyLoops(): Promise<schema.AutonomyLoop[]> {
    return db.select().from(schema.autonomyLoops).orderBy(schema.autonomyLoops.loopName);
  }

  async getEconomicEvents(filters: EconomicEventFilters): Promise<EconomicEventRow[]> {
    try {
      const conditions: any[] = [];
      
      if (filters.from) {
        conditions.push(gte(schema.economicEvents.scheduledAt, new Date(filters.from)));
      }
      if (filters.to) {
        conditions.push(lte(schema.economicEvents.scheduledAt, new Date(filters.to)));
      }
      if (filters.impact) {
        conditions.push(eq(schema.economicEvents.impactLevel, filters.impact));
      }
      if (filters.impacts && filters.impacts.length > 0) {
        conditions.push(inArray(schema.economicEvents.impactLevel, filters.impacts));
      }
      if (filters.country) {
        conditions.push(eq(schema.economicEvents.country, filters.country));
      }
      
      const query = conditions.length > 0
        ? db.select().from(schema.economicEvents).where(and(...conditions))
        : db.select().from(schema.economicEvents);
      
      const rows = await query.orderBy(schema.economicEvents.scheduledAt);
      
      return rows.map(row => ({
        id: row.id,
        source: row.source,
        eventName: row.eventName,
        eventType: row.eventType,
        country: row.country,
        currency: row.currency,
        impactLevel: row.impactLevel,
        scheduledAt: row.scheduledAt?.toISOString() ?? '',
        actual: row.actual,
        forecast: row.forecast,
        previous: row.previous,
      }));
    } catch (error) {
      console.error('Error fetching economic events:', error);
      return [];
    }
  }

  async upsertEconomicEvents(events: schema.InsertEconomicEvent[]): Promise<number> {
    if (!events.length) return 0;
    
    let inserted = 0;
    for (const event of events) {
      try {
        await db.insert(schema.economicEvents)
          .values(event)
          .onConflictDoNothing();
        inserted++;
      } catch (error) {
        console.error('Error inserting economic event:', error);
      }
    }
    return inserted;
  }

  async getAppSettings(userId: string): Promise<schema.AppSettings | undefined> {
    const [settings] = await db.select().from(schema.appSettings)
      .where(eq(schema.appSettings.userId, userId));
    return settings;
  }

  async upsertAppSettings(userId: string, settings: Partial<schema.AppSettings>): Promise<schema.AppSettings> {
    const existing = await this.getAppSettings(userId);
    if (existing) {
      const [updated] = await db.update(schema.appSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(schema.appSettings.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(schema.appSettings)
        .values({ userId, ...settings })
        .returning();
      return created;
    }
  }

  async getStageRoutingDefault(userId: string, stage: string): Promise<string | null> {
    const settings = await this.getAppSettings(userId);
    if (!settings?.general) return null;
    
    const general = settings.general as Record<string, unknown>;
    const stageRoutingDefaults = general.stageRoutingDefaults as Record<string, string | null> | undefined;
    if (!stageRoutingDefaults) return null;
    
    return stageRoutingDefaults[stage] ?? null;
  }

  async deleteBot(id: string): Promise<boolean> {
    const result = await db.update(schema.bots)
      .set({ archivedAt: new Date() })
      .where(eq(schema.bots.id, id))
      .returning();
    return result.length > 0;
  }

  async getBotInstances(filters?: { botId?: string; accountId?: string }): Promise<schema.BotInstance[]> {
    const conditions = [];
    if (filters?.botId) {
      conditions.push(eq(schema.botInstances.botId, filters.botId));
    }
    if (filters?.accountId) {
      conditions.push(eq(schema.botInstances.accountId, filters.accountId));
    }
    
    if (conditions.length > 0) {
      return db.select().from(schema.botInstances)
        .where(and(...conditions))
        .orderBy(desc(schema.botInstances.createdAt));
    }
    return db.select().from(schema.botInstances)
      .orderBy(desc(schema.botInstances.createdAt));
  }

  async getBotInstance(id: string): Promise<schema.BotInstance | undefined> {
    const [instance] = await db.select().from(schema.botInstances)
      .where(eq(schema.botInstances.id, id));
    return instance;
  }

  async createBotInstance(instance: schema.InsertBotInstance): Promise<schema.BotInstance> {
    const [created] = await db.insert(schema.botInstances).values(instance).returning();
    return created;
  }

  async updateBotInstance(id: string, updates: Partial<schema.BotInstance>): Promise<schema.BotInstance | undefined> {
    const [updated] = await db.update(schema.botInstances)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.botInstances.id, id))
      .returning();
    return updated;
  }

  async deleteBotInstance(id: string): Promise<boolean> {
    const result = await db.delete(schema.botInstances)
      .where(eq(schema.botInstances.id, id))
      .returning();
    return result.length > 0;
  }

  async getTradeLogs(filters: TradeLogFilters): Promise<schema.TradeLog[]> {
    const conditions = [];
    
    if (filters.botId) {
      conditions.push(eq(schema.tradeLogs.botId, filters.botId));
    }
    if (filters.botInstanceId) {
      conditions.push(eq(schema.tradeLogs.botInstanceId, filters.botInstanceId));
    }
    if (filters.backtestSessionId) {
      conditions.push(eq(schema.tradeLogs.backtestSessionId, filters.backtestSessionId));
    }
    if (filters.excludeInvalid) {
      conditions.push(eq(schema.tradeLogs.isInvalid, false));
    }
    if (filters.excludeTest) {
      conditions.push(sql`${schema.tradeLogs.sourceType} != 'TEST' OR ${schema.tradeLogs.sourceType} IS NULL`);
    }
    if (filters.isOpen !== undefined) {
      conditions.push(eq(schema.tradeLogs.isOpen, filters.isOpen));
    }
    
    let query = db.select().from(schema.tradeLogs);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    query = query.orderBy(desc(schema.tradeLogs.createdAt)) as any;
    
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }
    
    return query;
  }

  async getTradeLogsByBot(botId: string, excludeInvalid: boolean = true): Promise<schema.TradeLog[]> {
    return this.getTradeLogs({ 
      botId, 
      excludeInvalid, 
      excludeTest: true 
    });
  }

  async createTradeLog(trade: schema.InsertTradeLog): Promise<schema.TradeLog> {
    const [created] = await db.insert(schema.tradeLogs).values(trade).returning();
    return created;
  }

  /**
   * Recalculate and update live metrics (livePnl, liveTotalTrades, liveWinRate)
   * from trade logs for PAPER/LIVE trades (excludes BACKTEST and TEST source types).
   * 
   * INSTITUTIONAL REQUIREMENT: Live metrics must reflect actual paper/live trades,
   * not backtest simulations. This ensures accurate stage progression evaluation.
   */
  async updateBotLiveMetrics(botId: string): Promise<void> {
    const result = await db.execute(sql`
      WITH live_trades AS (
        SELECT 
          pnl,
          CASE WHEN pnl > 0 THEN 1 ELSE 0 END as is_winner
        FROM trade_logs
        WHERE bot_id = ${botId}
          AND is_open = false
          AND (is_invalid = false OR is_invalid IS NULL)
          AND source_type IN ('PAPER', 'LIVE', 'SHADOW', 'CANARY')
      ),
      metrics AS (
        SELECT 
          COALESCE(SUM(pnl), 0) as total_pnl,
          COUNT(*) as total_trades,
          CASE 
            WHEN COUNT(*) > 0 THEN SUM(is_winner)::float / COUNT(*)
            ELSE 0 
          END as win_rate
        FROM live_trades
      )
      UPDATE bots 
      SET 
        live_pnl = metrics.total_pnl,
        live_total_trades = metrics.total_trades,
        live_win_rate = metrics.win_rate,
        updated_at = NOW()
      FROM metrics
      WHERE bots.id = ${botId}
    `);
    
    console.log(`[LIVE_METRICS] bot_id=${botId} updated live metrics from paper/live trades`);
  }

  async getStuckJobs(thresholdMinutes: number = 30): Promise<StuckJobInfo[]> {
    const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    
    const stuckJobs = await db.select({
      id: schema.botJobs.id,
      botId: schema.botJobs.botId,
      jobType: schema.botJobs.jobType,
      status: schema.botJobs.status,
      startedAt: schema.botJobs.startedAt,
    })
    .from(schema.botJobs)
    .where(and(
      eq(schema.botJobs.status, 'RUNNING'),
      lte(schema.botJobs.startedAt, thresholdTime)
    ));
    
    return stuckJobs.map(job => ({
      ...job,
      minutesStuck: job.startedAt 
        ? Math.floor((Date.now() - job.startedAt.getTime()) / 60000)
        : 0,
    }));
  }

  async getKillEvents(botId: string): Promise<schema.KillEvent[]> {
    return db.select()
      .from(schema.killEvents)
      .where(eq(schema.killEvents.botId, botId))
      .orderBy(desc(schema.killEvents.createdAt));
  }

  async createKillEvent(event: schema.InsertKillEvent): Promise<schema.KillEvent> {
    const [created] = await db.insert(schema.killEvents).values(event).returning();
    return created;
  }

  async getInstruments(): Promise<schema.Instrument[]> {
    return db.select()
      .from(schema.instruments)
      .where(eq(schema.instruments.isActive, true))
      .orderBy(schema.instruments.symbol);
  }

  async getInstrument(symbol: string): Promise<schema.Instrument | undefined> {
    const [instrument] = await db.select()
      .from(schema.instruments)
      .where(eq(schema.instruments.symbol, symbol.toUpperCase()));
    return instrument;
  }

  async createInstrument(instrument: schema.InsertInstrument): Promise<schema.Instrument> {
    const [created] = await db.insert(schema.instruments).values(instrument).returning();
    return created;
  }

  async seedInstruments(): Promise<void> {
    const existingInstruments = await this.getInstruments();
    if (existingInstruments.length > 0) {
      return;
    }

    const defaultInstruments: schema.InsertInstrument[] = [
      { symbol: 'MES', name: 'Micro E-mini S&P 500', exchange: 'CME', tickSize: 0.25, pointValue: 1.25 },
      { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', exchange: 'CME', tickSize: 0.25, pointValue: 0.50 },
      { symbol: 'ES', name: 'E-mini S&P 500', exchange: 'CME', tickSize: 0.25, pointValue: 12.50 },
      { symbol: 'NQ', name: 'E-mini Nasdaq-100', exchange: 'CME', tickSize: 0.25, pointValue: 5.00 },
      { symbol: 'GC', name: 'Gold Futures', exchange: 'COMEX', tickSize: 0.10, pointValue: 10.00 },
      { symbol: 'CL', name: 'Crude Oil Futures', exchange: 'NYMEX', tickSize: 0.01, pointValue: 10.00 },
    ];

    await db.insert(schema.instruments).values(defaultInstruments);
  }

  async getBrokerAccountEvents(accountId: string): Promise<schema.BrokerAccountEvent[]> {
    return db.select()
      .from(schema.brokerAccountEvents)
      .where(eq(schema.brokerAccountEvents.accountId, accountId))
      .orderBy(desc(schema.brokerAccountEvents.createdAt));
  }

  async createBrokerAccountEvent(event: schema.InsertBrokerAccountEvent): Promise<schema.BrokerAccountEvent> {
    const [created] = await db.insert(schema.brokerAccountEvents).values(event).returning();
    return created;
  }

  async getEvaluationRuns(limit = 20): Promise<schema.EvaluationRun[]> {
    return db.select()
      .from(schema.evaluationRuns)
      .orderBy(desc(schema.evaluationRuns.createdAt))
      .limit(limit);
  }

  async createEvaluationRun(run: schema.InsertEvaluationRun): Promise<schema.EvaluationRun> {
    const [created] = await db.insert(schema.evaluationRuns).values(run).returning();
    return created;
  }

  async updateEvaluationRun(id: string, updates: Partial<schema.EvaluationRun>): Promise<schema.EvaluationRun | undefined> {
    const [updated] = await db.update(schema.evaluationRuns)
      .set(updates)
      .where(eq(schema.evaluationRuns.id, id))
      .returning();
    return updated;
  }

  async getBotStageChanges(botId: string, limit = 50): Promise<schema.BotStageChange[]> {
    return db.select()
      .from(schema.botStageChanges)
      .where(eq(schema.botStageChanges.botId, botId))
      .orderBy(desc(schema.botStageChanges.createdAt))
      .limit(limit);
  }

  async createBotStageChange(change: schema.InsertBotStageChange): Promise<schema.BotStageChange> {
    const [created] = await db.insert(schema.botStageChanges).values(change).returning();
    return created;
  }

  async getSchedulerStates(userId: string): Promise<schema.SchedulerState[]> {
    return db.select()
      .from(schema.schedulerState)
      .where(eq(schema.schedulerState.userId, userId))
      .orderBy(schema.schedulerState.schedulerType);
  }

  async getSchedulerState(userId: string, schedulerType: string): Promise<schema.SchedulerState | undefined> {
    const [state] = await db.select()
      .from(schema.schedulerState)
      .where(and(
        eq(schema.schedulerState.userId, userId),
        eq(schema.schedulerState.schedulerType, schedulerType)
      ));
    return state;
  }

  async upsertSchedulerState(state: Partial<schema.SchedulerState> & { userId: string; schedulerType: string }): Promise<schema.SchedulerState> {
    const existing = await this.getSchedulerState(state.userId, state.schedulerType);
    if (existing) {
      const [updated] = await db.update(schema.schedulerState)
        .set({ ...state, updatedAt: new Date() })
        .where(eq(schema.schedulerState.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(schema.schedulerState).values(state as schema.InsertSchedulerState).returning();
    return created;
  }

  async initializeSchedulerStates(userId: string, schedulerTypes: string[]): Promise<schema.SchedulerState[]> {
    const existing = await this.getSchedulerStates(userId);
    const existingTypes = new Set(existing.map(s => s.schedulerType));
    
    const toCreate = schedulerTypes.filter(t => !existingTypes.has(t));
    const created: schema.SchedulerState[] = [];
    
    for (const schedulerType of toCreate) {
      const state = await this.upsertSchedulerState({ userId, schedulerType, enabled: true, frequencyMinutes: 60 });
      created.push(state);
    }
    
    return [...existing, ...created];
  }

  async getUserSecurity(userId: string): Promise<schema.UserSecurity | undefined> {
    const [security] = await db.select()
      .from(schema.userSecurity)
      .where(eq(schema.userSecurity.userId, userId));
    return security;
  }

  async upsertUserSecurity(security: Partial<schema.UserSecurity> & { userId: string }): Promise<schema.UserSecurity> {
    const existing = await this.getUserSecurity(security.userId);
    if (existing) {
      const [updated] = await db.update(schema.userSecurity)
        .set({ ...security, updatedAt: new Date() })
        .where(eq(schema.userSecurity.userId, security.userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(schema.userSecurity).values(security as schema.InsertUserSecurity).returning();
    return created;
  }

  async getLatestReadinessRun(userId?: string): Promise<schema.ReadinessRun | undefined> {
    const query = db.select()
      .from(schema.readinessRuns)
      .orderBy(desc(schema.readinessRuns.createdAt))
      .limit(1);
    
    if (userId) {
      const [run] = await db.select()
        .from(schema.readinessRuns)
        .where(eq(schema.readinessRuns.userId, userId))
        .orderBy(desc(schema.readinessRuns.createdAt))
        .limit(1);
      return run;
    }
    
    const [run] = await query;
    return run;
  }

  async getReadinessHistory(userId: string | undefined, limit = 7): Promise<schema.ReadinessRun[]> {
    if (userId) {
      return db.select()
        .from(schema.readinessRuns)
        .where(eq(schema.readinessRuns.userId, userId))
        .orderBy(desc(schema.readinessRuns.createdAt))
        .limit(limit);
    }
    return db.select()
      .from(schema.readinessRuns)
      .orderBy(desc(schema.readinessRuns.createdAt))
      .limit(limit);
  }

  async createReadinessRun(run: schema.InsertReadinessRun): Promise<schema.ReadinessRun> {
    const [created] = await db.insert(schema.readinessRuns).values(run).returning();
    return created;
  }

  async getStrategyArchetypes(): Promise<schema.StrategyArchetype[]> {
    return db.select().from(schema.strategyArchetypes).orderBy(schema.strategyArchetypes.name);
  }

  async getPromotionLogs(entityId?: string, limit = 50): Promise<any[]> {
    if (entityId) {
      return db.select()
        .from(schema.botStageChanges)
        .where(eq(schema.botStageChanges.botId, entityId))
        .orderBy(desc(schema.botStageChanges.createdAt))
        .limit(limit);
    }
    return db.select()
      .from(schema.botStageChanges)
      .orderBy(desc(schema.botStageChanges.createdAt))
      .limit(limit);
  }

  async getBotAllocations(accountId?: string): Promise<any[]> {
    const query = db.select({
      botId: schema.bots.id,
      botName: schema.bots.name,
      accountId: schema.bots.defaultAccountId,
      capitalAllocated: schema.bots.capitalAllocated,
      mode: schema.bots.mode,
      status: schema.bots.status,
    }).from(schema.bots);
    
    if (accountId) {
      return query.where(eq(schema.bots.defaultAccountId, accountId));
    }
    return query;
  }

  async getTradeDecisions(botId?: string, limit = 20): Promise<any[]> {
    const query = db.select()
      .from(schema.tradeLogs)
      .orderBy(desc(schema.tradeLogs.createdAt))
      .limit(limit);
    
    if (botId) {
      return db.select()
        .from(schema.tradeLogs)
        .where(eq(schema.tradeLogs.botId, botId))
        .orderBy(desc(schema.tradeLogs.createdAt))
        .limit(limit);
    }
    return query;
  }

  async recordJobHeartbeat(jobId: string): Promise<void> {
    await db.update(schema.botJobs)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(schema.botJobs.id, jobId));
  }

  async getTimedOutJobs(thresholdMinutes = 10): Promise<schema.BotJob[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    return db.select()
      .from(schema.botJobs)
      .where(
        and(
          eq(schema.botJobs.status, 'RUNNING'),
          or(
            // Case 1: Has a heartbeat but it's stale
            lte(schema.botJobs.lastHeartbeatAt, threshold),
            // Case 2: Never sent a heartbeat AND was started > threshold ago
            and(
              isNull(schema.botJobs.lastHeartbeatAt),
              lte(schema.botJobs.startedAt, threshold)
            )
          )
        )
      );
  }

  async logJobStateTransition(transition: JobStateTransition): Promise<void> {
    await db.execute(sql`
      INSERT INTO job_run_events (run_id, from_status, to_status, reason_code, reason, trace_id, metadata)
      VALUES (
        ${transition.runId}::uuid,
        ${transition.fromStatus},
        ${transition.toStatus},
        ${transition.reasonCode || null},
        ${transition.reason || null},
        ${transition.traceId ? sql`${transition.traceId}::uuid` : sql`gen_random_uuid()`},
        ${JSON.stringify(transition.metadata || {})}::jsonb
      )
    `);
  }

  async timeoutStaleJobs(thresholdMinutes = 10): Promise<number> {
    const timedOutJobs = await this.getTimedOutJobs(thresholdMinutes);
    let count = 0;
    
    for (const job of timedOutJobs) {
      await this.logJobStateTransition({
        runId: job.id,
        fromStatus: job.status,
        toStatus: 'TIMEOUT',
        reasonCode: 'HEARTBEAT_TIMEOUT',
        reason: `No heartbeat received for ${thresholdMinutes} minutes`,
        metadata: { lastHeartbeatAt: job.lastHeartbeatAt }
      });
      
      await db.update(schema.botJobs)
        .set({ 
          status: 'TIMEOUT',
          statusReasonCode: 'HEARTBEAT_TIMEOUT',
          statusReasonHuman: `No heartbeat received for ${thresholdMinutes} minutes`,
          completedAt: new Date()
        })
        .where(eq(schema.botJobs.id, job.id));
      
      count++;
    }
    
    return count;
  }

  async getLatestBotJob(botId: string, jobType?: string): Promise<schema.BotJob | undefined> {
    const conditions = [eq(schema.botJobs.botId, botId)];
    if (jobType) {
      conditions.push(eq(schema.botJobs.jobType, jobType));
    }
    const [job] = await db.select()
      .from(schema.botJobs)
      .where(and(...conditions))
      .orderBy(desc(schema.botJobs.createdAt))
      .limit(1);
    return job;
  }

  async getActiveRunnerInstance(botId: string): Promise<schema.BotInstance | undefined> {
    const [instance] = await db.select()
      .from(schema.botInstances)
      .where(and(
        eq(schema.botInstances.botId, botId),
        eq(schema.botInstances.isActive, true),
        eq(schema.botInstances.jobType, 'RUNNER')
      ))
      .orderBy(desc(schema.botInstances.createdAt))
      .limit(1);
    return instance;
  }

  async getBotJob(id: string): Promise<schema.BotJob | undefined> {
    const [job] = await db.select()
      .from(schema.botJobs)
      .where(eq(schema.botJobs.id, id));
    return job;
  }

  async createAuthTempToken(data: { userId: string; tokenHash: string; purpose?: string; ip?: string; userAgent?: string; expiresAt: Date }): Promise<{ id: string }> {
    const [token] = await db.insert(schema.authTempTokens)
      .values({
        userId: data.userId,
        tokenHash: data.tokenHash,
        purpose: (data.purpose as "2FA_LOGIN" | "PASSWORD_RESET" | "EMAIL_VERIFY") || "2FA_LOGIN",
        ip: data.ip,
        userAgent: data.userAgent,
        expiresAt: data.expiresAt,
      })
      .returning({ id: schema.authTempTokens.id });
    return token;
  }

  async validateAuthTempToken(tokenHash: string): Promise<{ userId: string; purpose: string; expired: boolean; consumed: boolean; ip?: string; userAgent?: string } | null> {
    const [token] = await db.select()
      .from(schema.authTempTokens)
      .where(eq(schema.authTempTokens.tokenHash, tokenHash));
    
    if (!token) return null;
    
    const now = new Date();
    return {
      userId: token.userId,
      purpose: token.purpose || "2FA_LOGIN",
      expired: token.expiresAt < now,
      consumed: token.consumedAt !== null,
      ip: token.ip || undefined,
      userAgent: token.userAgent || undefined,
    };
  }

  async consumeAuthTempToken(tokenHash: string): Promise<{ userId: string; email: string; username?: string } | null> {
    const now = new Date();
    
    const [token] = await db.update(schema.authTempTokens)
      .set({ consumedAt: now })
      .where(and(
        eq(schema.authTempTokens.tokenHash, tokenHash),
        isNull(schema.authTempTokens.consumedAt),
        gte(schema.authTempTokens.expiresAt, now)
      ))
      .returning({ userId: schema.authTempTokens.userId });
    
    if (!token) return null;
    
    const user = await this.getUser(token.userId);
    if (!user) return null;
    
    return {
      userId: user.id,
      email: user.email,
      username: user.username || undefined,
    };
  }

  async cleanupExpiredTempTokens(): Promise<number> {
    const now = new Date();
    const result = await db.delete(schema.authTempTokens)
      .where(lte(schema.authTempTokens.expiresAt, now))
      .returning({ id: schema.authTempTokens.id });
    return result.length;
  }

  async getLatestWalkForwardRun(botId: string): Promise<schema.WalkForwardRun | undefined> {
    const [run] = await db.select()
      .from(schema.walkForwardRuns)
      .where(eq(schema.walkForwardRuns.botId, botId))
      .orderBy(desc(schema.walkForwardRuns.createdAt))
      .limit(1);
    return run;
  }

  async getWalkForwardRuns(botId: string, limit = 10): Promise<schema.WalkForwardRun[]> {
    return db.select()
      .from(schema.walkForwardRuns)
      .where(eq(schema.walkForwardRuns.botId, botId))
      .orderBy(desc(schema.walkForwardRuns.createdAt))
      .limit(limit);
  }

  async createWalkForwardRun(run: schema.InsertWalkForwardRun): Promise<schema.WalkForwardRun> {
    const [created] = await db.insert(schema.walkForwardRuns)
      .values(run)
      .returning();
    return created;
  }

  async updateWalkForwardRun(id: string, updates: Partial<schema.WalkForwardRun>): Promise<schema.WalkForwardRun | undefined> {
    const [updated] = await db.update(schema.walkForwardRuns)
      .set(updates)
      .where(eq(schema.walkForwardRuns.id, id))
      .returning();
    return updated;
  }

  async getStressTestPresets(symbol?: string): Promise<schema.StressTestPreset[]> {
    if (symbol) {
      return db.select()
        .from(schema.stressTestPresets)
        .where(and(
          eq(schema.stressTestPresets.isActive, true),
          sql`${symbol} = ANY(${schema.stressTestPresets.symbols})`
        ))
        .orderBy(desc(schema.stressTestPresets.severity));
    }
    return db.select()
      .from(schema.stressTestPresets)
      .where(eq(schema.stressTestPresets.isActive, true))
      .orderBy(desc(schema.stressTestPresets.severity));
  }

  async getLatestStressTestResults(botId: string): Promise<schema.StressTestResult[]> {
    return db.select()
      .from(schema.stressTestResults)
      .where(eq(schema.stressTestResults.botId, botId))
      .orderBy(desc(schema.stressTestResults.createdAt))
      .limit(10);
  }

  async createStressTestResult(result: schema.InsertStressTestResult): Promise<schema.StressTestResult> {
    const [created] = await db.insert(schema.stressTestResults)
      .values(result)
      .returning();
    return created;
  }

  async getStressTestResultsForBot(botId: string, generationId?: string): Promise<schema.StressTestResult[]> {
    const conditions = [eq(schema.stressTestResults.botId, botId)];
    if (generationId) {
      conditions.push(eq(schema.stressTestResults.generationId, generationId));
    }
    return db.select()
      .from(schema.stressTestResults)
      .where(and(...conditions))
      .orderBy(desc(schema.stressTestResults.createdAt));
  }

  async getOpenPaperPosition(botId: string): Promise<schema.PaperPosition | undefined> {
    const [position] = await db.select()
      .from(schema.paperPositions)
      .where(
        and(
          eq(schema.paperPositions.botId, botId),
          or(
            eq(schema.paperPositions.status, 'LONG'),
            eq(schema.paperPositions.status, 'SHORT')
          )
        )
      )
      .orderBy(desc(schema.paperPositions.createdAt))
      .limit(1);
    return position;
  }

  async getPaperTrade(tradeId: string): Promise<schema.PaperTrade | undefined> {
    const [trade] = await db.select()
      .from(schema.paperTrades)
      .where(eq(schema.paperTrades.id, tradeId))
      .limit(1);
    return trade;
  }

  async getBotAccountPnl(botId: string, accountId: string): Promise<schema.BotAccountPnl | undefined> {
    const [record] = await db.select()
      .from(schema.botAccountPnl)
      .where(
        and(
          eq(schema.botAccountPnl.botId, botId),
          eq(schema.botAccountPnl.accountId, accountId)
        )
      )
      .limit(1);
    return record;
  }

  async upsertBotAccountPnl(botId: string, accountId: string, pnlUpdate: BotAccountPnlUpdate): Promise<schema.BotAccountPnl> {
    const existing = await this.getBotAccountPnl(botId, accountId);
    const netPnl = pnlUpdate.realizedPnl - pnlUpdate.fees;
    
    if (existing) {
      const newRealizedPnl = (existing.realizedPnl || 0) + pnlUpdate.realizedPnl;
      const newTotalFees = (existing.totalFees || 0) + pnlUpdate.fees;
      const newNetPnl = (existing.netPnl || 0) + netPnl;
      const newTotalTrades = (existing.totalTrades || 0) + 1;
      const newWinningTrades = (existing.winningTrades || 0) + (pnlUpdate.isWin ? 1 : 0);
      const newLosingTrades = (existing.losingTrades || 0) + (pnlUpdate.isWin ? 0 : 1);
      
      const currentPeakEquity = existing.peakEquity ?? 0;
      const newPeakEquity = Math.max(currentPeakEquity, newNetPnl);
      
      let newMaxDrawdown = existing.maxDrawdown ?? 0;
      let newMaxDrawdownPercent = existing.maxDrawdownPercent ?? 0;
      if (newNetPnl < newPeakEquity && newPeakEquity > 0) {
        const currentDrawdown = newPeakEquity - newNetPnl;
        const currentDrawdownPercent = (currentDrawdown / newPeakEquity) * 100;
        if (currentDrawdown > newMaxDrawdown) {
          newMaxDrawdown = currentDrawdown;
          newMaxDrawdownPercent = currentDrawdownPercent;
        }
      }

      const [updated] = await db.update(schema.botAccountPnl)
        .set({
          realizedPnl: newRealizedPnl,
          totalFees: newTotalFees,
          netPnl: newNetPnl,
          totalTrades: newTotalTrades,
          winningTrades: newWinningTrades,
          losingTrades: newLosingTrades,
          peakEquity: newPeakEquity,
          maxDrawdown: newMaxDrawdown,
          maxDrawdownPercent: newMaxDrawdownPercent,
          lastTradeClosedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.botAccountPnl.id, existing.id))
        .returning();
      return updated;
    }

    const peakEquity = netPnl > 0 ? netPnl : 0;
    const [created] = await db.insert(schema.botAccountPnl)
      .values({
        botId,
        accountId,
        realizedPnl: pnlUpdate.realizedPnl,
        totalFees: pnlUpdate.fees,
        netPnl,
        totalTrades: 1,
        winningTrades: pnlUpdate.isWin ? 1 : 0,
        losingTrades: pnlUpdate.isWin ? 0 : 1,
        peakEquity,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        lastTradeClosedAt: new Date(),
      })
      .returning();
    return created;
  }

  async getAccountBotsPnl(accountId: string): Promise<schema.BotAccountPnl[]> {
    return db.select()
      .from(schema.botAccountPnl)
      .where(eq(schema.botAccountPnl.accountId, accountId))
      .orderBy(desc(schema.botAccountPnl.updatedAt));
  }

  async getAccountWithComputedBalance(accountId: string): Promise<AccountWithComputedBalance | undefined> {
    const account = await this.getAccount(accountId);
    if (!account) return undefined;

    const botsPnl = await this.getAccountBotsPnl(accountId);
    const totalBotPnl = botsPnl.reduce((sum, bp) => sum + (bp.netPnl || 0), 0);
    const initialBalance = account.initialBalance || 0;
    const computedBalance = initialBalance + totalBotPnl;

    return {
      account,
      initialBalance,
      totalBotPnl,
      computedBalance,
      botsPnl,
    };
  }

  async getAccountsWithComputedBalance(userId: string): Promise<schema.EnrichedAccount[]> {
    const accounts = await this.getAccounts(userId);
    
    if (accounts.length === 0) {
      return [];
    }
    
    const accountIdsArray = sql.raw(`ARRAY[${accounts.map(a => `'${a.id}'::uuid`).join(',')}]`);
    
    const pnlAggResult = await db.execute(sql`
      SELECT 
        account_id,
        SUM(net_pnl) as total_bot_pnl,
        COUNT(*) as bots_pnl_count
      FROM bot_account_pnl
      WHERE account_id = ANY(${accountIdsArray})
      GROUP BY account_id
    `);
    
    const pnlByAccount = new Map<string, { totalBotPnl: number; botsPnlCount: number }>();
    for (const row of pnlAggResult.rows as any[]) {
      pnlByAccount.set(row.account_id, {
        totalBotPnl: parseFloat(row.total_bot_pnl || '0'),
        botsPnlCount: parseInt(row.bots_pnl_count || '0'),
      });
    }

    return accounts.map(account => {
      const pnlData = pnlByAccount.get(account.id) || { totalBotPnl: 0, botsPnlCount: 0 };
      const initialBalance = account.initialBalance || 0;
      return {
        ...account,
        computedBalance: initialBalance + pnlData.totalBotPnl,
        totalBotPnl: pnlData.totalBotPnl,
        botsPnlCount: pnlData.botsPnlCount,
      };
    });
  }

  /**
   * BULLETPROOF: Compute paper trade metrics directly from database
   * This is the single source of truth for PAPER+ stage metrics.
   * Returns metrics for ALL bots with paper trades, regardless of runner status.
   * 
   * INSTITUTIONAL FORMULAS:
   * - Win Rate: (winning trades / total closed trades) * 100
   * - Max Drawdown: Peak-to-trough equity curve percentage
   * - Profit Factor: gross_profit / gross_loss
   * - Sharpe Ratio: (mean return / stddev return) * sqrt(252) annualized
   * 
   * Minimum trade thresholds:
   * - Win Rate: 1 trade
   * - Max Drawdown: 1 trade
   * - Profit Factor: 1 winning + 1 losing trade
   * - Sharpe Ratio: 5 trades (statistical significance)
   */
  async getPaperTradeMetrics(botIds?: string[]): Promise<Map<string, {
    closedTrades: number;
    openTrades: number;
    realizedPnl: number;
    winRate: number | null;
    maxDrawdownPct: number | null;
    profitFactor: number | null;
    sharpe: number | null;
    metricsSource: 'PAPER_TRADES' | 'INSUFFICIENT_DATA';
  }>> {
    const results = new Map<string, {
      closedTrades: number;
      openTrades: number;
      realizedPnl: number;
      winRate: number | null;
      maxDrawdownPct: number | null;
      profitFactor: number | null;
      sharpe: number | null;
      metricsSource: 'PAPER_TRADES' | 'INSUFFICIENT_DATA';
    }>();

    try {
      // Step 1: Get aggregate metrics (closed trades, wins, pnl, gross profit/loss)
      // CRITICAL: Filter by current ACTIVE account attempt only to prevent stale metrics from blown attempts
      // Trades with NULL account_attempt_id are included (legacy trades before attempt tracking)
      // Trades linked to BLOWN attempts are excluded (historical data for AI learning only)
      let aggregateQuery;
      if (botIds && botIds.length > 0) {
        const botIdParams = sql.join(botIds.map(id => sql`${id}::uuid`), sql`, `);
        aggregateQuery = sql`
          SELECT 
            pt.bot_id,
            COUNT(*) FILTER (WHERE pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')) as closed_trades,
            COUNT(*) FILTER (WHERE pt.status = 'OPEN') as open_trades,
            SUM(CASE WHEN pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN COALESCE(pt.pnl, 0) ELSE 0 END) as realized_pnl,
            COUNT(*) FILTER (WHERE pt.status = 'CLOSED' AND pt.pnl > 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')) as wins,
            SUM(CASE WHEN pt.status = 'CLOSED' AND pt.pnl > 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN pt.pnl ELSE 0 END) as gross_profit,
            ABS(SUM(CASE WHEN pt.status = 'CLOSED' AND pt.pnl < 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN pt.pnl ELSE 0 END)) as gross_loss
          FROM paper_trades pt
          LEFT JOIN account_attempts aa ON pt.account_attempt_id = aa.id
          WHERE pt.bot_id IN (${botIdParams})
            AND (pt.account_attempt_id IS NULL OR aa.status = 'ACTIVE')
          GROUP BY pt.bot_id
        `;
      } else {
        aggregateQuery = sql`
          SELECT 
            pt.bot_id,
            COUNT(*) FILTER (WHERE pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')) as closed_trades,
            COUNT(*) FILTER (WHERE pt.status = 'OPEN') as open_trades,
            SUM(CASE WHEN pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN COALESCE(pt.pnl, 0) ELSE 0 END) as realized_pnl,
            COUNT(*) FILTER (WHERE pt.status = 'CLOSED' AND pt.pnl > 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')) as wins,
            SUM(CASE WHEN pt.status = 'CLOSED' AND pt.pnl > 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN pt.pnl ELSE 0 END) as gross_profit,
            ABS(SUM(CASE WHEN pt.status = 'CLOSED' AND pt.pnl < 0 AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
                THEN pt.pnl ELSE 0 END)) as gross_loss
          FROM paper_trades pt
          LEFT JOIN account_attempts aa ON pt.account_attempt_id = aa.id
          WHERE (pt.account_attempt_id IS NULL OR aa.status = 'ACTIVE')
          GROUP BY pt.bot_id
        `;
      }

      const aggregateResult = await db.execute(aggregateQuery);
      
      // Create a set of bot IDs that have trades for further processing
      const botsWithTrades = new Set<string>();
      const aggregateMap = new Map<string, {
        closedTrades: number;
        openTrades: number;
        realizedPnl: number;
        wins: number;
        grossProfit: number;
        grossLoss: number;
      }>();

      for (const row of aggregateResult.rows as any[]) {
        const botId = row.bot_id;
        botsWithTrades.add(botId);
        aggregateMap.set(botId, {
          closedTrades: Number(row.closed_trades) || 0,
          openTrades: Number(row.open_trades) || 0,
          realizedPnl: Number(row.realized_pnl) || 0,
          wins: Number(row.wins) || 0,
          grossProfit: Number(row.gross_profit) || 0,
          grossLoss: Number(row.gross_loss) || 0,
        });
      }

      // Step 2: For bots with >= 1 closed trade, compute Max DD and Sharpe
      // This requires iterating through trades in order (more expensive, but necessary)
      for (const botId of botsWithTrades) {
        const agg = aggregateMap.get(botId)!;
        
        // Initialize base metrics
        let winRate: number | null = null;
        let maxDrawdownPct: number | null = null;
        let profitFactor: number | null = null;
        let sharpe: number | null = null;
        let metricsSource: 'PAPER_TRADES' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';

        if (agg.closedTrades >= 1) {
          metricsSource = 'PAPER_TRADES';
          
          // Win Rate (valid with 1+ trades)
          winRate = (agg.wins / agg.closedTrades) * 100;
          
          // Profit Factor (valid only if there are both wins and losses)
          if (agg.grossLoss > 0) {
            profitFactor = agg.grossProfit / agg.grossLoss;
          } else if (agg.grossProfit > 0) {
            profitFactor = 999; // All wins, cap at 999
          }

          // Fetch individual trades for Max DD and Sharpe calculation
          // CRITICAL: ORDER BY exit_time, id for deterministic chronological ordering
          // CRITICAL: Filter by ACTIVE account attempt only to prevent stale metrics from blown attempts
          const tradesResult = await db.execute(sql`
            SELECT pt.pnl, pt.entry_price, pt.quantity, pt.symbol
            FROM paper_trades pt
            LEFT JOIN account_attempts aa ON pt.account_attempt_id = aa.id
            WHERE pt.bot_id = ${botId}::uuid 
              AND pt.status = 'CLOSED'
              AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')
              AND (pt.account_attempt_id IS NULL OR aa.status = 'ACTIVE')
            ORDER BY pt.exit_time ASC NULLS LAST, pt.id ASC
          `);
          
          const trades = tradesResult.rows as { pnl: number; entry_price: number; quantity: number; symbol: string }[];

          // INSTITUTIONAL: Use same initialCapital as backtest-executor.ts (10000)
          // This ensures PAPER and LAB metrics are directly comparable
          const initialCapital = 10000;

          // INSTITUTIONAL MAX DD: Peak-to-trough equity curve tracking
          // EXACT MATCH to backtest-executor.ts calculateMetrics()
          let equity = initialCapital;
          let peak = initialCapital;
          let maxDrawdown = 0;

          for (const trade of trades) {
            const pnl = Number(trade.pnl) || 0;
            equity += pnl;
            peak = Math.max(peak, equity);
            const dd = peak - equity;
            maxDrawdown = Math.max(maxDrawdown, dd);
          }
          
          // Max DD percentage: EXACT MATCH to backtest-executor.ts
          maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

          // INSTITUTIONAL SHARPE: EXACT MATCH to backtest-executor.ts
          // Formula: (avgReturn / stdDev) * sqrt(252) where return = pnl / initialCapital
          // Requires at least 5 trades for statistical significance
          if (trades.length >= 5) {
            // Calculate percentage returns per trade: pnl / initialCapital
            // This EXACTLY matches backtest-executor.ts line 1954
            const returns = trades.map(t => (Number(t.pnl) || 0) / initialCapital);
            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
            const stdDev = Math.sqrt(variance);
            
            if (stdDev > 0 && !isNaN(stdDev)) {
              // Annualize: multiply by sqrt(252) for daily trading
              sharpe = (avgReturn / stdDev) * Math.sqrt(252);
              // Clamp to reasonable bounds and guard NaN
              if (!isNaN(sharpe)) {
                sharpe = Math.max(-5, Math.min(5, sharpe));
              } else {
                sharpe = null;
              }
            }
          }
        }

        results.set(botId, {
          closedTrades: agg.closedTrades,
          openTrades: agg.openTrades,
          realizedPnl: agg.realizedPnl,
          winRate,
          maxDrawdownPct,
          profitFactor,
          sharpe,
          metricsSource,
        });
      }

      console.log(`[STORAGE] getPaperTradeMetrics computed for ${results.size} bots`);
    } catch (error) {
      console.error("[STORAGE] getPaperTradeMetrics failed:", error);
    }

    return results;
  }

  // ============ ACCOUNT ATTEMPTS (Blown Account Recovery) ============
  
  async getAccountAttempts(accountId: string): Promise<schema.AccountAttempt[]> {
    const result = await db.execute(sql`
      SELECT * FROM account_attempts 
      WHERE account_id = ${accountId}::uuid
      ORDER BY attempt_number DESC
    `);
    return result.rows as schema.AccountAttempt[];
  }

  async createAccountAttempt(data: schema.InsertAccountAttempt): Promise<schema.AccountAttempt> {
    const result = await db.execute(sql`
      INSERT INTO account_attempts (
        account_id, attempt_number, status, starting_balance,
        peak_balance, lowest_balance, started_at
      ) VALUES (
        ${data.accountId}::uuid,
        ${data.attemptNumber || 1},
        ${data.status || 'ACTIVE'},
        ${data.startingBalance},
        ${data.startingBalance},
        ${data.startingBalance},
        NOW()
      )
      RETURNING *
    `);
    return result.rows[0] as schema.AccountAttempt;
  }

  async markAttemptBlown(attemptId: string, blowDetails: {
    endingBalance: number;
    blownReason: string;
    blownReasonCode?: string;
    botGenerationAtBlow?: number;
    botStageAtBlow?: string;
    metricsSnapshot?: Record<string, unknown>;
    aiRecommendation?: string;
    aiAnalysis?: Record<string, unknown>;
  }): Promise<schema.AccountAttempt> {
    const result = await db.execute(sql`
      UPDATE account_attempts SET
        status = 'BLOWN',
        ending_balance = ${blowDetails.endingBalance},
        blown_at = NOW(),
        blown_reason = ${blowDetails.blownReason},
        blown_reason_code = ${blowDetails.blownReasonCode || null},
        bot_generation_at_blow = ${blowDetails.botGenerationAtBlow || null},
        bot_stage_at_blow = ${blowDetails.botStageAtBlow || null},
        metrics_snapshot = ${JSON.stringify(blowDetails.metricsSnapshot || {})}::jsonb,
        ai_recommendation = ${blowDetails.aiRecommendation || null},
        ai_analysis = ${JSON.stringify(blowDetails.aiAnalysis || {})}::jsonb,
        ended_at = NOW()
      WHERE id = ${attemptId}::uuid
      RETURNING *
    `);
    return result.rows[0] as schema.AccountAttempt;
  }

  async resetAccountForNewAttempt(accountId: string, newInitialBalance: number): Promise<schema.Account> {
    // Increment attempt counters and reset the account balance
    const result = await db.execute(sql`
      UPDATE accounts SET
        initial_balance = ${newInitialBalance},
        current_balance = ${newInitialBalance},
        current_attempt_number = COALESCE(current_attempt_number, 1) + 1,
        updated_at = NOW()
      WHERE id = ${accountId}::uuid
      RETURNING *
    `);
    const account = result.rows[0] as schema.Account;
    
    // Create a new account attempt record
    await this.createAccountAttempt({
      accountId: account.id,
      attemptNumber: account.currentAttemptNumber || 1,
      status: 'ACTIVE',
      startingBalance: newInitialBalance,
    });
    
    // Clear bot P&L records for this account to start fresh
    await db.execute(sql`
      DELETE FROM bot_account_pnl WHERE account_id = ${accountId}::uuid
    `);
    
    // CRITICAL: Reset cached live metrics on all bots linked to this account
    // These cached values must be zeroed so the UI shows accurate metrics for the new attempt
    // The paper_trades table is properly scoped by account_attempt_id, but bots.live_* are cached
    await db.execute(sql`
      UPDATE bots SET
        live_pnl = 0,
        live_total_trades = 0,
        live_win_rate = 0,
        updated_at = NOW()
      WHERE id IN (
        SELECT DISTINCT bot_id FROM bot_instances WHERE account_id = ${accountId}::uuid
      )
    `);
    console.log(`[ACCOUNT_RESET] Reset live metrics for all bots linked to account ${accountId}`);
    
    // CRITICAL FIX: Clear awaitingRecovery flag and set readyForRestart for auto-restart
    // Uses JSONB merge to preserve existing state keys while clearing recovery flags
    await db.execute(sql`
      UPDATE bot_instances SET
        status = 'STOPPED',
        stopped_at = NULL,
        state_json = COALESCE(state_json, '{}'::jsonb) 
          - 'awaitingRecovery' 
          - 'blownAccount' 
          - 'blownAt' 
          - 'blockedReason'
          || jsonb_build_object(
            'recoveredAt', NOW()::text,
            'readyForRestart', true
          )
      WHERE account_id = ${accountId}::uuid
        AND state_json->>'awaitingRecovery' = 'true'
    `);
    console.log(`[ACCOUNT_RESET] Cleared awaitingRecovery flags for account ${accountId} - bots ready for auto-restart`);
    
    return account;
  }

  async checkAndHandleBlownAccount(accountId: string): Promise<{ isBlown: boolean; attempt?: schema.AccountAttempt }> {
    // Get the computed balance for this account
    const accountData = await this.getAccountWithComputedBalance(accountId);
    if (!accountData) {
      return { isBlown: false };
    }

    const { computedBalance, account } = accountData;
    
    // Check if account balance is at or below $0
    if (computedBalance > 0) {
      return { isBlown: false };
    }

    // GUARD: Check if account is already blown using transaction-safe approach
    // Multiple code paths (paper runner, watchdog, API) may detect blown simultaneously
    const attempts = await this.getAccountAttempts(accountId);
    
    // Find most recent attempt - if it's BLOWN, account was already processed
    const mostRecentAttempt = attempts[0]; // Sorted by attemptNumber DESC
    if (mostRecentAttempt?.status === 'BLOWN') {
      console.log(`[BLOWN_ACCOUNT] Account ${accountId} already marked BLOWN (attempt #${mostRecentAttempt.attemptNumber}) - skipping duplicate`);
      return { isBlown: true, attempt: mostRecentAttempt };
    }
    
    let currentAttempt = attempts.find(a => a.status === 'ACTIVE');

    console.log(`[BLOWN_ACCOUNT] Account ${accountId} has balance $${computedBalance.toFixed(2)} - marking as BLOWN`);

    // If no active attempt exists, this is a legacy account that was never properly initialized
    // Create the first attempt record to track this blown event and trigger proper recovery
    if (!currentAttempt) {
      console.log(`[BLOWN_ACCOUNT] Legacy account ${accountId} has no attempt records - creating initial attempt for tracking`);
      
      // Update account to have proper attempt tracking
      await db.execute(sql`
        UPDATE accounts SET 
          current_attempt_number = 1,
          updated_at = NOW()
        WHERE id = ${accountId}::uuid
      `);
      
      // Create the first attempt starting from when the account was created/last reset
      currentAttempt = await this.createAccountAttempt({
        accountId,
        attemptNumber: 1,
        status: 'ACTIVE',
        startingBalance: account.initialBalance ?? 0,
      });
    }

    // Mark the current attempt as blown
    const blownAttempt = await this.markAttemptBlown(currentAttempt.id, {
      endingBalance: computedBalance,
      blownReason: 'Account balance depleted to $0 or below',
      blownReasonCode: 'BALANCE_DEPLETED',
      metricsSnapshot: {
        initialBalance: account.initialBalance,
        computedBalance,
        timestamp: new Date().toISOString(),
      },
    });

    // Update the account's blown counters and get updated count
    const updateResult = await db.execute(sql`
      UPDATE accounts SET
        consecutive_blown_count = COALESCE(consecutive_blown_count, 0) + 1,
        total_blown_count = COALESCE(total_blown_count, 0) + 1,
        last_blown_at = NOW(),
        updated_at = NOW()
      WHERE id = ${accountId}::uuid
      RETURNING consecutive_blown_count
    `);
    
    const updatedConsecutiveCount = (updateResult.rows[0] as any)?.consecutive_blown_count || 1;

    // Defer AI recovery and runner shutdown to next event loop tick to avoid circular dependency during module initialization
    setImmediate(async () => {
      // Stop paper runners for all bots attached to this blown account
      // Use bot_instances (primary source) instead of empty bot_accounts table
      try {
        const botsResult = await db.execute(sql`
          SELECT DISTINCT b.id FROM bots b
          JOIN bot_instances bi ON b.id = bi.bot_id
          WHERE bi.account_id = ${accountId}::uuid
            AND b.stage IN ('PAPER', 'SHADOW', 'CANARY')
        `);
        
        if (botsResult.rows.length > 0) {
          const { paperRunnerService } = await import("./paper-runner-service");
          for (const row of botsResult.rows as { id: string }[]) {
            try {
              await paperRunnerService.stopBot(row.id);
              console.log(`[BLOWN_ACCOUNT] Stopped paper runner for bot ${row.id.slice(0, 8)}`);
            } catch (stopErr) {
              console.error(`[BLOWN_ACCOUNT] Failed to stop runner for bot ${row.id}:`, stopErr);
            }
          }
          console.log(`[BLOWN_ACCOUNT] Stopped ${botsResult.rows.length} runner(s) for blown account ${accountId}`);
        }
      } catch (err) {
        console.error(`[BLOWN_ACCOUNT] Failed to stop runners for account ${accountId}:`, err);
      }
      
      // Trigger AI recovery decision
      processBlownAccountRecovery({
        accountId,
        consecutiveBlownCount: updatedConsecutiveCount,
        attempt: blownAttempt,
        account,
      }).catch(err => {
        console.error(`[BLOWN_ACCOUNT] AI recovery failed for account ${accountId}:`, err);
      });
    });

    return { isBlown: true, attempt: blownAttempt };
  }

  async createGovernanceApproval(approval: schema.InsertGovernanceApproval): Promise<schema.GovernanceApproval> {
    const [result] = await db.insert(schema.governanceApprovals).values(approval).returning();
    return result;
  }

  async getGovernanceApproval(id: string): Promise<schema.GovernanceApproval | undefined> {
    const [result] = await db.select().from(schema.governanceApprovals).where(eq(schema.governanceApprovals.id, id));
    return result;
  }

  async getGovernanceApprovalsByBot(botId: string, limit: number = 20): Promise<schema.GovernanceApproval[]> {
    return await db.select().from(schema.governanceApprovals)
      .where(eq(schema.governanceApprovals.botId, botId))
      .orderBy(desc(schema.governanceApprovals.requestedAt))
      .limit(limit);
  }

  async getPendingGovernanceApprovals(userId?: string): Promise<schema.GovernanceApproval[]> {
    const now = new Date();
    const conditions = [
      eq(schema.governanceApprovals.status, 'PENDING'),
      or(
        isNull(schema.governanceApprovals.expiresAt),
        gt(schema.governanceApprovals.expiresAt, now)
      )
    ];
    
    if (userId) {
      conditions.push(eq(schema.governanceApprovals.requestedBy, userId));
    }
    
    return await db.select().from(schema.governanceApprovals)
      .where(and(...conditions))
      .orderBy(desc(schema.governanceApprovals.requestedAt));
  }

  async updateGovernanceApproval(id: string, updates: Partial<schema.GovernanceApproval>): Promise<schema.GovernanceApproval | undefined> {
    const [result] = await db.update(schema.governanceApprovals)
      .set(updates)
      .where(eq(schema.governanceApprovals.id, id))
      .returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
