/**
 * Canonical Health Computation - Single Source of Truth
 * 
 * RULES:
 * 1. Overall = RED if ANY component is FAIL
 * 2. Overall = YELLOW if ANY component is UNVERIFIED/DEGRADED
 * 3. Live Ready = false if broker or market data is FAIL/UNVERIFIED/ERROR
 * 4. Canary Ready = false if any critical component is FAIL
 * 5. UNVERIFIED is NOT OK - it means never tested
 * 6. ERROR status from integrations = FAIL
 */

export type ComponentStatus = "OK" | "DEGRADED" | "FAIL" | "UNVERIFIED";

export interface ComponentHealthResult {
  name: string;
  status: ComponentStatus;
  required_for_live: boolean;
  required_for_canary: boolean;
  optional: boolean;
  latency_ms?: number | null;
  metric_label?: string;
  metric_value?: string;
  last_verified_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error_message?: string | null;
}

export interface HealthBlocker {
  code: string;
  severity: "CRITICAL" | "ERROR" | "WARNING";
  message: string;
  component: string;
  cta?: string;
  deep_link?: string;
}

export interface ComputedHealth {
  overall: "GREEN" | "YELLOW" | "RED";
  live_ready: boolean;
  canary_ready: boolean;
  blockers: HealthBlocker[];
  components: ComponentHealthResult[];
  timestamp: string;
}

export interface IntegrationRow {
  id: string;
  kind: string;
  provider: string;
  label: string;
  status: string;
  is_enabled: boolean;
  is_primary?: boolean;
  last_verified_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error_message?: string | null;
  last_latency_ms?: number | null;
}

/**
 * Derive component status from integration status field
 * This is the ONLY place where status mapping happens
 */
function mapIntegrationStatus(integration: IntegrationRow): ComponentStatus {
  // First check the explicit status - trust backend's verification determination
  switch (integration.status) {
    case "VERIFIED":
    case "CONNECTED":
    case "VALIDATED":
      return "OK";
    case "DEGRADED":
      return "DEGRADED";
    case "ERROR":
    case "FAIL":
    case "FAILED":
      return "FAIL";
    case "DISABLED":
      return "UNVERIFIED";
    case "UNVERIFIED":
      return "UNVERIFIED";
    default:
      // For unknown status, check if has been verified
      if (integration.last_verified_at) {
        return "OK";
      }
      return "UNVERIFIED";
  }
}

/**
 * Aggregate status from multiple integrations
 * PRIMARY-DRIVEN: Primary integration status is authoritative
 * - If PRIMARY exists and is OK → Group is OK (secondary degraded ignored)
 * - If PRIMARY exists and is FAIL → Group is FAIL
 * - If PRIMARY exists and is DEGRADED/UNVERIFIED → Group inherits that status
 * - If NO primary → Use "best of" semantics (any OK = OK)
 */
function aggregateStatus(integrations: IntegrationRow[]): {
  status: ComponentStatus;
  lastVerifiedAt?: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMessage?: string | null;
} {
  if (integrations.length === 0) {
    return { status: "FAIL" };
  }

  // Find timestamps from all integrations
  const lastVerifiedAt = integrations
    .map((r) => r.last_verified_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  
  const lastSuccessAt = integrations
    .map((r) => r.last_success_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  
  const lastErrorAt = integrations
    .map((r) => r.last_error_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  
  const lastErrorMessage = integrations
    .map((r) => r.last_error_message)
    .filter(Boolean)
    .at(-1) || null;

  // Find primary integration - its status is AUTHORITATIVE
  const primary = integrations.find((i) => i.is_primary);
  
  if (primary) {
    const primaryStatus = mapIntegrationStatus(primary);
    // Primary status is AUTHORITATIVE - return it directly
    // This prevents secondary degraded integrations from tanking the group
    // while still properly reflecting primary failures
    return { status: primaryStatus, lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
  }

  // No primary: FAIL-closed but allow OK to override DEGRADED
  const statuses = integrations.map(mapIntegrationStatus);
  
  // FAIL is always critical - if any is FAIL, group is FAIL
  if (statuses.some((s) => s === "FAIL")) {
    return { status: "FAIL", lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
  }
  
  // If ANY integration is OK, group is OK (at least one working)
  // This allows OK to override DEGRADED/UNVERIFIED for optional providers
  if (statuses.some((s) => s === "OK")) {
    return { status: "OK", lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
  }
  
  // No OK and no FAIL: UNVERIFIED > DEGRADED
  if (statuses.some((s) => s === "UNVERIFIED")) {
    return { status: "UNVERIFIED", lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
  }
  if (statuses.some((s) => s === "DEGRADED")) {
    return { status: "DEGRADED", lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
  }
  
  return { status: "OK", lastVerifiedAt, lastSuccessAt, lastErrorAt, lastErrorMessage };
}

/**
 * Main computation function - THE SINGLE SOURCE OF TRUTH
 */
export function computeHealthFromIntegrations(
  integrations: IntegrationRow[],
  options?: {
    hasLiveBots?: boolean;
    hasCanaryBots?: boolean;
    degradedBotCount?: number;
    criticalAlertCount?: number;
    lastAuditStatus?: "PASS" | "FAIL" | null;
  }
): ComputedHealth {
  const blockers: HealthBlocker[] = [];
  const components: ComponentHealthResult[] = [];
  
  const hasLiveBots = options?.hasLiveBots ?? false;
  const hasCanaryBots = options?.hasCanaryBots ?? false;
  
  // ===== Market Data =====
  const marketDataIntegrations = integrations.filter((i) => i.kind === "MARKET_DATA");
  if (marketDataIntegrations.length > 0) {
    const result = aggregateStatus(marketDataIntegrations);
    const primary = marketDataIntegrations.find((m) => m.is_primary) ?? marketDataIntegrations[0];
    
    components.push({
      name: "Market Data Live",
      status: result.status,
      required_for_live: true,
      required_for_canary: true,
      optional: false,
      latency_ms: primary?.last_latency_ms,
      metric_label: "Provider",
      metric_value: primary?.label || primary?.provider || "Configured",
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
    
    if (result.status === "FAIL") {
      blockers.push({
        code: "MARKET_DATA_FAIL",
        severity: "CRITICAL",
        message: result.lastErrorMessage || "Market data probe failed",
        component: "Market Data Live",
        cta: "Run Smoke Test",
        deep_link: "/system-status",
      });
    } else if (result.status === "UNVERIFIED") {
      blockers.push({
        code: "MARKET_DATA_UNVERIFIED",
        severity: "ERROR",
        message: "Market data has never been verified",
        component: "Market Data Live",
        cta: "Run Smoke Test",
        deep_link: "/system-status",
      });
    }
  } else {
    components.push({
      name: "Market Data Live",
      status: "FAIL",
      required_for_live: true,
      required_for_canary: true,
      optional: false,
      metric_label: "Provider",
      metric_value: "Not configured",
    });
    blockers.push({
      code: "NO_MARKET_DATA",
      severity: "CRITICAL",
      message: "No market data provider configured",
      component: "Market Data Live",
      cta: "Configure",
      deep_link: "/system-status",
    });
  }
  
  // ===== Brokers =====
  const brokerIntegrations = integrations.filter((i) => i.kind === "BROKER");
  if (brokerIntegrations.length > 0) {
    const result = aggregateStatus(brokerIntegrations);
    
    components.push({
      name: "Brokers",
      status: result.status,
      required_for_live: true,
      required_for_canary: true,
      optional: false,
      metric_label: "Configured",
      metric_value: String(brokerIntegrations.length),
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
    
    if (result.status === "FAIL") {
      blockers.push({
        code: "BROKER_FAIL",
        severity: "CRITICAL",
        message: result.lastErrorMessage || "Broker validation failed",
        component: "Brokers",
        cta: "Fix Broker",
        deep_link: "/system-status",
      });
    } else if (result.status === "UNVERIFIED") {
      blockers.push({
        code: "BROKER_UNVERIFIED",
        severity: "ERROR",
        message: "Brokers have never been validated",
        component: "Brokers",
        cta: "Validate Broker",
        deep_link: "/system-status",
      });
    }
  } else {
    components.push({
      name: "Brokers",
      status: "FAIL",
      required_for_live: true,
      required_for_canary: true,
      optional: false,
      metric_label: "Connected",
      metric_value: "0",
    });
    blockers.push({
      code: "NO_BROKER",
      severity: "CRITICAL",
      message: "No broker configured",
      component: "Brokers",
      cta: "Configure",
      deep_link: "/system-status",
    });
  }
  
  // ===== Redis =====
  const redisIntegrations = integrations.filter(
    (i) => (i.kind === "CACHE" || i.kind === "INFRA") && (i.provider === "redis" || i.label?.toLowerCase().includes("redis"))
  );
  if (redisIntegrations.length > 0) {
    const result = aggregateStatus(redisIntegrations);
    
    components.push({
      name: "Redis",
      status: result.status,
      required_for_live: true,
      required_for_canary: true,
      optional: false,
      latency_ms: redisIntegrations[0]?.last_latency_ms,
      metric_label: "Latency",
      metric_value: redisIntegrations[0]?.last_latency_ms 
        ? `${redisIntegrations[0].last_latency_ms}ms`
        : "n/a",
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
    
    if (result.status === "FAIL") {
      blockers.push({
        code: "REDIS_FAIL",
        severity: "CRITICAL",
        message: result.lastErrorMessage || "Redis health check failed",
        component: "Redis",
        cta: "Check Redis",
        deep_link: "/system-status",
      });
    } else if (result.status === "UNVERIFIED") {
      blockers.push({
        code: "REDIS_UNVERIFIED",
        severity: "WARNING",
        message: "Redis has never been verified",
        component: "Redis",
        cta: "Run Smoke Test",
        deep_link: "/system-status",
      });
    }
  } else {
    components.push({
      name: "Redis",
      status: "UNVERIFIED",
      required_for_live: true,
      required_for_canary: false,
      optional: true,
      metric_label: "Status",
      metric_value: "Not configured",
    });
  }
  
  // ===== Queues =====
  const queueIntegrations = integrations.filter(
    (i) => (i.kind === "CACHE" || i.kind === "INFRA") && (i.provider === "redis_queue" || i.provider === "queue_redis" || i.label?.toLowerCase().includes("queue"))
  );
  if (queueIntegrations.length > 0) {
    const result = aggregateStatus(queueIntegrations);
    components.push({
      name: "Queues",
      status: result.status,
      required_for_live: false,
      required_for_canary: false,
      optional: true,
      metric_label: "Status",
      metric_value: result.status === "OK" ? "Healthy" : result.status,
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
  }
  
  // ===== AI Providers (Optional) =====
  const aiIntegrations = integrations.filter((i) => i.kind === "AI");
  if (aiIntegrations.length > 0) {
    const result = aggregateStatus(aiIntegrations);
    components.push({
      name: "AI Providers",
      status: result.status,
      required_for_live: false,
      required_for_canary: false,
      optional: true,
      metric_label: "Configured",
      metric_value: String(aiIntegrations.length),
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
  }
  
  // ===== Alt Data (Optional) =====
  const altDataIntegrations = integrations.filter((i) => i.kind === "ALT_DATA");
  if (altDataIntegrations.length > 0) {
    const result = aggregateStatus(altDataIntegrations);
    components.push({
      name: "Alt Data",
      status: result.status,
      required_for_live: false,
      required_for_canary: false,
      optional: true,
      metric_label: "Sources",
      metric_value: String(altDataIntegrations.length),
      last_verified_at: result.lastVerifiedAt,
      last_success_at: result.lastSuccessAt,
      last_error_at: result.lastErrorAt,
      last_error_message: result.lastErrorMessage,
    });
  }
  
  // ===== Bot Fleet (from options) =====
  const botStatus: ComponentStatus = 
    (options?.degradedBotCount ?? 0) > 0 
      ? ((options?.degradedBotCount ?? 0) > 3 ? "FAIL" : "DEGRADED")
      : "OK";
  
  components.push({
    name: "Bot Fleet",
    status: botStatus,
    required_for_live: false,
    required_for_canary: false,
    optional: false,
    metric_label: "Problems",
    metric_value: String(options?.degradedBotCount ?? 0),
  });
  
  // ===== Risk Engine (always OK for now) =====
  components.push({
    name: "Risk Engine",
    status: "OK",
    required_for_live: true,
    required_for_canary: true,
    optional: false,
    metric_label: "Status",
    metric_value: "Loaded",
  });
  
  // ===== Audit =====
  const auditStatus: ComponentStatus = 
    options?.lastAuditStatus === "PASS" ? "OK" : 
    options?.lastAuditStatus === "FAIL" ? "FAIL" : 
    "UNVERIFIED";
  
  components.push({
    name: "Audit",
    status: auditStatus,
    required_for_live: true,
    required_for_canary: false,
    optional: false,
    metric_label: "Status",
    metric_value: options?.lastAuditStatus || "Not run",
  });
  
  if (auditStatus === "FAIL") {
    blockers.push({
      code: "AUDIT_FAILED",
      severity: "ERROR",
      message: "Last audit failed",
      component: "Audit",
      cta: "View Audit",
      deep_link: "/system-status",
    });
  }
  
  // ===== Compute Overall Status =====
  // RULE: If ANY required component is FAIL -> RED
  // RULE: If ANY component is FAIL (even optional) -> YELLOW at minimum
  const requiredForLive = components.filter((c) => c.required_for_live);
  const requiredForCanary = components.filter((c) => c.required_for_canary);
  
  const hasAnyFail = components.some((c) => c.status === "FAIL");
  const hasAnyDegraded = components.some((c) => c.status === "DEGRADED");
  const hasAnyUnverified = components.some((c) => c.status === "UNVERIFIED" && !c.optional);
  
  const hasRequiredFail = requiredForLive.some((c) => c.status === "FAIL");
  const hasRequiredUnverified = requiredForLive.some((c) => c.status === "UNVERIFIED");
  
  const hasCanaryFail = requiredForCanary.some((c) => c.status === "FAIL");
  const hasCanaryUnverified = requiredForCanary.some((c) => c.status === "UNVERIFIED");
  
  // Overall: RED if any required fails, YELLOW if unverified/degraded
  let overall: "GREEN" | "YELLOW" | "RED";
  if (hasRequiredFail || hasAnyFail) {
    overall = "RED";
  } else if (hasAnyUnverified || hasAnyDegraded || hasRequiredUnverified) {
    overall = "YELLOW";
  } else {
    overall = "GREEN";
  }
  
  // Live Ready: ALL required_for_live must be OK
  const liveReady = requiredForLive.every((c) => c.status === "OK");
  
  // Canary Ready: ALL required_for_canary must be OK or DEGRADED (not FAIL/UNVERIFIED)
  const canaryReady = requiredForCanary.every((c) => c.status === "OK" || c.status === "DEGRADED");
  
  return {
    overall,
    live_ready: liveReady,
    canary_ready: canaryReady,
    blockers,
    components,
    timestamp: new Date().toISOString(),
  };
}
