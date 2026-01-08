import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface BacktestSweepParams {
  botId: string;
  windowLengthDays?: number;
  numWindows?: number;
  startDate?: string;
  endDate?: string;
}

export function useBacktestSweep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: BacktestSweepParams) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch('/api/backtest-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bot_id: params.botId,
          window_length_days: params.windowLengthDays || 30,
          num_windows: params.numWindows || 10,
          start_date: params.startDate,
          end_date: params.endDate,
        }),
      });

      if (!response.ok) throw new Error('Failed to start sweep');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ 
        title: "Backtest Sweep Queued", 
        description: `Walk-forward test started with multiple windows.`
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to start sweep", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useWindowResults(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["window-results", botId],
    queryFn: async () => {
      if (!botId) return [];
      
      const response = await fetch(`/api/backtest-sweep/results?bot_id=${botId}`, {
        credentials: 'include',
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!botId,
  });
}
