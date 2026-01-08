/**
 * Priority score hooks
 * MIGRATED: Supabase → Express API
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";
import { 
  calculatePriorityScore, 
  type PriorityScoreInput, 
  type WindowMetrics,
  type HealthState,
  type Stage,
  type PriorityBucket,
  BUCKET_DISPLAY,
} from "@/lib/priorityScore";
import { computeBotHealth } from "@/lib/botHealth";

export { BUCKET_DISPLAY };
export type { PriorityBucket };

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response;
}

export function useBotPriority(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_priority", botId],
    queryFn: async () => {
      if (!botId) return null;

      const response = await fetchWithAuth(`/api/bots/${botId}/priority`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch priority');
      }

      return {
        score: data.data?.priorityScore ?? 0,
        bucket: (data.data?.priorityBucket || "D") as PriorityBucket,
        computedAt: data.data?.priorityComputedAt,
      };
    },
    enabled: !!user && !!botId,
  });
}

export function useBotPriorities(botIds: string[]) {
  const { user } = useAuth();
  const restOnline = useRestOnline();

  return useQuery({
    queryKey: ["bot_priorities", botIds],
    queryFn: async () => {
      if (!restOnline || botIds.length === 0) {
        return new Map<
          string,
          { score: number | null; bucket: PriorityBucket | null; computedAt: string | null }
        >();
      }

      const response = await fetchWithAuth('/api/bots/priorities');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch priorities');
      }

      const map = new Map<
        string,
        { score: number | null; bucket: PriorityBucket | null; computedAt: string | null }
      >();

      const bots = data.data || [];
      for (const bot of bots) {
        if (!botIds.includes(bot.id)) continue;
        const hasBeenScored = bot.priorityComputedAt !== null;
        map.set(bot.id, {
          score: hasBeenScored ? bot.priorityScore ?? null : null,
          bucket: hasBeenScored ? ((bot.priorityBucket || null) as PriorityBucket | null) : null,
          computedAt: bot.priorityComputedAt ?? null,
        });
      }

      return map;
    },
    enabled: !!user && restOnline && botIds.length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateBotPriority() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (botId: string) => {
      if (!user) throw new Error("Not authenticated");

      const [botRes, instancesRes] = await Promise.all([
        fetchWithAuth(`/api/bots/${botId}`),
        fetchWithAuth(`/api/bot-instances?bot_id=${botId}`),
      ]);

      const botData = await botRes.json();
      const instancesData = await instancesRes.json();

      const bot = botData.data;
      const instances = instancesData.data || [];
      const primaryInstance = instances.find((i: any) => i.isPrimaryRunner);

      const getWindowMetrics = (): WindowMetrics | null => null;

      const health = computeBotHealth({
        activityState: primaryInstance?.activityState || null,
        lastHeartbeat: primaryInstance?.lastHeartbeatAt || null,
        stallReason: null,
        instanceStatus: bot?.status || null,
        mode: null,
        recentErrorCount: 0,
        hasRiskViolation: false,
        executionBlocked: false,
      });

      const input: PriorityScoreInput = {
        metrics7D: getWindowMetrics(),
        metrics30D: getWindowMetrics(),
        metrics90D: getWindowMetrics(),
        healthState: health.status as HealthState,
        correlationPenalty30D: 0,
        stage: 'TRIALS' as Stage,
      };

      const result = calculatePriorityScore(input);

      const updateRes = await fetch(`/api/bots/${botId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priorityScore: result.score,
          priorityBucket: result.bucket,
          priorityComputedAt: new Date().toISOString(),
        }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update priority');
      }

      return result;
    },
    onSuccess: (_, botId) => {
      queryClient.invalidateQueries({ queryKey: ["bot_priority", botId] });
      queryClient.invalidateQueries({ queryKey: ["bot_priorities"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
  });
}
