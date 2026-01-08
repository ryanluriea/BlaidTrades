import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";
import type { BotJob } from "@shared/schema";

export type { BotJob };

export function useBotJobs(botId?: string) {
  const { user } = useAuth();
  const restOnline = useRestOnline();

  return useQuery({
    queryKey: ["bot-jobs", botId],
    queryFn: async (): Promise<BotJob[]> => {
      if (!user || !restOnline) return [];

      const params = new URLSearchParams();
      if (botId) params.set("bot_id", botId);
      
      const response = await fetch(`/api/jobs?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch jobs");
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user && restOnline,
    refetchInterval: restOnline ? 15000 : false, // THROTTLED: 15s (was 5s)
    staleTime: 10000, // 10 seconds stale time
  });
}

export function useJobQueueStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['job-queue-stats'],
    queryFn: async () => {
      if (!user) return { queued: 0, running: 0, failed: 0 };

      const response = await fetch('/api/jobs/stats', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch job stats");
      const result = await response.json();
      return result.data || { queued: 0, running: 0, failed: 0 };
    },
    enabled: !!user,
    refetchInterval: 30000, // THROTTLED: 30s (was 10s)
    staleTime: 15000,
  });
}

export function useEnqueueJob() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ 
      botId, 
      jobType, 
      payload = {},
      priority = 0,
    }: { 
      botId: string; 
      jobType: BotJob['jobType']; 
      payload?: Record<string, unknown>;
      priority?: number;
    }) => {
      if (!user) throw new Error('Not authenticated');

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: user.id,
          botId,
          jobType,
          status: 'QUEUED',
          priority,
          payloadJson: payload,
        }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to enqueue job');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job-queue-stats'] });
    },
  });
}
