/**
 * Linked bots hooks
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns explicit degraded state on failure, never empty arrays
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface LinkedBot {
  id: string;
  botId: string;
  accountId: string;
  mode: string;
  status: string;
  currentPnl: number;
  dailyPnl: number;
  currentPosition: number;
  entryPrice: number | null;
  positionSide: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  bot: {
    id: string;
    name: string;
    symbol: string | null;
    status: string;
    totalPnl: number;
    winRate: number | null;
  } | null;
}

export interface LinkedBotsResult {
  data: LinkedBot[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

/**
 * Full account with linked bot count
 * NOTE: Using Record<string, any> & base fields because API returns full account object
 * with snake_case fields (current_balance, account_type, etc.) plus linked_bots_count
 */
export interface AccountWithLinkedBotCount {
  id: string;
  name: string;
  userId: string;
  account_type: string;
  accountType?: string;
  provider?: string;
  risk_tier?: string;
  initial_balance?: number | string;
  current_balance?: number | string;
  max_contracts_per_trade?: number;
  max_daily_loss_percent?: number | string;
  allow_shared_bots?: boolean;
  linked_bots_count: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  [key: string]: any; // Allow additional fields from API
}

export interface AccountsWithLinkedBotsResult {
  data: AccountWithLinkedBotCount[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

/**
 * Fetch linked bots for a specific account
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useLinkedBots(accountId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["linked_bots", accountId],
    queryFn: async (): Promise<LinkedBotsResult> => {
      const traceId = `lb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
        };
      }

      if (!accountId) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_ACCOUNT_ID",
          message: "Account ID required",
          trace_id: traceId,
        };
      }

      try {
        const response = await fetch(`/api/accounts/${accountId}/linked-bots`, {
          credentials: 'include',
        });

        // FAIL-CLOSED: Non-OK response = degraded
        if (!response.ok) {
          console.error("[useLinkedBots] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch linked bots (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: data.message || "API returned error",
            trace_id: traceId,
          };
        }

        return {
          data: data.data as LinkedBot[],
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useLinkedBots] Request failed:", err);
        return {
          data: null,
          degraded: true,
          error_code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
        };
      }
    },
    enabled: !!user && !!accountId,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });
}

/**
 * Get linked bot count for an account
 * Returns null if data is degraded (caller must handle)
 */
export function useLinkedBotsCount(accountId: string | undefined): number | null {
  const { data: result } = useLinkedBots(accountId);
  if (!result || result.degraded || result.data === null) {
    return null;
  }
  return result.data.length;
}

/**
 * Fetch all accounts with their linked bot counts
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useAccountsWithLinkedBotsCounts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["accounts_with_linked_bots_counts"],
    queryFn: async (): Promise<AccountsWithLinkedBotsResult> => {
      const traceId = `awlb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
        };
      }

      try {
        const [accountsRes, instancesRes] = await Promise.all([
          fetch('/api/accounts', { credentials: 'include' }),
          fetch('/api/bot-instances', { credentials: 'include' }),
        ]);

        // FAIL-CLOSED: If either endpoint fails, return degraded
        if (!accountsRes.ok || !instancesRes.ok) {
          console.error("[useAccountsWithLinkedBotsCounts] Endpoint failure:", {
            accounts: accountsRes.status,
            instances: instancesRes.status,
          });
          return {
            data: null,
            degraded: true,
            error_code: "ENDPOINT_FAILURE",
            message: `Failed to fetch data (accounts: ${accountsRes.status}, instances: ${instancesRes.status})`,
            trace_id: traceId,
          };
        }

        const accountsData = await accountsRes.json();
        const instancesData = await instancesRes.json();

        if (!accountsData.success || !instancesData.success) {
          return {
            data: null,
            degraded: true,
            error_code: "API_ERROR",
            message: "API returned error status",
            trace_id: traceId,
          };
        }

        const accounts = accountsData.data || [];
        const instances = instancesData.data || [];

        // Fix bot count: dedupe by botId per account (keep only latest instance per bot)
        // and only count active instances (running or recently active)
        const countMap = new Map<string, number>();
        const seenBotsByAccount = new Map<string, Set<string>>();
        
        instances.forEach((inst: any) => {
          if (!inst.accountId || !inst.botId) return;
          
          // Skip stopped/historical instances - only count running or recently active
          const status = (inst.status || '').toLowerCase();
          const isActive = status === 'running' || status === 'starting' || status === 'paused';
          if (!isActive) return;
          
          // Dedupe by botId within each account
          if (!seenBotsByAccount.has(inst.accountId)) {
            seenBotsByAccount.set(inst.accountId, new Set());
          }
          const seenBots = seenBotsByAccount.get(inst.accountId)!;
          
          if (!seenBots.has(inst.botId)) {
            seenBots.add(inst.botId);
            countMap.set(inst.accountId, (countMap.get(inst.accountId) || 0) + 1);
          }
        });

        const result = accounts.map((acc: any) => ({
          ...acc,
          linked_bots_count: countMap.get(acc.id) || 0,
        }));

        return {
          data: result,
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useAccountsWithLinkedBotsCounts] Request failed:", err);
        return {
          data: null,
          degraded: true,
          error_code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
        };
      }
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/**
 * Helper to check if linked bots data is degraded
 */
export function isLinkedBotsDegraded(result: LinkedBotsResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

/**
 * Helper to check if accounts with linked bots data is degraded
 */
export function isAccountsWithLinkedBotsDegraded(result: AccountsWithLinkedBotsResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}
