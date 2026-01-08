import { db } from "./db";
import {
  macroRequests,
  optionsFlowRequests,
  newsRequests,
  aiRequests,
  brokerRequests,
} from "@shared/schema";

type IntegrationSource = "MACRO" | "OPTIONS_FLOW" | "NEWS" | "AI" | "BROKER";

interface BaseRequestLog {
  traceId: string;
  botId?: string;
  stage?: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  requestFingerprint?: string;
}

interface MacroRequestLog extends BaseRequestLog {
  source: "MACRO";
  seriesIds?: string[];
  provider?: string;
  endpoint?: string;
  recordsReturned?: number;
}

interface OptionsFlowRequestLog extends BaseRequestLog {
  source: "OPTIONS_FLOW";
  symbol?: string;
  provider?: string;
  endpoint?: string;
  recordsReturned?: number;
}

interface NewsRequestLog extends BaseRequestLog {
  source: "NEWS";
  symbol?: string;
  keywords?: string;
  provider: string;
  endpoint?: string;
  recordsReturned?: number;
}

interface AIRequestLog extends BaseRequestLog {
  source: "AI";
  provider: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  purpose?: string;
}

interface BrokerRequestLog extends BaseRequestLog {
  source: "BROKER";
  accountId?: string;
  broker: string;
  action: string;
  symbol?: string;
  qty?: number;
  orderType?: string;
  orderId?: string;
  fillId?: string;
}

type RequestLog =
  | MacroRequestLog
  | OptionsFlowRequestLog
  | NewsRequestLog
  | AIRequestLog
  | BrokerRequestLog;

export async function logIntegrationRequest(log: RequestLog): Promise<void> {
  try {
    switch (log.source) {
      case "MACRO":
        await db.insert(macroRequests).values({
          traceId: log.traceId,
          botId: log.botId,
          stage: log.stage,
          seriesIds: log.seriesIds,
          provider: log.provider || "FRED",
          endpoint: log.endpoint,
          recordsReturned: log.recordsReturned,
          latencyMs: log.latencyMs,
          success: log.success,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          requestFingerprint: log.requestFingerprint,
        });
        break;

      case "OPTIONS_FLOW":
        await db.insert(optionsFlowRequests).values({
          traceId: log.traceId,
          botId: log.botId,
          stage: log.stage,
          symbol: log.symbol,
          provider: log.provider || "UNUSUAL_WHALES",
          endpoint: log.endpoint,
          recordsReturned: log.recordsReturned,
          latencyMs: log.latencyMs,
          success: log.success,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          requestFingerprint: log.requestFingerprint,
        });
        break;

      case "NEWS":
        await db.insert(newsRequests).values({
          traceId: log.traceId,
          botId: log.botId,
          stage: log.stage,
          symbol: log.symbol,
          keywords: log.keywords,
          provider: log.provider,
          endpoint: log.endpoint,
          recordsReturned: log.recordsReturned,
          latencyMs: log.latencyMs,
          success: log.success,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          requestFingerprint: log.requestFingerprint,
        });
        break;

      case "AI":
        await db.insert(aiRequests).values({
          traceId: log.traceId,
          botId: log.botId,
          stage: log.stage,
          provider: log.provider,
          model: log.model,
          tokensIn: log.tokensIn,
          tokensOut: log.tokensOut,
          latencyMs: log.latencyMs,
          success: log.success,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          purpose: log.purpose,
          requestFingerprint: log.requestFingerprint,
        });
        break;

      case "BROKER":
        await db.insert(brokerRequests).values({
          traceId: log.traceId,
          botId: log.botId,
          accountId: log.accountId,
          stage: log.stage,
          broker: log.broker,
          action: log.action,
          symbol: log.symbol,
          qty: log.qty,
          orderType: log.orderType,
          latencyMs: log.latencyMs,
          success: log.success,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          orderId: log.orderId,
          fillId: log.fillId,
          requestFingerprint: log.requestFingerprint,
        });
        break;
    }
  } catch (error) {
    console.error(`[REQUEST_LOGGER] Failed to log ${log.source} request:`, error);
  }
}

export function generateRequestFingerprint(
  source: IntegrationSource,
  params: Record<string, unknown>
): string {
  const sortedKeys = Object.keys(params).sort();
  const fingerprint = `${source}:${sortedKeys.map((k) => `${k}=${params[k]}`).join("|")}`;
  return Buffer.from(fingerprint).toString("base64").substring(0, 32);
}
