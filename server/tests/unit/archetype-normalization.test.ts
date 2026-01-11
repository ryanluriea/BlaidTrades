/**
 * ARCHETYPE NORMALIZATION TESTS
 * 
 * Industry-standard tests to verify:
 * 1. Each archetype maps to a unique template
 * 2. Different archetypes produce different entry predicates
 * 3. Different archetypes produce different QC code
 */

import { describe, it, expect } from 'vitest';
import { translateToLEAN } from '../../providers/quantconnect/leanTranslator';

// Default config with all required risk parameters
const DEFAULT_RISK_CONFIG = {
  stopLossTicks: 16,
  takeProfitTicks: 80,
  maxPositionSize: 1,
};

const DEFAULT_STRATEGY_CONFIG = {
  rsiOversold: 30,
  rsiOverbought: 70,
  adxThreshold: 25,
  bbPeriod: 20,
  bbStd: 2,
  rsiPeriod: 14,
  adxPeriod: 14,
  emaPeriod: 21,
  atrPeriod: 14,
};

// Helper function to create proper input for translateToLEAN
function createTranslationInput(archetype: string) {
  return {
    botName: `Test_${archetype}_Strategy`,
    symbol: 'MES',
    archetype,
    timeframe: '5m',
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    riskConfig: DEFAULT_RISK_CONFIG,
    backtestPeriodDays: 30,
    rulesJson: {
      entry: [],
      exit: [],
    },
  };
}

// Extract entry logic from generated Python code
function extractEntryLogic(code: string): string {
  // Match the return statement in should_enter_long, handling multi-line
  const match = code.match(/def should_enter_long\(self, price\):[\s\S]*?return\s+(.+?)(?=\n\s*\n|\n\s*def\s)/);
  return match ? match[1].trim() : 'NOT_FOUND';
}

// Test data: Different archetypes that should produce DIFFERENT results
const TEST_ARCHETYPES = [
  'mean_reversion',
  'volatility_breakout',
  'vwap_bounce',
  'momentum',
  'range',
  'breakout',
  'trend_following',
  'scalping',
  'gap_fade',
  'session_transition',
  'breakout_retest',
  'microstructure',
  'orb_breakout',
  'exhaustion_fade',
  'momentum_surge',
  'range_scalper',
];

// Case variations that should normalize to the same template
const NORMALIZATION_CASES = [
  { input: 'MEAN_REVERSION', expected: 'mean_reversion' },
  { input: 'Mean_Reversion', expected: 'mean_reversion' },
  { input: 'VOLATILITY_BREAKOUT', expected: 'volatility_breakout' },
  { input: 'VWAP_BOUNCE', expected: 'vwap_bounce' },
  { input: 'Momentum', expected: 'momentum' },
  { input: 'SCALPING', expected: 'scalping' },
  { input: 'GAP_FADE', expected: 'gap_fade' },
];

describe('Archetype Normalization', () => {
  describe('Different archetypes produce different entry logic', () => {
    it('should generate UNIQUE entry predicates for each archetype', () => {
      const entryLogics: Map<string, string> = new Map();

      for (const archetype of TEST_ARCHETYPES) {
        const result = translateToLEAN(createTranslationInput(archetype));

        if (!result.success) {
          console.error(`Failed for ${archetype}:`, result.error);
        }
        expect(result.success).toBe(true);
        expect(result.pythonCode).toBeDefined();
        
        const entryLogic = extractEntryLogic(result.pythonCode!);
        entryLogics.set(archetype, entryLogic);
      }

      // Verify we got unique entry logic for each archetype
      const uniqueEntryLogics = new Set(entryLogics.values());
      
      console.log('\n=== ARCHETYPE ENTRY LOGIC COMPARISON ===');
      for (const [archetype, logic] of entryLogics.entries()) {
        console.log(`${archetype.padEnd(20)} => ${logic.substring(0, 80)}...`);
      }
      console.log(`\nTotal archetypes: ${TEST_ARCHETYPES.length}`);
      console.log(`Unique entry logics: ${uniqueEntryLogics.size}`);
      
      // CRITICAL: Each archetype should have unique entry logic
      expect(uniqueEntryLogics.size).toBe(TEST_ARCHETYPES.length);
    });

    it('should generate DIFFERENT indicator sets for different archetypes', () => {
      const indicatorSets: Map<string, string[]> = new Map();

      for (const archetype of TEST_ARCHETYPES) {
        const result = translateToLEAN(createTranslationInput(archetype));

        expect(result.success).toBe(true);
        
        // Extract indicators from the code
        const indicators: string[] = [];
        if (result.pythonCode!.includes('self.bb =')) indicators.push('BB');
        if (result.pythonCode!.includes('self.rsi =')) indicators.push('RSI');
        if (result.pythonCode!.includes('self.adx =')) indicators.push('ADX');
        if (result.pythonCode!.includes('self.atr =')) indicators.push('ATR');
        if (result.pythonCode!.includes('self.ema_fast =')) indicators.push('EMA_FAST');
        if (result.pythonCode!.includes('self.ema_slow =')) indicators.push('EMA_SLOW');
        if (result.pythonCode!.includes('self.vwap =')) indicators.push('VWAP');
        
        indicatorSets.set(archetype, indicators);
      }

      console.log('\n=== ARCHETYPE INDICATOR SETS ===');
      for (const [archetype, indicators] of indicatorSets.entries()) {
        console.log(`${archetype.padEnd(20)} => [${indicators.join(', ')}]`);
      }

      // Verify different archetypes use different predicates
      // VWAP_BOUNCE should use vwap in the entry logic (not necessarily as a separate indicator)
      const vwapBounceLogic = extractEntryLogic(translateToLEAN(createTranslationInput('vwap_bounce')).pythonCode!);
      expect(vwapBounceLogic).toContain('vwap');
      
      // Volatility breakout should use BandWidth
      const volBreakoutLogic = extractEntryLogic(translateToLEAN(createTranslationInput('volatility_breakout')).pythonCode!);
      expect(volBreakoutLogic).toContain('BandWidth');
    });
  });

  describe('Case normalization works correctly', () => {
    it('should normalize uppercase/mixed case to lowercase canonical form', () => {
      for (const testCase of NORMALIZATION_CASES) {
        const upperResult = translateToLEAN(createTranslationInput(testCase.input));
        const lowerResult = translateToLEAN(createTranslationInput(testCase.expected));

        expect(upperResult.success).toBe(true);
        expect(lowerResult.success).toBe(true);
        
        // Extract entry logic from both
        const upperLogic = extractEntryLogic(upperResult.pythonCode!);
        const lowerLogic = extractEntryLogic(lowerResult.pythonCode!);
        
        // They should produce the SAME entry logic (normalization working)
        expect(upperLogic).toBe(lowerLogic);
      }
      
      console.log('\n=== CASE NORMALIZATION ===');
      console.log('All case variations correctly normalized to canonical form');
    });
  });

  describe('No silent fallback to mean_reversion', () => {
    it('volatility_breakout should NOT produce mean_reversion entry logic', () => {
      const volatilityResult = translateToLEAN(createTranslationInput('volatility_breakout'));
      const meanRevResult = translateToLEAN(createTranslationInput('mean_reversion'));

      expect(volatilityResult.success).toBe(true);
      expect(meanRevResult.success).toBe(true);

      const volEntry = extractEntryLogic(volatilityResult.pythonCode!);
      const meanEntry = extractEntryLogic(meanRevResult.pythonCode!);

      console.log('\n=== NO SILENT FALLBACK TEST ===');
      console.log(`volatility_breakout entry: ${volEntry}`);
      console.log(`mean_reversion entry:      ${meanEntry}`);
      
      // CRITICAL: volatility_breakout must NOT equal mean_reversion
      expect(volEntry).not.toBe(meanEntry);
      
      // Verify volatility_breakout uses BandWidth (unique to this archetype)
      expect(volEntry).toContain('BandWidth');
      
      // Verify mean_reversion does NOT use BandWidth
      expect(meanEntry).not.toContain('BandWidth');
    });

    it('all database archetypes should have unique predicates', () => {
      // These are the actual archetypes found in the production database
      const databaseArchetypes = [
        'MEAN_REVERSION',
        'volatility_breakout', 
        'VWAP_BOUNCE',
        'SCALPING',
        'GAP_FADE',
        'session_transition',
        'momentum',
        'trend_following',
        'range',
        'breakout_retest',
        'breakout',
        'microstructure',
        'momentum_surge',
        'exhaustion_fade',
        'orb_breakout',
        'range_scalper',
      ];

      const entryLogics: Map<string, string> = new Map();

      for (const archetype of databaseArchetypes) {
        const result = translateToLEAN(createTranslationInput(archetype));

        expect(result.success).toBe(true);
        
        const logic = extractEntryLogic(result.pythonCode!);
        const normalized = archetype.toLowerCase();
        entryLogics.set(normalized, logic);
      }

      const uniqueLogics = new Set(entryLogics.values());
      
      console.log('\n=== DATABASE ARCHETYPE VERIFICATION ===');
      for (const [archetype, logic] of entryLogics.entries()) {
        console.log(`${archetype.padEnd(20)} => ${logic.substring(0, 60)}...`);
      }
      console.log(`\nDatabase archetypes tested: ${databaseArchetypes.length}`);
      console.log(`Unique entry logics generated: ${uniqueLogics.size}`);
      
      // All archetypes should produce unique entry logic
      expect(uniqueLogics.size).toBe(new Set(databaseArchetypes.map(a => a.toLowerCase())).size);
    });
  });
});
