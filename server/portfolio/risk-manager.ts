export interface PositionRisk {
  botId: string;
  symbol: string;
  contracts: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  marketValue: number;
  weight: number;
}

export interface VaRResult {
  historicalVaR95: number;
  historicalVaR99: number;
  parametricVaR95: number;
  parametricVaR99: number;
  expectedShortfall95: number;
  expectedShortfall99: number;
  calculatedAt: Date;
  portfolioValue: number;
}

export interface SectorExposure {
  sector: string;
  symbols: string[];
  exposure: number;
  weight: number;
  pnl: number;
}

export interface ConcentrationMetrics {
  herfindahlIndex: number;
  maxPositionWeight: number;
  top3Weight: number;
  numberOfPositions: number;
  diversificationScore: number;
}

export interface RiskLimits {
  maxVaR95Pct: number;
  maxPositionWeight: number;
  maxSectorWeight: number;
  maxConcentrationHHI: number;
  maxDrawdownPct: number;
  maxDailyLossPct: number;
}

export interface RiskViolation {
  type: "VAR" | "POSITION_WEIGHT" | "SECTOR_WEIGHT" | "CONCENTRATION" | "DRAWDOWN" | "DAILY_LOSS";
  current: number;
  limit: number;
  severity: "WARNING" | "CRITICAL";
  message: string;
}

const DEFAULT_LIMITS: RiskLimits = {
  maxVaR95Pct: 5,
  maxPositionWeight: 25,
  maxSectorWeight: 40,
  maxConcentrationHHI: 0.5,
  maxDrawdownPct: 15,
  maxDailyLossPct: 3,
};

const SYMBOL_SECTORS: Record<string, string> = {
  MES: "Equity Index",
  MNQ: "Equity Index",
  ES: "Equity Index",
  NQ: "Equity Index",
  MCL: "Energy",
  CL: "Energy",
  MGC: "Precious Metals",
  GC: "Precious Metals",
  MBT: "Crypto",
  BTC: "Crypto",
  ZN: "Fixed Income",
  ZB: "Fixed Income",
  ZC: "Agriculture",
  ZS: "Agriculture",
  ZW: "Agriculture",
  "6E": "Currency",
  "6J": "Currency",
};

export class RiskManager {
  private limits: RiskLimits;
  private historicalReturns: number[] = [];
  private readonly MAX_HISTORY = 252;

  constructor(limits: Partial<RiskLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  calculateVaR(
    positions: PositionRisk[],
    dailyReturns: number[]
  ): VaRResult {
    const portfolioValue = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
    
    if (dailyReturns.length < 20 || portfolioValue === 0) {
      return {
        historicalVaR95: 0,
        historicalVaR99: 0,
        parametricVaR95: 0,
        parametricVaR99: 0,
        expectedShortfall95: 0,
        expectedShortfall99: 0,
        calculatedAt: new Date(),
        portfolioValue,
      };
    }

    const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
    const n = sortedReturns.length;
    
    const var95Index = Math.floor(n * 0.05);
    const var99Index = Math.floor(n * 0.01);
    
    const historicalVaR95 = -sortedReturns[var95Index] * portfolioValue;
    const historicalVaR99 = -sortedReturns[var99Index] * portfolioValue;

    const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);

    const z95 = 1.645;
    const z99 = 2.326;
    
    const parametricVaR95 = (mean - z95 * std) * -portfolioValue;
    const parametricVaR99 = (mean - z99 * std) * -portfolioValue;

    const tail95 = sortedReturns.slice(0, var95Index + 1);
    const tail99 = sortedReturns.slice(0, var99Index + 1);
    
    const es95 = tail95.length > 0 
      ? -tail95.reduce((a, b) => a + b, 0) / tail95.length * portfolioValue 
      : historicalVaR95;
    const es99 = tail99.length > 0 
      ? -tail99.reduce((a, b) => a + b, 0) / tail99.length * portfolioValue 
      : historicalVaR99;

    return {
      historicalVaR95,
      historicalVaR99,
      parametricVaR95,
      parametricVaR99,
      expectedShortfall95: es95,
      expectedShortfall99: es99,
      calculatedAt: new Date(),
      portfolioValue,
    };
  }

  calculateSectorExposure(positions: PositionRisk[]): SectorExposure[] {
    const portfolioValue = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
    const sectorMap = new Map<string, { symbols: Set<string>; exposure: number; pnl: number }>();

    for (const pos of positions) {
      const sector = SYMBOL_SECTORS[pos.symbol] || "Other";
      
      if (!sectorMap.has(sector)) {
        sectorMap.set(sector, { symbols: new Set(), exposure: 0, pnl: 0 });
      }
      
      const s = sectorMap.get(sector)!;
      s.symbols.add(pos.symbol);
      s.exposure += Math.abs(pos.marketValue);
      s.pnl += pos.unrealizedPnL;
    }

    return Array.from(sectorMap.entries()).map(([sector, data]) => ({
      sector,
      symbols: Array.from(data.symbols),
      exposure: data.exposure,
      weight: portfolioValue > 0 ? (data.exposure / portfolioValue) * 100 : 0,
      pnl: data.pnl,
    })).sort((a, b) => b.exposure - a.exposure);
  }

  calculateConcentration(positions: PositionRisk[]): ConcentrationMetrics {
    const portfolioValue = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
    
    if (portfolioValue === 0 || positions.length === 0) {
      return {
        herfindahlIndex: 0,
        maxPositionWeight: 0,
        top3Weight: 0,
        numberOfPositions: 0,
        diversificationScore: 0,
      };
    }

    const weights = positions.map(p => Math.abs(p.marketValue) / portfolioValue);
    const hhi = weights.reduce((sum, w) => sum + w * w, 0);
    
    const sortedWeights = [...weights].sort((a, b) => b - a);
    const maxWeight = sortedWeights[0] * 100;
    const top3Weight = sortedWeights.slice(0, 3).reduce((a, b) => a + b, 0) * 100;

    const n = positions.length;
    const minHHI = 1 / n;
    const diversificationScore = n > 1 ? (1 - hhi) / (1 - minHHI) * 100 : 0;

    return {
      herfindahlIndex: hhi,
      maxPositionWeight: maxWeight,
      top3Weight,
      numberOfPositions: n,
      diversificationScore,
    };
  }

  checkRiskLimits(
    positions: PositionRisk[],
    dailyReturns: number[],
    currentDrawdownPct: number = 0,
    dailyPnLPct: number = 0
  ): RiskViolation[] {
    const violations: RiskViolation[] = [];
    
    const var95Result = this.calculateVaR(positions, dailyReturns);
    const var95Pct = var95Result.portfolioValue > 0 
      ? (var95Result.historicalVaR95 / var95Result.portfolioValue) * 100 
      : 0;
    
    if (var95Pct > this.limits.maxVaR95Pct) {
      violations.push({
        type: "VAR",
        current: var95Pct,
        limit: this.limits.maxVaR95Pct,
        severity: var95Pct > this.limits.maxVaR95Pct * 1.5 ? "CRITICAL" : "WARNING",
        message: `VaR(95%) at ${var95Pct.toFixed(2)}% exceeds limit of ${this.limits.maxVaR95Pct}%`,
      });
    }

    const concentration = this.calculateConcentration(positions);
    
    if (concentration.maxPositionWeight > this.limits.maxPositionWeight) {
      violations.push({
        type: "POSITION_WEIGHT",
        current: concentration.maxPositionWeight,
        limit: this.limits.maxPositionWeight,
        severity: concentration.maxPositionWeight > this.limits.maxPositionWeight * 1.5 ? "CRITICAL" : "WARNING",
        message: `Max position weight ${concentration.maxPositionWeight.toFixed(1)}% exceeds limit of ${this.limits.maxPositionWeight}%`,
      });
    }

    if (concentration.herfindahlIndex > this.limits.maxConcentrationHHI) {
      violations.push({
        type: "CONCENTRATION",
        current: concentration.herfindahlIndex,
        limit: this.limits.maxConcentrationHHI,
        severity: concentration.herfindahlIndex > this.limits.maxConcentrationHHI * 1.2 ? "CRITICAL" : "WARNING",
        message: `HHI concentration ${concentration.herfindahlIndex.toFixed(3)} exceeds limit of ${this.limits.maxConcentrationHHI}`,
      });
    }

    const sectorExposure = this.calculateSectorExposure(positions);
    for (const sector of sectorExposure) {
      if (sector.weight > this.limits.maxSectorWeight) {
        violations.push({
          type: "SECTOR_WEIGHT",
          current: sector.weight,
          limit: this.limits.maxSectorWeight,
          severity: sector.weight > this.limits.maxSectorWeight * 1.25 ? "CRITICAL" : "WARNING",
          message: `${sector.sector} sector at ${sector.weight.toFixed(1)}% exceeds limit of ${this.limits.maxSectorWeight}%`,
        });
      }
    }

    if (currentDrawdownPct > this.limits.maxDrawdownPct) {
      violations.push({
        type: "DRAWDOWN",
        current: currentDrawdownPct,
        limit: this.limits.maxDrawdownPct,
        severity: currentDrawdownPct > this.limits.maxDrawdownPct * 1.5 ? "CRITICAL" : "WARNING",
        message: `Current drawdown ${currentDrawdownPct.toFixed(2)}% exceeds limit of ${this.limits.maxDrawdownPct}%`,
      });
    }

    if (dailyPnLPct < -this.limits.maxDailyLossPct) {
      violations.push({
        type: "DAILY_LOSS",
        current: Math.abs(dailyPnLPct),
        limit: this.limits.maxDailyLossPct,
        severity: Math.abs(dailyPnLPct) > this.limits.maxDailyLossPct * 1.5 ? "CRITICAL" : "WARNING",
        message: `Daily loss ${Math.abs(dailyPnLPct).toFixed(2)}% exceeds limit of ${this.limits.maxDailyLossPct}%`,
      });
    }

    return violations;
  }

  addDailyReturn(ret: number): void {
    this.historicalReturns.push(ret);
    if (this.historicalReturns.length > this.MAX_HISTORY) {
      this.historicalReturns.shift();
    }
  }

  getHistoricalReturns(): number[] {
    return [...this.historicalReturns];
  }

  setLimits(limits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  getRiskSummary(positions: PositionRisk[]): {
    var: VaRResult;
    sectors: SectorExposure[];
    concentration: ConcentrationMetrics;
    violations: RiskViolation[];
  } {
    const var95 = this.calculateVaR(positions, this.historicalReturns);
    const sectors = this.calculateSectorExposure(positions);
    const concentration = this.calculateConcentration(positions);
    const violations = this.checkRiskLimits(positions, this.historicalReturns);

    return { var: var95, sectors, concentration, violations };
  }
}

export const riskManager = new RiskManager();
