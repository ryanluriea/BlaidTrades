import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Bot, InsertBot } from "@shared/schema";

export { Bot };
export type BotInsert = InsertBot;
export type BotUpdate = Partial<InsertBot>;

export function useCreateStarterBots() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/bots/starter-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create starter pack');
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({
        title: "Starter BotPack created!",
        description: `Created ${data?.created_bots || 0} trading bots ready for backtesting.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create starter bots",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useBots() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bots", user?.id],
    queryFn: async (): Promise<Bot[]> => {
      if (!user?.id) return [];

      const response = await fetch(`/api/bots?user_id=${user.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch bots');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
    retry: false,
  });
}

export function useBot(id: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bots", id],
    queryFn: async (): Promise<Bot | null> => {
      if (!id) return null;

      const response = await fetch(`/api/bots/${id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch bot');
      }
      const result = await response.json();
      return result.data;
    },
    enabled: !!user && !!id,
  });
}

export function useCreateBot() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (bot: Omit<BotInsert, 'userId'>) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...bot, userId: user.id }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create bot');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Bot created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create bot", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: BotUpdate & { id: string }) => {
      const response = await fetch(`/api/bots/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to update bot');
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bots", data.id] });
      toast({ title: "Bot updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update bot", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/bots/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete bot');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Bot deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete bot", description: error.message, variant: "destructive" });
    },
  });
}

export function useExportBotpack() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`/api/bots/${botId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Export failed');
      return result.data;
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data.botpack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.botpack?.bot?.name?.replace(/\s+/g, "-") || 'bot'}.botpack.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ 
        title: "Bot exported!", 
        description: "Botpack file downloaded successfully." 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Export failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useImportBotpack() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botpack, namePrefix }: { botpack: unknown; namePrefix?: string }) => {
      const response = await fetch('/api/bots/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botpack, namePrefix }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Import failed');
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ 
        title: "Bot imported!", 
        description: `Created "${data.bot?.name || 'bot'}" with ${data.generations_created || 0} generations.` 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Import failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useTradesReconcile() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params?: { accountId?: string; botInstanceId?: string }) => {
      const response = await fetch('/api/trades/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params || {}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Reconciliation failed');
      return result.data;
    },
    onSuccess: (data) => {
      if (!data.issues || data.issues.length === 0) {
        toast({ 
          title: "Reconciliation complete", 
          description: "No issues found. All trades match fills." 
        });
      } else {
        toast({ 
          title: "Issues found", 
          description: `Found ${data.issues.length} discrepancies.`, 
          variant: "destructive" 
        });
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Reconciliation failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}
