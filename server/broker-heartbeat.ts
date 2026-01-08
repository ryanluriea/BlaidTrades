/**
 * Broker Heartbeat Monitor - Explicit Health Verification
 * 
 * INDUSTRY STANDARD: Continuous broker connectivity verification.
 * - Explicit ping/pong heartbeats every 30 seconds
 * - Integration with ProviderHealth system
 * - Autonomy gating when heartbeats lapse (3+ missed = DEGRADED)
 * - Auto-recovery on reconnection
 * 
 * Used by: Autonomy loop, Risk engine, Activity grid
 */

import { EventEmitter } from "events";
import { logActivityEvent } from "./activity-logger";
import { logIntegrationUsage } from "./integration-usage";

export type HeartbeatStatus = "HEALTHY" | "WARNING" | "DEGRADED" | "DISCONNECTED";

export interface BrokerHeartbeat {
  broker: string;
  lastPing: Date;
  lastPong: Date | null;
  rttMs: number | null;       // Round-trip time in milliseconds
  missedPings: number;
  status: HeartbeatStatus;
  consecutiveFailures: number;
  lastStatusChange: Date;
}

interface BrokerHeartbeatConfig {
  pingIntervalMs: number;     // How often to send pings
  timeoutMs: number;          // How long to wait for pong
  warningThreshold: number;   // Missed pings before WARNING
  degradedThreshold: number;  // Missed pings before DEGRADED
  disconnectedThreshold: number; // Missed pings before DISCONNECTED
}

const DEFAULT_CONFIG: BrokerHeartbeatConfig = {
  pingIntervalMs: 30_000,     // 30 seconds
  timeoutMs: 10_000,          // 10 seconds
  warningThreshold: 1,        // 1 missed = WARNING
  degradedThreshold: 3,       // 3 missed = DEGRADED
  disconnectedThreshold: 5,   // 5 missed = DISCONNECTED
};

class BrokerHeartbeatMonitor extends EventEmitter {
  private heartbeats: Map<string, BrokerHeartbeat> = new Map();
  private pingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingPings: Map<string, { sent: Date; timeout: NodeJS.Timeout }> = new Map();
  private config: BrokerHeartbeatConfig = DEFAULT_CONFIG;
  private isRunning = false;
  
  /**
   * Register a broker for heartbeat monitoring
   */
  registerBroker(broker: string, sendPing: () => Promise<boolean>): void {
    const now = new Date();
    
    this.heartbeats.set(broker, {
      broker,
      lastPing: now,
      lastPong: null,
      rttMs: null,
      missedPings: 0,
      status: "HEALTHY",
      consecutiveFailures: 0,
      lastStatusChange: now,
    });
    
    // Start heartbeat interval
    const interval = setInterval(async () => {
      await this.sendPing(broker, sendPing);
    }, this.config.pingIntervalMs);
    
    this.pingIntervals.set(broker, interval);
    
    console.log(`[BROKER_HEARTBEAT] registered broker: ${broker}`);
  }
  
  /**
   * Unregister a broker from monitoring
   */
  unregisterBroker(broker: string): void {
    const interval = this.pingIntervals.get(broker);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(broker);
    }
    
    const pending = this.pendingPings.get(broker);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPings.delete(broker);
    }
    
    this.heartbeats.delete(broker);
    console.log(`[BROKER_HEARTBEAT] unregistered broker: ${broker}`);
  }
  
  /**
   * Send a ping to the broker
   */
  private async sendPing(broker: string, sendPing: () => Promise<boolean>): Promise<void> {
    const heartbeat = this.heartbeats.get(broker);
    if (!heartbeat) return;
    
    const now = new Date();
    heartbeat.lastPing = now;
    
    // Set timeout for pong response
    const timeout = setTimeout(() => {
      this.handlePongTimeout(broker);
    }, this.config.timeoutMs);
    
    this.pendingPings.set(broker, { sent: now, timeout });
    
    try {
      const success = await sendPing();
      if (!success) {
        // Ping failed to send
        this.handlePongTimeout(broker);
      }
    } catch (error) {
      console.error(`[BROKER_HEARTBEAT] ping error for ${broker}:`, error);
      this.handlePongTimeout(broker);
    }
  }
  
  /**
   * Record a pong response from the broker
   * Called by broker client when heartbeat/pong is received
   */
  recordPong(broker: string): void {
    const pending = this.pendingPings.get(broker);
    const heartbeat = this.heartbeats.get(broker);
    
    if (!heartbeat) return;
    
    const now = new Date();
    
    if (pending) {
      // Clear the timeout
      clearTimeout(pending.timeout);
      this.pendingPings.delete(broker);
      
      // Calculate RTT
      heartbeat.rttMs = now.getTime() - pending.sent.getTime();
    }
    
    heartbeat.lastPong = now;
    heartbeat.missedPings = 0;
    heartbeat.consecutiveFailures = 0;
    
    // Update status if recovering
    const prevStatus = heartbeat.status;
    if (prevStatus !== "HEALTHY") {
      heartbeat.status = "HEALTHY";
      heartbeat.lastStatusChange = now;
      
      this.emit("status_change", { broker, from: prevStatus, to: "HEALTHY" });
      
      logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: "Broker Heartbeat Recovered",
        summary: `${broker} heartbeat restored (RTT: ${heartbeat.rttMs}ms)`,
        payload: { broker, rttMs: heartbeat.rttMs },
      }).catch(console.error);
      
      logIntegrationUsage({
        provider: broker.toLowerCase(),
        operation: "heartbeat_recovered",
        status: "OK",
        latencyMs: heartbeat.rttMs ?? 0,
      }).catch(console.error);
    }
  }
  
  /**
   * Handle pong timeout (missed ping)
   */
  private handlePongTimeout(broker: string): void {
    const heartbeat = this.heartbeats.get(broker);
    if (!heartbeat) return;
    
    // Clear pending
    const pending = this.pendingPings.get(broker);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPings.delete(broker);
    }
    
    heartbeat.missedPings++;
    heartbeat.consecutiveFailures++;
    heartbeat.rttMs = null;
    
    const prevStatus = heartbeat.status;
    let newStatus: HeartbeatStatus = "HEALTHY";
    
    if (heartbeat.missedPings >= this.config.disconnectedThreshold) {
      newStatus = "DISCONNECTED";
    } else if (heartbeat.missedPings >= this.config.degradedThreshold) {
      newStatus = "DEGRADED";
    } else if (heartbeat.missedPings >= this.config.warningThreshold) {
      newStatus = "WARNING";
    }
    
    if (newStatus !== prevStatus) {
      heartbeat.status = newStatus;
      heartbeat.lastStatusChange = new Date();
      
      this.emit("status_change", { broker, from: prevStatus, to: newStatus });
      
      const severity = newStatus === "DISCONNECTED" ? "ERROR" : newStatus === "DEGRADED" ? "WARN" : "INFO";
      
      logActivityEvent({
        eventType: "INTEGRATION_ERROR",
        severity,
        title: `Broker Heartbeat ${newStatus}`,
        summary: `${broker} missed ${heartbeat.missedPings} pings`,
        payload: { broker, missedPings: heartbeat.missedPings, status: newStatus },
      }).catch(console.error);
      
      logIntegrationUsage({
        provider: broker.toLowerCase(),
        operation: "heartbeat_missed",
        status: "ERROR",
        latencyMs: 0,
        metadata: { missedPings: heartbeat.missedPings, status: newStatus },
      }).catch(console.error);
    }
  }
  
  /**
   * Get current heartbeat status for a broker
   */
  getHeartbeat(broker: string): BrokerHeartbeat | null {
    return this.heartbeats.get(broker) ?? null;
  }
  
  /**
   * Get all heartbeat statuses
   */
  getAllHeartbeats(): BrokerHeartbeat[] {
    return Array.from(this.heartbeats.values());
  }
  
  /**
   * Check if autonomy should be gated due to broker health
   * Returns true if any broker is DEGRADED or DISCONNECTED
   */
  shouldGateAutonomy(): { gated: boolean; reason: string | null } {
    for (const hb of this.heartbeats.values()) {
      if (hb.status === "DISCONNECTED") {
        return { gated: true, reason: `Broker ${hb.broker} is disconnected` };
      }
      if (hb.status === "DEGRADED") {
        return { gated: true, reason: `Broker ${hb.broker} is degraded (${hb.missedPings} missed pings)` };
      }
    }
    return { gated: false, reason: null };
  }
  
  /**
   * Stop all heartbeat monitoring
   */
  stop(): void {
    for (const interval of this.pingIntervals.values()) {
      clearInterval(interval);
    }
    this.pingIntervals.clear();
    
    for (const pending of this.pendingPings.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingPings.clear();
    
    this.isRunning = false;
    console.log("[BROKER_HEARTBEAT] stopped all monitoring");
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<BrokerHeartbeatConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[BROKER_HEARTBEAT] config updated: ping=${this.config.pingIntervalMs}ms timeout=${this.config.timeoutMs}ms`);
  }
}

export const brokerHeartbeatMonitor = new BrokerHeartbeatMonitor();
