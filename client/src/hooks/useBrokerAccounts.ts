import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface BrokerAccountWithIntegration {
  id: string;
  integration_id: string;
  broker_account_ref: string;
  broker_account_name: string;
  currency: string;
  is_active: boolean;
  meta_json: Record<string, unknown>;
  broker_env: 'LIVE' | 'DEMO';
  permissions_json: { trade?: boolean; data?: boolean };
  last_synced_at: string | null;
  integration?: {
    id: string;
    provider: string;
    label: string;
    status: string;
    last_verified_at: string | null;
    last_success_at: string | null;
  };
}

export interface BrokerIntegration {
  id: string;
  kind: string;
  provider: string;
  label: string;
  is_enabled: boolean;
  status: string;
  last_verified_at: string | null;
  last_success_at: string | null;
}

export function useBrokerAccounts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["broker-accounts"],
    queryFn: async () => {
      if (!user) return [];

      const response = await fetch(`/api/broker-accounts?user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return (result.data || []).map((d: any) => ({
        ...d,
        broker_env: (d.broker_env || 'LIVE') as 'LIVE' | 'DEMO',
        permissions_json: (d.permissions_json || { trade: true, data: true }) as { trade?: boolean; data?: boolean },
        meta_json: (d.meta_json || {}) as Record<string, unknown>,
      })) as BrokerAccountWithIntegration[];
    },
    enabled: !!user,
  });
}

export function useBrokerAccountsByIntegration(integrationId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["broker-accounts", integrationId],
    queryFn: async () => {
      if (!integrationId || !user) return [];
      
      const response = await fetch(`/api/broker-accounts?integration_id=${integrationId}&user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return (result.data || []).map((d: any) => ({
        ...d,
        broker_env: (d.broker_env || 'LIVE') as 'LIVE' | 'DEMO',
        permissions_json: (d.permissions_json || { trade: true, data: true }) as { trade?: boolean; data?: boolean },
        meta_json: (d.meta_json || {}) as Record<string, unknown>,
      })) as BrokerAccountWithIntegration[];
    },
    enabled: !!integrationId && !!user,
  });
}

export function useVerifiedBrokerIntegrations() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["verified-broker-integrations"],
    queryFn: async () => {
      if (!user) return [];

      const response = await fetch(`/api/integrations?user_id=${user.id}&kind=BROKER&status=VERIFIED,CONNECTED`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return (result.data || []) as BrokerIntegration[];
    },
    enabled: !!user,
  });
}

interface LinkBrokerAccountInput {
  name: string;
  broker_account_id: string;
  broker_connection_id: string;
  initial_balance: number;
  risk_tier: 'conservative' | 'moderate' | 'aggressive';
  risk_percent_per_trade?: number;
  max_risk_dollars_per_trade?: number;
  max_contracts_per_trade?: number;
  max_contracts_per_symbol?: number;
  max_total_exposure_contracts?: number;
  max_daily_loss_percent?: number;
  max_daily_loss_dollars?: number;
}

export function useLinkBrokerAccount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: LinkBrokerAccountInput) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/broker-accounts/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...input, user_id: user.id }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to link broker account');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["broker-accounts"] });
      toast({ title: "Broker account linked", description: "Trading account created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to link account", description: error.message, variant: "destructive" });
    },
  });
}
