import { db } from "./db";
import { 
  bots, 
  botGenerations, 
  strategyArchetypes, 
  strategyCandidates,
  accounts
} from "@shared/schema";
import { eq, and, isNull, inArray, or } from "drizzle-orm";

interface ExportData {
  version: string;
  exportedAt: string;
  bots: any[];
  botGenerations: any[];
  strategyArchetypes: any[];
  strategyCandidates: any[];
  accounts: any[];
}

export async function exportUserData(userId: string): Promise<ExportData> {
  console.log(`[DATA_MIGRATION] Starting export for user ${userId}`);

  const userBots = await db.select().from(bots).where(eq(bots.userId, userId));
  console.log(`[DATA_MIGRATION] Found ${userBots.length} bots`);

  const botIds = userBots.map(b => b.id);
  
  let generations: any[] = [];
  if (botIds.length > 0) {
    for (const botId of botIds) {
      const botGens = await db.select().from(botGenerations).where(eq(botGenerations.botId, botId));
      generations = [...generations, ...botGens];
    }
  }
  console.log(`[DATA_MIGRATION] Found ${generations.length} generations`);

  const userArchetypes = await db.select().from(strategyArchetypes).where(eq(strategyArchetypes.userId, userId));
  console.log(`[DATA_MIGRATION] Found ${userArchetypes.length} user archetypes`);

  let candidates: any[] = [];
  if (botIds.length > 0) {
    const botIdSet = new Set(botIds);
    const rawCandidates = await db.select().from(strategyCandidates).where(
      or(
        inArray(strategyCandidates.sourceLabBotId, botIds),
        inArray(strategyCandidates.createdBotId, botIds)
      )
    );
    candidates = rawCandidates.filter(c => {
      const sourceOk = !c.sourceLabBotId || botIdSet.has(c.sourceLabBotId);
      const createdOk = !c.createdBotId || botIdSet.has(c.createdBotId);
      return sourceOk && createdOk;
    });
  }
  console.log(`[DATA_MIGRATION] Found ${candidates.length} strategy candidates linked to user's bots`);

  const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
  console.log(`[DATA_MIGRATION] Found ${userAccounts.length} accounts`);

  return {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    bots: userBots,
    botGenerations: generations,
    strategyArchetypes: userArchetypes,
    strategyCandidates: candidates,
    accounts: userAccounts,
  };
}

interface ImportResult {
  success: boolean;
  imported: {
    bots: number;
    botGenerations: number;
    strategyArchetypes: number;
    strategyCandidates: number;
    accounts: number;
  };
  errors: string[];
}

export async function importUserData(userId: string, data: ExportData): Promise<ImportResult> {
  console.log(`[DATA_MIGRATION] Starting import for user ${userId}`);
  
  const result: ImportResult = {
    success: true,
    imported: {
      bots: 0,
      botGenerations: 0,
      strategyArchetypes: 0,
      strategyCandidates: 0,
      accounts: 0,
    },
    errors: [],
  };

  try {
    const existingBots = await db.select({ id: bots.id }).from(bots).where(eq(bots.userId, userId));
    const existingBotIds = new Set(existingBots.map(b => b.id));

    const existingArchetypes = await db.select({ id: strategyArchetypes.id }).from(strategyArchetypes);
    const existingArchetypeIds = new Set(existingArchetypes.map(a => a.id));

    const existingAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId));
    const existingAccountIds = new Set(existingAccounts.map(a => a.id));

    for (const account of data.accounts || []) {
      if (!existingAccountIds.has(account.id)) {
        try {
          await db.insert(accounts).values({
            ...account,
            userId: userId,
          });
          result.imported.accounts++;
        } catch (e: any) {
          result.errors.push(`Account ${account.name}: ${e.message}`);
        }
      }
    }

    for (const archetype of data.strategyArchetypes || []) {
      if (!existingArchetypeIds.has(archetype.id)) {
        try {
          await db.insert(strategyArchetypes).values({
            ...archetype,
            userId: userId,
          });
          result.imported.strategyArchetypes++;
        } catch (e: any) {
          result.errors.push(`Archetype ${archetype.name}: ${e.message}`);
        }
      }
    }

    const botIdMapping: Record<string, string> = {};
    
    for (const bot of data.bots || []) {
      if (existingBotIds.has(bot.id)) {
        botIdMapping[bot.id] = bot.id;
        continue;
      }
      
      try {
        const insertedBot = await db.insert(bots).values({
          ...bot,
          userId: userId,
          currentGenerationId: null,
          defaultAccountId: null,
        }).returning({ id: bots.id });
        
        botIdMapping[bot.id] = insertedBot[0].id;
        result.imported.bots++;
      } catch (e: any) {
        result.errors.push(`Bot ${bot.name}: ${e.message}`);
      }
    }

    for (const gen of data.botGenerations || []) {
      const newBotId = botIdMapping[gen.botId];
      if (!newBotId) continue;
      
      try {
        const existingGen = await db.select({ id: botGenerations.id })
          .from(botGenerations)
          .where(and(
            eq(botGenerations.botId, newBotId),
            eq(botGenerations.generationNumber, gen.generationNumber)
          ));
        
        if (existingGen.length === 0) {
          await db.insert(botGenerations).values({
            ...gen,
            botId: newBotId,
            parentGenerationId: null,
            baselineBacktestId: null,
          });
          result.imported.botGenerations++;
        }
      } catch (e: any) {
        result.errors.push(`Generation ${gen.id}: ${e.message}`);
      }
    }

    for (const candidate of data.strategyCandidates || []) {
      try {
        const existing = await db.select({ id: strategyCandidates.id })
          .from(strategyCandidates)
          .where(eq(strategyCandidates.id, candidate.id));
        
        if (existing.length === 0) {
          const newSourceBotId = candidate.sourceLabBotId ? botIdMapping[candidate.sourceLabBotId] : null;
          const newCreatedBotId = candidate.createdBotId ? botIdMapping[candidate.createdBotId] : null;
          
          await db.insert(strategyCandidates).values({
            ...candidate,
            sourceLabBotId: newSourceBotId || null,
            createdBotId: newCreatedBotId || null,
          });
          result.imported.strategyCandidates++;
        }
      } catch (e: any) {
        result.errors.push(`Candidate ${candidate.strategyName}: ${e.message}`);
      }
    }

    console.log(`[DATA_MIGRATION] Import complete:`, result.imported);
    
  } catch (e: any) {
    result.success = false;
    result.errors.push(`Fatal error: ${e.message}`);
  }

  return result;
}
