import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { AppSettings } from "@shared/schema";

export { AppSettings };

const defaultSettings = {
  general: { timezone: "America/New_York", theme: "dark" },
  dataProviders: {},
  brokers: {},
  riskDefaults: { max_position_size: 2, max_daily_loss: 1000, default_stop_ticks: 20 },
  labs: { auto_evolution: true, auto_promote_to_shadow: true, live_requires_approval: true },
  appearance: { compact_mode: false, show_pnl_colors: true },
  promotionRules: {},
  arbiterSettings: {},
};

export function useAppSettings() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["app_settings", user?.id],
    queryFn: async (): Promise<AppSettings | null> => {
      if (!user?.id) return null;

      const response = await fetch(`/api/settings?user_id=${user.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      
      const result = await response.json();
      
      if (!result.data || Object.keys(result.data).length === 0) {
        const createResponse = await fetch(`/api/settings?user_id=${user.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(defaultSettings),
        });
        if (!createResponse.ok) throw new Error('Failed to create settings');
        const createResult = await createResponse.json();
        return createResult.data;
      }
      
      return result.data;
      
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000, // 10 minutes - settings rarely change
  });
}

export function useUpdateAppSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: Partial<AppSettings>) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const response = await fetch(`/api/settings?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      const result = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });
}
