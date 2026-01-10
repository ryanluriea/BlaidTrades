/**
 * Research Monitor WebSocket Server
 * 
 * INSTITUTIONAL-GRADE AI Research Transparency Layer
 * 
 * Provides complete audit trail of all AI research activities including:
 * - Search queries and API calls
 * - Source analysis with credibility scoring
 * - Idea discovery with confidence levels
 * - Strategy candidate creation with full reasoning
 * - Cost tracking and token usage
 * - Phase progression and timing metrics
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

// Extended event types for institutional-grade transparency
export type ResearchEventType = 
  | "search"           // API query initiated
  | "source"           // Source/citation discovered
  | "idea"             // Trading idea/hypothesis generated
  | "candidate"        // Strategy candidate created
  | "error"            // Error occurred
  | "system"           // System message
  | "analysis"         // Analysis in progress
  | "reasoning"        // AI reasoning chain exposed
  | "validation"       // Validation check performed
  | "cost"             // Cost/token tracking event
  | "phase"            // Research phase transition
  | "scoring"          // Confidence scoring event
  | "rejection"        // Candidate rejected with reason
  | "api_call"         // Raw API call details
  | "action_required"; // User action needed (self-healing failed)

export type ResearchSource = "perplexity" | "grok" | "openai" | "anthropic" | "groq" | "gemini" | "system";

export interface ResearchEvent {
  id: string;
  timestamp: number;
  eventType: ResearchEventType;
  source: ResearchSource;
  title: string;
  details?: string;
  metadata?: {
    // Common fields
    traceId?: string;
    phase?: string;
    durationMs?: number;
    
    // Provider info
    provider?: string;
    model?: string;
    
    // Token/cost tracking
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    
    // Confidence/scoring
    confidence?: number;
    confidenceBreakdown?: Record<string, number>;
    
    // Strategy details
    strategyName?: string;
    archetype?: string;
    symbol?: string;
    symbols?: string[];
    
    // Research context
    depth?: string;
    regime?: string;
    trigger?: string;
    
    // Reasoning/evidence
    reasoning?: string;
    sources?: Array<{ type: string; label: string; detail: string }>;
    hypothesis?: string;
    
    // Validation
    validationResult?: "PASS" | "FAIL" | "WARN";
    validationReason?: string;
    
    // Rejection
    rejectionReason?: string;
    
    // URLs/citations
    url?: string;
    citations?: string[];
    
    // Arbitrary extra data
    [key: string]: any;
  };
}

interface ClientState {
  ws: WebSocket;
  connectedAt: number;
}

interface ResearchPhase {
  name: string;
  startTime: number;
  source: ResearchSource;
  traceId: string;
}

class ResearchMonitorWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private eventBuffer: ResearchEvent[] = [];
  private readonly MAX_BUFFER_SIZE = 200; // Increased for richer history
  private activePhases: Map<string, ResearchPhase> = new Map();
  
  // Statistics tracking
  private stats = {
    totalEvents: 0,
    searchCount: 0,
    candidatesCreated: 0,
    errorsLogged: 0,
    totalCostUsd: 0,
    totalTokens: 0,
  };

  initialize(server: Server): void {
    if (this.wss) {
      console.log("[RESEARCH_WS] Already initialized");
      return;
    }

    // Use noServer mode to manually handle upgrade events
    // This ensures WebSocket upgrade happens BEFORE Express can intercept the request
    this.wss = new WebSocketServer({ 
      noServer: true,
      // Disable per-message deflate compression for Replit proxy compatibility
      perMessageDeflate: false
    });
    
    // Manually handle HTTP upgrade event for /ws/research-monitor path
    server.on("upgrade", (request, socket, head) => {
      const pathname = request.url || "";
      if (pathname === "/ws/research-monitor" || pathname.startsWith("/ws/research-monitor?")) {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit("connection", ws, request);
        });
      }
      // Other paths will be handled by other upgrade handlers (e.g., live-pnl)
    });

    this.wss.on("connection", (ws: WebSocket) => {
      const clientState: ClientState = {
        ws,
        connectedAt: Date.now(),
      };
      
      this.clients.set(ws, clientState);
      console.log(`[RESEARCH_WS] Client connected. Total: ${this.clients.size}`);

      ws.send(JSON.stringify({
        type: "connected",
        timestamp: Date.now(),
        message: "Research Monitor connected",
        recentEvents: this.eventBuffer.slice(-50),
        stats: this.stats,
      }));

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[RESEARCH_WS] Client disconnected. Total: ${this.clients.size}`);
      });

      ws.on("error", (error) => {
        console.error("[RESEARCH_WS] Client error:", error);
        this.clients.delete(ws);
      });
    });

    console.log("[RESEARCH_WS] Research Monitor WebSocket initialized at /ws/research-monitor");
  }

  private broadcast(event: Omit<ResearchEvent, "id" | "timestamp">): void {
    if (!this.wss) {
      return;
    }
    
    const fullEvent: ResearchEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };

    this.eventBuffer.push(fullEvent);
    if (this.eventBuffer.length > this.MAX_BUFFER_SIZE) {
      this.eventBuffer = this.eventBuffer.slice(-this.MAX_BUFFER_SIZE);
    }

    // Update stats
    this.stats.totalEvents++;
    if (event.eventType === "search") this.stats.searchCount++;
    if (event.eventType === "candidate") this.stats.candidatesCreated++;
    if (event.eventType === "error") this.stats.errorsLogged++;
    if (event.metadata?.costUsd) this.stats.totalCostUsd += event.metadata.costUsd;
    if (event.metadata?.inputTokens) this.stats.totalTokens += event.metadata.inputTokens;
    if (event.metadata?.outputTokens) this.stats.totalTokens += event.metadata.outputTokens;

    const message = JSON.stringify({
      type: "research_event",
      ...fullEvent,
    });

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          console.error("[RESEARCH_WS] Failed to send to client:", error);
        }
      }
    });
  }

  // ============================================================
  // PHASE MANAGEMENT - Track research lifecycle
  // ============================================================
  
  startPhase(source: ResearchSource, phaseName: string, traceId: string, metadata?: Record<string, any>): void {
    const phaseKey = `${source}-${traceId}`;
    this.activePhases.set(phaseKey, {
      name: phaseName,
      startTime: Date.now(),
      source,
      traceId,
    });
    
    this.broadcast({
      eventType: "phase",
      source,
      title: `Phase Started: ${phaseName}`,
      details: `Beginning ${phaseName} phase`,
      metadata: { ...metadata, phase: phaseName, traceId },
    });
  }
  
  endPhase(source: ResearchSource, phaseName: string, traceId: string, result?: string): void {
    const phaseKey = `${source}-${traceId}`;
    const phase = this.activePhases.get(phaseKey);
    const durationMs = phase ? Date.now() - phase.startTime : 0;
    this.activePhases.delete(phaseKey);
    
    this.broadcast({
      eventType: "phase",
      source,
      title: `Phase Complete: ${phaseName}`,
      details: result || `Completed ${phaseName} in ${durationMs}ms`,
      metadata: { phase: phaseName, traceId, durationMs },
    });
  }

  // ============================================================
  // SEARCH & API CALLS
  // ============================================================

  logSearch(source: ResearchSource, query: string, metadata?: Record<string, any>): void {
    this.broadcast({
      eventType: "search",
      source,
      title: `Querying: "${query.slice(0, 100)}${query.length > 100 ? "..." : ""}"`,
      details: query,
      metadata: { ...metadata },
    });
  }
  
  logApiCall(source: ResearchSource, provider: string, model: string, purpose: string, metadata?: Record<string, any>): void {
    this.broadcast({
      eventType: "api_call",
      source,
      title: `API Call: ${provider}/${model}`,
      details: purpose,
      metadata: { ...metadata, provider, model },
    });
  }

  // ============================================================
  // SOURCE DISCOVERY
  // ============================================================

  logSource(source: ResearchSource, url: string, title?: string, credibility?: string): void {
    this.broadcast({
      eventType: "source",
      source,
      title: title || "Analyzing source",
      details: url,
      metadata: { url, credibility },
    });
  }
  
  logCitations(source: ResearchSource, citations: string[], context?: string): void {
    if (citations.length === 0) return;
    
    this.broadcast({
      eventType: "source",
      source,
      title: `Found ${citations.length} citations`,
      details: context || citations.slice(0, 3).join(", ") + (citations.length > 3 ? "..." : ""),
      metadata: { citations, citationCount: citations.length },
    });
  }

  // ============================================================
  // REASONING & ANALYSIS
  // ============================================================
  
  logReasoning(source: ResearchSource, reasoning: string, context?: string): void {
    this.broadcast({
      eventType: "reasoning",
      source,
      title: `Reasoning: ${reasoning.slice(0, 80)}${reasoning.length > 80 ? "..." : ""}`,
      details: reasoning,
      metadata: { context },
    });
  }

  logAnalysis(source: ResearchSource, analysis: string, metadata?: Record<string, any>): void {
    this.broadcast({
      eventType: "analysis",
      source,
      title: analysis.slice(0, 100) + (analysis.length > 100 ? "..." : ""),
      details: analysis,
      metadata,
    });
  }

  // ============================================================
  // IDEA DISCOVERY
  // ============================================================

  logIdea(source: ResearchSource, idea: string, confidence?: number, hypothesis?: string): void {
    this.broadcast({
      eventType: "idea",
      source,
      title: `Idea: ${idea.slice(0, 80)}${idea.length > 80 ? "..." : ""}`,
      details: idea,
      metadata: { confidence, hypothesis },
    });
  }

  // ============================================================
  // CANDIDATE CREATION & SCORING
  // ============================================================

  logCandidate(
    source: ResearchSource, 
    strategyName: string, 
    confidence: number, 
    options?: {
      symbol?: string;
      symbols?: string[];
      archetype?: string;
      hypothesis?: string;
      reasoning?: string;
      synthesis?: string;  // Research synthesis summary
      sources?: Array<{ type: string; label: string; detail: string }>;
      aiProvider?: string;  // Which AI provider generated this
      confidenceBreakdown?: Record<string, number>;
      traceId?: string;
    }
  ): void {
    this.broadcast({
      eventType: "candidate",
      source,
      title: `Strategy Created: ${strategyName}`,
      details: options?.hypothesis || `Confidence: ${confidence}%`,
      metadata: {
        strategyName,
        confidence,
        symbol: options?.symbol,
        symbols: options?.symbols,
        archetype: options?.archetype,
        hypothesis: options?.hypothesis,
        reasoning: options?.reasoning,
        synthesis: options?.synthesis,
        sources: options?.sources,
        aiProvider: options?.aiProvider,
        confidenceBreakdown: options?.confidenceBreakdown,
        traceId: options?.traceId,
      },
    });
  }
  
  logScoring(source: ResearchSource, strategyName: string, score: number, breakdown: Record<string, number>): void {
    this.broadcast({
      eventType: "scoring",
      source,
      title: `Scored: ${strategyName} = ${score}%`,
      details: Object.entries(breakdown).map(([k, v]) => `${k}: ${v}`).join(", "),
      metadata: { strategyName, confidence: score, confidenceBreakdown: breakdown },
    });
  }

  // ============================================================
  // VALIDATION & REJECTION
  // ============================================================
  
  logValidation(source: ResearchSource, check: string, result: "PASS" | "FAIL" | "WARN", reason?: string): void {
    this.broadcast({
      eventType: "validation",
      source,
      title: `${result}: ${check}`,
      details: reason,
      metadata: { validationResult: result, validationReason: reason },
    });
  }
  
  logRejection(source: ResearchSource, strategyName: string, reason: string, metadata?: {
    confidence?: number;
    threshold?: number;
    archetype?: string;
    traceId?: string;
  }): void {
    this.broadcast({
      eventType: "rejection",
      source,
      title: `Rejected: ${strategyName}`,
      details: reason,
      metadata: { 
        strategyName, 
        rejectionReason: reason,
        ...metadata,
      },
    });
  }
  
  logThinking(source: ResearchSource, thought: string, phase?: string, traceId?: string): void {
    this.broadcast({
      eventType: "reasoning",
      source,
      title: `Thinking: ${thought.slice(0, 60)}${thought.length > 60 ? "..." : ""}`,
      details: thought,
      metadata: { phase, traceId, isThinking: true },
    });
  }
  
  logCounterEvidence(source: ResearchSource, strategyName: string, counterEvidence: string, wasDisproven: boolean): void {
    this.broadcast({
      eventType: "validation",
      source,
      title: wasDisproven ? `Disproven: ${strategyName}` : `Tested: ${strategyName}`,
      details: counterEvidence,
      metadata: { 
        strategyName, 
        counterEvidence,
        status: wasDisproven ? "FAIL" : "PASS",
        validationResult: wasDisproven ? "FAIL" : "PASS",
        validationType: "counter_evidence",
      },
    });
  }
  
  logSourceWithSnippet(source: ResearchSource, sourceInfo: {
    url: string;
    title: string;
    snippet: string;
    category?: string;
    credibility?: "HIGH" | "MEDIUM" | "LOW";
  }): void {
    this.broadcast({
      eventType: "source",
      source,
      title: sourceInfo.title.slice(0, 80) + (sourceInfo.title.length > 80 ? "..." : ""),
      details: sourceInfo.snippet,
      metadata: { 
        url: sourceInfo.url,
        snippet: sourceInfo.snippet,
        category: sourceInfo.category || "Research",
        credibility: sourceInfo.credibility || "MEDIUM",
      },
    });
  }

  // ============================================================
  // COST & TOKEN TRACKING
  // ============================================================
  
  logCost(source: ResearchSource, provider: string, model: string, inputTokens: number, outputTokens: number, costUsd: number, traceId?: string): void {
    this.broadcast({
      eventType: "cost",
      source,
      title: `Cost: $${costUsd.toFixed(4)} (${provider}/${model})`,
      details: `Input: ${inputTokens.toLocaleString()} | Output: ${outputTokens.toLocaleString()} tokens`,
      metadata: { provider, model, inputTokens, outputTokens, costUsd, traceId },
    });
  }

  // ============================================================
  // ERRORS & SYSTEM
  // ============================================================

  logError(source: ResearchSource, error: string, metadata?: Record<string, any>): void {
    this.broadcast({
      eventType: "error",
      source,
      title: `Error: ${error.slice(0, 80)}`,
      details: error,
      metadata,
    });
  }

  logSystem(source: ResearchSource | string, message: string, details?: string): void {
    this.broadcast({
      eventType: "system",
      source: (source as ResearchSource) || "system",
      title: message,
      details,
    });
  }
  
  logActionRequired(
    source: ResearchSource, 
    issue: string, 
    metadata?: {
      actionRequired?: string;
      actionType?: "INCREASE_BUDGET" | "RESUME_MANUALLY" | "CHECK_API_KEY" | "WAIT_FOR_RESET";
      currentSpend?: number;
      limit?: number;
      traceId?: string;
      [key: string]: any;
    }
  ): void {
    const actionMessage = metadata?.actionRequired 
      ? `${issue} — ${metadata.actionRequired}`
      : issue;
      
    this.broadcast({
      eventType: "action_required",
      source,
      title: `⚠️ Action Required: ${issue}`,
      details: actionMessage,
      metadata: {
        ...metadata,
        requiresUserAction: true,
        canSelfHeal: false,
      },
    });
    
    console.log(`[RESEARCH_MONITOR] ACTION_REQUIRED source=${source} issue="${issue}" action="${metadata?.actionRequired || 'none specified'}"`);
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  getClientCount(): number {
    return this.clients.size;
  }

  getRecentEvents(since?: number): ResearchEvent[] {
    if (since) {
      return this.eventBuffer.filter(e => e.timestamp > since);
    }
    return [...this.eventBuffer];
  }
  
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
  
  clearEvents(): void {
    this.eventBuffer = [];
    this.stats = {
      totalEvents: 0,
      searchCount: 0,
      candidatesCreated: 0,
      errorsLogged: 0,
      totalCostUsd: 0,
      totalTokens: 0,
    };
  }

  shutdown(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    this.eventBuffer = [];
  }
}

export const researchMonitorWS = new ResearchMonitorWebSocketServer();
