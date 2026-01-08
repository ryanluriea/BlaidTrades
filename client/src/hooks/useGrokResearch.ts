import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type GrokResearchDepth = "CONTRARIAN_SCAN" | "SENTIMENT_BURST" | "DEEP_REASONING" | "FULL_SPECTRUM";

export interface GrokResearchState {
  enabled: boolean;
  depth: GrokResearchDepth;
  lastCycleAt: string | null;
  nextCycleIn: number | null;
  isFullSpectrum?: boolean;
}

export interface OrchestratorStatus {
  isEnabled: boolean;
  isFullSpectrum: boolean;
  runningJobs: number;
  dailyCost: number;
  dailyJobs: number;
  lastRuns: Record<string, string | null>;
  nextRuns?: Record<string, number | null>;
}

export function useGrokResearchState() {
  return useQuery<GrokResearchState>({
    queryKey: ["/api/grok-research/state"],
    queryFn: async () => {
      const response = await fetch("/api/grok-research/state", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch Grok research state");
      const result = await response.json();
      return result.data ?? result;
    },
    refetchInterval: 60_000,
  });
}

export function useToggleGrokResearchState() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch("/api/grok-research/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle Grok research");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grok-research/state"] });
      toast({
        title: data.data?.enabled ? "Grok Research Enabled" : "Grok Research Paused",
        description: data.data?.enabled 
          ? `Contrarian analysis active in ${data.data.depth} mode`
          : "Grok autonomous research paused",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useSetGrokResearchDepth() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (depth: GrokResearchDepth) => {
      const response = await fetch("/api/grok-research/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ depth }),
      });
      if (!response.ok) throw new Error("Failed to set Grok depth");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grok-research/state"] });
      toast({
        title: "Grok Depth Updated",
        description: `Research mode set to ${getDepthLabel(data.data?.depth)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useTriggerGrokResearch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ depth, userId }: { depth?: GrokResearchDepth; userId?: string }) => {
      const response = await fetch("/api/grok-research/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ depth, user_id: userId }),
      });
      if (!response.ok) throw new Error("Failed to trigger Grok research");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grok-research/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-candidates"] });
      if (data.success) {
        toast({
          title: "Grok Research Triggered",
          description: `Generated ${data.data?.candidatesCreated || 0} contrarian strategy candidates`,
        });
      } else {
        toast({
          title: "Grok Research Issue",
          description: data.data?.error || "Research cycle completed with no candidates",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function getDepthLabel(depth: GrokResearchDepth | undefined): string {
  switch (depth) {
    case "CONTRARIAN_SCAN":
      return "Contrarian";
    case "SENTIMENT_BURST":
      return "Sentiment";
    case "DEEP_REASONING":
      return "Deep";
    case "FULL_SPECTRUM":
      return "Full Spectrum";
    default:
      return "Unknown";
  }
}

export function getDepthDescription(depth: GrokResearchDepth): string {
  switch (depth) {
    case "CONTRARIAN_SCAN":
      return "Find crowded trades and contrarian opportunities (2h cycles)";
    case "SENTIMENT_BURST":
      return "Quick X/Twitter sentiment analysis (30min cycles)";
    case "DEEP_REASONING":
      return "Full institutional-grade multi-factor analysis (6h cycles)";
    case "FULL_SPECTRUM":
      return "All 3 modes running concurrently with smart orchestration";
    default:
      return "";
  }
}

export function useOrchestratorStatus() {
  return useQuery<OrchestratorStatus>({
    queryKey: ["/api/research-orchestrator/status"],
    queryFn: async () => {
      const response = await fetch("/api/research-orchestrator/status", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch orchestrator status");
      const result = await response.json();
      return result.data ?? result;
    },
    refetchInterval: 30_000,
  });
}

export function useToggleFullSpectrum() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch("/api/research-orchestrator/full-spectrum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to toggle Full Spectrum mode");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-orchestrator/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grok-research/state"] });
      toast({
        title: data.data?.isFullSpectrum ? "Full Spectrum Enabled" : "Full Spectrum Disabled",
        description: data.data?.isFullSpectrum 
          ? "All 3 research modes running concurrently"
          : "Switched to single research mode",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
