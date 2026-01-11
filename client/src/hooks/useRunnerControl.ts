import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface StartRunnerParams {
  botId: string;
  reason?: 'USER_START' | 'AUTO_HEAL' | 'PROMOTION' | 'SCHEDULE';
  accountId?: string;
}

interface RestartRunnerParams {
  botId: string;
  reason?: 'USER_RESTART' | 'AUTO_HEAL' | 'STALE_RECOVERY' | 'ERROR_RECOVERY';
}

interface RunnerResponse {
  success: boolean;
  instance_id?: string;
  mode?: string;
  activity_state?: string;
  account_id?: string;
  error?: string;
}

export function useStartRunner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ botId, reason = 'USER_START', accountId }: StartRunnerParams): Promise<RunnerResponse> => {
      const response = await fetch('/api/runners/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bot_id: botId,
          reason,
          account_id: accountId,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to start runner');

      return data;
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Runner Started",
        description: `Runner is now scanning in ${data.mode} mode`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bots-overview'] });
      queryClient.invalidateQueries({ queryKey: ['bot-runner-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['bot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['bot-detail', variables.botId] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to Start Runner",
        description: error.message,
      });
    },
  });
}

export function useRestartRunner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ botId, reason = 'USER_RESTART' }: RestartRunnerParams): Promise<RunnerResponse> => {
      const response = await fetch('/api/runners/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bot_id: botId,
          reason,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to restart runner');

      return data;
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Runner Restarted",
        description: `Runner recovered and now scanning`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bots-overview'] });
      queryClient.invalidateQueries({ queryKey: ['bot-runner-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['bot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['bot-detail', variables.botId] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to Restart Runner",
        description: error.message,
      });
    },
  });
}

export function useReconcileBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (botId: string): Promise<any> => {
      const response = await fetch(`/api/bots/${botId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dry_run: false,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Reconciliation failed');
      return data;
    },
    onSuccess: (data, botId) => {
      const healed = data.bots_healed > 0 || data.health_states_updated > 0;
      
      toast({
        title: healed ? "Bot Reconciled" : "Bot Already Healthy",
        description: healed 
          ? `Fixed ${data.bots_healed} issue(s) and updated ${data.health_states_updated} health state(s)`
          : "No issues found",
      });
      
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bots-overview'] });
      queryClient.invalidateQueries({ queryKey: ['bot-runner-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['bot-detail', botId] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Reconciliation Failed",
        description: error.message,
      });
    },
  });
}
