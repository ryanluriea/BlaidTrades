/**
 * Discord Webhook Notifications Provider
 * Canonical notifications channel via Discord webhooks
 * Single control plane compliant - no Supabase Edge Functions
 */

export type DiscordChannel = "ops" | "trading" | "autonomy" | "alerts" | "lab" | "audit";
export type NotificationSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL" | "SUCCESS";

const CHANNEL_ENV_MAP: Record<DiscordChannel, string> = {
  ops: "DISCORD_WEBHOOK_OPS",
  trading: "DISCORD_WEBHOOK_TRADING",
  autonomy: "DISCORD_WEBHOOK_AUTONOMY",
  alerts: "DISCORD_WEBHOOK_ALERTS",
  lab: "DISCORD_WEBHOOK_LAB",
  audit: "DISCORD_WEBHOOK_AUDIT",
};

const REQUIRED_CHANNELS: DiscordChannel[] = ["ops"];
const OPTIONAL_CHANNELS: DiscordChannel[] = ["trading", "autonomy", "alerts", "lab", "audit"];

const SEVERITY_COLORS: Record<NotificationSeverity, number> = {
  INFO: 0x3498db,
  WARN: 0xf39c12,
  ERROR: 0xe74c3c,
  CRITICAL: 0x8e44ad,
  SUCCESS: 0x2ecc71,
};

const SEVERITY_EMOJI: Record<NotificationSeverity, string> = {
  INFO: "",
  WARN: "",
  ERROR: "",
  CRITICAL: "",
  SUCCESS: "",
};

export interface DiscordConfigStatus {
  configured: boolean;
  missing: string[];
  suggestedFix: string;
  channels: Record<DiscordChannel, boolean>;
}

export interface SendDiscordParams {
  channel: DiscordChannel;
  title: string;
  message: string;
  severity: NotificationSeverity;
  metadata?: Record<string, any>;
  correlationId: string;
}

export interface SendDiscordResult {
  success: boolean;
  deliveryId?: string;
  error?: string;
  errorCode?: string;
  latencyMs?: number;
}

function generateDeliveryId(): string {
  return `discord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getWebhookUrl(channel: DiscordChannel): string | undefined {
  const envVar = CHANNEL_ENV_MAP[channel];
  return process.env[envVar];
}

function sanitizeMessage(msg: string, maxLength: number = 1900): string {
  let sanitized = msg
    .replace(/https?:\/\/discord\.com\/api\/webhooks\/[^\s]+/gi, "[WEBHOOK_REDACTED]")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[API_KEY_REDACTED]")
    .replace(/\b[A-Za-z0-9+/=]{40,}\b/g, "[TOKEN_REDACTED]");
  
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength - 3) + "...";
  }
  
  return sanitized;
}

export function verifyDiscordConfig(): DiscordConfigStatus {
  const channels: Record<DiscordChannel, boolean> = {} as Record<DiscordChannel, boolean>;
  const missing: string[] = [];
  
  for (const channel of Object.keys(CHANNEL_ENV_MAP) as DiscordChannel[]) {
    const envVar = CHANNEL_ENV_MAP[channel];
    const isConfigured = !!process.env[envVar];
    channels[channel] = isConfigured;
    
    if (REQUIRED_CHANNELS.includes(channel) && !isConfigured) {
      missing.push(envVar);
    }
  }
  
  const configured = missing.length === 0;
  
  return {
    configured,
    missing,
    suggestedFix: configured 
      ? "" 
      : `Add the following required webhook URLs in Replit Secrets: ${missing.join(", ")}`,
    channels,
  };
}

export function getChannelStatus(channel: DiscordChannel): {
  configured: boolean;
  envVar: string;
} {
  const envVar = CHANNEL_ENV_MAP[channel];
  return {
    configured: !!process.env[envVar],
    envVar,
  };
}

export async function sendDiscord(params: SendDiscordParams): Promise<SendDiscordResult> {
  const { channel, title, message, severity, metadata, correlationId } = params;
  const startTime = Date.now();
  const deliveryId = generateDeliveryId();
  
  const webhookUrl = getWebhookUrl(channel);
  if (!webhookUrl) {
    const envVar = CHANNEL_ENV_MAP[channel];
    console.warn(`[DISCORD] trace_id=${correlationId} channel=${channel} status=not_configured missing=${envVar}`);
    return {
      success: false,
      error: `Discord webhook not configured for channel: ${channel}`,
      errorCode: "INTEGRATION_KEY_MISSING",
    };
  }
  
  const sanitizedTitle = sanitizeMessage(title, 256);
  const sanitizedMessage = sanitizeMessage(message, 1900);
  
  const embed = {
    title: `${SEVERITY_EMOJI[severity]} ${sanitizedTitle}`,
    description: sanitizedMessage,
    color: SEVERITY_COLORS[severity],
    timestamp: new Date().toISOString(),
    footer: {
      text: `BlaidAgent | ${channel.toUpperCase()} | trace: ${correlationId.substring(0, 8)}`,
    },
    fields: [] as Array<{ name: string; value: string; inline: boolean }>,
  };
  
  if (metadata) {
    const safeMetadata = Object.entries(metadata)
      .filter(([key]) => !key.toLowerCase().includes("secret") && !key.toLowerCase().includes("token"))
      .slice(0, 5);
    
    for (const [key, value] of safeMetadata) {
      embed.fields.push({
        name: key,
        value: String(value).substring(0, 100),
        inline: true,
      });
    }
  }
  
  const payload = {
    username: "BlaidAgent",
    embeds: [embed],
  };
  
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[DISCORD] trace_id=${correlationId} channel=${channel} status=failed http=${response.status} latency_ms=${latencyMs}`);
      return {
        success: false,
        error: `Discord API error: ${response.status}`,
        errorCode: "DISCORD_API_ERROR",
        latencyMs,
      };
    }
    
    console.log(`[DISCORD] trace_id=${correlationId} channel=${channel} status=success deliveryId=${deliveryId} severity=${severity} latency_ms=${latencyMs}`);
    
    return {
      success: true,
      deliveryId,
      latencyMs,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error.message || "Unknown error";
    
    console.error(`[DISCORD] trace_id=${correlationId} channel=${channel} status=exception error=${errorMessage} latency_ms=${latencyMs}`);
    
    return {
      success: false,
      error: errorMessage,
      errorCode: "NETWORK_ERROR",
      latencyMs,
    };
  }
}

export async function verifyDiscordConnection(channel: DiscordChannel, traceId: string): Promise<{
  connected: boolean;
  error?: string;
  errorCode?: string;
}> {
  const webhookUrl = getWebhookUrl(channel);
  if (!webhookUrl) {
    return {
      connected: false,
      error: `Webhook not configured for channel: ${channel}`,
      errorCode: "INTEGRATION_KEY_MISSING",
    };
  }
  
  try {
    const response = await fetch(webhookUrl, {
      method: "GET",
    });
    
    if (response.ok) {
      console.log(`[DISCORD_VERIFY] trace_id=${traceId} channel=${channel} status=connected`);
      return { connected: true };
    }
    
    if (response.status === 401 || response.status === 403) {
      console.warn(`[DISCORD_VERIFY] trace_id=${traceId} channel=${channel} status=invalid_webhook`);
      return {
        connected: false,
        error: "Invalid webhook URL or permissions",
        errorCode: "INVALID_WEBHOOK",
      };
    }
    
    return {
      connected: false,
      error: `Discord API returned ${response.status}`,
      errorCode: "DISCORD_API_ERROR",
    };
  } catch (error: any) {
    console.error(`[DISCORD_VERIFY] trace_id=${traceId} channel=${channel} status=failed error=${error.message}`);
    return {
      connected: false,
      error: error.message,
      errorCode: "NETWORK_ERROR",
    };
  }
}

export const DISCORD_PROVIDER_INFO = {
  id: "discord",
  category: "notifications" as const,
  displayName: "Discord",
  requiredEnvVars: REQUIRED_CHANNELS.map(c => CHANNEL_ENV_MAP[c]),
  optionalEnvVars: OPTIONAL_CHANNELS.map(c => CHANNEL_ENV_MAP[c]),
  supportsVerify: true,
  supportsProofOfUse: true,
  description: "Discord webhooks for ops alerts, trading notifications, and autonomy events",
};

export const VALID_CHANNELS = Object.keys(CHANNEL_ENV_MAP) as DiscordChannel[];
export const VALID_SEVERITIES: NotificationSeverity[] = ["INFO", "WARN", "ERROR", "CRITICAL"];
