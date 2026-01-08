import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { toast } from "sonner";

export interface BotHistoryEvent {
  id: string;
  bot_id: string;
  event_type: string;
  timestamp: string;
  mode: string | null;
  metadata: Record<string, any> | null;
}

export interface BotActivityState {
  id: string;
  bot_id: string;
  state: string;
  last_heartbeat_at: string | null;
  health_score: number | null;
  stall_reason: string | null;
  current_task: string | null;
}

export function useBotHistory(botId: string | undefined, options?: { limit?: number; eventType?: string; mode?: string }) {
  const { user } = useAuth();
  const { limit = 200, eventType, mode } = options || {};

  return useQuery({
    queryKey: ["bot-history", botId, limit, eventType, mode],
    queryFn: async () => {
      if (!botId) return [];

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (eventType) params.set("event_type", eventType);
      if (mode) params.set("mode", mode);

      const response = await fetch(`/api/bot-history/${botId}?${params}`);
      if (!response.ok) throw new Error("Failed to fetch history");
      const json = await response.json();
      return (json.data || []) as BotHistoryEvent[];
    },
    enabled: !!user && !!botId,
  });
}

export function useBotActivityState(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-activity", botId],
    queryFn: async () => {
      if (!botId) return null;

      const response = await fetch(`/api/bot-activity/${botId}`);
      if (!response.ok) return null;
      const json = await response.json();
      return json.data as BotActivityState | null;
    },
    enabled: !!user && !!botId,
    refetchInterval: 10000,
  });
}

export function useAllBotActivity() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-activity-all"],
    queryFn: async () => {
      const response = await fetch("/api/bot-activity/all");
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
    refetchInterval: 10000,
  });
}

export function useRevertGeneration() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botId, generationId, reason }: { botId: string; generationId: string; reason?: string }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/revert-generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          generation_id: generationId,
          reason,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to revert");
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bots", variables.botId] });
      queryClient.invalidateQueries({ queryKey: [`/api/bot-generations/${variables.botId}`] });
      queryClient.invalidateQueries({ queryKey: ["bot-history", variables.botId] });
      toast({
        title: "Generation Reverted",
        description: `Successfully reverted to generation ${data.revertedTo || 'previous'}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Revert Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useForkBot() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      botId,
      generationId,
      newBotName,
      attachAccountId,
      mode,
    }: {
      botId: string;
      generationId: string;
      newBotName: string;
      attachAccountId?: string;
      mode?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          generation_id: generationId,
          new_bot_name: newBotName,
          attach_account_id: attachAccountId,
          mode,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fork");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({
        title: "Bot Forked",
        description: `Created new bot: ${data.newBotName || 'forked bot'}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fork Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useBranchGeneration() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      botId,
      generationId,
      mutationOverrides,
      label,
      setAsCurrent,
    }: {
      botId: string;
      generationId: string;
      mutationOverrides?: Record<string, unknown>;
      label?: string;
      setAsCurrent?: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/branch-generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          generation_id: generationId,
          mutation_overrides: mutationOverrides,
          label,
          set_as_current: setAsCurrent,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to branch");
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: [`/api/bot-generations/${variables.botId}`] });
      queryClient.invalidateQueries({ queryKey: ["bot-history", variables.botId] });
      toast({
        title: "Generation Branched",
        description: `Created new generation from parent`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Branch Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateBotActivity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      botId: string;
      botInstanceId?: string;
      accountId?: string;
      mode?: string;
      state?: string;
      currentTask?: string;
      healthScore?: number;
      stallReason?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bot-activity/${params.botId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...params,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update activity");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bot-activity", variables.botId] });
      queryClient.invalidateQueries({ queryKey: ["bot-activity-all"] });
    },
  });
}

export function usePinGeneration() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ generationId, botId, pin }: { generationId: string; botId: string; pin: boolean }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bot-generations/${generationId}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pin,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to pin");
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/bot-generations/${variables.botId}`] });
      toast.success(variables.pin ? "Generation pinned as best checkpoint" : "Generation unpinned");
    },
    onError: (error: Error) => {
      toast.error(`Failed to pin: ${error.message}`);
    },
  });
}
