/**
 * Position Reconciliation Service
 * 
 * INDUSTRY STANDARD: Verify local position state matches broker reality.
 * - Poll broker positions on connect/resume
 * - Compare against local database state
 * - Log variances with full audit trail
 * - Auto-alert on material discrepancies
 * 
 * Used by: Live trading runner, Risk engine, Daily reconciliation
 */

import { logActivityEvent } from "./activity-logger";

export interface BrokerPosition {
  symbol: string;
  quantity: number;          // Positive = long, negative = short
  averagePrice: number;
  unrealizedPnL: number;
  marketValue: number;
  accountId: string;
  lastUpdated: Date;
}

export interface LocalPosition {
  botId: number;
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  accountAttemptId?: string;
}

export interface PositionVariance {
  symbol: string;
  localQty: number;
  brokerQty: number;
  qtyVariance: number;
  localAvgPrice: number;
  brokerAvgPrice: number;
  priceVariance: number;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface ReconciliationResult {
  timestamp: Date;
  accountId: string;
  matched: number;
  variances: PositionVariance[];
  orphanedBroker: BrokerPosition[];   // Positions at broker but not local
  orphanedLocal: LocalPosition[];      // Positions local but not at broker
  status: "MATCHED" | "VARIANCE_DETECTED" | "CRITICAL_VARIANCE";
}

class PositionReconciliationService {
  private lastReconciliation: Map<string, ReconciliationResult> = new Map();
  private varianceThresholds = {
    qtyWarning: 0,       // Any qty mismatch is a warning
    qtyCritical: 0,      // Any qty mismatch could be critical for small positions
    priceWarning: 0.01,  // 1% price variance
    priceCritical: 0.05, // 5% price variance
  };
  
  /**
   * Reconcile positions between broker and local state
   */
  async reconcile(
    accountId: string,
    brokerPositions: BrokerPosition[],
    localPositions: LocalPosition[]
  ): Promise<ReconciliationResult> {
    const now = new Date();
    const variances: PositionVariance[] = [];
    const orphanedBroker: BrokerPosition[] = [];
    const orphanedLocal: LocalPosition[] = [];
    let matched = 0;
    
    // Create maps for easy lookup
    const brokerMap = new Map<string, BrokerPosition>();
    for (const bp of brokerPositions) {
      brokerMap.set(bp.symbol, bp);
    }
    
    const localMap = new Map<string, LocalPosition>();
    for (const lp of localPositions) {
      localMap.set(lp.symbol, lp);
    }
    
    // Check each local position against broker
    for (const local of localPositions) {
      const broker = brokerMap.get(local.symbol);
      
      if (!broker) {
        // Position exists locally but not at broker
        orphanedLocal.push(local);
        continue;
      }
      
      // Compare quantities
      const qtyVariance = broker.quantity - local.quantity;
      const priceVariance = broker.averagePrice > 0 && local.averageEntryPrice > 0
        ? Math.abs((broker.averagePrice - local.averageEntryPrice) / broker.averagePrice)
        : 0;
      
      if (qtyVariance === 0 && priceVariance < this.varianceThresholds.priceWarning) {
        matched++;
        continue;
      }
      
      // Determine severity
      let severity: "INFO" | "WARNING" | "CRITICAL" = "INFO";
      const messages: string[] = [];
      
      if (qtyVariance !== 0) {
        severity = "CRITICAL";  // Any quantity mismatch is critical
        messages.push(`Qty: local=${local.quantity} broker=${broker.quantity} (diff=${qtyVariance})`);
      }
      
      if (priceVariance >= this.varianceThresholds.priceCritical) {
        severity = "CRITICAL";
        messages.push(`Price: local=${local.averageEntryPrice} broker=${broker.averagePrice} (${(priceVariance * 100).toFixed(2)}%)`);
      } else if (priceVariance >= this.varianceThresholds.priceWarning) {
        if (severity !== "CRITICAL") severity = "WARNING";
        messages.push(`Price: local=${local.averageEntryPrice} broker=${broker.averagePrice} (${(priceVariance * 100).toFixed(2)}%)`);
      }
      
      variances.push({
        symbol: local.symbol,
        localQty: local.quantity,
        brokerQty: broker.quantity,
        qtyVariance,
        localAvgPrice: local.averageEntryPrice,
        brokerAvgPrice: broker.averagePrice,
        priceVariance,
        severity,
        message: messages.join("; "),
      });
      
      // Remove from broker map to track orphans
      brokerMap.delete(local.symbol);
    }
    
    // Check for positions at broker not in local
    for (const [symbol, broker] of brokerMap) {
      if (!localMap.has(symbol)) {
        orphanedBroker.push(broker);
      }
    }
    
    // Determine overall status
    let status: "MATCHED" | "VARIANCE_DETECTED" | "CRITICAL_VARIANCE" = "MATCHED";
    if (variances.some(v => v.severity === "CRITICAL") || orphanedBroker.length > 0 || orphanedLocal.length > 0) {
      status = "CRITICAL_VARIANCE";
    } else if (variances.length > 0) {
      status = "VARIANCE_DETECTED";
    }
    
    const result: ReconciliationResult = {
      timestamp: now,
      accountId,
      matched,
      variances,
      orphanedBroker,
      orphanedLocal,
      status,
    };
    
    this.lastReconciliation.set(accountId, result);
    
    // Log activity event
    await this.logReconciliation(result);
    
    return result;
  }
  
  private async logReconciliation(result: ReconciliationResult): Promise<void> {
    if (result.status === "MATCHED") {
      await logActivityEvent({
        eventType: "RUNNER_STARTED",
        severity: "INFO",
        title: "Position Reconciliation Passed",
        summary: `${result.matched} positions matched for ${result.accountId}`,
        payload: { accountId: result.accountId, matched: result.matched },
      });
      return;
    }
    
    const severity = result.status === "CRITICAL_VARIANCE" ? "ERROR" : "WARN";
    const details: string[] = [];
    
    if (result.variances.length > 0) {
      details.push(`${result.variances.length} variances detected`);
    }
    if (result.orphanedBroker.length > 0) {
      details.push(`${result.orphanedBroker.length} positions at broker not tracked locally`);
    }
    if (result.orphanedLocal.length > 0) {
      details.push(`${result.orphanedLocal.length} local positions not at broker`);
    }
    
    await logActivityEvent({
      eventType: "INTEGRATION_ERROR",
      severity,
      title: `Position Reconciliation ${result.status}`,
      summary: details.join("; "),
      payload: {
        accountId: result.accountId,
        matched: result.matched,
        variances: result.variances,
        orphanedBroker: result.orphanedBroker.map(p => p.symbol),
        orphanedLocal: result.orphanedLocal.map(p => p.symbol),
      },
    });
  }
  
  /**
   * Get last reconciliation result for an account
   */
  getLastReconciliation(accountId: string): ReconciliationResult | null {
    return this.lastReconciliation.get(accountId) ?? null;
  }
  
  /**
   * Get all recent reconciliation results
   */
  getAllReconciliations(): ReconciliationResult[] {
    return Array.from(this.lastReconciliation.values());
  }
  
  /**
   * Check if reconciliation should block trading
   * Returns true if there are critical variances
   */
  shouldBlockTrading(accountId: string): { blocked: boolean; reason: string | null } {
    const result = this.lastReconciliation.get(accountId);
    if (!result) {
      return { blocked: false, reason: null };
    }
    
    if (result.status === "CRITICAL_VARIANCE") {
      const reasons: string[] = [];
      if (result.orphanedBroker.length > 0) {
        reasons.push(`untracked broker positions: ${result.orphanedBroker.map(p => p.symbol).join(", ")}`);
      }
      if (result.variances.some(v => v.qtyVariance !== 0)) {
        reasons.push("quantity mismatches detected");
      }
      return { blocked: true, reason: reasons.join("; ") };
    }
    
    return { blocked: false, reason: null };
  }
  
  /**
   * Clear reconciliation state (for testing or reset)
   */
  clearState(): void {
    this.lastReconciliation.clear();
  }
}

export const positionReconciliationService = new PositionReconciliationService();
