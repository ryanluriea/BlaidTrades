import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface EvolutionSeed {
  candidate_id: string;
  session_id: string;
  bot_id?: string;
  locked_hypothesis: string;
  allowed_mutations: string[];
  disallowed_mutations: string[];
  origin_thesis: string;
  regime_tags: string[];
}

export function useSendToEvolution() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      candidate_id: string;
      session_id: string;
      user_id: string;
    }) => {
      const response = await fetch('/api/strategy-evolution/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error('Failed to send to evolution');
      const json = await response.json();
      return json.data as { 
        bot_id: string; 
        bot_name: string;
        evolution_seed: EvolutionSeed;
      };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot-jobs"] });
      toast({ 
        title: "Sent to Evolution", 
        description: `Bot "${data.bot_name}" created and queued for evolution` 
      });
    },
    onError: (error) => {
      toast({ title: "Evolution failed", description: error.message, variant: "destructive" });
    },
  });
}
