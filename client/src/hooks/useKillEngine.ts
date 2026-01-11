import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface BotKillState {
  botId: string;
  killState: 'NONE' | 'SOFT_KILLED' | 'HARD_KILLED' | 'QUARANTINED';
  killReasonCode: string | null;
  killReasonDetail: string | null;
  killUntil: string | null;
  killCounter: number;
  demotionCooldownUntil: string | null;
  promotionCooldownUntil: string | null;
}

export interface BotKillEvent {
  id: string;
  botId: string;
  eventType: string;
  triggerCode: string;
  triggerDetail: string | null;
  fromStage: string | null;
  toStage: string | null;
  createdAt: string;
}

export function useBotKillState(botId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bot_kill_state', botId],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/kill-state`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch kill state');
      }

      const data = await response.json();
      return data.data as BotKillState;
    },
    enabled: !!user && !!botId,
  });
}

export function useBotKillEvents(botId: string, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bot_kill_events', botId, limit],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/kill-events?limit=${limit}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return (result.data || []) as BotKillEvent[];
    },
    enabled: !!user && !!botId,
  });
}

export function useManualKill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ botId, killLevel, reason }: { botId: string; killLevel: 'SOFT_KILLED' | 'HARD_KILLED'; reason: string }) => {
      const response = await fetch(`/api/bots/${botId}/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ killLevel, reason }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to kill bot');
      }

      return response.json();
    },
    onSuccess: (_, { botId }) => {
      queryClient.invalidateQueries({ queryKey: ['bot_kill_state', botId] });
      queryClient.invalidateQueries({ queryKey: ['bot_kill_events', botId] });
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bots-overview'] });
    },
  });
}

export function useManualResurrect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ botId }: { botId: string }) => {
      const response = await fetch(`/api/bots/${botId}/resurrect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to resurrect bot');
      }

      return response.json();
    },
    onSuccess: (_, { botId }) => {
      queryClient.invalidateQueries({ queryKey: ['bot_kill_state', botId] });
      queryClient.invalidateQueries({ queryKey: ['bot_kill_events', botId] });
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bots-overview'] });
    },
  });
}
