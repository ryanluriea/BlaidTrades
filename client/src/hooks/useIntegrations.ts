import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Integration, InsertIntegration } from "@shared/schema";

export { Integration };
export type IntegrationInsert = InsertIntegration;

export function useIntegrations() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["integrations", user?.id],
    queryFn: async (): Promise<Integration[]> => {
      if (!user?.id) return [];

      const response = await fetch(`/api/integrations?user_id=${user.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch integrations');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}

export function useUpsertIntegration() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<IntegrationInsert> & { id?: string }) => {
      if (!user?.id) throw new Error("Not authenticated");

      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...data, userId: user.id }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to save integration');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast({ title: "Integration saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save integration", description: error.message, variant: "destructive" });
    },
  });
}

export function useVerifyIntegration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      const response = await fetch(`/api/integrations/${integrationId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      if (data.success) {
        toast({ title: "Verification successful", description: data.message });
      } else {
        toast({ title: "Verification failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useDisableIntegration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      const response = await fetch(`/api/integrations/${integrationId}/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to disable integration');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast({ title: "Integration disabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to disable integration", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteIntegration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      const response = await fetch(`/api/integrations/${integrationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete integration');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast({ title: "Integration deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete integration", description: error.message, variant: "destructive" });
    },
  });
}

export function useSyncBrokerAccounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      const response = await fetch(`/api/integrations/${integrationId}/sync-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to sync accounts');
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast({ 
        title: "Broker accounts synced", 
        description: `Found ${data?.broker_accounts?.length || 0} accounts` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to sync accounts", description: error.message, variant: "destructive" });
    },
  });
}
