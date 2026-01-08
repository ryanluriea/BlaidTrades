import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { SchedulerState as SchemaSchedulerState } from "@shared/schema";

export type SchedulerType = 'BACKTEST' | 'GRADUATION' | 'REBALANCE' | 'ARCHETYPE_CERT' | 'HEALTH_CHECK';

export function formatFrequency(minutes: number): string {
  if (minutes < 60) {
    return `Every ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Every ${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  const days = Math.floor(hours / 24);
  return `Every ${days} day${days !== 1 ? 's' : ''}`;
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 0) {
    const futureSeconds = Math.abs(diffSeconds);
    const futureMinutes = Math.floor(futureSeconds / 60);
    const futureHours = Math.floor(futureMinutes / 60);
    const futureDays = Math.floor(futureHours / 24);
    
    if (futureSeconds < 60) return `in ${futureSeconds}s`;
    if (futureMinutes < 60) return `in ${futureMinutes}m`;
    if (futureHours < 24) return `in ${futureHours}h`;
    return `in ${futureDays}d`;
  }
  
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

export interface SchedulerState {
  id: string;
  user_id: string;
  scheduler_type: SchedulerType;
  enabled: boolean;
  frequency_minutes: number;
  last_run_at: string | null;
  next_run_at: string | null;
  running_jobs: number;
  queue_depth: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapSchedulerState(s: SchemaSchedulerState): SchedulerState {
  return {
    id: s.id,
    user_id: s.userId,
    scheduler_type: s.schedulerType as SchedulerType,
    enabled: s.enabled ?? true,
    frequency_minutes: s.frequencyMinutes ?? 60,
    last_run_at: s.lastRunAt?.toISOString() || null,
    next_run_at: s.nextRunAt?.toISOString() || null,
    running_jobs: s.runningJobs ?? 0,
    queue_depth: s.queueDepth ?? 0,
    last_error: s.lastError || null,
    last_error_at: s.lastErrorAt?.toISOString() || null,
    created_at: s.createdAt?.toISOString() || new Date().toISOString(),
    updated_at: s.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

export function useSchedulerStates() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["scheduler-states", user?.id],
    queryFn: async (): Promise<SchedulerState[]> => {
      if (!user) return [];

      const response = await fetch(`/api/scheduler-states?user_id=${user.id}`, {
        credentials: "include",
      });

      if (!response.ok) return [];
      const json = await response.json();
      return (json.data || []).map(mapSchedulerState);
    },
    enabled: !!user,
  });
}

export function useSchedulerState(type: SchedulerType) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["scheduler-state", user?.id, type],
    queryFn: async (): Promise<SchedulerState | null> => {
      if (!user) return null;

      const response = await fetch(`/api/scheduler-state/${type}?user_id=${user.id}`, {
        credentials: "include",
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data ? mapSchedulerState(json.data) : null;
    },
    enabled: !!user,
  });
}

export function useUpdateSchedulerState() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      scheduler_type: SchedulerType;
      enabled?: boolean;
      frequency_minutes?: number;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch("/api/scheduler-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: user.id,
          schedulerType: params.scheduler_type,
          enabled: params.enabled,
          frequencyMinutes: params.frequency_minutes,
        }),
      });

      if (!response.ok) throw new Error("Failed to update scheduler state");
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler-states"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-state"] });
    },
  });
}

export function useInitializeSchedulerStates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (schedulerTypes: SchedulerType[]) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch("/api/scheduler-states/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          user_id: user.id,
          scheduler_types: schedulerTypes,
        }),
      });

      if (!response.ok) throw new Error("Failed to initialize scheduler states");
      const json = await response.json();
      return (json.data || []).map(mapSchedulerState);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler-states"] });
    },
  });
}

export function useTriggerScheduler() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ schedulerType, dryRun }: { schedulerType: SchedulerType; dryRun?: boolean }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch("/api/scheduler/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          user_id: user.id,
          scheduler_type: schedulerType,
          dry_run: dryRun,
        }),
      });

      if (!response.ok) {
        return { success: false, message: "Scheduler trigger not implemented" };
      }
      return response.json().then(r => r.data || { success: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduler-states"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-state"] });
    },
  });
}

export function useSchedulerHistory(type: SchedulerType, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["scheduler-history", type, limit],
    queryFn: async () => {
      if (!user) return [];

      const response = await fetch(`/api/scheduler-history?scheduler_type=${type}&limit=${limit}`, {
        credentials: "include",
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}
