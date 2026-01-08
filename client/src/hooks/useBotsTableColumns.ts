/**
 * Bots table columns hook
 * MIGRATED: Supabase → Express API
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";

export interface ColumnConfig {
  key: string;
  label: string;
  locked?: boolean;
  defaultVisible: boolean;
  align?: "left" | "center" | "right";
  width?: string;
}

export const BOTS_COLUMNS: ColumnConfig[] = [
  { key: "expand", label: "", locked: true, defaultVisible: true, width: "w-8" },
  { key: "name", label: "Name", locked: true, defaultVisible: true, width: "min-w-[120px] flex-1" },
  { key: "symbol", label: "Symbol", locked: true, defaultVisible: true, width: "w-16" },
  { key: "stage", label: "Stage", locked: true, defaultVisible: true, width: "w-20" },
  { key: "mode", label: "Mode", defaultVisible: true, width: "w-20" },
  { key: "activity", label: "Activity", locked: true, defaultVisible: true, width: "w-24" },
  { key: "gen", label: "Gen", defaultVisible: true, width: "w-12", align: "center" },
  { key: "account", label: "Account", defaultVisible: true, width: "w-28" },
  { key: "pnl", label: "P&L", locked: true, defaultVisible: true, width: "w-20", align: "right" },
  { key: "maxdd", label: "Max DD", defaultVisible: true, width: "w-16", align: "right" },
  { key: "winrate", label: "Win%", locked: true, defaultVisible: true, width: "w-14", align: "right" },
  { key: "sharpe", label: "Sharpe", defaultVisible: true, width: "w-14", align: "right" },
  { key: "trades", label: "Trades", locked: true, defaultVisible: true, width: "w-14", align: "right" },
  { key: "health", label: "Health", defaultVisible: true, width: "w-16", align: "center" },
  { key: "actions", label: "", locked: true, defaultVisible: true, width: "w-10" },
  { key: "lastTrade", label: "Last Trade", defaultVisible: false, width: "w-20" },
  { key: "exposure", label: "Exposure", defaultVisible: false, width: "w-16", align: "right" },
  { key: "expectancy", label: "Expectancy", defaultVisible: false, width: "w-16", align: "right" },
  { key: "profitFactor", label: "PF", defaultVisible: false, width: "w-12", align: "right" },
];

const PREFS_KEY = "bots_table_columns";

function getDefaultVisibleColumns(): string[] {
  return BOTS_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
}

export function useBotsTableColumns() {
  const { user } = useAuth();
  const restOnline = useRestOnline();
  const queryClient = useQueryClient();

  const { data: visibleColumns, isLoading } = useQuery({
    queryKey: ["user_table_prefs", user?.id, PREFS_KEY],
    queryFn: async () => {
      if (!user) return getDefaultVisibleColumns();

      try {
        const response = await fetch(`/api/user-preferences?key=${PREFS_KEY}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          return getDefaultVisibleColumns();
        }

        const data = await response.json();

        if (data.success && data.data?.valueJson?.columns && Array.isArray(data.data.valueJson.columns)) {
          return data.data.valueJson.columns as string[];
        }

        return getDefaultVisibleColumns();
      } catch {
        return getDefaultVisibleColumns();
      }
    },
    enabled: !!user && restOnline,
  });

  const updateColumns = useMutation({
    mutationFn: async (columns: string[]) => {
      if (!user) throw new Error("Not authenticated");
      if (!restOnline) return columns;

      const response = await fetch(`/api/user-preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PREFS_KEY, valueJson: { columns } }),
      });

      if (!response.ok) {
        throw new Error('Failed to save preferences');
      }

      return columns;
    },
    onSuccess: (columns) => {
      queryClient.setQueryData(["user_table_prefs", user?.id, PREFS_KEY], columns);
    },
  });

  const effectiveColumns = visibleColumns || getDefaultVisibleColumns();

  const toggleColumn = (columnKey: string) => {
    const current = effectiveColumns;
    const column = BOTS_COLUMNS.find((c) => c.key === columnKey);

    if (column?.locked) return;

    const newColumns = current.includes(columnKey)
      ? current.filter((k) => k !== columnKey)
      : [...current, columnKey];

    updateColumns.mutate(newColumns);
  };

  const isColumnVisible = (columnKey: string): boolean => {
    return effectiveColumns.includes(columnKey);
  };

  const resetToDefaults = () => {
    updateColumns.mutate(getDefaultVisibleColumns());
  };

  return {
    columns: BOTS_COLUMNS,
    visibleColumns: effectiveColumns,
    isLoading: isLoading && restOnline,
    toggleColumn,
    isColumnVisible,
    resetToDefaults,
  };
}
