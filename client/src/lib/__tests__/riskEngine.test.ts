/**
 * Automated tests for Account-Scaled Risk (Dynamic Position Sizing)
 * These tests prove the risk engine works correctly per requirements
 */

import { describe, it, expect } from 'vitest';
import { 
  calculateOrderSizeContracts, 
  parseRiskProfile,
  ticksToPrice,
  formatRiskPercent,
  RISK_TIER_PRESETS,
  type RiskProfile,
  type SizingInput 
} from '../riskEngine';

describe('Account-Scaled Risk Engine', () => {
  
  // Standard ES futures instrument
  const ES_INSTRUMENT = {
    contract_size: 50, // $50 per point
    tick_size: 0.25,
  };

  // Standard MES futures instrument (micro)
  const MES_INSTRUMENT = {
    contract_size: 5, // $5 per point
    tick_size: 0.25,
  };

  const createInput = (overrides: Partial<SizingInput> = {}): SizingInput => ({
    account_equity: 50000,
    account_risk_profile: RISK_TIER_PRESETS.moderate,
    instrument_contract_size: ES_INSTRUMENT.contract_size,
    instrument_tick_size: ES_INSTRUMENT.tick_size,
    stop_distance_price: 5, // 5 points = $250 per contract
    existing_position_contracts: 0,
    total_open_contracts: 0,
    ...overrides,
  });

  describe('Test 1: Scaling with account size', () => {
    it('larger account produces larger contract size with same risk% and stop', () => {
      const smallAccount = createInput({ account_equity: 10000 });
      const largeAccount = createInput({ account_equity: 100000 });

      const smallResult = calculateOrderSizeContracts(smallAccount);
      const largeResult = calculateOrderSizeContracts(largeAccount);

      // With 0.5% risk:
      // Small: $10,000 * 0.005 = $50 / $250 = 0 contracts
      // Large: $100,000 * 0.005 = $500 / $250 = 2 contracts (capped by max_risk_dollars of $300)
      expect(largeResult.contracts).toBeGreaterThanOrEqual(smallResult.contracts);
      expect(largeResult.risk_dollars).toBeGreaterThan(smallResult.risk_dollars);
    });

    it('account equity directly affects risk dollars', () => {
      const result10k = calculateOrderSizeContracts(createInput({ account_equity: 10000 }));
      const result50k = calculateOrderSizeContracts(createInput({ account_equity: 50000 }));
      const result100k = calculateOrderSizeContracts(createInput({ account_equity: 100000 }));

      // Risk dollars scale with equity (up to caps)
      expect(result50k.calculation_details.base_risk_dollars).toBeGreaterThanOrEqual(
        result10k.calculation_details.base_risk_dollars
      );
      expect(result100k.calculation_details.base_risk_dollars).toBeGreaterThanOrEqual(
        result50k.calculation_details.base_risk_dollars
      );
    });
  });

  describe('Test 2: Contract math correctness', () => {
    it('calculates correct contracts for known instrument and stop distance', () => {
      // Setup: $50,000 account, 0.5% risk, 5 point stop, ES ($50/point)
      // Risk = $50,000 * 0.005 = $250 (but capped at $300)
      // $ per contract at stop = 5 * $50 = $250
      // Raw contracts = $250 / $250 = 1
      const result = calculateOrderSizeContracts(createInput());

      expect(result.dollars_per_contract_at_stop).toBe(250); // 5 points * $50
      expect(result.raw_contracts).toBe(1);
      expect(result.contracts).toBe(1);
    });

    it('uses correct contract_size for different instruments', () => {
      const esResult = calculateOrderSizeContracts(createInput({
        instrument_contract_size: 50, // ES
        stop_distance_price: 2,
      }));

      const mesResult = calculateOrderSizeContracts(createInput({
        instrument_contract_size: 5, // MES
        stop_distance_price: 2,
      }));

      // ES: 2 points * $50 = $100 per contract
      // MES: 2 points * $5 = $10 per contract
      expect(esResult.dollars_per_contract_at_stop).toBe(100);
      expect(mesResult.dollars_per_contract_at_stop).toBe(10);

      // MES allows more contracts for same risk
      expect(mesResult.raw_contracts).toBeGreaterThan(esResult.raw_contracts);
    });

    it('correctly converts ticks to price distance', () => {
      expect(ticksToPrice(20, 0.25)).toBe(5); // 20 ticks * 0.25 = 5 points
      expect(ticksToPrice(4, 0.25)).toBe(1);
      expect(ticksToPrice(0, 0.25)).toBe(0);
    });
  });

  describe('Test 3: Caps enforcement', () => {
    it('max_contracts_per_trade clamps contract size', () => {
      const profile: RiskProfile = {
        ...RISK_TIER_PRESETS.aggressive,
        max_contracts_per_trade: 2, // Cap at 2
      };

      // With aggressive risk and small stop, raw would be higher
      const result = calculateOrderSizeContracts(createInput({
        account_equity: 200000,
        account_risk_profile: profile,
        instrument_contract_size: 5, // MES for smaller $ per contract
        stop_distance_price: 1,
      }));

      expect(result.contracts).toBeLessThanOrEqual(2);
      if (result.raw_contracts > 2) {
        expect(result.capped_by).toBe('account_max_contracts_per_trade');
      }
    });

    it('max_contracts_per_symbol clamps when existing position exists', () => {
      const profile: RiskProfile = {
        ...RISK_TIER_PRESETS.moderate,
        max_contracts_per_symbol: 3,
      };

      const result = calculateOrderSizeContracts(createInput({
        account_equity: 200000,
        account_risk_profile: profile,
        existing_position_contracts: 2, // Already have 2
        instrument_contract_size: 5,
        stop_distance_price: 1,
      }));

      // Max allowed is 3 total, already have 2, so max new = 1
      expect(result.contracts).toBeLessThanOrEqual(1);
    });

    it('max_total_exposure clamps across multiple symbols', () => {
      const profile: RiskProfile = {
        ...RISK_TIER_PRESETS.moderate,
        max_total_exposure_contracts: 5,
      };

      const result = calculateOrderSizeContracts(createInput({
        account_equity: 200000,
        account_risk_profile: profile,
        total_open_contracts: 4, // Already have 4 total
        instrument_contract_size: 5,
        stop_distance_price: 1,
      }));

      // Max allowed is 5 total, already have 4, so max new = 1
      expect(result.contracts).toBeLessThanOrEqual(1);
      if (result.raw_contracts > 1) {
        expect(result.capped_by).toBe('max_total_exposure_contracts');
      }
    });

    it('bot max_contracts_per_trade overrides when lower', () => {
      const result = calculateOrderSizeContracts(createInput({
        account_equity: 200000,
        account_risk_profile: RISK_TIER_PRESETS.aggressive,
        instrument_contract_size: 5,
        stop_distance_price: 1,
        bot_risk_config: {
          max_contracts_per_trade: 1,
        },
      }));

      expect(result.contracts).toBeLessThanOrEqual(1);
      if (result.raw_contracts > 1) {
        expect(result.capped_by).toBe('bot_max_contracts_per_trade');
      }
    });
  });

  describe('Test 4: Too small scenario', () => {
    it('returns 0 contracts when risk is too small for stop distance', () => {
      // Very small account with large stop
      const result = calculateOrderSizeContracts(createInput({
        account_equity: 1000, // Small account
        account_risk_profile: RISK_TIER_PRESETS.conservative, // 0.25% risk
        stop_distance_price: 10, // Large stop
        instrument_contract_size: 50,
      }));

      // Risk = $1,000 * 0.0025 = $2.50
      // $ per contract at stop = 10 * $50 = $500
      // Raw contracts = $2.50 / $500 = 0
      expect(result.contracts).toBe(0);
      expect(result.reason_if_blocked).toContain('Risk too small');
    });

    it('blocks order with clear reason when contracts = 0 due to caps', () => {
      const profile: RiskProfile = {
        ...RISK_TIER_PRESETS.moderate,
        max_total_exposure_contracts: 2,
      };

      const result = calculateOrderSizeContracts(createInput({
        account_equity: 100000,
        account_risk_profile: profile,
        total_open_contracts: 2, // Already at max
        instrument_contract_size: 5,
        stop_distance_price: 1,
      }));

      expect(result.contracts).toBe(0);
      expect(result.reason_if_blocked).toBeDefined();
    });

    it('handles zero stop distance gracefully', () => {
      const result = calculateOrderSizeContracts(createInput({
        stop_distance_price: 0,
      }));

      expect(result.contracts).toBe(0);
      expect(result.reason_if_blocked).toContain('Invalid stop distance');
    });

    it('handles negative stop distance gracefully', () => {
      const result = calculateOrderSizeContracts(createInput({
        stop_distance_price: -5,
      }));

      expect(result.contracts).toBe(0);
      expect(result.reason_if_blocked).toContain('Invalid stop distance');
    });
  });

  describe('Test 5: Risk profile parsing', () => {
    it('uses tier presets when no profile provided', () => {
      const profile = parseRiskProfile(null, 'conservative');
      expect(profile.risk_percent_per_trade).toBe(RISK_TIER_PRESETS.conservative.risk_percent_per_trade);
    });

    it('merges partial profile with tier defaults', () => {
      const partial = { risk_percent_per_trade: 0.01 };
      const profile = parseRiskProfile(partial, 'conservative');
      
      expect(profile.risk_percent_per_trade).toBe(0.01); // From partial
      expect(profile.max_contracts_per_trade).toBe(RISK_TIER_PRESETS.conservative.max_contracts_per_trade); // From tier
    });

    it('falls back to moderate tier for unknown tier', () => {
      const profile = parseRiskProfile(null, 'unknown_tier');
      expect(profile).toEqual(RISK_TIER_PRESETS.moderate);
    });
  });

  describe('Test 6: Utility functions', () => {
    it('formats risk percent correctly', () => {
      expect(formatRiskPercent(0.005)).toBe('0.50%');
      expect(formatRiskPercent(0.01)).toBe('1.00%');
      expect(formatRiskPercent(0.0025)).toBe('0.25%');
    });
  });

  describe('Test 7: Bot risk config integration', () => {
    it('uses minimum of account and bot risk percent', () => {
      const result = calculateOrderSizeContracts(createInput({
        account_risk_profile: {
          ...RISK_TIER_PRESETS.aggressive,
          risk_percent_per_trade: 0.02, // 2%
        },
        bot_risk_config: {
          risk_percent_per_trade: 0.005, // 0.5%
        },
      }));

      expect(result.calculation_details.risk_percent_used).toBe(0.005);
    });

    it('uses minimum of account and bot max risk dollars', () => {
      const accountProfile: RiskProfile = {
        ...RISK_TIER_PRESETS.aggressive,
        max_risk_dollars_per_trade: 1000,
      };

      const result = calculateOrderSizeContracts(createInput({
        account_equity: 500000, // Large equity
        account_risk_profile: accountProfile,
        bot_risk_config: {
          max_risk_dollars_per_trade: 200, // Bot cap
        },
        instrument_contract_size: 5,
        stop_distance_price: 1,
      }));

      // Should be capped at $200
      expect(result.risk_dollars).toBeLessThanOrEqual(200);
    });
  });

  describe('Test 8: Never negative contracts', () => {
    it('never returns negative contracts', () => {
      const extremeCases = [
        { account_equity: 0 },
        { account_equity: -1000 },
        { stop_distance_price: 1000 },
        { existing_position_contracts: 1000 },
        { total_open_contracts: 1000 },
      ];

      for (const override of extremeCases) {
        const result = calculateOrderSizeContracts(createInput(override));
        expect(result.contracts).toBeGreaterThanOrEqual(0);
        expect(result.raw_contracts).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
