import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DecayMetrics {
  currentSharpe: number;
  baselineSharpe: number;
  sharpeDecay: number;
  rollingWinRate: number;
  baselineWinRate: number;
  winRateDecay: number;
  rollingPnL: number;
  baselinePnL: number;
  pnlDecay: number;
  consecLosses: number;
  tradeDensity: number;
}

export interface DecayAssessment {
  botId: string;
  botName: string;
  stage: string;
  decayDetected: boolean;
  decayLevel: "NONE" | "MILD" | "MODERATE" | "SEVERE" | "CRITICAL";
  metrics: DecayMetrics;
  recommendation: "CONTINUE" | "MONITOR" | "REDUCE_SIZE" | "PAUSE" | "EMERGENCY_STOP";
  reasons: string[];
  autoActionTaken: boolean;
  actionDetails?: string;
}

export interface DecayHistoryEntry {
  date: string;
  sharpe: number;
  winRate: number;
  pnl: number;
  decayLevel: string;
}

export interface DecayThresholds {
  mildSharpeDrop: number;
  moderateSharpeDrop: number;
  severeSharpeDrop: number;
  criticalSharpeDrop: number;
  minWinRateDrop: number;
  maxConsecLosses: number;
  minTradeDensity: number;
  rollingWindowDays: number;
}

export function useAlphaDecay(botId: string, enabled = true) {
  return useQuery<{ success: boolean } & DecayAssessment>({
    queryKey: ["/api/alpha-decay/assess", botId],
    queryFn: async () => {
      const res = await fetch(`/api/alpha-decay/assess/${botId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch alpha decay assessment");
      return res.json();
    },
    enabled: enabled && !!botId,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function useAlphaDecayScan(stages?: string[]) {
  const stagesParam = stages?.length ? `?stages=${stages.join(",")}` : "";
  return useQuery<{
    success: boolean;
    results: DecayAssessment[];
    decayingCount: number;
    totalScanned: number;
  }>({
    queryKey: ["/api/alpha-decay/scan", stages],
    queryFn: async () => {
      const res = await fetch(`/api/alpha-decay/scan${stagesParam}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to scan for alpha decay");
      return res.json();
    },
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
}

export function useAlphaDecayHistory(botId: string, days = 90) {
  return useQuery<{
    success: boolean;
    botId: string;
    history: DecayHistoryEntry[];
  }>({
    queryKey: ["/api/alpha-decay/history", botId, days],
    queryFn: async () => {
      const res = await fetch(`/api/alpha-decay/history/${botId}?days=${days}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch decay history");
      return res.json();
    },
    enabled: !!botId,
    staleTime: 120000,
  });
}

export function useSetDecayThresholds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      botId,
      thresholds,
    }: {
      botId: string;
      thresholds: Partial<DecayThresholds>;
    }) => {
      const res = await fetch(`/api/alpha-decay/thresholds/${botId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error("Failed to set decay thresholds");
      return res.json();
    },
    onSuccess: (_, { botId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alpha-decay/assess", botId] });
    },
  });
}

export function getDecayLevelColor(level: string) {
  switch (level) {
    case "NONE":
      return "text-green-400 bg-green-500/10 border-green-500/30";
    case "MILD":
      return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    case "MODERATE":
      return "text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "SEVERE":
      return "text-red-400 bg-red-500/10 border-red-500/30";
    case "CRITICAL":
      return "text-red-500 bg-red-600/20 border-red-500/50";
    default:
      return "text-muted-foreground bg-muted/50";
  }
}

export function getRecommendationColor(recommendation: string) {
  switch (recommendation) {
    case "CONTINUE":
      return "text-green-400";
    case "MONITOR":
      return "text-yellow-400";
    case "REDUCE_SIZE":
      return "text-orange-400";
    case "PAUSE":
      return "text-red-400";
    case "EMERGENCY_STOP":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}
