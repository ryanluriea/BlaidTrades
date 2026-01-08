import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface UWCoverageItem {
  feature_key: string;
  endpoint: string;
  description: string;
  plan_required: string | null;
  proxy_symbols: string[];
  enabled: boolean;
  wired_to_signal_bus: boolean;
  wired_to_risk_engine: boolean;
  wired_to_why_panel: boolean;
  last_probe_at: string | null;
  last_probe_status: 'PASS' | 'FAIL' | 'DEGRADED' | 'UNVERIFIED' | 'PLAN_LIMITATION';
  last_probe_http: number | null;
  last_probe_latency_ms: number | null;
  last_probe_error: string | null;
}

export interface UWSignal {
  id: string;
  provider: string;
  feature_key: string;
  symbol: string | null;
  signal_timestamp: string;
  signal_type: string;
  strength: number;
  direction: string;
  payload_json: Record<string, unknown>;
}

export interface MacroRiskOverlay {
  risk_mode: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  confidence: number;
  drivers_json: Record<string, unknown>;
  last_computed_at: string;
}

export interface ProbeResult {
  feature_key: string;
  endpoint: string;
  status: 'PASS' | 'FAIL' | 'DEGRADED' | 'PLAN_LIMITATION';
  http_code?: number;
  latency_ms?: number;
  error?: string;
  sample_count?: number;
}

export function useUWCoverage() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['uw-coverage', user?.id],
    queryFn: async (): Promise<UWCoverageItem[]> => {
      if (!user?.id) return [];
      
      const response = await fetch(`/api/unusual-whales/coverage`, {
        credentials: "include",
      });
      
      if (!response.ok) return [];
      const json = await response.json();
      return json.data?.coverage || [];
    },
    enabled: !!user?.id,
    staleTime: 60000,
  });
}

export function useUWSignals(limit = 50) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['uw-signals', user?.id, limit],
    queryFn: async (): Promise<UWSignal[]> => {
      if (!user?.id) return [];
      
      const response = await fetch(`/api/unusual-whales/signals?limit=${limit}`, {
        credentials: "include",
      });
      
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });
}

export function useMacroRiskOverlay() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['macro-risk-overlay', user?.id],
    queryFn: async (): Promise<MacroRiskOverlay | null> => {
      if (!user?.id) return null;
      
      const response = await fetch(`/api/unusual-whales/risk-overlay`, {
        credentials: "include",
      });
      
      if (!response.ok) return null;
      const json = await response.json();
      return json.data?.overlay || null;
    },
    enabled: !!user?.id,
    staleTime: 60000,
  });
}

export function useUWProbe() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (featuresToProbe?: string[]): Promise<{
      status: string;
      results: ProbeResult[];
      summary: { pass: number; fail: number; plan_limitation: number };
    }> => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const response = await fetch('/api/unusual-whales/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ features_to_probe: featuresToProbe }),
      });
      
      if (!response.ok) throw new Error('Probe failed');
      const json = await response.json();
      return json.data || { status: 'stub', results: [], summary: { pass: 0, fail: 0, plan_limitation: 0 } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uw-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      
      if (data.summary.pass > 0) {
        toast.success(`Unusual Whales: ${data.summary.pass} endpoints verified`);
      }
      if (data.summary.fail > 0) {
        toast.warning(`${data.summary.fail} endpoints failed`);
      }
      if (data.summary.plan_limitation > 0) {
        toast.info(`${data.summary.plan_limitation} endpoints require higher plan`);
      }
    },
    onError: (error) => {
      toast.error(`Probe failed: ${error.message}`);
    },
  });
}

export function useUWFetchSignals() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const response = await fetch('/api/unusual-whales/fetch-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Fetch failed');
      const json = await response.json();
      return json.data || { success: true, signals: [] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uw-signals'] });
      queryClient.invalidateQueries({ queryKey: ['macro-risk-overlay'] });
      
      toast.success(`Fetched ${data.signals?.length || 0} signals from Unusual Whales`);
    },
    onError: (error) => {
      toast.error(`Signal fetch failed: ${error.message}`);
    },
  });
}

export function useUWUpdateCoverage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ feature_key, updates }: {
      feature_key: string;
      updates: Partial<{
        enabled: boolean;
        wired_to_signal_bus: boolean;
        wired_to_risk_engine: boolean;
        wired_to_why_panel: boolean;
      }>;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const response = await fetch('/api/unusual-whales/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feature_key, updates }),
      });
      
      if (!response.ok) throw new Error('Update failed');
      const json = await response.json();
      return json.data || { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uw-coverage'] });
    },
  });
}
