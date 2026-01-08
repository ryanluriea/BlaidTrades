import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Alert } from "@shared/schema";

export type AlertCategory = Alert['category'];
export type AlertStatus = Alert['status'];

export { Alert };

export function useAlerts(filters?: {
  category?: AlertCategory;
  status?: AlertStatus[];
  limit?: number;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["alerts", user?.id, filters],
    queryFn: async (): Promise<Alert[]> => {
      if (!user?.id) return [];
      
      const params = new URLSearchParams({ user_id: user.id });
      if (filters?.category) params.append('category', filters.category);
      if (filters?.status?.length) params.append('status', filters.status.join(','));
      if (filters?.limit) params.append('limit', filters.limit.toString());

      const response = await fetch(`/api/alerts?${params.toString()}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch alerts');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });
}

export function useUnreadAlertCount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["alerts", "unread-count", user?.id],
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0;
      
      const response = await fetch(`/api/alerts/count?user_id=${user.id}&status=OPEN`, {
        credentials: 'include',
      });
      
      if (!response.ok) return 0;
      const result = await response.json();
      return result.count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 15000,
  });
}

export function useUpdateAlertStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      alertId,
      status,
      snoozedUntil,
    }: {
      alertId: string;
      status: AlertStatus;
      snoozedUntil?: string | null;
    }) => {
      const updates: Record<string, unknown> = { status };
      
      if (status === "SNOOZED" && snoozedUntil) {
        updates.snoozedUntil = snoozedUntil;
      }
      if (status === "RESOLVED") {
        updates.resolvedAt = new Date().toISOString();
      }

      const response = await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update alert');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useLogAlertAction() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      alertId,
      actionType,
      requestJson,
      resultJson,
      success,
    }: {
      alertId: string;
      actionType: string;
      requestJson?: Record<string, unknown>;
      resultJson?: Record<string, unknown>;
      success: boolean;
    }) => {
      const response = await fetch('/api/alert-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          alertId,
          actionType,
          actor: user?.email || 'system',
          requestJson: requestJson || {},
          resultJson: resultJson || {},
          success,
        }),
      });
      if (!response.ok) throw new Error('Failed to log action');
      return response.json();
    },
  });
}

export function useDismissAlert() {
  const updateStatus = useUpdateAlertStatus();
  const logAction = useLogAlertAction();

  return useMutation({
    mutationFn: async (alertId: string) => {
      await logAction.mutateAsync({
        alertId,
        actionType: "DISMISS",
        success: true,
      });
      return updateStatus.mutateAsync({ alertId, status: "DISMISSED" });
    },
    onSuccess: () => {
      toast.success("Alert dismissed");
    },
  });
}

export function useSnoozeAlert() {
  const updateStatus = useUpdateAlertStatus();
  const logAction = useLogAlertAction();

  return useMutation({
    mutationFn: async ({
      alertId,
      hours,
    }: {
      alertId: string;
      hours: number;
    }) => {
      const snoozedUntil = new Date(
        Date.now() + hours * 60 * 60 * 1000
      ).toISOString();

      await logAction.mutateAsync({
        alertId,
        actionType: "SNOOZE",
        requestJson: { hours },
        success: true,
      });

      return updateStatus.mutateAsync({
        alertId,
        status: "SNOOZED",
        snoozedUntil,
      });
    },
    onSuccess: () => {
      toast.success("Alert snoozed");
    },
  });
}

export function useAcknowledgeAlert() {
  const updateStatus = useUpdateAlertStatus();
  const logAction = useLogAlertAction();

  return useMutation({
    mutationFn: async (alertId: string) => {
      await logAction.mutateAsync({
        alertId,
        actionType: "ACK",
        success: true,
      });
      return updateStatus.mutateAsync({ alertId, status: "ACKED" });
    },
  });
}
