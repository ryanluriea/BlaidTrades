import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface TournamentEntry {
  candidate_id: string;
  session_id: string;
  bot_id: string;
  universe: string;
  contract_preference: string;
  entered_at: string;
  status: 'PENDING' | 'COMPETING' | 'WINNER' | 'SURVIVOR' | 'ELIMINATED';
  score?: number;
}

export function useEnterTournament() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      candidate_id: string;
      session_id: string;
      user_id: string;
    }) => {
      const response = await fetch('/api/strategy-tournament/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error('Tournament entry failed');
      const json = await response.json();
      return json.data as { 
        bot_id: string; 
        bot_name: string;
        tournament_status: 'PENDING';
      };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ 
        title: "Entered Tournament", 
        description: `Bot "${data.bot_name}" is now competing in the tournament` 
      });
    },
    onError: (error) => {
      toast({ title: "Tournament entry failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useTournamentResults(botId: string | null) {
  return {
    status: null as 'WINNER' | 'SURVIVOR' | 'ELIMINATED' | null,
    score: null as number | null,
    rank: null as number | null,
  };
}
