/**
 * Client-side risk engine utilities
 * Mirrors the logic in the risk-engine edge function for UI previews
 */

export interface RiskProfile {
  risk_percent_per_trade: number;
  max_risk_dollars_per_trade?: number;
  max_contracts_per_trade: number;
  max_contracts_per_symbol: number;
  max_daily_loss_percent: number;
  max_daily_loss_dollars?: number;
  max_total_exposure_contracts: number;
}

export interface BotRiskConfig {
  risk_percent_per_trade?: number;
  max_risk_dollars_per_trade?: number;
  max_contracts_per_trade?: number;
  stop_loss_ticks?: number;
  default_stop_ticks?: number;
  max_position_size?: number;
  max_daily_loss?: number;
}

export interface SizingInput {
  account_equity: number;
  account_risk_profile: RiskProfile;
  instrument_contract_size: number;
  instrument_tick_size: number;
  stop_distance_price: number;
  bot_risk_config?: BotRiskConfig;
  existing_position_contracts?: number;
  total_open_contracts?: number;
}

export interface SizingResult {
  contracts: number;
  risk_dollars: number;
  dollars_per_contract_at_stop: number;
  raw_contracts: number;
  capped_by?: string;
  reason_if_blocked?: string;
  calculation_details: {
    account_equity: number;
    risk_percent_used: number;
    base_risk_dollars: number;
    stop_distance_price: number;
    contract_size: number;
  };
}

// Risk tier presets
export const RISK_TIER_PRESETS: Record<string, RiskProfile> = {
  conservative: {
    risk_percent_per_trade: 0.0025,
    max_risk_dollars_per_trade: 150,
    max_contracts_per_trade: 1,
    max_contracts_per_symbol: 2,
    max_daily_loss_percent: 0.015,
    max_daily_loss_dollars: 500,
    max_total_exposure_contracts: 3,
  },
  moderate: {
    risk_percent_per_trade: 0.005,
    max_risk_dollars_per_trade: 300,
    max_contracts_per_trade: 3,
    max_contracts_per_symbol: 5,
    max_daily_loss_percent: 0.02,
    max_daily_loss_dollars: 1000,
    max_total_exposure_contracts: 8,
  },
  aggressive: {
    risk_percent_per_trade: 0.01,
    max_risk_dollars_per_trade: 500,
    max_contracts_per_trade: 5,
    max_contracts_per_symbol: 10,
    max_daily_loss_percent: 0.03,
    max_daily_loss_dollars: 2000,
    max_total_exposure_contracts: 15,
  },
};

/**
 * Calculate position size in contracts based on risk parameters
 */
export function calculateOrderSizeContracts(input: SizingInput): SizingResult {
  const {
    account_equity,
    account_risk_profile,
    instrument_contract_size,
    stop_distance_price,
    bot_risk_config,
    existing_position_contracts = 0,
    total_open_contracts = 0,
  } = input;

  // Step 1: Determine risk percent
  let riskPercent = account_risk_profile.risk_percent_per_trade;
  if (bot_risk_config?.risk_percent_per_trade !== undefined) {
    riskPercent = Math.min(riskPercent, bot_risk_config.risk_percent_per_trade);
  }

  // Step 2: Calculate base risk dollars
  let riskDollars = account_equity * riskPercent;

  if (account_risk_profile.max_risk_dollars_per_trade !== undefined) {
    riskDollars = Math.min(riskDollars, account_risk_profile.max_risk_dollars_per_trade);
  }

  if (bot_risk_config?.max_risk_dollars_per_trade !== undefined) {
    riskDollars = Math.min(riskDollars, bot_risk_config.max_risk_dollars_per_trade);
  }

  // Step 3: Calculate dollars at risk per contract
  const dollarsPerContractAtStop = stop_distance_price * instrument_contract_size;

  if (dollarsPerContractAtStop <= 0) {
    return {
      contracts: 0,
      risk_dollars: riskDollars,
      dollars_per_contract_at_stop: dollarsPerContractAtStop,
      raw_contracts: 0,
      reason_if_blocked: "Invalid stop distance (zero or negative)",
      calculation_details: {
        account_equity,
        risk_percent_used: riskPercent,
        base_risk_dollars: riskDollars,
        stop_distance_price,
        contract_size: instrument_contract_size,
      },
    };
  }

  // Step 4: Compute raw contracts
  const rawContracts = Math.floor(riskDollars / dollarsPerContractAtStop);

  // Step 5: Apply caps
  let contracts = Math.max(rawContracts, 0);
  let cappedBy: string | undefined;

  // Account max contracts per trade
  if (contracts > account_risk_profile.max_contracts_per_trade) {
    contracts = account_risk_profile.max_contracts_per_trade;
    cappedBy = "account_max_contracts_per_trade";
  }

  // Bot max contracts per trade
  const botMaxContracts = bot_risk_config?.max_contracts_per_trade ?? bot_risk_config?.max_position_size;
  if (botMaxContracts !== undefined && contracts > botMaxContracts) {
    contracts = botMaxContracts;
    cappedBy = "bot_max_contracts_per_trade";
  }

  // Symbol position limit
  const potentialSymbolPosition = Math.abs(existing_position_contracts) + contracts;
  if (potentialSymbolPosition > account_risk_profile.max_contracts_per_symbol) {
    const allowedNew = Math.max(0, account_risk_profile.max_contracts_per_symbol - Math.abs(existing_position_contracts));
    if (allowedNew < contracts) {
      contracts = allowedNew;
      cappedBy = "max_contracts_per_symbol";
    }
  }

  // Total exposure limit
  const potentialTotalExposure = total_open_contracts + contracts;
  if (potentialTotalExposure > account_risk_profile.max_total_exposure_contracts) {
    const allowedNew = Math.max(0, account_risk_profile.max_total_exposure_contracts - total_open_contracts);
    if (allowedNew < contracts) {
      contracts = allowedNew;
      cappedBy = "max_total_exposure_contracts";
    }
  }

  // Step 6: Determine if blocked
  let reasonIfBlocked: string | undefined;
  if (contracts === 0) {
    if (rawContracts === 0) {
      reasonIfBlocked = `Risk too small for stop distance. Risk $${riskDollars.toFixed(2)} vs $${dollarsPerContractAtStop.toFixed(2)} per contract at stop.`;
    } else if (cappedBy) {
      reasonIfBlocked = `Order blocked by ${cappedBy} limit`;
    } else {
      reasonIfBlocked = "Position size computed to zero after caps";
    }
  }

  return {
    contracts,
    risk_dollars: riskDollars,
    dollars_per_contract_at_stop: dollarsPerContractAtStop,
    raw_contracts: rawContracts,
    capped_by: cappedBy,
    reason_if_blocked: reasonIfBlocked,
    calculation_details: {
      account_equity,
      risk_percent_used: riskPercent,
      base_risk_dollars: riskDollars,
      stop_distance_price,
      contract_size: instrument_contract_size,
    },
  };
}

/**
 * Parse risk profile from account data, with tier-based defaults
 * Supports both legacy risk_profile JSON and new explicit columns
 */
export function parseRiskProfile(riskProfileJson: unknown, riskTier: string): RiskProfile {
  const tierPreset = RISK_TIER_PRESETS[riskTier] || RISK_TIER_PRESETS.moderate;
  
  if (!riskProfileJson || typeof riskProfileJson !== 'object') {
    return tierPreset;
  }

  const profile = riskProfileJson as Record<string, unknown>;

  return {
    risk_percent_per_trade: (profile.risk_percent_per_trade as number) ?? tierPreset.risk_percent_per_trade,
    max_risk_dollars_per_trade: (profile.max_risk_dollars_per_trade as number) ?? tierPreset.max_risk_dollars_per_trade,
    max_contracts_per_trade: (profile.max_contracts_per_trade as number) ?? tierPreset.max_contracts_per_trade,
    max_contracts_per_symbol: (profile.max_contracts_per_symbol as number) ?? tierPreset.max_contracts_per_symbol,
    max_daily_loss_percent: (profile.max_daily_loss_percent as number) ?? tierPreset.max_daily_loss_percent,
    max_daily_loss_dollars: (profile.max_daily_loss_dollars as number) ?? tierPreset.max_daily_loss_dollars,
    max_total_exposure_contracts: (profile.max_total_exposure_contracts as number) ?? tierPreset.max_total_exposure_contracts,
  };
}

/**
 * Build risk profile from account's explicit columns (preferred over JSON)
 * Falls back to tier presets for any missing values
 */
export function buildRiskProfileFromAccount(account: {
  risk_tier: string;
  risk_percent_per_trade?: number | null;
  max_risk_dollars_per_trade?: number | null;
  max_contracts_per_trade?: number | null;
  max_contracts_per_symbol?: number | null;
  max_total_exposure_contracts?: number | null;
  max_daily_loss_percent?: number | null;
  max_daily_loss_dollars?: number | null;
}): RiskProfile {
  const tierPreset = RISK_TIER_PRESETS[account.risk_tier] || RISK_TIER_PRESETS.moderate;

  return {
    risk_percent_per_trade: account.risk_percent_per_trade ?? tierPreset.risk_percent_per_trade,
    max_risk_dollars_per_trade: account.max_risk_dollars_per_trade ?? tierPreset.max_risk_dollars_per_trade,
    max_contracts_per_trade: account.max_contracts_per_trade ?? tierPreset.max_contracts_per_trade,
    max_contracts_per_symbol: account.max_contracts_per_symbol ?? tierPreset.max_contracts_per_symbol,
    max_daily_loss_percent: account.max_daily_loss_percent ?? tierPreset.max_daily_loss_percent,
    max_daily_loss_dollars: account.max_daily_loss_dollars ?? tierPreset.max_daily_loss_dollars,
    max_total_exposure_contracts: account.max_total_exposure_contracts ?? tierPreset.max_total_exposure_contracts,
  };
}

/**
 * Convert ticks to price distance
 */
export function ticksToPrice(ticks: number, tickSize: number): number {
  return ticks * tickSize;
}

/**
 * Format risk percent for display
 */
export function formatRiskPercent(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}%`;
}
