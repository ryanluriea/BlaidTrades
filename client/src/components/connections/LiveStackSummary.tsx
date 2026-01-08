import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Database,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Bot,
  Sparkles,
  Bell,
  Server,
  Shield,
} from "lucide-react";
import { http } from "@/lib/http";
import { useState } from "react";

interface ProviderStatus {
  providerId: string;
  configured: boolean;
  verified: boolean;
  connected: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
  proof_24h: number;
  last_used_by_bot_id: number | null;
  missing_env_vars: string[];
  error_code: string | null;
  suggested_fix: string | null;
}

interface LiveStackResponse {
  marketData: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  execution: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  llm: {
    primary: ProviderStatus | null;
    fallbacks: ProviderStatus[];
  };
  notifications: {
    primary: ProviderStatus | null;
    backups: ProviderStatus[];
  };
  infra: {
    database: { connected: boolean; type: string };
  };
  autonomyGates: {
    system_status: "OK" | "DEGRADED" | "BLOCKED";
    autonomy_allowed: boolean;
    blockers: Array<{
      code: string;
      severity: "critical" | "warning";
      reason_human: string;
      suggested_fix: string;
      trace_id: string;
    }>;
  };
}

const CATEGORY_CONFIG = {
  marketData: { label: "Market Data", icon: TrendingUp, color: "text-blue-500" },
  execution: { label: "Execution", icon: Bot, color: "text-green-500" },
  llm: { label: "AI/LLM", icon: Sparkles, color: "text-purple-500" },
  notifications: { label: "Notifications", icon: Bell, color: "text-yellow-500" },
};

function ProviderCard({ 
  provider, 
  isPrimary = false,
  onVerify 
}: { 
  provider: ProviderStatus; 
  isPrimary?: boolean;
  onVerify: (providerId: string) => void;
}) {
  const statusIcon = provider.connected ? (
    <CheckCircle className="w-4 h-4 text-green-500" />
  ) : provider.configured ? (
    <AlertTriangle className="w-4 h-4 text-yellow-500" />
  ) : (
    <XCircle className="w-4 h-4 text-muted-foreground" />
  );

  const statusLabel = provider.connected
    ? "Connected"
    : provider.verified
    ? "Verified"
    : provider.configured
    ? "Configured"
    : "Not Configured";

  return (
    <div className="flex items-center justify-between p-2 rounded bg-muted/30">
      <div className="flex items-center gap-2">
        {statusIcon}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">{provider.providerId}</span>
            {isPrimary && (
              <Badge variant="outline" className="text-xs">
                Primary
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {provider.proof_24h > 0 ? (
              <span>{provider.proof_24h} calls/24h</span>
            ) : (
              <span>{statusLabel}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {provider.configured && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onVerify(provider.providerId)}
                data-testid={`button-verify-${provider.providerId}`}
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Verify connection</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  primary,
  backups,
  onVerify,
}: {
  category: keyof typeof CATEGORY_CONFIG;
  primary: ProviderStatus | null;
  backups: ProviderStatus[];
  onVerify: (providerId: string) => void;
}) {
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  const hasConnected = primary?.connected || backups.some((b) => b.connected);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${config.color}`} />
        <span className="text-sm font-medium">{config.label}</span>
        {hasConnected ? (
          <Wifi className="w-3 h-3 text-green-500" />
        ) : (
          <WifiOff className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1 pl-6">
        {primary ? (
          <ProviderCard provider={primary} isPrimary onVerify={onVerify} />
        ) : (
          <div className="text-xs text-muted-foreground p-2">No primary provider</div>
        )}
        {backups.length > 0 && (
          <div className="text-xs text-muted-foreground mt-1 mb-1">Backups:</div>
        )}
        {backups.map((backup) => (
          <ProviderCard key={backup.providerId} provider={backup} onVerify={onVerify} />
        ))}
      </div>
    </div>
  );
}

export function LiveStackSummary() {
  const [verifying, setVerifying] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{
    success: boolean;
    liveStack?: LiveStackResponse;
  }>({
    queryKey: ["/api/system/status"],
  });

  const liveStack = data?.liveStack;

  const handleVerify = async (providerId: string) => {
    setVerifying(providerId);
    try {
      await http.post("/api/integrations/verify", { provider: providerId });
      await refetch();
    } catch (error) {
      console.error("Verify failed:", error);
    } finally {
      setVerifying(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Live Stack
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !liveStack) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Live Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4 text-sm">
            Unable to load live stack status
          </div>
        </CardContent>
      </Card>
    );
  }

  const { autonomyGates } = liveStack;
  const statusColors = {
    OK: "text-green-500",
    DEGRADED: "text-yellow-500",
    BLOCKED: "text-red-500",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="w-4 h-4" />
          Live Stack
        </CardTitle>
        <div className="flex items-center gap-2">
          {/* RULE: Only show badge when there's a problem - no "OK" badges */}
          {autonomyGates.system_status !== "OK" && (
            <Badge variant="destructive">
              <Shield className="w-3 h-3 mr-1" />
              {autonomyGates.system_status}
            </Badge>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => refetch()}
            data-testid="button-refresh-live-stack"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CategorySection
          category="marketData"
          primary={liveStack.marketData.primary}
          backups={liveStack.marketData.backups}
          onVerify={handleVerify}
        />
        <CategorySection
          category="execution"
          primary={liveStack.execution.primary}
          backups={liveStack.execution.backups}
          onVerify={handleVerify}
        />
        <CategorySection
          category="llm"
          primary={liveStack.llm.primary}
          backups={liveStack.llm.fallbacks}
          onVerify={handleVerify}
        />
        <CategorySection
          category="notifications"
          primary={liveStack.notifications.primary}
          backups={liveStack.notifications.backups}
          onVerify={handleVerify}
        />

        <div className="flex items-center gap-2 pt-2 border-t">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm">Database</span>
          {liveStack.infra.database.connected ? (
            <Badge variant="outline" className="text-green-500">
              <CheckCircle className="w-3 h-3 mr-1" />
              {liveStack.infra.database.type}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-red-500">
              <XCircle className="w-3 h-3 mr-1" />
              Disconnected
            </Badge>
          )}
        </div>

        {autonomyGates.blockers.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <div className="text-sm font-medium text-destructive">Blockers</div>
            {autonomyGates.blockers.map((blocker, i) => (
              <div key={i} className="text-xs p-2 bg-destructive/10 rounded">
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span className="font-medium">{blocker.code}</span>
                </div>
                <div className="text-muted-foreground mt-1">{blocker.reason_human}</div>
                <div className="text-blue-500 mt-1">{blocker.suggested_fix}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
