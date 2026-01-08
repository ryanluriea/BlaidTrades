/**
 * Archetypes hooks
 * MIGRATED: Supabase → Express API
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface ArchetypeTestRun {
  id: string;
  archetypeId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  summaryJson: Record<string, any>;
  artifactsJson: Record<string, any>;
  logsJson: Record<string, any>;
  createdAt: string;
}

interface Archetype {
  id: string;
  key: string;
  name: string;
  category: string;
  isActive: boolean;
  version: number;
  tags: string[];
  description: string | null;
  defaultConfigJson: Record<string, any>;
}

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response;
}

export function useAllArchetypes() {
  return useQuery({
    queryKey: ["all-archetypes"],
    queryFn: async () => {
      const response = await fetchWithAuth('/api/archetypes');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch archetypes');
      }

      return (data.data || []) as Archetype[];
    },
  });
}

export function useActiveArchetypes() {
  return useQuery({
    queryKey: ["active-archetypes"],
    queryFn: async () => {
      const response = await fetchWithAuth('/api/archetypes?active=true');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch archetypes');
      }

      const archetypes = (data.data || []) as Archetype[];
      return archetypes.filter(a => a.isActive);
    },
  });
}

export function useArchetypeByKey(key: string | undefined) {
  return useQuery({
    queryKey: ["archetype", key],
    queryFn: async () => {
      if (!key) return null;
      
      const response = await fetchWithAuth(`/api/archetypes/${key}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch archetype');
      }

      return data.data as Archetype | null;
    },
    enabled: !!key,
  });
}

export function useArchetypeTestRun(archetypeId: string | undefined) {
  return useQuery({
    queryKey: ["archetype-test-run", archetypeId],
    queryFn: async () => {
      if (!archetypeId) return null;
      
      const response = await fetchWithAuth(`/api/archetypes/${archetypeId}/test-runs?limit=1`);
      const data = await response.json();

      if (!data.success) {
        return null;
      }

      const runs = data.data || [];
      return runs[0] as ArchetypeTestRun | null;
    },
    enabled: !!archetypeId,
  });
}

export function useArchetypeTestSummary() {
  return useQuery({
    queryKey: ["archetype-test-summary"],
    queryFn: async () => {
      const archetypesRes = await fetchWithAuth('/api/archetypes');
      const archetypesData = await archetypesRes.json();

      if (!archetypesData.success) {
        throw new Error(archetypesData.error || 'Failed to fetch archetypes');
      }

      const archetypes = (archetypesData.data || []) as Archetype[];

      const testRunResults = await Promise.all(
        archetypes.map(arch => 
          fetchWithAuth(`/api/archetypes/${arch.id}/test-runs?limit=1`)
            .then(r => r.json())
            .catch(() => null)
        )
      );

      return archetypes.map((arch, idx) => ({
        ...arch,
        latestTestRun: testRunResults[idx]?.data?.[0] || null,
      }));
    },
  });
}

export function useRunArchetypeTest() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ archetypeId, testTypes }: { archetypeId: string; testTypes?: string[] }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/archetype-test-runner', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetypeId, testTypes }),
      });

      if (!response.ok) {
        if (response.status === 501) {
          const data = await response.json();
          throw new Error(data.message || 'Archetype testing not implemented');
        }
        throw new Error('Test run failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["archetype-test-run"] });
      queryClient.invalidateQueries({ queryKey: ["archetype-test-summary"] });
      toast({
        title: `Test ${data.status?.toUpperCase() || 'COMPLETED'}`,
        description: `${data.archetypeName || 'Archetype'}: ${data.results?.length || 0} tests completed`,
        variant: data.status === "fail" ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Test failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateBotFromArchetype() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      archetypeId,
      name,
      description,
      accountId,
      mode,
      overrides,
    }: {
      archetypeId: string;
      name: string;
      description?: string;
      accountId?: string;
      mode?: "BACKTEST_ONLY" | "SIM_LIVE" | "SHADOW" | "LIVE";
      overrides?: Record<string, unknown>;
    }) => {
      if (!user?.id) throw new Error("Not authenticated");

      const archetypeRes = await fetchWithAuth(`/api/archetypes/${archetypeId}`);
      const archetypeData = await archetypeRes.json();

      if (!archetypeData.success || !archetypeData.data) {
        throw new Error("Archetype not found");
      }

      const archetype = archetypeData.data;

      const defaultConfig = archetype.defaultConfigJson || {};
      const strategyConfig = {
        ...defaultConfig,
        ...overrides,
      };

      const botRes = await fetch('/api/bots', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          archetypeId,
          strategyConfig,
          riskConfig: {
            maxDailyLoss: 500,
            stopLossTicks: 20,
            maxPositionSize: 1,
          },
          mode: mode || "BACKTEST_ONLY",
          status: "idle",
          evolutionStatus: "untested",
          evolutionMode: "auto",
        }),
      });

      if (!botRes.ok) {
        throw new Error('Failed to create bot');
      }

      const botData = await botRes.json();
      const bot = botData.data;

      await fetch('/api/bot-generations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: bot.id,
          generationNumber: 1,
          isCurrent: true,
          strategyConfig,
          riskConfig: bot.riskConfig,
          mutationNotes: `Created from archetype: ${archetype.name} v${archetype.version || 1}`,
        }),
      });

      if (accountId && mode && mode !== "BACKTEST_ONLY") {
        await fetch('/api/bot-instances', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId: bot.id,
            accountId,
            mode,
            status: "idle",
          }),
        });
      }

      return { bot, archetype };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
      toast({
        title: "Bot created",
        description: `${data.bot.name} created from ${data.archetype.name}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create bot",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
