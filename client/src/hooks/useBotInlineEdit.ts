import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export function useUpdateBotSymbol() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      botId, 
      oldSymbol, 
      newSymbol 
    }: { 
      botId: string; 
      oldSymbol: string; 
      newSymbol: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch(`/api/bots/${botId}/symbol`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          old_symbol: oldSymbol,
          new_symbol: newSymbol,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update symbol");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot_instances"] });
      toast({ title: "Symbol updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update symbol", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateBotStage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      botId, 
      oldStage, 
      newStage,
      accountId,
    }: { 
      botId: string; 
      oldStage: string; 
      newStage: string;
      accountId?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          old_stage: oldStage,
          new_stage: newStage,
          account_id: accountId,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update stage");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot_instances"] });
      toast({ title: "Stage updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update stage", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateBotAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      botId,
      oldAccountId,
      newAccountId,
      stage,
    }: {
      botId: string;
      oldAccountId: string | null;
      newAccountId: string | null;
      stage: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          old_account_id: oldAccountId,
          new_account_id: newAccountId,
          stage,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update account");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot_instances"] });
      queryClient.invalidateQueries({ queryKey: ["bots_enriched"] });
      toast({ title: "Account updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update account",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRequestLiveApproval() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      botId, 
      reason,
    }: { 
      botId: string; 
      reason?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/request-live-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          user_id: user.id,
          reason,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to request approval");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["governance-approvals"] });
      toast({ 
        title: "Approval token generated", 
        description: `Token expires at ${new Date(data.expires_at).toLocaleTimeString()}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to request approval", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateBotStageWithApproval() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      botId, 
      oldStage, 
      newStage,
      accountId,
      approvalToken,
    }: { 
      botId: string; 
      oldStage: string; 
      newStage: string;
      accountId?: string;
      approvalToken?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${botId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          old_stage: oldStage,
          new_stage: newStage,
          account_id: accountId,
          user_id: user.id,
          approval_token: approvalToken,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        if (data.requires_approval) {
          throw Object.assign(new Error(data.error), { requiresApproval: true });
        }
        throw new Error(data.error || "Failed to update stage");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot_instances"] });
      queryClient.invalidateQueries({ queryKey: ["governance-approvals"] });
      toast({ title: "Stage updated" });
    },
    onError: (error: Error & { requiresApproval?: boolean }) => {
      if (!error.requiresApproval) {
        toast({ title: "Failed to update stage", description: error.message, variant: "destructive" });
      }
    },
  });
}
