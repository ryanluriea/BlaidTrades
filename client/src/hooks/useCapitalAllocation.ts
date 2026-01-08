import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface CapitalAllocationResult {
  success: boolean;
  dry_run: boolean;
  total_bots: number;
  proven_bots: number;
  total_risk_allocated: number;
  allocations: any[];
  policy: {
    total_risk_units: number;
    max_units_per_bot: number;
    kill_switch_active: boolean;
  };
}

export function useCapitalAllocation(accountId?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const runAllocation = useMutation({
    mutationFn: async (params: { dry_run?: boolean; account_id?: string }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/capital-allocator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          user_id: user.id, 
          account_id: params.account_id || accountId,
          dry_run: params.dry_run ?? false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to run capital allocation');
      }

      return response.json() as Promise<CapitalAllocationResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capital-allocations'] });
    },
  });

  return {
    allocations: null as any[] | null,
    policy: null as any,
    isLoading: false,
    refetch: () => {},
    runAllocation,
    toggleKillSwitch: { mutateAsync: async (_: boolean) => {} },
  };
}

export function useProfitabilityAudit() {
  const { user } = useAuth();

  const runAudit = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/profitability-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_id: user.id }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to run profitability audit');
      }

      return response.json();
    },
  });

  return { runAudit };
}
