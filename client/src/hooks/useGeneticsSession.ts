import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { GeneticsConfig } from "./useStrategyLab";

export interface GeneticPoolStatus {
  session_id: string;
  current_generation: number;
  pool_size: number;
  species_count: number;
  elite_count: number;
  best_fitness: number | null;
  diversity_score: number | null;
  convergence_warning: boolean;
  genomes: GenomeInfo[];
}

export interface GenomeInfo {
  id: string;
  name: string;
  generation_number: number;
  species_id: string | null;
  scalar_fitness: number | null;
  pareto_rank: number | null;
  is_elite: boolean;
  is_immigrant: boolean;
  progenitor_a_id: string | null;
  progenitor_b_id: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

export interface SpeciesInfo {
  id: string;
  species_key: string;
  member_count: number;
  best_fitness: number | null;
  avg_fitness: number | null;
  generation_born: number;
  is_stagnant: boolean;
}

export function useGeneticsPool(sessionId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["genetics-pool", sessionId],
    queryFn: async (): Promise<GeneticPoolStatus | null> => {
      if (!sessionId) return null;

      const response = await fetch(`/api/genetics/pool/${sessionId}`, {
        credentials: 'include',
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!sessionId,
    refetchInterval: 5000,
  });
}

export function useGeneticsSpecies(sessionId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["genetics-species", sessionId],
    queryFn: async (): Promise<SpeciesInfo[]> => {
      if (!sessionId) return [];
      
      const response = await fetch(`/api/genetics/species/${sessionId}`, {
        credentials: 'include',
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!sessionId,
  });
}

export function useRunGeneticsGeneration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id, generations = 1 }: { session_id: string; generations?: number }) => {
      const response = await fetch('/api/genetics/run-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id, generations }),
      });

      if (!response.ok) throw new Error('Failed to run genetics cycle');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, { session_id }) => {
      queryClient.invalidateQueries({ queryKey: ["genetics-pool", session_id] });
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", session_id] });
      toast({ title: "Genetics cycle started" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to run genetics cycle", description: error.message, variant: "destructive" });
    },
  });
}

export function useForceRecombination() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id, progenitor_a_id, progenitor_b_id }: { 
      session_id: string; 
      progenitor_a_id: string;
      progenitor_b_id: string;
    }) => {
      const response = await fetch('/api/genetics/force-recombine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id, progenitor_a_id, progenitor_b_id }),
      });

      if (!response.ok) throw new Error('Recombination failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, { session_id }) => {
      queryClient.invalidateQueries({ queryKey: ["genetics-pool", session_id] });
      toast({ title: "Genetic recombination complete" });
    },
    onError: (error: Error) => {
      toast({ title: "Recombination failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useInjectImmigrant() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id }: { session_id: string }) => {
      const response = await fetch('/api/genetics/inject-immigrant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id }),
      });

      if (!response.ok) throw new Error('Failed to inject immigrant');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, { session_id }) => {
      queryClient.invalidateQueries({ queryKey: ["genetics-pool", session_id] });
      toast({ title: "Immigrant genome injected" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to inject immigrant", description: error.message, variant: "destructive" });
    },
  });
}

export function useRetireGenome() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id, candidate_id, reason }: { 
      session_id: string; 
      candidate_id: string;
      reason?: string;
    }) => {
      const response = await fetch('/api/genetics/retire-genome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id, candidate_id, reason }),
      });

      if (!response.ok) throw new Error('Failed to retire genome');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, { session_id }) => {
      queryClient.invalidateQueries({ queryKey: ["genetics-pool", session_id] });
      toast({ title: "Genome retired" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to retire genome", description: error.message, variant: "destructive" });
    },
  });
}

export function useExportElite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id, candidate_id }: { session_id: string; candidate_id: string }) => {
      const response = await fetch('/api/genetics/export-elite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id, candidate_id }),
      });

      if (!response.ok) throw new Error('Export failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Elite exported to LAB bot" });
    },
    onError: (error: Error) => {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ session_id, name }: { session_id: string; name: string }) => {
      const trimmedName = name.trim();
      if (trimmedName.length < 3 || trimmedName.length > 80) {
        throw new Error('Name must be 3-80 characters');
      }
      
      const response = await fetch(`/api/strategy-lab/sessions/${session_id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) throw new Error('Failed to rename');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, { session_id }) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", session_id] });
      toast({ title: "Session renamed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to rename", description: error.message, variant: "destructive" });
    },
  });
}

export function useCreateGeneticsSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      name?: string;
      symbol?: string;
      timeframe?: string;
      genetics_config?: Partial<GeneticsConfig>;
      universe?: string;
      contract_preference?: string;
      discovery_enabled?: boolean;
    }) => {
      const response = await fetch('/api/genetics/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error('Failed to create session');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-sessions"] });
      toast({ title: "Genetics session created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create session", description: error.message, variant: "destructive" });
    },
  });
}
