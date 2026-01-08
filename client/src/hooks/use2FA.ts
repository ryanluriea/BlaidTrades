import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useSecurityGate } from "@/contexts/SecurityGateContext";
import { toast } from "sonner";
import type { UserSecurity as SchemaUserSecurity } from "@shared/schema";

export interface UserSecurity {
  user_id: string;
  two_factor_enabled: boolean;
  last_2fa_at: string | null;
  failed_2fa_attempts: number;
  locked_until: string | null;
}

function mapUserSecurity(s: SchemaUserSecurity): UserSecurity {
  return {
    user_id: s.userId,
    two_factor_enabled: s.twoFactorEnabled ?? false,
    last_2fa_at: s.last2faAt?.toISOString() || null,
    failed_2fa_attempts: s.failed2faAttempts ?? 0,
    locked_until: s.lockedUntil?.toISOString() || null,
  };
}

export function use2FA() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { restDisabledUntil } = useSecurityGate();
  const [pendingCode, setPendingCode] = useState("");

  const restDisabled = !!restDisabledUntil && restDisabledUntil > Date.now();

  const {
    data: securitySettings,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["user-security", user?.id],
    queryFn: async (): Promise<UserSecurity | null> => {
      if (!user) return null;
      
      const response = await fetch(`/api/user-security?user_id=${user.id}`, {
        credentials: "include",
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data ? mapUserSecurity(json.data) : null;
    },
    enabled: !!user && !restDisabled,
    retry: 2,
    retryDelay: 1000,
  });

  const sendCodeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/2fa/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ user_id: user?.id }),
      });

      if (!response.ok) throw new Error("Failed to send code");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Verification code sent");
    },
    onError: (error) => {
      toast.error(`Failed to send code: ${error.message}`);
    },
  });

  const verifyCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetch("/api/2fa/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code, user_id: user?.id }),
      });

      if (!response.ok) throw new Error("Invalid code");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-security"] });
      toast.success("2FA verification successful");
      setPendingCode("");
    },
    onError: (error) => {
      toast.error(`Verification failed: ${error.message}`);
    },
  });

  const enable2FAMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch("/api/user-security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: user.id,
          twoFactorEnabled: true,
        }),
      });

      if (!response.ok) throw new Error("Failed to enable 2FA");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-security"] });
      toast.success("2FA enabled");
    },
    onError: (error) => {
      toast.error(`Failed to enable 2FA: ${error.message}`);
    },
  });

  const disable2FAMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch("/api/user-security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: user.id,
          twoFactorEnabled: false,
        }),
      });

      if (!response.ok) throw new Error("Failed to disable 2FA");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-security"] });
      toast.success("2FA disabled");
    },
    onError: (error) => {
      toast.error(`Failed to disable 2FA: ${error.message}`);
    },
  });

  return {
    securitySettings,
    isLoading,
    isError,
    error,
    pendingCode,
    setPendingCode,
    sendCode: sendCodeMutation.mutate,
    isSendingCode: sendCodeMutation.isPending,
    verifyCode: verifyCodeMutation.mutate,
    isVerifying: verifyCodeMutation.isPending,
    enable2FA: enable2FAMutation.mutate,
    isEnabling2FA: enable2FAMutation.isPending,
    disable2FA: disable2FAMutation.mutate,
    isDisabling2FA: disable2FAMutation.isPending,
    is2FAEnabled: securitySettings?.two_factor_enabled ?? false,
    isLocked: securitySettings?.locked_until 
      ? new Date(securitySettings.locked_until) > new Date() 
      : false,
  };
}

export function useCheckSecurityGate() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["security-gate-check", user?.id],
    queryFn: async () => {
      if (!user) return { requiresVerification: false };

      const response = await fetch(`/api/user-security?user_id=${user.id}`, {
        credentials: "include",
      });

      if (!response.ok) return { requiresVerification: false };
      const json = await response.json();
      const security = json.data;

      if (!security) return { requiresVerification: false };

      const is2FAEnabled = security.twoFactorEnabled ?? false;
      const lastVerified = security.last2faAt ? new Date(security.last2faAt) : null;
      const hoursSinceLastVerification = lastVerified 
        ? (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60) 
        : Infinity;

      return {
        requiresVerification: is2FAEnabled && hoursSinceLastVerification > 24,
        is2FAEnabled,
        lastVerified: lastVerified?.toISOString() || null,
      };
    },
    enabled: !!user,
    staleTime: 60000,
  });
}
