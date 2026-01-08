/**
 * Execution Routing and Account Type Validation
 * 
 * This module enforces the canonical rules for:
 * - Account Types: VIRTUAL, SIM, LIVE
 * - Execution Modes: BACKTEST_ONLY, SIM_LIVE, SHADOW, LIVE
 * - Data Feed Modes: HISTORICAL_DATA, LIVE_DATA
 */

// ============= TYPE DEFINITIONS =============

export type AccountType = "VIRTUAL" | "SIM" | "LIVE";
export type AccountProvider = "INTERNAL" | "IRONBEAM" | "TRADOVATE" | "OTHER";
export type ExecutionMode = "BACKTEST_ONLY" | "SIM_LIVE" | "SHADOW" | "LIVE";
export type DataFeedMode = "HISTORICAL_DATA" | "LIVE_DATA";
export type ExecutionRouting = "INTERNAL_SIM_FILLS" | "BROKER_FILLS" | "BLOCKED";

// ============= ACCOUNT TYPE DESCRIPTIONS =============

export const ACCOUNT_TYPE_INFO: Record<AccountType, {
  label: string;
  shortLabel: string;
  description: string;
  allowedModes: ExecutionMode[];
  defaultProvider: AccountProvider;
  defaultAllowSharedBots: boolean;
}> = {
  VIRTUAL: {
    label: "Virtual (Sandbox/Training)",
    shortLabel: "Virtual",
    description: "Internal sandbox for backtests, paper trading, and shadow using live data. No real orders. Bot sharing allowed.",
    allowedModes: ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW"],
    defaultProvider: "INTERNAL",
    defaultAllowSharedBots: true,
  },
  SIM: {
    label: "Simulation (Paper Trading)",
    shortLabel: "Simulation",
    description: "Live-like paper trading. Backtests + paper + shadow using live data. No real orders.",
    allowedModes: ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW"],
    defaultProvider: "INTERNAL",
    defaultAllowSharedBots: false,
  },
  LIVE: {
    label: "Live (Broker Connected)",
    shortLabel: "Live",
    description: "Real broker account. Backtest + paper + shadow using live data, and LIVE execution when enabled.",
    allowedModes: ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW", "LIVE"],
    defaultProvider: "IRONBEAM",
    defaultAllowSharedBots: false,
  },
};

export const EXECUTION_MODE_INFO: Record<ExecutionMode, {
  label: string;
  shortLabel: string;
  description: string;
  defaultDataFeed: DataFeedMode;
}> = {
  BACKTEST_ONLY: {
    label: "Backtest",
    shortLabel: "Backtest",
    description: "Historical replay using past market data",
    defaultDataFeed: "HISTORICAL_DATA",
  },
  SIM_LIVE: {
    label: "SIM Live (Paper Trading)",
    shortLabel: "SIM",
    description: "Paper trading with live market data, internal execution",
    defaultDataFeed: "LIVE_DATA",
  },
  SHADOW: {
    label: "Shadow (Staging)",
    shortLabel: "Shadow",
    description: "Staging mode with live data, mirrors LIVE behavior but internal execution",
    defaultDataFeed: "LIVE_DATA",
  },
  LIVE: {
    label: "Live (Real Execution)",
    shortLabel: "Live",
    description: "Real broker orders with live market data",
    defaultDataFeed: "LIVE_DATA",
  },
};

export const PROVIDER_INFO: Record<AccountProvider, {
  label: string;
  description: string;
}> = {
  INTERNAL: {
    label: "Internal",
    description: "Internal simulation engine",
  },
  IRONBEAM: {
    label: "Ironbeam",
    description: "Ironbeam broker connection",
  },
  TRADOVATE: {
    label: "Tradovate",
    description: "Tradovate broker connection",
  },
  OTHER: {
    label: "Other",
    description: "Other broker connection",
  },
};

// ============= VALIDATION FUNCTIONS =============

/**
 * Check if an execution mode is valid for an account type
 */
export function isValidModeForAccount(
  accountType: AccountType,
  executionMode: ExecutionMode
): boolean {
  return ACCOUNT_TYPE_INFO[accountType].allowedModes.includes(executionMode);
}

/**
 * Get all valid execution modes for an account type
 */
export function getValidModesForAccount(accountType: AccountType): ExecutionMode[] {
  return ACCOUNT_TYPE_INFO[accountType].allowedModes;
}

/**
 * Check if a provider is valid for an account type
 */
export function isValidProviderForAccount(
  accountType: AccountType,
  provider: AccountProvider
): boolean {
  if (accountType === "VIRTUAL" || accountType === "SIM") {
    return provider === "INTERNAL";
  }
  if (accountType === "LIVE") {
    return provider !== "INTERNAL";
  }
  return false;
}

/**
 * Get valid providers for an account type
 */
export function getValidProvidersForAccount(accountType: AccountType): AccountProvider[] {
  if (accountType === "VIRTUAL" || accountType === "SIM") {
    return ["INTERNAL"];
  }
  return ["IRONBEAM", "TRADOVATE", "OTHER"];
}

// ============= EXECUTION ROUTING =============

/**
 * Determine execution routing based on account type and execution mode
 * This is the canonical routing function used everywhere
 */
export function getExecutionRouting(
  accountType: AccountType,
  executionMode: ExecutionMode
): ExecutionRouting {
  // BACKTEST always routes to internal
  if (executionMode === "BACKTEST_ONLY") {
    return "INTERNAL_SIM_FILLS";
  }

  // SIM and SHADOW always route to internal
  if (executionMode === "SIM_LIVE" || executionMode === "SHADOW") {
    return "INTERNAL_SIM_FILLS";
  }

  // LIVE mode
  if (executionMode === "LIVE") {
    // Only LIVE accounts can route to broker
    if (accountType === "LIVE") {
      return "BROKER_FILLS";
    }
    // All other account types cannot use LIVE mode
    return "BLOCKED";
  }

  return "BLOCKED";
}

/**
 * Check if execution should be blocked
 */
export function shouldBlockExecution(
  accountType: AccountType,
  executionMode: ExecutionMode
): { blocked: boolean; reason?: string } {
  // First check if mode is valid for account type
  if (!isValidModeForAccount(accountType, executionMode)) {
    return {
      blocked: true,
      reason: `Execution mode ${executionMode} is not allowed for ${accountType} accounts`,
    };
  }

  // Check routing
  const routing = getExecutionRouting(accountType, executionMode);
  if (routing === "BLOCKED") {
    return {
      blocked: true,
      reason: `Cannot route ${executionMode} execution for ${accountType} account`,
    };
  }

  return { blocked: false };
}

// ============= DATA FEED MODE =============

/**
 * Determine data feed mode based on execution mode and overrides
 */
export function getDataFeedMode(
  executionMode: ExecutionMode,
  accountOverride?: DataFeedMode | null,
  botOverride?: DataFeedMode | null
): DataFeedMode {
  // Bot override takes precedence
  if (botOverride) {
    return botOverride;
  }

  // Account override next
  if (accountOverride) {
    return accountOverride;
  }

  // Default based on execution mode
  return EXECUTION_MODE_INFO[executionMode].defaultDataFeed;
}

// ============= ACCOUNT DEFAULTS =============

/**
 * Get default values when creating an account of a specific type
 */
export function getAccountDefaults(accountType: AccountType): {
  provider: AccountProvider;
  allow_shared_bots: boolean;
} {
  const info = ACCOUNT_TYPE_INFO[accountType];
  return {
    provider: info.defaultProvider,
    allow_shared_bots: info.defaultAllowSharedBots,
  };
}

// ============= UI HELPERS =============

/**
 * Get badge variant for account type
 */
export function getAccountTypeBadgeVariant(accountType: AccountType): "default" | "secondary" | "destructive" | "outline" {
  switch (accountType) {
    case "VIRTUAL":
      return "outline";
    case "SIM":
      return "secondary";
    case "LIVE":
      return "destructive";
    default:
      return "default";
  }
}

/**
 * Get badge variant for execution mode
 */
export function getExecutionModeBadgeVariant(mode: ExecutionMode): "default" | "secondary" | "destructive" | "outline" {
  switch (mode) {
    case "BACKTEST_ONLY":
      return "outline";
    case "SIM_LIVE":
      return "secondary";
    case "SHADOW":
      return "default";
    case "LIVE":
      return "destructive";
    default:
      return "default";
  }
}

/**
 * Get tooltip text explaining why a mode is disabled for an account
 */
export function getModeDisabledReason(
  accountType: AccountType,
  executionMode: ExecutionMode
): string | null {
  if (isValidModeForAccount(accountType, executionMode)) {
    return null;
  }

  if (executionMode === "LIVE" && (accountType === "VIRTUAL" || accountType === "SIM")) {
    return `LIVE execution requires a broker-connected LIVE account. ${accountType} accounts use internal simulation only.`;
  }

  return `${executionMode} is not supported for ${accountType} accounts`;
}
