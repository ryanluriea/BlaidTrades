/**
 * Capabilities Registry - Platform Feature Inventory
 * 
 * Single source of truth for all platform capabilities.
 * Tracks implementation status for:
 * - Sidebar tooltip display
 * - Feature audit reporting
 * - Roadmap planning
 * 
 * Status meanings:
 * - IMPLEMENTED: Fully functional in production
 * - PARTIAL: Core functionality exists, edge cases may be missing
 * - PLANNED: On roadmap, not yet implemented
 * - EXPERIMENTAL: Available but may change/break
 */

export type FeatureStatus = "IMPLEMENTED" | "PARTIAL" | "PLANNED" | "EXPERIMENTAL";

export interface Capability {
  id: string;
  name: string;
  description: string;
  category: CapabilityCategory;
  status: FeatureStatus;
  version?: string;       // Version when implemented
  lastUpdated?: string;   // ISO date
  dependencies?: string[]; // Other capability IDs this depends on
}

export type CapabilityCategory = 
  | "data"
  | "execution"
  | "risk"
  | "autonomy"
  | "infrastructure"
  | "monitoring"
  | "strategy";

export const CAPABILITIES: Capability[] = [
  // DATA CAPABILITIES
  {
    id: "realtime-quotes",
    name: "Real-Time Quotes",
    description: "Sub-second tick data from Ironbeam for MES/MNQ/ES/NQ",
    category: "data",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "level2-orderbook",
    name: "Level 2 Order Book",
    description: "Bid/ask spread tracking, imbalance metrics, liquidity scoring",
    category: "data",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  {
    id: "bar-aggregation",
    name: "Bar Aggregation",
    description: "Real-time 1-minute OHLCV bar construction from ticks",
    category: "data",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "historical-bars",
    name: "Historical Bars",
    description: "3-tier bar cache (Redis -> SQLite -> Databento)",
    category: "data",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "data-provenance",
    name: "Data Provenance",
    description: "Full audit trail of data sources with timestamps",
    category: "data",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  
  // EXECUTION CAPABILITIES
  {
    id: "dynamic-slippage",
    name: "Dynamic Slippage",
    description: "Volatility and spread-aware slippage calculation",
    category: "execution",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  {
    id: "paper-trading",
    name: "Paper Trading",
    description: "Simulated order execution with real market data",
    category: "execution",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "live-trading",
    name: "Live Trading",
    description: "Real order execution via Ironbeam/Tradovate",
    category: "execution",
    status: "PARTIAL",
    version: "1.0.0",
  },
  {
    id: "position-reconciliation",
    name: "Position Reconciliation",
    description: "Broker position sync with variance detection",
    category: "execution",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  {
    id: "backtest-fill-variance",
    name: "Backtest Fill Variance",
    description: "Realistic fill simulation with randomized offsets",
    category: "execution",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  
  // RISK CAPABILITIES
  {
    id: "position-limits",
    name: "Position Limits",
    description: "Per-bot and global position size limits",
    category: "risk",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "drawdown-limits",
    name: "Drawdown Limits",
    description: "Session and total drawdown enforcement",
    category: "risk",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "circuit-breaker",
    name: "Circuit Breaker",
    description: "Automatic trading halt on repeated failures",
    category: "risk",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "kill-switch",
    name: "Kill Switch",
    description: "Emergency stop all trading activity",
    category: "risk",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "risk-self-test",
    name: "Risk Self-Test",
    description: "Continuous verification of risk checks",
    category: "risk",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  
  // AUTONOMY CAPABILITIES
  {
    id: "auto-promotion",
    name: "Auto Promotion",
    description: "Autonomous stage advancement (LAB->PAPER->SHADOW->CANARY->LIVE)",
    category: "autonomy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "strategy-research",
    name: "Strategy Research",
    description: "Perplexity-powered autonomous strategy discovery",
    category: "autonomy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "qc-verification",
    name: "QC Verification",
    description: "QuantConnect backtest validation with evolution",
    category: "autonomy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "lab-feedback-loop",
    name: "LAB Feedback Loop",
    description: "Auto-retry research cycles on failures",
    category: "autonomy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  
  // INFRASTRUCTURE CAPABILITIES
  {
    id: "broker-heartbeat",
    name: "Broker Heartbeat",
    description: "Explicit broker health monitoring with autonomy gating",
    category: "infrastructure",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  {
    id: "ai-cascade",
    name: "AI Provider Cascade",
    description: "Multi-provider LLM failover (Groq->OpenAI->Anthropic->Gemini->xAI)",
    category: "infrastructure",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "memory-sentinel",
    name: "Memory Sentinel",
    description: "Heap monitoring with auto-pause of heavy workers",
    category: "infrastructure",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "database-backup",
    name: "Database Backup",
    description: "Scheduled pg_dump with Google Drive integration",
    category: "infrastructure",
    status: "IMPLEMENTED",
    version: "1.1.0",
    lastUpdated: "2025-12-31",
  },
  {
    id: "websocket-pnl",
    name: "WebSocket P&L",
    description: "Real-time P&L streaming with throttling",
    category: "infrastructure",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  
  // MONITORING CAPABILITIES
  {
    id: "activity-grid",
    name: "Activity Grid",
    description: "Real-time event log with severity filtering",
    category: "monitoring",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "integration-health",
    name: "Integration Health",
    description: "Proof-of-use tracking for brokers and AI providers",
    category: "monitoring",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "data-freshness",
    name: "Data Freshness",
    description: "Price authority with staleness detection",
    category: "monitoring",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "discord-notifications",
    name: "Discord Notifications",
    description: "Alert routing to Discord webhooks",
    category: "monitoring",
    status: "PARTIAL",
    version: "1.0.0",
  },
  
  // STRATEGY CAPABILITIES
  {
    id: "multi-timeframe",
    name: "Multi-Timeframe",
    description: "Strategy support for 1m, 5m, 15m, 1h timeframes",
    category: "strategy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
  {
    id: "regime-detection",
    name: "Regime Detection",
    description: "Market regime classification for strategy selection",
    category: "strategy",
    status: "PARTIAL",
    version: "1.0.0",
  },
  {
    id: "signal-fusion",
    name: "Signal Fusion",
    description: "Multi-strategy signal aggregation",
    category: "strategy",
    status: "IMPLEMENTED",
    version: "1.0.0",
  },
];

/**
 * Get capabilities by category
 */
export function getCapabilitiesByCategory(category: CapabilityCategory): Capability[] {
  return CAPABILITIES.filter(c => c.category === category);
}

/**
 * Get capabilities by status
 */
export function getCapabilitiesByStatus(status: FeatureStatus): Capability[] {
  return CAPABILITIES.filter(c => c.status === status);
}

/**
 * Get capability by ID
 */
export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find(c => c.id === id);
}

/**
 * Get summary stats for sidebar tooltip
 */
export function getCapabilitySummary(): {
  total: number;
  implemented: number;
  partial: number;
  planned: number;
  experimental: number;
  byCategory: Record<CapabilityCategory, number>;
} {
  const byCategory = {} as Record<CapabilityCategory, number>;
  const categories: CapabilityCategory[] = ["data", "execution", "risk", "autonomy", "infrastructure", "monitoring", "strategy"];
  
  for (const cat of categories) {
    byCategory[cat] = CAPABILITIES.filter(c => c.category === cat && c.status === "IMPLEMENTED").length;
  }
  
  return {
    total: CAPABILITIES.length,
    implemented: CAPABILITIES.filter(c => c.status === "IMPLEMENTED").length,
    partial: CAPABILITIES.filter(c => c.status === "PARTIAL").length,
    planned: CAPABILITIES.filter(c => c.status === "PLANNED").length,
    experimental: CAPABILITIES.filter(c => c.status === "EXPERIMENTAL").length,
    byCategory,
  };
}
