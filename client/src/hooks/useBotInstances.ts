import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { BotInstance, InsertBotInstance } from "@shared/schema";

export { BotInstance };
export type BotInstanceInsert = InsertBotInstance;
export type BotInstanceUpdate = Partial<InsertBotInstance>;

export type CreateBotInstanceInput = BotInstanceInsert & {
  sandboxInitialBalance?: number;
  sandboxCurrentBalance?: number;
  sandboxPeakBalance?: number;
  sandboxMaxDrawdown?: number;
};

export function useBotInstances(botId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/bot-instances", { botId }],
    queryFn: async (): Promise<BotInstance[]> => {
      const url = botId ? `/api/bot-instances?bot_id=${botId}` : '/api/bot-instances';
      const response = await fetch(url, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch bot instances');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}

export function useBotInstance(id: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/bot-instances", "detail", id],
    queryFn: async (): Promise<BotInstance | null> => {
      if (!id) return null;
      
      const response = await fetch(`/api/bot-instances/${id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch bot instance');
      }
      const result = await response.json();
      return result.data;
    },
    enabled: !!user && !!id,
  });
}

export function useCreateBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (instance: CreateBotInstanceInput) => {
      const response = await fetch('/api/bot-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(instance),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create bot instance');
      return result.data as BotInstance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: undefined }] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: data.botId }] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["linked_bots"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_with_linked_bots_counts"] });
      toast({ title: "Bot instance created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create bot instance", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: BotInstanceUpdate & { id: string }) => {
      const response = await fetch(`/api/bot-instances/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to update bot instance');
      return result.data as BotInstance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: undefined }] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", "detail", data.id] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: data.botId }] });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update bot instance", description: error.message, variant: "destructive" });
    },
  });
}

export function useStartBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (instanceId: string) => {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          status: "running", 
          startedAt: new Date().toISOString() 
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to start bot instance');
      return result.data as BotInstance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: undefined }] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", "detail", data.id] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: data.botId }] });
      }
      toast({ title: "Bot instance started" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start bot instance", description: error.message, variant: "destructive" });
    },
  });
}

export function useStopBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (instanceId: string) => {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          status: "stopped", 
          stoppedAt: new Date().toISOString() 
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to stop bot instance');
      return result.data as BotInstance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: undefined }] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", "detail", data.id] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: data.botId }] });
      }
      toast({ title: "Bot instance stopped" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to stop bot instance", description: error.message, variant: "destructive" });
    },
  });
}

export function usePauseBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (instanceId: string) => {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: "paused" }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to pause bot instance');
      return result.data as BotInstance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: undefined }] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", "detail", data.id] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bot-instances", { botId: data.botId }] });
      }
      toast({ title: "Bot instance paused" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to pause bot instance", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteBotInstance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (instanceId: string) => {
      const response = await fetch(`/api/bot-instances/${instanceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to delete bot instance');
      return instanceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          query.queryKey[0] === "/api/bot-instances" 
      });
      queryClient.invalidateQueries({ queryKey: ["linked_bots"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_with_linked_bots_counts"] });
      toast({ title: "Bot instance deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete bot instance", description: error.message, variant: "destructive" });
    },
  });
}
