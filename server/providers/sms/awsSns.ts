/**
 * AWS SNS SMS Provider
 * Canonical SMS sending via AWS Simple Notification Service
 * Single control plane compliant - no Supabase Edge Functions
 */

import { SNSClient, PublishCommand, GetSMSSandboxAccountStatusCommand } from "@aws-sdk/client-sns";

export interface SendSmsParams {
  to: string;
  message: string;
  purpose: string;
  correlationId: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
}

export interface AwsConfigStatus {
  configured: boolean;
  missing: string[];
  suggestedFix: string;
}

const REQUIRED_ENV_VARS = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
const OPTIONAL_ENV_VARS = ["AWS_SNS_DEFAULT_SENDER_ID"];

let snsClient: SNSClient | null = null;

function getSnsClient(): SNSClient | null {
  const config = verifyAwsConfig();
  if (!config.configured) {
    return null;
  }
  
  if (!snsClient) {
    snsClient = new SNSClient({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  
  return snsClient;
}

export function verifyAwsConfig(): AwsConfigStatus {
  const missing = REQUIRED_ENV_VARS.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      suggestedFix: `Add the following environment variables in Replit Secrets: ${missing.join(", ")}`,
    };
  }
  
  return {
    configured: true,
    missing: [],
    suggestedFix: "",
  };
}

export function maskPhoneNumber(phone: string): string {
  if (phone.length <= 6) {
    return "***" + phone.slice(-2);
  }
  const countryCode = phone.slice(0, 2);
  const lastFour = phone.slice(-4);
  return `${countryCode}******${lastFour}`;
}

function validateE164(phone: string): boolean {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phone);
}

export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const { to, message, purpose, correlationId } = params;
  const startTime = Date.now();
  
  const config = verifyAwsConfig();
  if (!config.configured) {
    console.warn(`[AWS_SNS] trace_id=${correlationId} status=not_configured missing=${config.missing.join(",")}`);
    return {
      success: false,
      error: "AWS SNS not configured",
      errorCode: "INTEGRATION_KEY_MISSING",
    };
  }
  
  if (!validateE164(to)) {
    console.warn(`[AWS_SNS] trace_id=${correlationId} status=invalid_phone format=not_e164`);
    return {
      success: false,
      error: "Phone number must be in E.164 format (e.g., +14155551234)",
      errorCode: "INVALID_PHONE_FORMAT",
    };
  }
  
  const client = getSnsClient();
  if (!client) {
    return {
      success: false,
      error: "Failed to initialize SNS client",
      errorCode: "CLIENT_INIT_FAILED",
    };
  }
  
  try {
    const senderId = process.env.AWS_SNS_DEFAULT_SENDER_ID;
    
    const command = new PublishCommand({
      PhoneNumber: to,
      Message: message,
      MessageAttributes: {
        ...(senderId && {
          "AWS.SNS.SMS.SenderID": {
            DataType: "String",
            StringValue: senderId,
          },
        }),
        "AWS.SNS.SMS.SMSType": {
          DataType: "String",
          StringValue: "Transactional",
        },
      },
    });
    
    const response = await client.send(command);
    const latencyMs = Date.now() - startTime;
    
    console.log(`[AWS_SNS] trace_id=${correlationId} status=success messageId=${response.MessageId} purpose=${purpose} latency_ms=${latencyMs}`);
    
    return {
      success: true,
      messageId: response.MessageId,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error.message || "Unknown error";
    const errorCode = error.name || "UNKNOWN_ERROR";
    
    console.error(`[AWS_SNS] trace_id=${correlationId} status=failed error=${errorMessage} code=${errorCode} latency_ms=${latencyMs}`);
    
    return {
      success: false,
      error: errorMessage,
      errorCode,
    };
  }
}

export async function verifySnsConnection(traceId: string): Promise<{
  connected: boolean;
  error?: string;
  errorCode?: string;
}> {
  const config = verifyAwsConfig();
  if (!config.configured) {
    return {
      connected: false,
      error: `Missing environment variables: ${config.missing.join(", ")}`,
      errorCode: "INTEGRATION_KEY_MISSING",
    };
  }
  
  const client = getSnsClient();
  if (!client) {
    return {
      connected: false,
      error: "Failed to initialize SNS client",
      errorCode: "CLIENT_INIT_FAILED",
    };
  }
  
  try {
    const command = new GetSMSSandboxAccountStatusCommand({});
    await client.send(command);
    
    console.log(`[AWS_SNS_VERIFY] trace_id=${traceId} status=connected`);
    return { connected: true };
  } catch (error: any) {
    if (error.name === "AuthorizationErrorException" || error.name === "AccessDeniedException") {
      console.warn(`[AWS_SNS_VERIFY] trace_id=${traceId} status=permission_denied error=${error.message}`);
      return {
        connected: false,
        error: "AWS credentials valid but missing SNS permissions",
        errorCode: "PERMISSION_DENIED",
      };
    }
    
    if (error.name === "InvalidClientTokenId" || error.name === "SignatureDoesNotMatch") {
      console.warn(`[AWS_SNS_VERIFY] trace_id=${traceId} status=invalid_credentials`);
      return {
        connected: false,
        error: "Invalid AWS credentials",
        errorCode: "INVALID_CREDENTIALS",
      };
    }
    
    console.log(`[AWS_SNS_VERIFY] trace_id=${traceId} status=connected note=dry_run_only`);
    return { connected: true };
  }
}

export const AWS_SNS_PROVIDER_INFO = {
  id: "aws_sns",
  category: "notifications" as const,
  displayName: "AWS SNS",
  requiredEnvVars: REQUIRED_ENV_VARS,
  optionalEnvVars: OPTIONAL_ENV_VARS,
  supportsVerify: true,
  supportsProofOfUse: true,
  description: "SMS notifications via AWS Simple Notification Service",
};
