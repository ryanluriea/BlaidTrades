import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { BacktestSession, InsertBacktestSession } from "@shared/schema";

export { BacktestSession };
export type BacktestInsert = InsertBacktestSession;
export type BacktestUpdate = Partial<InsertBacktestSession>;

export function useBacktests() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/backtests", user?.id],
    queryFn: async (): Promise<BacktestSession[]> => {
      if (!user?.id) return [];
      
      const response = await fetch(`/api/backtests?user_id=${user.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch backtests');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}

export function useBacktest(id: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/backtests", "detail", id],
    queryFn: async (): Promise<BacktestSession | null> => {
      if (!id) return null;
      
      const response = await fetch(`/api/backtests/${id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch backtest');
      }
      const result = await response.json();
      return result.data;
    },
    enabled: !!user && !!id,
  });
}

export function useBotBacktests(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/bots", botId, "backtests"],
    queryFn: async (): Promise<BacktestSession[]> => {
      if (!botId) return [];
      
      const response = await fetch(`/api/bots/${botId}/backtests`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch bot backtests');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user && !!botId,
  });
}

export function useLatestBotBacktest(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/bots", botId, "backtests", "latest"],
    queryFn: async (): Promise<BacktestSession | null> => {
      if (!botId) return null;
      
      const response = await fetch(`/api/bots/${botId}/backtests/latest`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch latest backtest');
      const result = await response.json();
      return result.data || null;
    },
    enabled: !!user && !!botId,
  });
}

export function useCreateBacktest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (backtest: Omit<BacktestInsert, 'userId'>) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...backtest, userId: user.id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create backtest');
      return result.data as BacktestSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests", user?.id] });
      if (data.botId) {
        queryClient.invalidateQueries({ queryKey: ["/api/bots", data.botId, "backtests"] });
      }
      toast({ title: "Backtest created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create backtest", description: error.message, variant: "destructive" });
    },
  });
}

export function useRunBacktest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (backtestId: string) => {
      const response = await fetch(`/api/backtests/${backtestId}/run`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to run backtest');
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests", user?.id] });
      toast({ 
        title: "Backtest started", 
        description: data?.message || "Backtest is running. Results will be available when complete." 
      });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests", user?.id] });
      toast({ 
        title: "Backtest failed", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useDeleteBacktest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/backtests/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to delete backtest');
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/backtests", "detail", deletedId] });
      toast({ title: "Backtest deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete backtest", description: error.message, variant: "destructive" });
    },
  });
}
