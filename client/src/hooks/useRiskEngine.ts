import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { 
  calculateOrderSizeContracts, 
  parseRiskProfile,
  buildRiskProfileFromAccount,
  ticksToPrice,
  type RiskProfile,
  type SizingResult,
  RISK_TIER_PRESETS,
} from "@/lib/riskEngine";

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  tickSize: number;
  contractSize: number;
  isActive: boolean;
}

export function useInstruments() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["instruments"],
    queryFn: async () => {
      const response = await fetch('/api/instruments', {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}

export function useInstrument(symbol: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["instruments", symbol],
    queryFn: async () => {
      if (!symbol) return null;
      
      const response = await fetch(`/api/instruments/${symbol}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return null;
      }

      const result = await response.json();
      return result.data || null;
    },
    enabled: !!user && !!symbol,
  });
}

export interface SizingPreviewInput {
  accountId?: string;
  accountEquity?: number;
  accountRiskTier?: string;
  accountRiskProfile?: RiskProfile | Record<string, unknown>;
  account?: {
    risk_tier: string;
    risk_percent_per_trade?: number | null;
    max_risk_dollars_per_trade?: number | null;
    max_contracts_per_trade?: number | null;
    max_contracts_per_symbol?: number | null;
    max_total_exposure_contracts?: number | null;
    max_daily_loss_percent?: number | null;
    max_daily_loss_dollars?: number | null;
  };
  botRiskConfig?: Record<string, unknown>;
  instrumentSymbol?: string;
  stopDistanceTicks: number;
}

export function useSizingPreview(input: SizingPreviewInput): SizingResult | null {
  const { data: instrument } = useInstrument(input.instrumentSymbol);
  
  if (!input.accountEquity || !instrument || input.stopDistanceTicks <= 0) {
    return null;
  }

  const riskProfile = input.account 
    ? buildRiskProfileFromAccount(input.account)
    : parseRiskProfile(
        input.accountRiskProfile,
        input.accountRiskTier || "moderate"
      );

  const stopDistancePrice = ticksToPrice(
    input.stopDistanceTicks,
    Number(instrument.tick_size || instrument.tickSize)
  );

  return calculateOrderSizeContracts({
    account_equity: input.accountEquity,
    account_risk_profile: riskProfile,
    instrument_contract_size: Number(instrument.contract_size || instrument.contractSize),
    instrument_tick_size: Number(instrument.tick_size || instrument.tickSize),
    stop_distance_price: stopDistancePrice,
    bot_risk_config: input.botRiskConfig as any,
    existing_position_contracts: 0,
    total_open_contracts: 0,
  });
}

export function useRiskTierPresets() {
  return RISK_TIER_PRESETS;
}

export { 
  calculateOrderSizeContracts, 
  parseRiskProfile,
  buildRiskProfileFromAccount,
  ticksToPrice,
  formatRiskPercent,
  RISK_TIER_PRESETS,
} from "@/lib/riskEngine";
export type { RiskProfile, SizingResult } from "@/lib/riskEngine";

export {
  isValidModeForAccount,
  getValidModesForAccount,
  getExecutionRouting,
  shouldBlockExecution,
  getDataFeedMode,
  ACCOUNT_TYPE_INFO,
  EXECUTION_MODE_INFO,
} from "@/lib/executionRouting";
export type { AccountType, ExecutionMode, DataFeedMode, ExecutionRouting } from "@/lib/executionRouting";
