/**
 * Backup Service
 * 
 * Handles comprehensive backup and restore operations for user data including:
 * - User profile
 * - Bots and their configurations
 * - Strategy candidates
 * - Backtest sessions
 * - Trade logs
 * - App settings (favorites, preferences)
 */

import { db } from "./db";
import { 
  users, 
  bots, 
  strategyCandidates, 
  backtestSessions, 
  tradeLogs,
  appSettings,
  accounts,
  botAccounts,
  botGenerations,
  qcVerifications,
  botStageEvents,
  evolutionTournaments,
  tournamentEntries,
  liveEligibilityTracking,
} from "@shared/schema";
import { eq, and, inArray, or, sql } from "drizzle-orm";
import { 
  uploadBackup,
  uploadBackupForUser, 
  downloadBackup, 
  listBackups, 
  deleteBackup,
  getBackupStatus,
  isGoogleDriveConnected,
  isGoogleDriveConnectedForUser,
  getCachedConnectionStatus,
  setCachedConnectionStatus,
  type BackupMetadata 
} from "./google-drive-client";
import { logActivityEvent } from "./activity-logger";

export interface BackupData {
  version: string;
  createdAt: string;
  userId: string;
  userEmail: string;
  profile: {
    username: string;
    email: string;
  };
  bots: Array<{
    id: string;
    name: string;
    stage: string;
    symbol: string;
    config: any;
    strategyType: string | null;
    strategyArchetype: string | null;
    isElite: boolean;
    isFavorite: boolean;
    aiProvider: string | null;
    createdAt: string;
  }>;
  strategyCandidates: Array<{
    id: string;
    name: string;
    status: string;
    strategyArchetype: string | null;
    researchDepth: string | null;
    confidenceScore: number | null;
    uniquenessScore: number | null;
    dispositionReason: string | null;
    isFavorite: boolean;
    createdAt: string;
  }>;
  backtestSessions: Array<{
    id: string;
    botId: string;
    status: string;
    startDate: string;
    endDate: string;
    sharpeRatio: number | null;
    maxDrawdownPct: number | null;
    winRate: number | null;
    netPnl: number | null;
    tradeCount: number | null;
    createdAt: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    broker: string;
    accountNumber: string | null;
    isSimulated: boolean;
    isFavorite: boolean;
    status: string;
  }>;
  appSettings: Array<{
    key: string;
    value: string;
  }>;
  statistics: {
    totalBots: number;
    totalStrategies: number;
    totalBacktests: number;
    totalAccounts: number;
    totalTournaments: number;
  };
  evolutionTournaments: Array<{
    id: string;
    cadence: string;
    status: string;
    entrantsCount: number;
    winnerId: string | null;
    winnerFitness: number | null;
    triggeredBy: string;
    startedAt: string;
    completedAt: string | null;
    summary: any;
  }>;
  tournamentEntries: Array<{
    id: string;
    tournamentId: string;
    botId: string;
    fitnessScore: number | null;
    rank: number | null;
    action: string | null;
    metricsSnapshot: any;
    passed: boolean;
    failureReasons: string[] | null;
  }>;
  liveEligibility: Array<{
    id: string;
    botId: string;
    consecutivePasses: number;
    lastTournamentId: string | null;
    promotedToLiveAt: string | null;
  }>;
}

export interface BackupSettings {
  autoBackupEnabled: boolean;
  backupFrequency: 'hourly' | 'daily' | 'weekly';
  backupRetentionCount: number;
  includeBacktests: boolean;
  includeTradeLogs: boolean;
  lastBackupAt: string | null;
  nextBackupAt: string | null;
}

const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackupEnabled: true,
  backupFrequency: 'daily',
  backupRetentionCount: 30,
  includeBacktests: true,
  includeTradeLogs: true,
  lastBackupAt: null,
  nextBackupAt: null,
};

let inMemoryBackupSettings: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS };

export async function getBackupSettings(): Promise<BackupSettings> {
  return inMemoryBackupSettings;
}

export async function updateBackupSettings(newSettings: Partial<BackupSettings>): Promise<BackupSettings> {
  inMemoryBackupSettings = { ...inMemoryBackupSettings, ...newSettings };
  return inMemoryBackupSettings;
}

export async function createBackup(userId: string, options?: { force?: boolean }): Promise<{ success: boolean; backup?: BackupMetadata; error?: string; inProgress?: boolean }> {
  const force = options?.force === true;
  
  // If force is true, reset the in-progress state (user explicitly wants a new backup)
  if (force && backupInProgress) {
    console.log(`[BACKUP_SERVICE] Force flag set - resetting in-progress state for new backup`);
    backupInProgress = false;
    currentBackupUserId = null;
  }
  
  if (backupInProgress && currentBackupUserId === userId) {
    console.log(`[BACKUP_SERVICE] Backup already in progress for user ${userId}, returning in-flight status`);
    return { 
      success: false, 
      inProgress: true,
      error: 'Backup already in progress',
    };
  }
  
  if (backupInProgress && currentBackupUserId !== userId) {
    console.log(`[BACKUP_SERVICE] Another user backup in progress, rejecting request`);
    return { success: false, error: 'Another backup is currently in progress. Please try again shortly.' };
  }
  
  if (global.gc) {
    console.log(`[BACKUP_SERVICE] Running garbage collection before backup...`);
    global.gc();
  }
  
  const memoryUsage = process.memoryUsage();
  const heapRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  
  console.log(`[BACKUP_SERVICE] Pre-flight memory check: ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapRatio * 100)}%)`);
  
  if (heapRatio > 0.92) {
    console.warn(`[BACKUP_SERVICE] Memory too high (${Math.round(heapRatio * 100)}%), refusing backup to prevent OOM`);
    return { 
      success: false, 
      error: `Server memory is too high (${Math.round(heapRatio * 100)}%). Please wait a moment and try again when load decreases.` 
    };
  }
  
  backupInProgress = true;
  currentBackupUserId = userId;
  backupStartTime = Date.now();
  
  updateBackupProgress({
    phase: 'preparing',
    currentItem: 'Gathering data...',
    itemsProcessed: 0,
    totalItems: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    startedAt: new Date().toISOString(),
  });
  
  try {
    console.log(`[BACKUP_SERVICE] Step 1: Checking Google Drive connection`);
    const connected = await isGoogleDriveConnectedForUser(userId);
    if (!connected) {
      backupInProgress = false;
      currentBackupUserId = null;
      backupStartTime = null;
      lastBackupSuccess = false;
      updateBackupProgress({ phase: 'failed', currentItem: 'Google Drive not connected' });
      return { success: false, error: 'Google Drive not connected' };
    }
    console.log(`[BACKUP_SERVICE] Step 1 complete: Drive connected`);

    console.log(`[BACKUP_SERVICE] Step 2: Fetching user`);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      backupInProgress = false;
      currentBackupUserId = null;
      backupStartTime = null;
      lastBackupSuccess = false;
      updateBackupProgress({ phase: 'failed', currentItem: 'User not found' });
      return { success: false, error: 'User not found' };
    }
    console.log(`[BACKUP_SERVICE] Step 2 complete: User found`);

    console.log(`[BACKUP_SERVICE] Step 3: Getting settings`);
    const settings = await getBackupSettings();
    console.log(`[BACKUP_SERVICE] Step 3 complete: Settings retrieved`);

    console.log(`[BACKUP_SERVICE] Step 4: Fetching bots`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading bots...' });
    const userBots = await db.select().from(bots).where(eq(bots.userId, userId));
    const botIds = userBots.map(b => b.id);
    console.log(`[BACKUP_SERVICE] Step 4 complete: ${userBots.length} bots found`);
    
    console.log(`[BACKUP_SERVICE] Step 5: Fetching strategy candidates`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading strategies...' });
    let userCandidates: typeof strategyCandidates.$inferSelect[] = [];
    if (botIds.length > 0) {
      // Use SQL IN clause instead of loading entire table
      // Split into two queries to avoid OR performance issues with nulls
      const candidatesBySource = await db.select().from(strategyCandidates).where(
        inArray(strategyCandidates.sourceLabBotId, botIds)
      );
      const candidatesByCreated = await db.select().from(strategyCandidates).where(
        inArray(strategyCandidates.createdBotId, botIds)
      );
      // Merge and deduplicate
      const candidateMap = new Map<string, typeof strategyCandidates.$inferSelect>();
      for (const c of candidatesBySource) candidateMap.set(c.id, c);
      for (const c of candidatesByCreated) candidateMap.set(c.id, c);
      userCandidates = Array.from(candidateMap.values());
    }
    console.log(`[BACKUP_SERVICE] Step 5 complete: ${userCandidates.length} candidates found`);
    
    console.log(`[BACKUP_SERVICE] Step 6: Fetching accounts`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading accounts...' });
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    console.log(`[BACKUP_SERVICE] Step 6 complete: ${userAccounts.length} accounts found`);
    
    console.log(`[BACKUP_SERVICE] Step 7: Fetching backtests (includeBacktests: ${settings.includeBacktests})`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading backtests...' });
    let userBacktests: any[] = [];
    if (settings.includeBacktests && botIds.length > 0) {
      // Select only essential columns - exclude large JSON fields to prevent OOM
      // Limit to 5 most recent sessions per bot (totals max ~180 rows for 36 bots)
      userBacktests = await db.select({
        id: backtestSessions.id,
        botId: backtestSessions.botId,
        status: backtestSessions.status,
        symbol: backtestSessions.symbol,
        startDate: backtestSessions.startDate,
        endDate: backtestSessions.endDate,
        netPnl: backtestSessions.netPnl,
        totalTrades: backtestSessions.totalTrades,
        winRate: backtestSessions.winRate,
        profitFactor: backtestSessions.profitFactor,
        sharpeRatio: backtestSessions.sharpeRatio,
        maxDrawdownPct: backtestSessions.maxDrawdownPct,
        expectancy: backtestSessions.expectancy,
        createdAt: backtestSessions.createdAt,
      }).from(backtestSessions).where(
        inArray(backtestSessions.botId, botIds)
      ).orderBy(sql`${backtestSessions.createdAt} DESC NULLS LAST`).limit(200);
    }
    console.log(`[BACKUP_SERVICE] Step 7 complete: ${userBacktests.length} backtests found`);

    console.log(`[BACKUP_SERVICE] Step 8: Fetching app settings`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading settings...' });
    const userSettings = await db.select().from(appSettings).where(
      eq(appSettings.userId, userId)
    );
    const allUserSettings = userSettings;
    console.log(`[BACKUP_SERVICE] Step 8 complete: ${allUserSettings.length} settings found`);

    console.log(`[BACKUP_SERVICE] Step 9: Fetching evolution tournaments`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading tournaments...' });
    const userTournaments = await db.select().from(evolutionTournaments)
      .where(eq(evolutionTournaments.userId, userId))
      .orderBy(sql`${evolutionTournaments.startedAt} DESC NULLS LAST`)
      .limit(100);
    console.log(`[BACKUP_SERVICE] Step 9 complete: ${userTournaments.length} tournaments found`);

    console.log(`[BACKUP_SERVICE] Step 10: Fetching tournament entries`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading tournament entries...' });
    let userTournamentEntries: typeof tournamentEntries.$inferSelect[] = [];
    if (userTournaments.length > 0) {
      const tournamentIds = userTournaments.map(t => t.id);
      userTournamentEntries = await db.select().from(tournamentEntries)
        .where(inArray(tournamentEntries.tournamentId, tournamentIds))
        .limit(1000);
    }
    console.log(`[BACKUP_SERVICE] Step 10 complete: ${userTournamentEntries.length} entries found`);

    console.log(`[BACKUP_SERVICE] Step 11: Fetching live eligibility`);
    updateBackupProgress({ phase: 'preparing', currentItem: 'Loading live eligibility...' });
    let userLiveEligibility: typeof liveEligibilityTracking.$inferSelect[] = [];
    if (botIds.length > 0) {
      userLiveEligibility = await db.select().from(liveEligibilityTracking)
        .where(inArray(liveEligibilityTracking.botId, botIds));
    }
    console.log(`[BACKUP_SERVICE] Step 11 complete: ${userLiveEligibility.length} eligibility records found`);

    const backupData: BackupData = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      userId: user.id,
      userEmail: user.email,
      profile: {
        username: user.username,
        email: user.email,
      },
      bots: userBots.map(b => ({
        id: b.id,
        name: b.name,
        stage: b.stage,
        symbol: b.symbol,
        config: b.config,
        strategyType: b.strategyType,
        strategyArchetype: b.strategyArchetype,
        isElite: b.isElite || false,
        isFavorite: b.isFavorite || false,
        aiProvider: b.aiProvider,
        createdAt: b.createdAt?.toISOString() || new Date().toISOString(),
      })),
      strategyCandidates: userCandidates.map(c => ({
        id: c.id,
        name: c.strategyName,
        status: c.disposition || 'PENDING_REVIEW',
        strategyArchetype: c.archetypeName || null,
        researchDepth: c.researchDepth || null,
        confidenceScore: c.confidenceScore || 0,
        uniquenessScore: c.noveltyScore || null,
        dispositionReason: c.rejectionReason || null,
        isFavorite: c.isFavorite || false,
        createdAt: c.createdAt?.toISOString() || new Date().toISOString(),
      })),
      backtestSessions: userBacktests.map(bt => ({
        id: bt.id,
        botId: bt.botId,
        status: bt.status,
        startDate: bt.startDate,
        endDate: bt.endDate,
        sharpeRatio: bt.sharpeRatio ? Number(bt.sharpeRatio) : null,
        maxDrawdownPct: bt.maxDrawdownPct ? Number(bt.maxDrawdownPct) : null,
        winRate: bt.winRate ? Number(bt.winRate) : null,
        netPnl: bt.netPnl ? Number(bt.netPnl) : null,
        tradeCount: bt.tradeCount,
        createdAt: bt.createdAt?.toISOString() || new Date().toISOString(),
      })),
      accounts: userAccounts.map(a => ({
        id: a.id,
        name: a.name,
        broker: a.broker,
        accountNumber: a.accountNumber,
        isSimulated: a.isSimulated || false,
        isFavorite: a.isFavorite || false,
        status: a.status,
      })),
      appSettings: allUserSettings.map(s => ({
        id: s.id,
        general: s.general,
        appearance: s.appearance,
        notifications: s.notifications,
      })),
      statistics: {
        totalBots: userBots.length,
        totalStrategies: userCandidates.length,
        totalBacktests: userBacktests.length,
        totalAccounts: userAccounts.length,
        totalTournaments: userTournaments.length,
      },
      evolutionTournaments: userTournaments.map(t => ({
        id: t.id,
        cadence: t.cadenceType,
        status: t.status || 'COMPLETED',
        entrantsCount: t.entrantsCount || 0,
        winnerId: t.winnerId,
        winnerFitness: t.winnerFitness ? Number(t.winnerFitness) : null,
        triggeredBy: t.triggeredBy || 'unknown',
        startedAt: t.startedAt?.toISOString() || new Date().toISOString(),
        completedAt: t.endedAt?.toISOString() || null,
        summary: t.summaryJson ? JSON.parse(JSON.stringify(t.summaryJson)) : {},
      })),
      tournamentEntries: userTournamentEntries.map(e => ({
        id: e.id,
        tournamentId: e.tournamentId,
        botId: e.botId,
        fitnessScore: e.fitnessV2 ? Number(e.fitnessV2) : null,
        rank: e.rank,
        action: e.actionTaken,
        metricsSnapshot: {
          sharpeRatio: e.sharpeRatio ? Number(e.sharpeRatio) : null,
          profitFactor: e.profitFactor ? Number(e.profitFactor) : null,
          winRate: e.winRate ? Number(e.winRate) : null,
          maxDrawdownPct: e.maxDrawdownPct ? Number(e.maxDrawdownPct) : null,
        },
        passed: e.passedThreshold || false,
        failureReasons: e.actionReason ? [e.actionReason] : null,
      })),
      liveEligibility: userLiveEligibility.map(le => ({
        id: le.id,
        botId: le.botId,
        consecutivePasses: le.candidatePassStreak || 0,
        lastTournamentId: le.lastTournamentId,
        promotedToLiveAt: le.promotedToLiveAt?.toISOString() || null,
      })),
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `blaidtrades_backup_${user.username}_${timestamp}.json`;

    // Calculate total items for progress
    const totalItems = userBots.length + userCandidates.length + userAccounts.length + userBacktests.length + userTournaments.length;
    const backupJson = JSON.stringify(backupData);
    const totalBytes = Buffer.byteLength(backupJson, 'utf8');
    
    // Update progress - now uploading
    updateBackupProgress({
      phase: 'uploading',
      currentItem: `Uploading ${filename}...`,
      itemsProcessed: totalItems,
      totalItems,
      bytesUploaded: 0,
      totalBytes,
    });

    const backup = await uploadBackupForUser(
      userId,
      filename, 
      backupData,
      `Full backup for ${user.username} (${user.email}) - ${userBots.length} bots, ${userCandidates.length} strategies, ${userTournaments.length} tournaments`
    );

    // Update progress - upload complete (keep progress visible for one more poll cycle)
    updateBackupProgress({
      phase: 'complete',
      currentItem: 'Backup complete',
      itemsProcessed: totalItems,
      totalItems,
      bytesUploaded: totalBytes,
      totalBytes,
    });

    await updateBackupSettings({ lastBackupAt: new Date().toISOString() });
    invalidateDriveTimestampCache();

    await logActivityEvent({
      eventType: 'CLOUD_BACKUP',
      severity: 'INFO',
      title: 'Backup Created',
      summary: `Created backup with ${userBots.length} bots, ${userCandidates.length} strategies`,
      payload: { 
        backupId: backup.id, 
        filename: backup.name,
        statistics: backupData.statistics,
      },
    });

    console.log(`[BACKUP_SERVICE] Created backup: ${backup.name} (${backup.id})`);

    backupInProgress = false;
    currentBackupUserId = null;
    backupStartTime = null;
    lastBackupSuccess = true;
    
    setTimeout(() => {
      if (!backupInProgress) resetBackupProgress();
    }, 3000);
    
    return { success: true, backup };
  } catch (error) {
    console.error('[BACKUP_SERVICE] Create backup failed:', error);
    backupInProgress = false;
    currentBackupUserId = null;
    backupStartTime = null;
    lastBackupSuccess = false;
    updateBackupProgress({ phase: 'failed', currentItem: String(error) });
    
    setTimeout(() => {
      if (!backupInProgress) resetBackupProgress();
    }, 3000);
    
    return { success: false, error: String(error) };
  }
}

export async function restoreBackup(
  backupId: string, 
  userId: string,
  options: { 
    mergeBots?: boolean; 
    mergeStrategies?: boolean;
    skipExisting?: boolean;
  } = {}
): Promise<{ success: boolean; restored?: { bots: number; strategies: number; accounts: number }; error?: string }> {
  try {
    const data = await downloadBackup(backupId) as BackupData;
    
    if (!data.version || !data.userId) {
      return { success: false, error: 'Invalid backup format' };
    }

    let botsRestored = 0;
    let strategiesRestored = 0;
    let accountsRestored = 0;

    if (data.bots && data.bots.length > 0) {
      for (const bot of data.bots) {
        const existing = await db.select().from(bots).where(eq(bots.id, bot.id));
        
        if (existing.length === 0) {
          await db.insert(bots).values({
            id: bot.id,
            userId,
            name: bot.name,
            stage: bot.stage as any,
            symbol: bot.symbol,
            config: bot.config,
            strategyType: bot.strategyType,
            strategyArchetype: bot.strategyArchetype,
            isElite: bot.isElite,
            isFavorite: bot.isFavorite,
            aiProvider: bot.aiProvider,
          });
          botsRestored++;
        } else if (options.mergeBots) {
          const updateFields: Record<string, any> = {};
          if (bot.isFavorite !== undefined) updateFields.isFavorite = bot.isFavorite;
          if (bot.isElite !== undefined) updateFields.isElite = bot.isElite;
          if (bot.stage !== undefined) updateFields.stage = bot.stage;
          if (bot.config !== undefined) updateFields.config = bot.config;
          
          if (Object.keys(updateFields).length > 0) {
            await db.update(bots).set(updateFields).where(eq(bots.id, bot.id));
          }
        }
      }
    }

    if (data.strategyCandidates && data.strategyCandidates.length > 0) {
      for (const candidate of data.strategyCandidates) {
        const existing = await db.select().from(strategyCandidates).where(eq(strategyCandidates.id, candidate.id));
        
        if (existing.length === 0) {
          try {
            await db.insert(strategyCandidates).values({
              id: candidate.id,
              strategyName: candidate.strategyName || candidate.name || 'Restored Strategy',
              archetypeId: candidate.archetypeId || null,
              archetypeName: candidate.archetypeName || candidate.strategyArchetype || null,
              hypothesis: candidate.hypothesis || 'Strategy restored from backup',
              rulesJson: candidate.rulesJson || candidate.rules || {},
              confidenceScore: candidate.confidenceScore ?? 0,
              disposition: (candidate.disposition || candidate.status || 'PENDING_REVIEW') as any,
              source: (candidate.source || 'MANUAL') as any,
              researchDepth: (candidate.researchDepth || 'BALANCED') as any,
              isFavorite: candidate.isFavorite ?? false,
              noveltyScore: candidate.noveltyScore || candidate.uniquenessScore || null,
              plainLanguageSummaryJson: candidate.plainLanguageSummaryJson || null,
              aiProvider: candidate.aiProvider || null,
              createdByAi: candidate.createdByAi || null,
            });
            strategiesRestored++;
          } catch (insertError) {
            console.warn(`[BACKUP_SERVICE] Skipping strategy ${candidate.id}: ${insertError}`);
          }
        } else if (options.mergeStrategies) {
          const updateFields: Record<string, any> = {};
          if (candidate.isFavorite !== undefined) updateFields.isFavorite = candidate.isFavorite;
          if (candidate.disposition !== undefined) updateFields.disposition = candidate.disposition;
          if (candidate.confidenceScore !== undefined) updateFields.confidenceScore = candidate.confidenceScore;
          
          if (Object.keys(updateFields).length > 0) {
            await db.update(strategyCandidates).set(updateFields).where(eq(strategyCandidates.id, candidate.id));
          }
        }
      }
    }

    if (data.accounts && data.accounts.length > 0) {
      for (const account of data.accounts) {
        const existing = await db.select().from(accounts).where(eq(accounts.id, account.id));
        
        if (existing.length === 0) {
          try {
            await db.insert(accounts).values({
              id: account.id,
              userId,
              name: account.name,
              broker: account.broker as any,
            } as any);
            accountsRestored++;
          } catch (insertError) {
            console.warn(`[BACKUP_SERVICE] Skipping account ${account.id}: ${insertError}`);
          }
        }
      }
    }

    let backtestsRestored = 0;
    if (data.backtestSessions && data.backtestSessions.length > 0) {
      for (const session of data.backtestSessions) {
        try {
          const existing = await db.select().from(backtestSessions).where(eq(backtestSessions.id, session.id));
          
          if (existing.length === 0) {
            await db.insert(backtestSessions).values({
              id: session.id,
              botId: session.botId,
              status: (session.status || 'completed') as any,
              startDate: session.startDate,
              endDate: session.endDate,
              netPnl: session.netPnl ? String(session.netPnl) : null,
              totalTrades: session.tradeCount,
              winRate: session.winRate ? String(session.winRate) : null,
              sharpeRatio: session.sharpeRatio ? String(session.sharpeRatio) : null,
              maxDrawdownPct: session.maxDrawdownPct ? String(session.maxDrawdownPct) : null,
            } as any);
            backtestsRestored++;
          }
        } catch (insertError) {
          console.warn(`[BACKUP_SERVICE] Skipping backtest session ${session.id}: ${insertError}`);
        }
      }
    }

    await logActivityEvent({
      eventType: 'CLOUD_BACKUP' as any,
      severity: 'INFO',
      title: 'Backup Restored',
      summary: `Restored ${botsRestored} bots, ${strategiesRestored} strategies, ${accountsRestored} accounts, ${backtestsRestored} backtests`,
      payload: { 
        backupId,
        botsRestored,
        strategiesRestored,
        accountsRestored,
      },
    });

    console.log(`[BACKUP_SERVICE] Restored backup: ${botsRestored} bots, ${strategiesRestored} strategies`);

    return { 
      success: true, 
      restored: { 
        bots: botsRestored, 
        strategies: strategiesRestored,
        accounts: accountsRestored,
      } 
    };
  } catch (error) {
    console.error('[BACKUP_SERVICE] Restore backup failed:', error);
    return { success: false, error: String(error) };
  }
}

export async function listUserBackups(): Promise<BackupMetadata[]> {
  return listBackups();
}

export async function deleteUserBackup(backupId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteBackup(backupId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

let backupInProgress = false;
let currentBackupUserId: string | null = null;
let backupStartTime: number | null = null;
let lastBackupSuccess: boolean | null = null;

// Live backup progress tracking for real-time UI updates
interface BackupProgress {
  phase: 'preparing' | 'uploading' | 'complete' | 'failed';
  currentItem: string;
  itemsProcessed: number;
  totalItems: number;
  bytesUploaded: number;
  totalBytes: number;
  startedAt: string | null;
}

let backupProgress: BackupProgress = {
  phase: 'complete',
  currentItem: '',
  itemsProcessed: 0,
  totalItems: 0,
  bytesUploaded: 0,
  totalBytes: 0,
  startedAt: null,
};

export function updateBackupProgress(update: Partial<BackupProgress>) {
  backupProgress = { ...backupProgress, ...update };
}

export function resetBackupProgress() {
  backupProgress = {
    phase: 'complete',
    currentItem: '',
    itemsProcessed: 0,
    totalItems: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    startedAt: null,
  };
}

let cachedDriveTimestamp: { value: string | null; fetchedAt: number } | null = null;
const DRIVE_TIMESTAMP_CACHE_TTL = 60000;

export function invalidateDriveTimestampCache() {
  cachedDriveTimestamp = null;
}

export async function getBackupQuickStatus(userId?: string): Promise<{
  connected: boolean;
  backingUp: boolean;
  lastBackupSuccess: boolean | null;
  lastBackupAt: string | null;
  progress: BackupProgress | null;
}> {
  // Use user-specific connection check if userId provided
  const connected = userId 
    ? await isGoogleDriveConnectedForUser(userId)
    : await isGoogleDriveConnected();
  const settings = await getBackupSettings();
  
  let lastBackupAtValue = settings.lastBackupAt;
  if (!lastBackupAtValue && connected) {
    const now = Date.now();
    if (cachedDriveTimestamp && (now - cachedDriveTimestamp.fetchedAt) < DRIVE_TIMESTAMP_CACHE_TTL) {
      lastBackupAtValue = cachedDriveTimestamp.value;
    } else {
      try {
        const backups = await listBackups();
        if (backups.length > 0 && backups[0].createdTime) {
          lastBackupAtValue = backups[0].createdTime;
        }
        cachedDriveTimestamp = { value: lastBackupAtValue, fetchedAt: now };
      } catch (e) {
        cachedDriveTimestamp = { value: null, fetchedAt: now };
      }
    }
  }
  
  // Return progress if either actively backing up OR progress has meaningful data from recent backup
  const hasActiveProgress = backupProgress.phase !== 'complete' || backupProgress.totalBytes > 0;
  
  return {
    connected,
    backingUp: backupInProgress,
    lastBackupSuccess,
    lastBackupAt: lastBackupAtValue,
    // Return progress during backup OR if there's recent progress data to show
    progress: (backupInProgress || hasActiveProgress) ? backupProgress : null,
  };
}

const DASHBOARD_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

// Cached dashboard data to avoid repeated expensive calls
interface DashboardCache {
  data: {
    connected: boolean;
    settings: BackupSettings;
    status: Awaited<ReturnType<typeof getBackupStatus>>;
    recentBackups: BackupMetadata[];
  };
  timestamp: number;
}
const dashboardCache = new Map<string, DashboardCache>();
const DASHBOARD_CACHE_TTL = 30000; // 30 seconds

export async function getCloudBackupDashboard(userId?: string): Promise<{
  connected: boolean;
  settings: BackupSettings;
  status: Awaited<ReturnType<typeof getBackupStatus>>;
  recentBackups: BackupMetadata[];
}> {
  const cacheKey = userId || 'default';
  
  // Return cached data immediately if available (instant response)
  const cached = dashboardCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL) {
    return cached.data;
  }
  
  const settings = await getBackupSettings();
  
  // Check connection cache first for instant "not connected" response
  if (userId) {
    const cachedConnected = getCachedConnectionStatus(userId);
    if (cachedConnected === false) {
      const result = {
        connected: false,
        settings,
        status: {
          connected: false,
          folderExists: false,
          backupCount: 0,
          latestBackup: null,
          totalSizeBytes: 0,
        },
        recentBackups: [],
      };
      dashboardCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }
  }
  
  const connectedPromise = userId 
    ? isGoogleDriveConnectedForUser(userId) 
    : isGoogleDriveConnected();
  const connected = await withTimeout(connectedPromise, DASHBOARD_TIMEOUT_MS, false);
  
  if (userId) {
    setCachedConnectionStatus(userId, connected);
  }
  
  if (!connected) {
    const result = {
      connected: false,
      settings,
      status: {
        connected: false,
        folderExists: false,
        backupCount: 0,
        latestBackup: null,
        totalSizeBytes: 0,
      },
      recentBackups: [],
    };
    dashboardCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  const backupsPromise = listBackups();
  const backups = await withTimeout(backupsPromise, DASHBOARD_TIMEOUT_MS, []);
  const totalSize = backups.reduce((sum, b) => sum + parseInt(b.size || '0', 10), 0);
  
  if (backups.length > 0 && backups[0].createdTime) {
    cachedDriveTimestamp = { value: backups[0].createdTime, fetchedAt: Date.now() };
  }
  
  const status = {
    connected: true,
    folderExists: true,
    backupCount: backups.length,
    latestBackup: backups[0] || null,
    totalSizeBytes: totalSize,
  };

  const result = {
    connected: true,
    settings,
    status,
    recentBackups: backups.slice(0, 10),
  };
  
  dashboardCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

export function clearDashboardCache(userId?: string): void {
  if (userId) {
    dashboardCache.delete(userId);
    dashboardCache.delete('default');
  } else {
    dashboardCache.clear();
  }
}

let backupSchedulerTimer: ReturnType<typeof setTimeout> | null = null;

export async function startBackupScheduler(): Promise<void> {
  const settings = await getBackupSettings();
  
  if (!settings.autoBackupEnabled) {
    console.log('[BACKUP_SCHEDULER] Auto backup disabled');
    return;
  }

  const connected = await isGoogleDriveConnected();
  if (!connected) {
    console.log('[BACKUP_SCHEDULER] Google Drive not connected, skipping scheduler');
    return;
  }

  const intervalMs = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  }[settings.backupFrequency];

  const runScheduledBackup = async () => {
    console.log('[BACKUP_SCHEDULER] Running scheduled backup...');
    
    const allUsers = await db.select().from(users);
    
    for (const user of allUsers) {
      const result = await createBackup(user.id);
      if (result.success) {
        console.log(`[BACKUP_SCHEDULER] Backup created for user ${user.username}`);
      } else {
        console.error(`[BACKUP_SCHEDULER] Backup failed for user ${user.username}: ${result.error}`);
      }
    }

    const currentSettings = await getBackupSettings();
    if (currentSettings.backupRetentionCount > 0) {
      const backups = await listBackups();
      if (backups.length > currentSettings.backupRetentionCount) {
        const toDelete = backups.slice(currentSettings.backupRetentionCount);
        for (const backup of toDelete) {
          await deleteBackup(backup.id);
          console.log(`[BACKUP_SCHEDULER] Deleted old backup: ${backup.name}`);
        }
      }
    }

    await updateBackupSettings({
      lastBackupAt: new Date().toISOString(),
      nextBackupAt: new Date(Date.now() + intervalMs).toISOString(),
    });
  };

  if (backupSchedulerTimer) {
    clearInterval(backupSchedulerTimer);
  }

  backupSchedulerTimer = setInterval(runScheduledBackup, intervalMs);

  const nextBackup = new Date(Date.now() + intervalMs);
  await updateBackupSettings({ nextBackupAt: nextBackup.toISOString() });
  
  // Clear dashboard cache so frontend gets updated nextBackupAt
  clearDashboardCache();

  console.log(`[BACKUP_SCHEDULER] Started with ${settings.backupFrequency} frequency, next backup at ${nextBackup.toISOString()}`);
}

export function stopBackupScheduler(): void {
  if (backupSchedulerTimer) {
    clearInterval(backupSchedulerTimer);
    backupSchedulerTimer = null;
    console.log('[BACKUP_SCHEDULER] Stopped');
  }
}
