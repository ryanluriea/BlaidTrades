/**
 * QuantConnect Cloud API Provider
 * Handles project creation, compilation, backtest submission, and result retrieval
 * Used for pre-promotion verification of trading strategies
 */

import crypto from "crypto";

const QC_API_BASE = "https://www.quantconnect.com/api/v2";

const REQUIRED_ENV_VARS = ["QUANTCONNECT_USER_ID", "QUANTCONNECT_API_TOKEN"];

export interface QCConfigStatus {
  configured: boolean;
  missing: string[];
  suggestedFix: string;
}

export type QCAuthHeaders = Record<string, string>;

export interface QCProject {
  projectId: number;
  name: string;
  created: string;
  modified: string;
  language: string;
}

export interface QCCompileResult {
  success: boolean;
  compileId: string;
  state: string;
  logs?: string[];
}

export interface QCBacktestResult {
  success: boolean;
  backtestId: string;
  name: string;
  created: string;
  completed: boolean;
  progress?: number;
  result?: QCBacktestMetrics;
  error?: string;
  stacktrace?: string;
}

export interface QCBacktestMetrics {
  netProfit: number;
  compoundingAnnualReturn: number;
  sharpeRatio: number;
  sortino: number;
  maxDrawdown: number;
  profitFactor: number;
  winRate: number;
  lossRate: number;
  totalTrades: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  alpha: number;
  beta: number;
  treynorRatio: number;
  informationRatio: number;
  trackingError: number;
  totalFees: number;
  equityFinal: number;
  tradingDays: number;
}

export interface QCApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function verifyQCConfig(): QCConfigStatus {
  const missing = REQUIRED_ENV_VARS.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      suggestedFix: `Add the following secrets in Replit: ${missing.join(", ")}`,
    };
  }

  return {
    configured: true,
    missing: [],
    suggestedFix: "",
  };
}

function getAuthHeaders(debugTraceId?: string): QCAuthHeaders {
  const userId = process.env.QUANTCONNECT_USER_ID!;
  const apiToken = process.env.QUANTCONNECT_API_TOKEN!;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  // CRITICAL: QC API requires colon separator between token and timestamp
  // Format: "{API_TOKEN}:{timestamp}" per QuantConnect API v2 docs
  const timeStampedToken = `${apiToken}:${timestamp}`;
  const hashedToken = crypto
    .createHash("sha256")
    .update(timeStampedToken, "utf8")
    .digest("hex");
  
  const credentials = `${userId}:${hashedToken}`;
  const encodedCredentials = Buffer.from(credentials, "utf8").toString("base64");

  // Debug logging to trace authentication issues
  if (debugTraceId) {
    console.log(`[QC_AUTH_DEBUG] trace_id=${debugTraceId} user_id=${userId} timestamp=${timestamp} token_len=${apiToken.length} hash_preview=${hashedToken.slice(0, 16)}...`);
  }

  return {
    Authorization: `Basic ${encodedCredentials}`,
    Timestamp: timestamp,
    "Content-Type": "application/json",
  };
}

async function qcApiRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
  traceId: string
): Promise<{ success: boolean; data?: T; error?: QCApiError }> {
  const config = verifyQCConfig();
  if (!config.configured) {
    return {
      success: false,
      error: {
        code: "INTEGRATION_KEY_MISSING",
        message: `Missing: ${config.missing.join(", ")}`,
      },
    };
  }

  const url = `${QC_API_BASE}${endpoint}`;
  const headers = getAuthHeaders(traceId);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startTime;
    const data: any = await response.json();

    if (!response.ok || data.success === false) {
      console.error(
        `[QC_API] trace_id=${traceId} endpoint=${endpoint} status=failed code=${response.status} latency_ms=${latencyMs} error=${JSON.stringify(data.errors || data.message || "Unknown")}`
      );
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: data.errors?.[0] || data.message || "Unknown QC API error",
          details: data as Record<string, unknown>,
        },
      };
    }

    console.log(
      `[QC_API] trace_id=${traceId} endpoint=${endpoint} status=success latency_ms=${latencyMs}`
    );

    return { success: true, data: data as T };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error(
      `[QC_API] trace_id=${traceId} endpoint=${endpoint} status=exception latency_ms=${latencyMs} error=${error.message}`
    );
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error.message || "Network request failed",
      },
    };
  }
}

export async function createProject(
  name: string,
  language: "Py" | "C#",
  traceId: string
): Promise<{ success: boolean; project?: QCProject; error?: QCApiError }> {
  const result = await qcApiRequest<{ projects: QCProject[] }>(
    "/projects/create",
    { name, language },
    traceId
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  const project = result.data.projects?.[0];
  if (!project) {
    return {
      success: false,
      error: { code: "NO_PROJECT", message: "No project returned from API" },
    };
  }

  console.log(
    `[QC_PROJECT] trace_id=${traceId} created projectId=${project.projectId} name="${name}"`
  );
  return { success: true, project };
}

export async function addFile(
  projectId: number,
  fileName: string,
  content: string,
  traceId: string
): Promise<{ success: boolean; error?: QCApiError }> {
  const result = await qcApiRequest(
    "/files/create",
    { projectId, name: fileName, content },
    traceId
  );

  if (result.success) {
    console.log(
      `[QC_FILE] trace_id=${traceId} added file="${fileName}" to projectId=${projectId}`
    );
  }

  return { success: result.success, error: result.error };
}

export async function updateFile(
  projectId: number,
  fileName: string,
  content: string,
  traceId: string
): Promise<{ success: boolean; error?: QCApiError }> {
  const result = await qcApiRequest(
    "/files/update",
    { projectId, name: fileName, content },
    traceId
  );

  if (result.success) {
    console.log(
      `[QC_FILE] trace_id=${traceId} updated file="${fileName}" in projectId=${projectId}`
    );
  }

  return { success: result.success, error: result.error };
}

export async function compileProject(
  projectId: number,
  traceId: string
): Promise<{ success: boolean; compile?: QCCompileResult; error?: QCApiError }> {
  const result = await qcApiRequest<QCCompileResult>(
    "/compile/create",
    { projectId },
    traceId
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  console.log(
    `[QC_COMPILE] trace_id=${traceId} projectId=${projectId} compileId=${result.data.compileId} state=${result.data.state}`
  );

  return { success: true, compile: result.data };
}

export async function readCompile(
  projectId: number,
  compileId: string,
  traceId: string
): Promise<{ success: boolean; compile?: QCCompileResult; error?: QCApiError }> {
  const result = await qcApiRequest<QCCompileResult>(
    "/compile/read",
    { projectId, compileId },
    traceId
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  return { success: true, compile: result.data };
}

export async function pollCompileUntilComplete(params: {
  projectId: number;
  compileId: string;
  traceId: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
}): Promise<{ success: boolean; compile?: QCCompileResult; error?: QCApiError }> {
  const { projectId, compileId, traceId, maxAttempts = 30, pollIntervalMs = 2000 } = params;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await readCompile(projectId, compileId, traceId);

    if (!result.success) {
      return result;
    }

    const state = result.compile?.state;

    if (state === "BuildSuccess") {
      console.log(`[QC_COMPILE] trace_id=${traceId} compile complete: BuildSuccess`);
      return { success: true, compile: result.compile };
    }

    if (state === "BuildError") {
      const logs = result.compile?.logs || [];
      console.log(`[QC_COMPILE] trace_id=${traceId} compile failed: BuildError logs=${logs.join(", ")}`);
      return { 
        success: false, 
        compile: result.compile,
        error: { code: "BUILD_ERROR", message: `Compilation failed: ${logs.join(", ")}` } 
      };
    }

    // Still InQueue or building, wait and retry
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  return { 
    success: false, 
    error: { code: "COMPILE_TIMEOUT", message: `Compile polling timed out after ${maxAttempts} attempts` } 
  };
}

export async function createBacktest(
  projectId: number,
  compileId: string,
  backtestName: string,
  traceId: string
): Promise<{ success: boolean; backtestId?: string; error?: QCApiError }> {
  const result = await qcApiRequest<QCBacktestResult>(
    "/backtests/create",
    { projectId, compileId, backtestName },
    traceId
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  // QC API returns backtestId nested under 'backtest' key: {backtest: {backtestId: "..."}, success: true}
  const responseData = result.data as unknown as Record<string, unknown>;
  let backtestId: string | undefined;
  
  // Check for nested structure first (QC API v2 response format)
  if (responseData.backtest && typeof responseData.backtest === 'object') {
    const backtest = responseData.backtest as Record<string, unknown>;
    backtestId = backtest.backtestId as string | undefined;
  }
  
  // Fallback to direct property (legacy format)
  if (!backtestId) {
    backtestId = result.data.backtestId;
  }
  
  console.log(
    `[QC_BACKTEST] trace_id=${traceId} created projectId=${projectId} backtestId=${backtestId} name="${backtestName}"`
  );

  if (!backtestId) {
    console.error(
      `[QC_BACKTEST] trace_id=${traceId} MISSING_BACKTEST_ID response_keys=${Object.keys(result.data).join(",")}`
    );
    return { 
      success: false, 
      error: { code: "MISSING_BACKTEST_ID", message: "QC API did not return backtestId" } 
    };
  }

  return { success: true, backtestId };
}

// Helper to parse QC statistics values (can be strings like "10%" or numbers)
// Note: Percentages are preserved as-is (10% stays as 10) to match UI expectations
function parseStatValue(value: unknown): number {
  if (typeof value === 'number') {
    // Handle NaN explicitly
    return Number.isNaN(value) ? 0 : value;
  }
  if (typeof value === 'string') {
    // Handle QC placeholder values that indicate no data
    const placeholder = value.trim().toLowerCase();
    if (placeholder === '--' || placeholder === 'n/a' || placeholder === 'nan' || placeholder === '') {
      return 0;
    }
    // Remove % sign, $ sign, and commas for parsing
    const cleaned = value.replace('%', '').replace('$', '').replace(',', '');
    const parsed = parseFloat(cleaned);
    // Handle NaN from parseFloat
    if (Number.isNaN(parsed)) {
      return 0;
    }
    // Keep percentages as reported (e.g., "10%" stays as 10, not 0.10)
    // This preserves QC's native format and aligns with UI display expectations
    return parsed;
  }
  return 0;
}

// Map QC API statistics to our metrics interface
function mapQCStatisticsToMetrics(stats: Record<string, unknown>): QCBacktestMetrics {
  return {
    netProfit: parseStatValue(stats['Net Profit'] || stats['NetProfit'] || 0),
    compoundingAnnualReturn: parseStatValue(stats['Compounding Annual Return'] || stats['CompoundingAnnualReturn'] || 0),
    sharpeRatio: parseStatValue(stats['Sharpe Ratio'] || stats['SharpeRatio'] || 0),
    sortino: parseStatValue(stats['Sortino Ratio'] || stats['SortinoRatio'] || 0),
    maxDrawdown: parseStatValue(stats['Drawdown'] || stats['MaxDrawdown'] || 0),
    profitFactor: parseStatValue(stats['Profit-Loss Ratio'] || stats['ProfitLossRatio'] || 0),
    winRate: parseStatValue(stats['Win Rate'] || stats['WinRate'] || 0),
    lossRate: parseStatValue(stats['Loss Rate'] || stats['LossRate'] || 0),
    totalTrades: parseStatValue(stats['Total Trades'] || stats['TotalTrades'] || stats['Total Orders'] || 0),
    averageWin: parseStatValue(stats['Average Win'] || stats['AverageWin'] || 0),
    averageLoss: parseStatValue(stats['Average Loss'] || stats['AverageLoss'] || 0),
    expectancy: parseStatValue(stats['Expectancy'] || 0),
    alpha: parseStatValue(stats['Alpha'] || 0),
    beta: parseStatValue(stats['Beta'] || 0),
    treynorRatio: parseStatValue(stats['Treynor Ratio'] || stats['TreynorRatio'] || 0),
    informationRatio: parseStatValue(stats['Information Ratio'] || stats['InformationRatio'] || 0),
    trackingError: parseStatValue(stats['Tracking Error'] || stats['TrackingError'] || 0),
    totalFees: parseStatValue(stats['Total Fees'] || stats['TotalFees'] || 0),
    equityFinal: parseStatValue(stats['Equity'] || 0),
    tradingDays: parseStatValue(stats['Trading Days Span'] || 0),
  };
}

export async function readBacktest(
  projectId: number,
  backtestId: string,
  traceId: string
): Promise<{ success: boolean; backtest?: QCBacktestResult; error?: QCApiError }> {
  // QC API returns: { success: true, backtest: { backtestId, progress, completed, statistics: {...} } }
  const result = await qcApiRequest<{ backtest: QCBacktestResult }>(
    "/backtests/read",
    { projectId, backtestId },
    traceId
  );

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  // Extract the nested backtest object from the response
  const responseData = result.data as Record<string, unknown>;
  let rawBacktest: Record<string, unknown> | undefined;
  
  // QC API v2 returns backtest data in nested 'backtest' object
  if (responseData.backtest && typeof responseData.backtest === 'object') {
    rawBacktest = responseData.backtest as Record<string, unknown>;
  } else {
    // Fallback: treat the response as the backtest directly (legacy format)
    rawBacktest = result.data as Record<string, unknown>;
  }
  
  if (!rawBacktest) {
    return { 
      success: false, 
      error: { code: "INVALID_RESPONSE", message: "QC API did not return backtest data" } 
    };
  }
  
  // Map raw response to our interface
  const backtest: QCBacktestResult = {
    success: true,
    backtestId: rawBacktest.backtestId as string,
    name: rawBacktest.name as string,
    created: rawBacktest.created as string,
    completed: rawBacktest.completed as boolean,
    progress: rawBacktest.progress as number | undefined,
    error: rawBacktest.error as string | undefined,
    stacktrace: rawBacktest.stacktrace as string | undefined,
  };
  
  // CRITICAL: QC API can return statistics in different locations:
  // 1. backtest.result.statistics (most common for completed backtests)
  // 2. backtest.statistics (direct on backtest object)
  // Try both paths to ensure we capture the metrics
  const resultObj = rawBacktest.result as Record<string, unknown> | undefined;
  let statistics: Record<string, unknown> | undefined;
  
  // Check result.statistics first (most common), then fall back to direct statistics
  if (resultObj && typeof resultObj === 'object' && resultObj.Statistics) {
    statistics = resultObj.Statistics as Record<string, unknown>;
    console.log(`[QC_BACKTEST_READ] trace_id=${traceId} found stats in result.Statistics`);
  } else if (resultObj && typeof resultObj === 'object' && resultObj.statistics) {
    statistics = resultObj.statistics as Record<string, unknown>;
    console.log(`[QC_BACKTEST_READ] trace_id=${traceId} found stats in result.statistics`);
  } else if (rawBacktest.statistics) {
    statistics = rawBacktest.statistics as Record<string, unknown>;
    console.log(`[QC_BACKTEST_READ] trace_id=${traceId} found stats in backtest.statistics`);
  }
  
  // Debug logging for backtest completion
  if (backtest.completed) {
    const hasStats = !!statistics && Object.keys(statistics).length > 0;
    const statKeys = statistics ? Object.keys(statistics).slice(0, 5).join(',') : 'none';
    const resultKeys = resultObj ? Object.keys(resultObj).slice(0, 5).join(',') : 'none';
    console.log(`[QC_BACKTEST_READ] trace_id=${traceId} completed=true hasStats=${hasStats} statKeys=${statKeys} resultKeys=${resultKeys}`);
    
    // Map statistics to our result format if available
    if (hasStats && statistics) {
      backtest.result = mapQCStatisticsToMetrics(statistics);
      console.log(`[QC_BACKTEST_READ] trace_id=${traceId} mapped sharpe=${backtest.result.sharpeRatio} trades=${backtest.result.totalTrades}`);
    }
  }

  return { success: true, backtest };
}

export async function deleteProject(
  projectId: number,
  traceId: string
): Promise<{ success: boolean; error?: QCApiError }> {
  const result = await qcApiRequest(
    "/projects/delete",
    { projectId },
    traceId
  );

  if (result.success) {
    console.log(`[QC_PROJECT] trace_id=${traceId} deleted projectId=${projectId}`);
  }

  return { success: result.success, error: result.error };
}

export async function verifyConnection(
  traceId: string
): Promise<{ connected: boolean; error?: string; errorCode?: string }> {
  const config = verifyQCConfig();
  if (!config.configured) {
    return {
      connected: false,
      error: `Missing: ${config.missing.join(", ")}`,
      errorCode: "INTEGRATION_KEY_MISSING",
    };
  }

  const result = await qcApiRequest<{ projects: QCProject[] }>(
    "/projects/read",
    {},
    traceId
  );

  if (result.success) {
    console.log(`[QC_VERIFY] trace_id=${traceId} status=connected`);
    return { connected: true };
  }

  return {
    connected: false,
    error: result.error?.message || "Connection failed",
    errorCode: result.error?.code,
  };
}

export interface PollBacktestOptions {
  projectId: number;
  backtestId: string;
  traceId: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
  onProgress?: (progress: number) => void;
}

export async function pollBacktestUntilComplete(
  options: PollBacktestOptions
): Promise<{ success: boolean; backtest?: QCBacktestResult; error?: QCApiError }> {
  const {
    projectId,
    backtestId,
    traceId,
    maxAttempts = 180, // 180 attempts × 5s = 900s (15 minutes) - increased for complex strategies
    pollIntervalMs = 5000,
    onProgress,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await readBacktest(projectId, backtestId, traceId);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const backtest = result.backtest!;
    const progress = backtest.progress ?? 0;
    const progressPct = Math.round(progress * 100);
    const elapsedSec = Math.round((attempt + 1) * pollIntervalMs / 1000);
    const maxSec = Math.round(maxAttempts * pollIntervalMs / 1000);

    // Log progress every 10 attempts (50 seconds) or on significant progress
    if (attempt % 10 === 0 || progressPct >= 90) {
      console.log(
        `[QC_POLL] trace_id=${traceId} backtestId=${backtestId.slice(0, 12)} progress=${progressPct}% elapsed=${elapsedSec}s/${maxSec}s attempt=${attempt + 1}/${maxAttempts}`
      );
    }

    if (onProgress && backtest.progress !== undefined) {
      onProgress(backtest.progress);
    }

    if (backtest.completed) {
      console.log(
        `[QC_POLL] trace_id=${traceId} backtestId=${backtestId} status=COMPLETED progress=100% elapsed=${elapsedSec}s attempts=${attempt + 1}`
      );
      return { success: true, backtest };
    }

    if (backtest.error) {
      console.error(
        `[QC_POLL] trace_id=${traceId} backtestId=${backtestId} status=error error="${backtest.error}"`
      );
      return {
        success: false,
        error: {
          code: "BACKTEST_ERROR",
          message: backtest.error,
          details: { stacktrace: backtest.stacktrace },
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    success: false,
    error: {
      code: "TIMEOUT",
      message: `Backtest did not complete within ${maxAttempts * pollIntervalMs / 1000}s`,
    },
  };
}

export const QUANTCONNECT_PROVIDER_INFO = {
  id: "quantconnect",
  category: "verification" as const,
  displayName: "QuantConnect",
  requiredEnvVars: REQUIRED_ENV_VARS,
  optionalEnvVars: [] as string[],
  supportsVerify: true,
  supportsProofOfUse: true,
  description: "Independent strategy verification via QuantConnect LEAN Engine",
};

export async function testAuthentication(traceId: string): Promise<{
  success: boolean;
  error?: string;
  debug?: Record<string, unknown>;
}> {
  const config = verifyQCConfig();
  if (!config.configured) {
    return {
      success: false,
      error: `Missing credentials: ${config.missing.join(", ")}`,
    };
  }

  const userId = process.env.QUANTCONNECT_USER_ID!;
  const apiToken = process.env.QUANTCONNECT_API_TOKEN!;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  const timeStampedToken = `${apiToken}:${timestamp}`;
  const hashedToken = crypto
    .createHash("sha256")
    .update(timeStampedToken, "utf8")
    .digest("hex");
  
  const credentials = `${userId}:${hashedToken}`;
  const encodedCredentials = Buffer.from(credentials, "utf8").toString("base64");

  const headers = {
    Authorization: `Basic ${encodedCredentials}`,
    Timestamp: timestamp,
    "Content-Type": "application/json",
  };

  console.log(`[QC_AUTH_TEST] trace_id=${traceId} Testing authentication...`);
  console.log(`[QC_AUTH_TEST] trace_id=${traceId} user_id=${userId} token_length=${apiToken.length} timestamp=${timestamp}`);
  console.log(`[QC_AUTH_TEST] trace_id=${traceId} hash=${hashedToken}`);

  try {
    const response = await fetch(`${QC_API_BASE}/authenticate`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    const data: any = await response.json();
    
    console.log(`[QC_AUTH_TEST] trace_id=${traceId} status=${response.status} success=${data.success} errors=${JSON.stringify(data.errors || [])}`);

    if (data.success) {
      return { success: true };
    }

    return {
      success: false,
      error: data.errors?.[0] || data.message || "Authentication failed",
      debug: {
        userId,
        tokenLength: apiToken.length,
        timestamp,
        hash: hashedToken,
        response: data,
      },
    };
  } catch (error: any) {
    console.error(`[QC_AUTH_TEST] trace_id=${traceId} exception=${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
