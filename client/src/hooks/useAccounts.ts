import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Account, InsertAccount, EnrichedAccount, AccountWithBotsPnl, AccountAttempt } from "@shared/schema";

export type { Account, EnrichedAccount, AccountWithBotsPnl };
export type AccountInsert = InsertAccount;
export type AccountUpdate = Partial<InsertAccount>;

export function useAccounts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/accounts", user?.id],
    queryFn: async (): Promise<EnrichedAccount[]> => {
      if (!user?.id) return [];
      
      const response = await fetch(`/api/accounts?user_id=${user.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch accounts');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes - accounts data changes infrequently
  });
}

export function useAccount(id: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/accounts", "detail", id],
    queryFn: async (): Promise<AccountWithBotsPnl | null> => {
      if (!id) return null;
      
      const response = await fetch(`/api/accounts/${id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch account');
      }
      const result = await response.json();
      return result.data;
    },
    enabled: !!user && !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (account: Omit<AccountInsert, 'userId'>) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...account, userId: user.id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create account');
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["accounts_with_linked_bots_counts"] });
      toast({ title: "Account created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create account", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: AccountUpdate & { id: string }) => {
      const response = await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      
      if (response.status === 403) {
        throw new Error("You don't have permission to update this account");
      }
      if (response.status === 401) {
        throw new Error("Authentication required");
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to update account');
      return result.data as Account;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", "detail", data.id] });
      queryClient.invalidateQueries({ queryKey: ["accounts_with_linked_bots_counts"] });
      toast({ title: "Account updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update account", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/accounts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (response.status === 403) {
        throw new Error("You don't have permission to delete this account");
      }
      if (response.status === 401) {
        throw new Error("Authentication required");
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to delete account');
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", "detail", deletedId] });
      queryClient.invalidateQueries({ queryKey: ["accounts_with_linked_bots_counts"] });
      toast({ title: "Account deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete account", description: error.message, variant: "destructive" });
    },
  });
}

export function useAccountAttempts(accountId: string | undefined) {
  return useQuery({
    queryKey: ["/api/accounts", accountId, "attempts"],
    queryFn: async (): Promise<AccountAttempt[]> => {
      if (!accountId) return [];
      
      const response = await fetch(`/api/accounts/${accountId}/attempts`, {
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to fetch account attempts');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useResetAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, newInitialBalance }: { id: string; newInitialBalance: number }) => {
      const response = await fetch(`/api/accounts/${id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newInitialBalance }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Reset failed with status ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to reset account');
      return result.data as Account;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", "detail", data.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", data.id, "attempts"] });
      toast({ title: "Account reset successfully", description: "Starting fresh with new balance" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reset account", description: error.message, variant: "destructive" });
    },
  });
}
