/**
 * Research Monitor WebSocket Server
 * 
 * Streams real-time AI research activity to connected clients.
 * Events include: search queries, source analysis, idea discovery, candidate creation.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export interface ResearchEvent {
  id: string;
  timestamp: number;
  eventType: "search" | "source" | "idea" | "candidate" | "error" | "system" | "analysis";
  source: "perplexity" | "grok" | "system";
  title: string;
  details?: string;
  metadata?: Record<string, any>;
}

interface ClientState {
  ws: WebSocket;
  connectedAt: number;
}

class ResearchMonitorWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private eventBuffer: ResearchEvent[] = [];
  private readonly MAX_BUFFER_SIZE = 100;

  initialize(server: Server): void {
    if (this.wss) {
      console.log("[RESEARCH_WS] Already initialized");
      return;
    }

    this.wss = new WebSocketServer({ 
      server, 
      path: "/ws/research-monitor" 
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
        recentEvents: this.eventBuffer.slice(-20),
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

  broadcast(event: Omit<ResearchEvent, "id" | "timestamp">): void {
    // Guard against worker-only mode where WebSocket server is not initialized
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

  logSearch(source: "perplexity" | "grok", query: string, metadata?: Record<string, any>): void {
    this.broadcast({
      eventType: "search",
      source,
      title: `Searching: "${query.slice(0, 100)}${query.length > 100 ? "..." : ""}"`,
      details: query,
      metadata,
    });
  }

  logSource(source: "perplexity" | "grok", url: string, title?: string): void {
    this.broadcast({
      eventType: "source",
      source,
      title: title || "Analyzing source",
      details: url,
      metadata: { url },
    });
  }

  logIdea(source: "perplexity" | "grok", idea: string, confidence?: number): void {
    this.broadcast({
      eventType: "idea",
      source,
      title: `Discovered: ${idea.slice(0, 80)}${idea.length > 80 ? "..." : ""}`,
      details: idea,
      metadata: { confidence },
    });
  }

  logCandidate(source: "perplexity" | "grok", strategyName: string, confidence: number, symbol?: string): void {
    this.broadcast({
      eventType: "candidate",
      source,
      title: `Created Strategy: ${strategyName}`,
      details: symbol ? `Symbol: ${symbol}` : undefined,
      metadata: { confidence, symbol },
    });
  }

  logAnalysis(source: "perplexity" | "grok", analysis: string): void {
    this.broadcast({
      eventType: "analysis",
      source,
      title: analysis.slice(0, 100) + (analysis.length > 100 ? "..." : ""),
      details: analysis,
    });
  }

  logError(source: "perplexity" | "grok" | "system", error: string): void {
    this.broadcast({
      eventType: "error",
      source,
      title: `Error: ${error.slice(0, 80)}`,
      details: error,
    });
  }

  logSystem(message: string): void {
    this.broadcast({
      eventType: "system",
      source: "system",
      title: message,
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getRecentEvents(since?: number): ResearchEvent[] {
    if (since) {
      return this.eventBuffer.filter(e => e.timestamp > since);
    }
    return [...this.eventBuffer];
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
