import { useEffect, useMemo, useRef, useState } from "react";
import { use2FA } from "@/hooks/use2FA";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useSecurityGate } from "@/contexts/SecurityGateContext";

interface TwoFactorGateProps {
  children: React.ReactNode;
  requirePrivileged?: boolean;
}

const GATE_BUILD_ID = "2025-12-16T16:16:00Z";

function maskHost(url?: string) {
  if (!url) return "unknown";
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function getStrictRawEnv(): string {
  // Vite only exposes VITE_* at runtime.
  return String((import.meta as any).env?.VITE_SECURITY_GATE_STRICT ?? "false");
}

function isSchemaCacheFailure(err: any): { status?: number; code?: string; message: string } {
  const status = err?.status ?? err?.response?.status;
  const code = err?.code ?? err?.error?.code;
  const message = String(err?.message ?? err?.error?.message ?? "");

  const isSchemaCache =
    status === 503 &&
    (code === "PGRST002" || message.toLowerCase().includes("schema cache"));

  return { status, code: isSchemaCache ? (code ?? "PGRST002") : code, message };
}

export function TwoFactorGate({ children, requirePrivileged = false }: TwoFactorGateProps) {
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const { strict, limitedMode, restFailCount, restDisabledUntil, lastRestError, markRestDegraded } =
    useSecurityGate();

  const {
    is2FAEnabled,
    isLocked,
    isLoading,
    isError,
    error,
    sendCode,
    isSendingCode,
    verifyCode,
    isVerifying,
    securitySettings,
  } = use2FA();
  
  // Derive verification status from security settings
  const lastVerifiedAt = securitySettings?.last_2fa_at ? new Date(securitySettings.last_2fa_at) : null;
  const hoursSinceVerification = lastVerifiedAt 
    ? (Date.now() - lastVerifiedAt.getTime()) / (1000 * 60 * 60) 
    : Infinity;
  const needs2FAVerification = is2FAEnabled && hoursSinceVerification > 24;
  const needsPrivileged2FA = requirePrivileged && needs2FAVerification;
  const is2FARequired = is2FAEnabled;

  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  // Hard-stop: this screen must never spin forever.
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const [msElapsed, setMsElapsed] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);

  const supabaseHost = maskHost((import.meta as any).env?.VITE_SUPABASE_URL);
  const strictRaw = getStrictRawEnv();

  // PROOF OF DEPLOY: log once on mount.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[SecurityGate] mount", {
      build: GATE_BUILD_ID,
      strictRaw,
      strict,
      limitedMode,
      supabaseHost,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Robust timeout: measure elapsed from first mount; do NOT reset on retries.
  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      setMsElapsed(0);
      startedAtRef.current = Date.now();
      return;
    }

    const i = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setMsElapsed(elapsed);
      if (elapsed >= 10_000) setTimedOut(true);
    }, 200);

    return () => window.clearInterval(i);
  }, [isLoading]);

  const failure = useMemo(() => {
    if (timedOut) {
      return { status: 504, code: "TIMEOUT", message: "Security check timed out" };
    }
    return isSchemaCacheFailure(error);
  }, [error, timedOut]);

  const shouldFailOpenToLimitedMode =
    !strict &&
    !requirePrivileged &&
    (timedOut || (failure.status === 503 && failure.code === "PGRST002"));

  useEffect(() => {
    if (!shouldFailOpenToLimitedMode) return;
    markRestDegraded({
      endpoint: "db:user_security",
      status: failure.status,
      code: failure.code,
      message:
        failure.status === 504
          ? "Security check timed out"
          : failure.message || "Schema cache rebuilding (PGRST002)",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFailOpenToLimitedMode]);

  // LIMITED MODE: fail open ONLY for non-privileged access when REST is degraded.
  if (shouldFailOpenToLimitedMode) {
    return <>{children}</>;
  }

  const Watermark = () => (
    <div className="text-[11px] text-muted-foreground font-mono">
      build: {GATE_BUILD_ID} | strictRaw: {String(strictRaw)} | strict: {String(strict)} | limited: {String(limitedMode)}
      <br />
      backend: {supabaseHost} | restDisabledUntil: {restDisabledUntil ? new Date(restDisabledUntil).toISOString() : "null"}
    </div>
  );

  const DebugPanel = () => (
    <div className="mt-3 rounded-lg border bg-card p-3">
      <div className="grid gap-2 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">msElapsed</span>
          <span className="font-mono">{msElapsed}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">timedOut</span>
          <span className="font-mono">{String(timedOut)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">restFailCount</span>
          <span className="font-mono">{restFailCount}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">lastRestError</span>
          <span className="font-mono">
            {lastRestError
              ? `${lastRestError.endpoint} | ${lastRestError.status ?? ""} | ${lastRestError.code ?? ""}`
              : "null"}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">rest/v1 host</span>
          <span className="font-mono">{supabaseHost}</span>
        </div>
      </div>
    </div>
  );

  // Strict mode OR privileged action: show an error screen (never infinite).
  if (isError || timedOut) {
    const anyErr: any = error;
    const status = timedOut ? 504 : anyErr?.status ?? anyErr?.response?.status ?? 503;
    const message = timedOut
      ? "Security check timed out"
      : String(anyErr?.message ?? anyErr?.error?.message ?? "Failed to load 2FA status");
    const requestId = anyErr?.requestId ?? anyErr?.error?.requestId;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-2xl space-y-3">
          <ErrorBanner
            endpoint="db:user_security"
            status={status}
            message={
              requirePrivileged && !strict
                ? "Security service degraded — privileged actions are disabled in Limited Mode"
                : message
            }
            requestId={requestId}
            onRetry={() => {
              setTimedOut(false);
              queryClient.invalidateQueries({ queryKey: ["user-security"] });
            }}
          />

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => setDebugOpen((v) => !v)}>
              {debugOpen ? "Hide Debug" : "Debug"}
            </Button>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>

          <Watermark />
          {debugOpen && <DebugPanel />}
        </div>
      </div>
    );
  }

  // Simple loading state (hard-capped at 10s by timedOut)
  if (isLoading && !timedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Loading security checks…</CardTitle>
            <CardDescription>Verifying your session and 2FA status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">Please wait (max 10s)…</div>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setDebugOpen((v) => !v)}>
                {debugOpen ? "Hide Debug" : "Debug"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTimedOut(false);
                  startedAtRef.current = Date.now();
                  queryClient.invalidateQueries({ queryKey: ["user-security"] });
                }}
              >
                Retry
              </Button>
            </div>
            <Watermark />
            {debugOpen && <DebugPanel />}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {(() => {
        // If 2FA is not required/enabled, pass through
        if (!is2FARequired && !requirePrivileged) {
          return <>{children}</>;
        }

        // Check if verification is needed
        const needsVerification = requirePrivileged ? needsPrivileged2FA : needs2FAVerification;

        if (!needsVerification) {
          return <>{children}</>;
        }

        // Check if account is locked
        if (isLocked) {
          return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
              <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                  </div>
                  <CardTitle>Account Locked</CardTitle>
                  <CardDescription>
                    Too many failed attempts. Please try again later.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          );
        }

        const handleSendCode = () => {
          sendCode();
          setCodeSent(true);
        };

        const handleVerify = () => {
          if (code.length === 6) {
            verifyCode(code);
          }
        };

        return (
          <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ShieldCheck className="w-6 h-6 text-primary" />
                </div>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>
                  {requirePrivileged
                    ? "This action requires recent 2FA verification."
                    : "Please verify your identity to continue."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!codeSent ? (
                  <Button className="w-full" onClick={handleSendCode} disabled={isSendingCode}>
                    {isSendingCode && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Send Verification Code
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-center text-muted-foreground">
                      Enter the 6-digit code sent to your phone
                    </p>
                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={code} onChange={setCode}>
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button className="w-full" onClick={handleVerify} disabled={code.length !== 6 || isVerifying}>
                      {isVerifying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Verify
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={handleSendCode} disabled={isSendingCode}>
                      Resend Code
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })()}
    </>
  );
}

