import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface AIUsageRollup {
  total_calls: number;
  total_cost_usd: number;
  calls_by_provider: Record<string, number>;
  fallback_rate: number;
}

export interface BotAIMetrics {
  ai_cost_lifetime: number;
  ai_calls_lifetime: number;
  first_ai_usage_at: string | null;
}

interface ProviderStats {
  provider: string;
  calls: number;
  cost: number;
}

async function fetchAIProviders(botId: string): Promise<ProviderStats[]> {
  const response = await fetch(`/api/ai-telemetry/providers?bot_id=${botId}`, {
    credentials: 'include',
  });

  if (!response.ok) return [];
  const json = await response.json();
  return json.data || [];
}

async function fetchAIUsage(botId: string): Promise<AIUsageRollup | null> {
  const response = await fetch(`/api/ai-telemetry/usage?bot_id=${botId}`, {
    credentials: 'include',
  });

  if (!response.ok) return null;
  const json = await response.json();
  return json.data || null;
}

export function useBotAIProviders(botId: string | undefined): UseQueryResult<ProviderStats[], Error> {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ai-providers", botId],
    queryFn: () => fetchAIProviders(botId!),
    enabled: !!user && !!botId,
    staleTime: 60_000,
  });
}

export function useBotAIUsage(botId: string | undefined): UseQueryResult<AIUsageRollup | null, Error> {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ai-usage", botId],
    queryFn: () => fetchAIUsage(botId!),
    enabled: !!user && !!botId,
    staleTime: 60_000,
  });
}
