import { db } from "./db";
import { systemSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ConfigDefault {
  category: string;
  key: string;
  value: unknown;
  description: string;
}

const CODE_DEFAULTS: ConfigDefault[] = [
  {
    category: "strategy_lab",
    key: "min_confidence_threshold",
    value: 0.65,
    description: "Minimum confidence score for strategy candidates to qualify for trials",
  },
  {
    category: "strategy_lab",
    key: "min_uniqueness_threshold",
    value: 0.50,
    description: "Minimum uniqueness score for strategy candidates",
  },
  {
    category: "strategy_lab",
    key: "auto_promote_enabled",
    value: true,
    description: "Enable automatic promotion from PENDING_REVIEW to SENT_TO_LAB",
  },
  {
    category: "strategy_lab",
    key: "max_concurrent_trials",
    value: 10,
    description: "Maximum number of concurrent strategy trials",
  },
  {
    category: "research_orchestrator",
    key: "grok_enabled",
    value: true,
    description: "Enable Grok autonomous research engine",
  },
  {
    category: "research_orchestrator",
    key: "perplexity_enabled",
    value: true,
    description: "Enable Perplexity deep research",
  },
  {
    category: "research_orchestrator",
    key: "cycle_interval_minutes",
    value: 30,
    description: "Minutes between research cycles",
  },
  {
    category: "risk",
    key: "max_drawdown_pct",
    value: 15,
    description: "Maximum drawdown percentage before risk controls kick in",
  },
  {
    category: "risk",
    key: "max_daily_loss_pct",
    value: 5,
    description: "Maximum daily loss percentage threshold",
  },
];

export async function getSetting<T>(category: string, key: string): Promise<T | null> {
  try {
    const result = await db.select()
      .from(systemSettings)
      .where(and(
        eq(systemSettings.category, category),
        eq(systemSettings.key, key)
      ))
      .limit(1);
    
    if (result.length === 0) {
      const codeDefault = CODE_DEFAULTS.find(d => d.category === category && d.key === key);
      return (codeDefault?.value as T) ?? null;
    }
    
    return result[0].value as T;
  } catch (error) {
    console.error(`[CONFIG] Failed to get setting ${category}.${key}:`, error);
    const codeDefault = CODE_DEFAULTS.find(d => d.category === category && d.key === key);
    return (codeDefault?.value as T) ?? null;
  }
}

export async function setSetting(category: string, key: string, value: unknown, updatedBy: string = "system"): Promise<boolean> {
  try {
    const existing = await db.select()
      .from(systemSettings)
      .where(and(
        eq(systemSettings.category, category),
        eq(systemSettings.key, key)
      ))
      .limit(1);
    
    const codeDefault = CODE_DEFAULTS.find(d => d.category === category && d.key === key);
    
    if (existing.length === 0) {
      await db.insert(systemSettings).values({
        category,
        key,
        value,
        description: codeDefault?.description || null,
        defaultValue: codeDefault?.value ?? null,
        version: 1,
        lastUpdatedBy: updatedBy,
      });
    } else {
      await db.update(systemSettings)
        .set({
          value,
          version: (existing[0].version || 1) + 1,
          lastUpdatedAt: new Date(),
          lastUpdatedBy: updatedBy,
        })
        .where(and(
          eq(systemSettings.category, category),
          eq(systemSettings.key, key)
        ));
    }
    
    return true;
  } catch (error) {
    console.error(`[CONFIG] Failed to set setting ${category}.${key}:`, error);
    return false;
  }
}

export async function reconcileConfigAtStartup(): Promise<{ synced: number; errors: string[] }> {
  console.log("[CONFIG_RECONCILIATION] Starting config reconciliation...");
  
  const errors: string[] = [];
  let synced = 0;
  
  for (const configDefault of CODE_DEFAULTS) {
    try {
      const existing = await db.select()
        .from(systemSettings)
        .where(and(
          eq(systemSettings.category, configDefault.category),
          eq(systemSettings.key, configDefault.key)
        ))
        .limit(1);
      
      if (existing.length === 0) {
        await db.insert(systemSettings).values({
          category: configDefault.category,
          key: configDefault.key,
          value: configDefault.value,
          description: configDefault.description,
          defaultValue: configDefault.value,
          version: 1,
          lastUpdatedBy: "system_startup",
        });
        console.log(`[CONFIG_RECONCILIATION] Created missing setting: ${configDefault.category}.${configDefault.key}`);
        synced++;
      } else {
        if (existing[0].defaultValue !== configDefault.value) {
          await db.update(systemSettings)
            .set({
              defaultValue: configDefault.value,
              lastUpdatedAt: new Date(),
            })
            .where(and(
              eq(systemSettings.category, configDefault.category),
              eq(systemSettings.key, configDefault.key)
            ));
          console.log(`[CONFIG_RECONCILIATION] Updated default for: ${configDefault.category}.${configDefault.key}`);
          synced++;
        }
      }
    } catch (error) {
      const errorMsg = `Failed to reconcile ${configDefault.category}.${configDefault.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      console.error(`[CONFIG_RECONCILIATION] ${errorMsg}`);
    }
  }
  
  if (errors.length === 0) {
    console.log(`[CONFIG_RECONCILIATION] Completed successfully. Synced ${synced} settings.`);
  } else {
    console.error(`[CONFIG_RECONCILIATION] Completed with ${errors.length} errors. Synced ${synced} settings.`);
  }
  
  return { synced, errors };
}

export async function getAllSettings(): Promise<Map<string, Map<string, unknown>>> {
  const settings = new Map<string, Map<string, unknown>>();
  
  try {
    const results = await db.select().from(systemSettings);
    
    for (const row of results) {
      if (!settings.has(row.category)) {
        settings.set(row.category, new Map());
      }
      settings.get(row.category)!.set(row.key, row.value);
    }
  } catch (error) {
    console.error("[CONFIG] Failed to get all settings:", error);
  }
  
  return settings;
}

export function getCodeDefaults(): ConfigDefault[] {
  return [...CODE_DEFAULTS];
}
