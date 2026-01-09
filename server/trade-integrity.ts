/**
 * Trade Data Integrity System
 * 
 * Industry-standard checksums for trade and fill records
 * to detect data corruption and ensure end-to-end integrity.
 * 
 * Features:
 * - SHA-256 checksums on critical trade fields
 * - Verification on read/write
 * - Corruption detection and alerting
 */

import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";

export interface TradeChecksum {
  tradeId: string;
  checksum: string;
  fields: {
    botId: string;
    side: string;
    quantity: number;
    entryPrice: number;
    exitPrice?: number;
    pnl?: number;
    timestamp: string;
  };
}

export function computeTradeChecksum(
  tradeId: string,
  botId: string,
  side: string,
  quantity: number,
  entryPrice: number,
  exitPrice?: number,
  pnl?: number,
  timestamp?: Date
): string {
  const data = JSON.stringify({
    id: tradeId,
    bot: botId,
    side,
    qty: quantity,
    entry: entryPrice.toFixed(6),
    exit: exitPrice?.toFixed(6) || null,
    pnl: pnl?.toFixed(2) || null,
    ts: timestamp?.toISOString() || null,
  });

  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function verifyTradeIntegrity(
  tradeId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const result = await db.execute(sql`
      SELECT 
        id,
        bot_id,
        side,
        quantity,
        entry_price,
        exit_price,
        pnl,
        created_at,
        checksum
      FROM paper_trades
      WHERE id = ${tradeId}
    `);

    if (result.rows.length === 0) {
      return { valid: false, error: "Trade not found" };
    }

    const trade = result.rows[0] as any;

    if (!trade.checksum) {
      return { valid: true };
    }

    const computedChecksum = computeTradeChecksum(
      trade.id,
      trade.bot_id,
      trade.side,
      parseFloat(trade.quantity),
      parseFloat(trade.entry_price),
      trade.exit_price ? parseFloat(trade.exit_price) : undefined,
      trade.pnl ? parseFloat(trade.pnl) : undefined,
      trade.created_at ? new Date(trade.created_at) : undefined
    );

    if (computedChecksum !== trade.checksum) {
      console.error(
        `[TRADE_INTEGRITY] CORRUPTION DETECTED trade=${tradeId} ` +
        `stored=${trade.checksum} computed=${computedChecksum}`
      );

      await logActivityEvent({
        eventType: "SYSTEM_AUDIT",
        severity: "ERROR",
        title: "Trade data corruption detected",
        payload: {
          tradeId,
          storedChecksum: trade.checksum,
          computedChecksum,
          botId: trade.bot_id,
        },
      });

      return { valid: false, error: "Checksum mismatch - data may be corrupted" };
    }

    return { valid: true };
  } catch (error) {
    console.error("[TRADE_INTEGRITY] Error verifying trade:", error);
    return { valid: false, error: String(error) };
  }
}

export async function runTradeIntegrityCheck(
  botId?: string,
  limit: number = 1000
): Promise<{
  checked: number;
  valid: number;
  corrupted: number;
  missing: number;
  corruptedIds: string[];
}> {
  const traceId = `trade-integrity-${Date.now().toString(36)}`;
  console.log(`[TRADE_INTEGRITY] trace_id=${traceId} Starting integrity check...`);

  const stats = {
    checked: 0,
    valid: 0,
    corrupted: 0,
    missing: 0,
    corruptedIds: [] as string[],
  };

  try {
    const trades = await db.execute(sql`
      SELECT 
        id,
        bot_id,
        side,
        quantity,
        entry_price,
        exit_price,
        pnl,
        created_at,
        checksum
      FROM paper_trades
      WHERE ${botId ? sql`bot_id = ${botId}` : sql`1=1`}
        AND checksum IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    for (const trade of trades.rows as any[]) {
      stats.checked++;

      if (!trade.checksum) {
        stats.missing++;
        continue;
      }

      const computedChecksum = computeTradeChecksum(
        trade.id,
        trade.bot_id,
        trade.side,
        parseFloat(trade.quantity),
        parseFloat(trade.entry_price),
        trade.exit_price ? parseFloat(trade.exit_price) : undefined,
        trade.pnl ? parseFloat(trade.pnl) : undefined,
        trade.created_at ? new Date(trade.created_at) : undefined
      );

      if (computedChecksum === trade.checksum) {
        stats.valid++;
      } else {
        stats.corrupted++;
        stats.corruptedIds.push(trade.id);
      }
    }

    console.log(
      `[TRADE_INTEGRITY] trace_id=${traceId} Complete: ` +
      `checked=${stats.checked} valid=${stats.valid} ` +
      `corrupted=${stats.corrupted} missing=${stats.missing}`
    );

    if (stats.corrupted > 0) {
      await logActivityEvent({
        eventType: "SYSTEM_AUDIT",
        severity: "ERROR",
        title: `Trade integrity check: ${stats.corrupted} corrupted records`,
        traceId,
        payload: { ...stats },
      });
    }

    return stats;
  } catch (error) {
    console.error(`[TRADE_INTEGRITY] trace_id=${traceId} Error:`, error);
    return stats;
  }
}

export async function addChecksumToTrade(
  tradeId: string,
  botId: string,
  side: string,
  quantity: number,
  entryPrice: number,
  exitPrice?: number,
  pnl?: number,
  timestamp?: Date
): Promise<string> {
  const checksum = computeTradeChecksum(
    tradeId,
    botId,
    side,
    quantity,
    entryPrice,
    exitPrice,
    pnl,
    timestamp
  );

  await db.execute(sql`
    UPDATE paper_trades
    SET checksum = ${checksum}
    WHERE id = ${tradeId}
  `);

  return checksum;
}

export async function backfillTradeChecksums(
  limit: number = 1000
): Promise<{ updated: number; errors: number; skipped: number }> {
  const traceId = `checksum-backfill-${Date.now().toString(36)}`;
  console.log(`[TRADE_INTEGRITY] trace_id=${traceId} Starting checksum backfill...`);

  let updated = 0;
  let errors = 0;
  let skipped = 0;

  try {
    const trades = await db.execute(sql`
      SELECT 
        id,
        bot_id,
        side,
        quantity,
        entry_price,
        exit_price,
        pnl,
        created_at,
        checksum
      FROM paper_trades
      WHERE checksum IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);

    for (const trade of trades.rows as any[]) {
      try {
        if (trade.checksum) {
          skipped++;
          continue;
        }

        const checksum = computeTradeChecksum(
          trade.id,
          trade.bot_id,
          trade.side,
          parseFloat(trade.quantity),
          parseFloat(trade.entry_price),
          trade.exit_price ? parseFloat(trade.exit_price) : undefined,
          trade.pnl ? parseFloat(trade.pnl) : undefined,
          trade.created_at ? new Date(trade.created_at) : undefined
        );

        await db.execute(sql`
          UPDATE paper_trades
          SET checksum = ${checksum}
          WHERE id = ${trade.id}
            AND checksum IS NULL
        `);

        updated++;
      } catch (error) {
        errors++;
        console.error(`[TRADE_INTEGRITY] trace_id=${traceId} Failed to backfill trade=${trade.id}:`, error);
      }
    }

    console.log(`[TRADE_INTEGRITY] trace_id=${traceId} Backfill complete: updated=${updated} skipped=${skipped} errors=${errors}`);
    return { updated, errors, skipped };
  } catch (error) {
    console.error(`[TRADE_INTEGRITY] trace_id=${traceId} Backfill error:`, error);
    return { updated, errors: errors + 1, skipped };
  }
}
