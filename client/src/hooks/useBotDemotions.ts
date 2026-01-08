import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface DemotionEvent {
  id: string;
  bot_id: string;
  user_id: string;
  from_stage: string;
  to_stage: string;
  reason_code: string;
  reason_detail: string | null;
  triggered_by: string;
  cooldown_until: string | null;
  snapshot: Record<string, any>;
  created_at: string;
}

export function useLatestDemotion(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-demotion-latest", botId],
    queryFn: async () => {
      if (!botId) return null;

      const response = await fetch(`/api/bot-demotions/${botId}?limit=1`);
      if (!response.ok) throw new Error("Failed to fetch demotion");
      const json = await response.json();
      const data = json.data || [];
      return data[0] || null;
    },
    enabled: !!user && !!botId,
  });
}

export function useBotDemotions(botId: string | undefined, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-demotions", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      const response = await fetch(`/api/bot-demotions/${botId}?limit=${limit}`);
      if (!response.ok) throw new Error("Failed to fetch demotions");
      const json = await response.json();
      return (json.data || []) as DemotionEvent[];
    },
    enabled: !!user && !!botId,
  });
}

export function useAllLatestDemotions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["all-bot-demotions"],
    queryFn: async () => {
      if (!user) return new Map<string, DemotionEvent>();

      const response = await fetch(`/api/bot-demotions/all`);
      if (!response.ok) return new Map<string, DemotionEvent>();
      const json = await response.json();
      const data = (json.data || []) as DemotionEvent[];

      const map = new Map<string, DemotionEvent>();
      data.forEach(event => {
        if (!map.has(event.bot_id)) {
          map.set(event.bot_id, event);
        }
      });

      return map;
    },
    enabled: !!user,
    staleTime: 30000,
  });
}
