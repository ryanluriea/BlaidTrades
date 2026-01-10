/**
 * Governance Approval Engine - Maker-Checker Dual Approval Workflow
 * 
 * Institutional-grade dual-control approval process for CANARY → LIVE promotions.
 * Ensures no single actor can move a bot to LIVE without independent verification.
 * 
 * Key Features:
 * - Dual control: Approver must be different from requester
 * - Time-bound: Requests expire after 24 hours
 * - Audit trail: Full logging of all governance decisions
 * - Integration: Triggers promotion-engine.ts on approval
 */

import { db } from "./db";
import { governanceApprovals, bots } from "@shared/schema";
import type { GovernanceApproval, InsertGovernanceApproval, Bot } from "@shared/schema";
import { eq, and, isNull, gt, lt, or } from "drizzle-orm";
import { storage } from "./storage";
import { executePromotion, evaluateBotForPromotion } from "./promotion-engine";
import { logActivityEvent } from "./activity-logger";

const APPROVAL_EXPIRY_HOURS = 24;

export type GovernanceStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "WITHDRAWN";

export interface GovernanceRequestResult {
  success: boolean;
  requestId: string | null;
  error?: string;
}

export interface GovernanceApprovalResult {
  success: boolean;
  requestId: string;
  botId: string;
  fromStage: string;
  toStage: string;
  promotionResult?: {
    stageChangeId: string | null;
    activityEventId: string | null;
  };
  error?: string;
}

export interface GovernanceRejectResult {
  success: boolean;
  requestId: string;
  error?: string;
}

export interface PendingApprovalRequest {
  id: string;
  botId: string;
  botName: string;
  fromStage: string;
  toStage: string;
  requestedBy: string | null;
  requestedAt: Date | null;
  requestReason: string | null;
  expiresAt: Date | null;
  metricsSnapshot: Record<string, any>;
}

/**
 * Request Governance Approval for CANARY → LIVE promotion
 * Creates a pending approval request that requires a different user to approve
 */
export async function requestGovernanceApproval(
  botId: string,
  requestedBy: string,
  justification: string
): Promise<GovernanceRequestResult> {
  try {
    const bot = await storage.getBot(botId);
    
    if (!bot) {
      return {
        success: false,
        requestId: null,
        error: "Bot not found",
      };
    }
    
    const currentStage = (bot.stage || "TRIALS").toUpperCase();
    
    if (currentStage !== "CANARY") {
      return {
        success: false,
        requestId: null,
        error: `Bot must be in CANARY stage to request LIVE promotion. Current stage: ${currentStage}`,
      };
    }
    
    if (bot.archivedAt || bot.killedAt) {
      return {
        success: false,
        requestId: null,
        error: "Cannot request promotion for archived or killed bot",
      };
    }
    
    const existingPending = await db
      .select()
      .from(governanceApprovals)
      .where(
        and(
          eq(governanceApprovals.botId, botId),
          eq(governanceApprovals.status, "PENDING"),
          or(
            isNull(governanceApprovals.expiresAt),
            gt(governanceApprovals.expiresAt, new Date())
          )
        )
      )
      .limit(1);
    
    if (existingPending.length > 0) {
      return {
        success: false,
        requestId: existingPending[0].id,
        error: "A pending approval request already exists for this bot",
      };
    }
    
    const promotionEval = await evaluateBotForPromotion(botId);
    const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000);
    
    const approvalData: InsertGovernanceApproval = {
      botId,
      requestedAction: "PROMOTE_TO_LIVE",
      fromStage: currentStage,
      toStage: "LIVE",
      requestedBy,
      requestReason: justification,
      status: "PENDING",
      expiresAt,
      metricsSnapshot: promotionEval.metrics as Record<string, any>,
      gatesSnapshot: { blockers: promotionEval.blockers, eligible: promotionEval.eligible },
      riskAssessment: {},
    };
    
    const created = await storage.createGovernanceApproval(approvalData);
    
    await logActivityEvent({
      userId: requestedBy,
      botId,
      eventType: "AUTONOMY_GATE_BLOCKED",
      severity: "INFO",
      title: `LIVE promotion requested for ${bot.name}`,
      summary: `Governance approval requested: ${justification}`,
      payload: {
        requestId: created.id,
        fromStage: currentStage,
        toStage: "LIVE",
        expiresAt: expiresAt.toISOString(),
        metrics: promotionEval.metrics,
      },
      stage: "CANARY",
    });
    
    console.log(`[GOVERNANCE] Approval request created: ${created.id} for bot ${bot.name} (${botId})`);
    
    return {
      success: true,
      requestId: created.id,
    };
  } catch (error) {
    console.error(`[GOVERNANCE] Failed to create approval request:`, error);
    return {
      success: false,
      requestId: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Approve Governance Request - Dual Control Enforcement
 * Validates that approver is different from requester before executing promotion
 */
export async function approveGovernanceRequest(
  requestId: string,
  approverId: string
): Promise<GovernanceApprovalResult> {
  try {
    const request = await storage.getGovernanceApproval(requestId);
    
    if (!request) {
      return {
        success: false,
        requestId,
        botId: "",
        fromStage: "",
        toStage: "",
        error: "Approval request not found",
      };
    }
    
    if (request.status !== "PENDING") {
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: `Request is not pending. Current status: ${request.status}`,
      };
    }
    
    if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
      await storage.updateGovernanceApproval(requestId, {
        status: "EXPIRED",
        reviewedAt: new Date(),
        reviewNotes: "Request expired before approval",
      });
      
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: "Request has expired",
      };
    }
    
    if (request.requestedBy === approverId) {
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: "Dual control violation: Approver cannot be the same as requester",
      };
    }
    
    const bot = await storage.getBot(request.botId);
    if (!bot) {
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: "Bot no longer exists",
      };
    }
    
    const currentStage = (bot.stage || "TRIALS").toUpperCase();
    if (currentStage !== request.fromStage) {
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: `Bot stage has changed since request. Expected: ${request.fromStage}, Current: ${currentStage}`,
      };
    }
    
    await storage.updateGovernanceApproval(requestId, {
      status: "APPROVED",
      reviewedBy: approverId,
      reviewedAt: new Date(),
      reviewNotes: "Approved via governance workflow",
    });
    
    const promotionResult = await executePromotion(
      request.botId,
      request.toStage,
      approverId,
      "manual"
    );
    
    if (!promotionResult.success) {
      await storage.updateGovernanceApproval(requestId, {
        status: "PENDING",
        reviewedBy: undefined,
        reviewedAt: undefined,
        reviewNotes: `Promotion failed: ${promotionResult.error}`,
      });
      
      return {
        success: false,
        requestId,
        botId: request.botId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        error: `Promotion execution failed: ${promotionResult.error}`,
      };
    }
    
    await logActivityEvent({
      userId: approverId,
      botId: request.botId,
      eventType: "PROMOTED",
      severity: "SUCCESS",
      title: `${bot.name} promoted to LIVE via governance approval`,
      summary: `Approved by ${approverId}, requested by ${request.requestedBy}`,
      payload: {
        requestId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        requestedBy: request.requestedBy,
        approvedBy: approverId,
        stageChangeId: promotionResult.stageChangeId,
      },
      stage: "LIVE",
    });
    
    console.log(`[GOVERNANCE] Request ${requestId} APPROVED by ${approverId} - Bot ${bot.name} promoted to LIVE`);
    
    return {
      success: true,
      requestId,
      botId: request.botId,
      fromStage: request.fromStage,
      toStage: request.toStage,
      promotionResult: {
        stageChangeId: promotionResult.stageChangeId,
        activityEventId: promotionResult.activityEventId,
      },
    };
  } catch (error) {
    console.error(`[GOVERNANCE] Failed to approve request ${requestId}:`, error);
    return {
      success: false,
      requestId,
      botId: "",
      fromStage: "",
      toStage: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Reject Governance Request
 * Marks the request as rejected with reason and logs the decision
 */
export async function rejectGovernanceRequest(
  requestId: string,
  rejecterId: string,
  reason: string
): Promise<GovernanceRejectResult> {
  try {
    const request = await storage.getGovernanceApproval(requestId);
    
    if (!request) {
      return {
        success: false,
        requestId,
        error: "Approval request not found",
      };
    }
    
    if (request.status !== "PENDING") {
      return {
        success: false,
        requestId,
        error: `Request is not pending. Current status: ${request.status}`,
      };
    }
    
    await storage.updateGovernanceApproval(requestId, {
      status: "REJECTED",
      reviewedBy: rejecterId,
      reviewedAt: new Date(),
      reviewNotes: reason,
    });
    
    const bot = await storage.getBot(request.botId);
    const botName = bot?.name || request.botId;
    
    await logActivityEvent({
      userId: rejecterId,
      botId: request.botId,
      eventType: "AUTONOMY_GATE_BLOCKED",
      severity: "WARN",
      title: `LIVE promotion rejected for ${botName}`,
      summary: `Rejected by ${rejecterId}: ${reason}`,
      payload: {
        requestId,
        fromStage: request.fromStage,
        toStage: request.toStage,
        requestedBy: request.requestedBy,
        rejectedBy: rejecterId,
        reason,
      },
      stage: request.fromStage,
    });
    
    console.log(`[GOVERNANCE] Request ${requestId} REJECTED by ${rejecterId}: ${reason}`);
    
    return {
      success: true,
      requestId,
    };
  } catch (error) {
    console.error(`[GOVERNANCE] Failed to reject request ${requestId}:`, error);
    return {
      success: false,
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get Pending Approval Requests
 * Returns all PENDING requests with bot details for the approval dashboard
 */
export async function getPendingApprovalRequests(userId?: string): Promise<PendingApprovalRequest[]> {
  try {
    const pendingApprovals = await storage.getPendingGovernanceApprovals(userId);
    
    const results: PendingApprovalRequest[] = [];
    
    for (const approval of pendingApprovals) {
      const bot = await storage.getBot(approval.botId);
      
      results.push({
        id: approval.id,
        botId: approval.botId,
        botName: bot?.name || "Unknown Bot",
        fromStage: approval.fromStage,
        toStage: approval.toStage,
        requestedBy: approval.requestedBy,
        requestedAt: approval.requestedAt,
        requestReason: approval.requestReason,
        expiresAt: approval.expiresAt,
        metricsSnapshot: (approval.metricsSnapshot || {}) as Record<string, any>,
      });
    }
    
    return results;
  } catch (error) {
    console.error(`[GOVERNANCE] Failed to get pending approvals:`, error);
    return [];
  }
}

/**
 * Expire Stale Requests Worker
 * Marks requests older than 24 hours as EXPIRED
 * Should be called by the scheduler periodically
 */
export async function expireStaleRequests(): Promise<{
  expired: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let expiredCount = 0;
  
  try {
    const now = new Date();
    
    const staleRequests = await db
      .select()
      .from(governanceApprovals)
      .where(
        and(
          eq(governanceApprovals.status, "PENDING"),
          lt(governanceApprovals.expiresAt, now)
        )
      );
    
    for (const request of staleRequests) {
      try {
        await storage.updateGovernanceApproval(request.id, {
          status: "EXPIRED",
          reviewedAt: now,
          reviewNotes: "Request expired due to inactivity",
        });
        
        await logActivityEvent({
          botId: request.botId,
          eventType: "AUTONOMY_GATE_BLOCKED",
          severity: "WARN",
          title: `Governance approval request expired`,
          summary: `Request ${request.id} expired after ${APPROVAL_EXPIRY_HOURS} hours`,
          payload: {
            requestId: request.id,
            fromStage: request.fromStage,
            toStage: request.toStage,
            requestedBy: request.requestedBy,
            expiresAt: request.expiresAt,
          },
          stage: request.fromStage,
        });
        
        expiredCount++;
        console.log(`[GOVERNANCE] Expired stale request ${request.id}`);
      } catch (err) {
        const errorMsg = `Failed to expire request ${request.id}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[GOVERNANCE] ${errorMsg}`);
      }
    }
    
    if (expiredCount > 0) {
      console.log(`[GOVERNANCE] Expiration worker completed: ${expiredCount} requests expired`);
    }
    
    return { expired: expiredCount, errors };
  } catch (error) {
    const errorMsg = `Expiration worker failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    errors.push(errorMsg);
    console.error(`[GOVERNANCE] ${errorMsg}`);
    return { expired: 0, errors };
  }
}

/**
 * Withdraw a pending governance request
 * Only the original requester can withdraw their request
 */
export async function withdrawGovernanceRequest(
  requestId: string,
  userId: string
): Promise<GovernanceRejectResult> {
  try {
    const request = await storage.getGovernanceApproval(requestId);
    
    if (!request) {
      return {
        success: false,
        requestId,
        error: "Approval request not found",
      };
    }
    
    if (request.status !== "PENDING") {
      return {
        success: false,
        requestId,
        error: `Request is not pending. Current status: ${request.status}`,
      };
    }
    
    if (request.requestedBy !== userId) {
      return {
        success: false,
        requestId,
        error: "Only the original requester can withdraw this request",
      };
    }
    
    await storage.updateGovernanceApproval(requestId, {
      status: "WITHDRAWN",
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewNotes: "Withdrawn by requester",
    });
    
    console.log(`[GOVERNANCE] Request ${requestId} WITHDRAWN by ${userId}`);
    
    return {
      success: true,
      requestId,
    };
  } catch (error) {
    console.error(`[GOVERNANCE] Failed to withdraw request ${requestId}:`, error);
    return {
      success: false,
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get governance approval history for a bot
 */
export async function getGovernanceHistory(
  botId: string,
  limit: number = 20
): Promise<GovernanceApproval[]> {
  return storage.getGovernanceApprovalsByBot(botId, limit);
}
