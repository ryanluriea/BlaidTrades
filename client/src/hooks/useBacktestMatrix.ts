import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface MatrixSpec {
  timeframes: string[];
  horizons: string[];
  folds: number;
  regimes: string[];
}

export interface MatrixAggregate {
  median_pf: number | null;
  worst_pf: number | null;
  median_max_dd_pct: number | null;
  worst_max_dd_pct: number | null;
  trade_count_total: number;
  consistency_score: number;
  stability_score: number;
  cells_with_data: number;
  total_cells: number;
}

export interface MatrixCell {
  id: string;
  timeframe: string;
  horizon: string;
  fold_index: number;
  regime_tag: string;
  status: string;
  total_trades: number;
  profit_factor: number | null;
  win_rate: number | null;
  max_drawdown_pct: number | null;
}

export interface MatrixRun {
  id: string;
  bot_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  matrix_spec: MatrixSpec;
  total_cells: number;
  completed_cells: number;
  failed_cells: number;
  aggregate: MatrixAggregate | null;
  best_cell: any;
  worst_cell: any;
}

const DEFAULT_MATRIX_SPEC: MatrixSpec = {
  timeframes: ['5m', '15m', '1h'],
  horizons: ['90d', '1y'],
  folds: 3,
  regimes: ['all'],
};

export function useLatestMatrixRun(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['matrix-run', 'latest', botId],
    queryFn: async (): Promise<MatrixRun | null> => {
      if (!botId) return null;
      
      const response = await fetch(`/api/backtest-matrix/runs/latest?bot_id=${botId}`, {
        credentials: 'include',
      });
      
      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!botId,
    staleTime: 30000,
  });
}

export function useMatrixRunStatus(matrixRunId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['matrix-run', 'status', matrixRunId],
    queryFn: async () => {
      if (!matrixRunId) return null;
      
      const response = await fetch(`/api/backtest-matrix/runs/${matrixRunId}/status`, {
        credentials: 'include',
      });
      
      if (!response.ok) return null;
      const json = await response.json();
      return json.data;
    },
    enabled: !!user && !!matrixRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' ? 5000 : false;
    },
  });
}

export function useMatrixCells(matrixRunId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['matrix-cells', matrixRunId],
    queryFn: async (): Promise<MatrixCell[]> => {
      if (!matrixRunId) return [];
      
      const response = await fetch(`/api/backtest-matrix/runs/${matrixRunId}/cells`, {
        credentials: 'include',
      });
      
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!matrixRunId,
  });
}

export function useStartMatrixRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ botId, spec }: { botId: string; spec?: MatrixSpec }) => {
      const response = await fetch('/api/backtest-matrix/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          bot_id: botId,
          matrix_spec: spec || DEFAULT_MATRIX_SPEC,
        }),
      });
      
      if (!response.ok) throw new Error('Failed to start matrix');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data, { botId }) => {
      queryClient.invalidateQueries({ queryKey: ['matrix-run', 'latest', botId] });
      toast.success(`Matrix started with ${data?.total_cells || 0} cells`, {
        description: `Testing across ${data?.spec?.timeframes?.length || 0} timeframes`,
      });
    },
    onError: (error) => {
      toast.error(`Failed to start matrix: ${error.message}`);
    },
  });
}

export function useCancelMatrixRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (matrixRunId: string) => {
      const response = await fetch(`/api/backtest-matrix/runs/${matrixRunId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to cancel matrix');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matrix-run'] });
      toast.info('Matrix run cancelled');
    },
  });
}

export function useBotMatrixAggregate(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bot-matrix-aggregate', botId],
    queryFn: async () => {
      if (!botId) return null;
      
      const response = await fetch(`/api/bots/${botId}/matrix-aggregate`, {
        credentials: 'include',
      });
      
      if (!response.ok) return null;
      const json = await response.json();
      return json.data;
    },
    enabled: !!user && !!botId,
  });
}
