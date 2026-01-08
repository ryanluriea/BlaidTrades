import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Activity,
  Settings,
  Loader2,
  Zap,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface IntegrationData {
  provider: string;
  displayName?: string;
  category?: string;
  configured: boolean;
  verified?: boolean;
  lastVerifiedAt?: string | null;
  lastUsedAt?: string | null;
  count24h?: number;
  latencyMs?: number;
  errorCount?: number;
}

interface ProviderHealthPopoverProps {
  provider: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  integrationData?: IntegrationData;
  children: React.ReactNode;
}

export function ProviderHealthPopover({
  provider,
  name,
  icon: IconComponent,
  color,
  integrationData,
  children,
}: ProviderHealthPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/integrations/test/${provider}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Connection test failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/status"] });
      toast.success(`${name} connection verified successfully`);
    },
    onError: (error: Error) => {
      toast.error(`${name} test failed: ${error.message}`);
    },
  });

  const getHealthStatus = () => {
    if (!integrationData?.configured) {
      return { 
        status: "not_configured", 
        label: "Not Configured", 
        color: "text-red-500",
        bgColor: "bg-red-500/10",
        borderColor: "border-red-500/30"
      };
    }
    if (integrationData?.verified) {
      return { 
        status: "healthy", 
        label: "Healthy", 
        color: "text-green-500",
        bgColor: "bg-green-500/10",
        borderColor: "border-green-500/30"
      };
    }
    return { 
      status: "degraded", 
      label: "Degraded", 
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      borderColor: "border-yellow-500/30"
    };
  };

  const healthStatus = getHealthStatus();

  const formatTimestamp = (ts?: string | null): string => {
    if (!ts) return "Never";
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="right">
        <div className={cn("p-3 border-b", healthStatus.bgColor, healthStatus.borderColor)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconComponent className={cn("h-4 w-4", color)} />
              <span className="font-medium text-sm">{name}</span>
            </div>
            <Badge variant="outline" className={cn("text-xs", healthStatus.color)}>
              {healthStatus.label}
            </Badge>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" />
                <span>Last Verified</span>
              </div>
              <span className={healthStatus.color}>
                {formatTimestamp(integrationData?.lastVerifiedAt)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Last Used</span>
              </div>
              <span>{formatTimestamp(integrationData?.lastUsedAt)}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>Requests (24h)</span>
              </div>
              <span className="font-mono">{integrationData?.count24h ?? 0}</span>
            </div>

            {integrationData?.latencyMs !== undefined && (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  <span>Latency</span>
                </div>
                <span className={cn(
                  "font-mono",
                  integrationData.latencyMs < 200 ? "text-green-500" :
                  integrationData.latencyMs < 1000 ? "text-yellow-500" : "text-red-500"
                )}>
                  {integrationData.latencyMs}ms
                </span>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => testConnectionMutation.mutate()}
            disabled={testConnectionMutation.isPending || !integrationData?.configured}
            data-testid={`button-test-${provider}`}
          >
            {testConnectionMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Test Connection
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SECRET_KEY_MAP: Record<string, string> = {
  unusual_whales: "UNUSUAL_WHALES_API_KEY",
  fred: "FRED_API_KEY",
  finnhub: "FINNHUB_API_KEY",
  news_api: "NEWS_API_KEY",
  marketaux: "MARKETAUX_API_KEY",
  fmp: "FMP_API_KEY",
  databento: "DATABENTO_API_KEY",
  polygon: "POLYGON_API_KEY",
  alphavantage: "ALPHAVANTAGE_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  ironbeam: "IRONBEAM_API_KEY_1",
  ironbeam_2: "IRONBEAM_API_KEY_2",
  ironbeam_3: "IRONBEAM_API_KEY_3",
  tradovate: "TRADOVATE_APP_ID",
};

interface ProviderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  integrationData?: IntegrationData;
}

export function ProviderSettingsDialog({
  open,
  onOpenChange,
  provider,
  name,
  icon: IconComponent,
  color,
  integrationData,
}: ProviderSettingsDialogProps) {
  const queryClient = useQueryClient();
  const secretKeyName = SECRET_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;

  const testMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/integrations/test/${provider}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Test failed");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/status"] });
      toast.success(`${name} connection verified`);
    },
    onError: (error: Error) => {
      toast.error(`Test failed: ${error.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconComponent className={cn("h-5 w-5", color)} />
            {name} Settings
          </DialogTitle>
          <DialogDescription>
            Manage your API credentials for {name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border">
            <div>
              <div className="text-sm font-medium">Connection Status</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {integrationData?.configured ? (
                  integrationData?.verified ? (
                    <span className="text-green-500 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Connected and verified
                    </span>
                  ) : (
                    <span className="text-yellow-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Configured but not verified
                    </span>
                  )
                ) : (
                  <span className="text-red-500 flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> Not configured
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !integrationData?.configured}
              data-testid={`button-test-connection-${provider}`}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-key" className="text-sm">
              Secret Key Name
            </Label>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 font-mono text-xs">
              {secretKeyName}
            </div>
            <p className="text-xs text-muted-foreground">
              This key should be set in your environment secrets
            </p>
          </div>

          <div className="p-3 rounded-md border border-blue-500/30 bg-blue-500/10 space-y-2">
            <div className="text-xs font-medium flex items-center gap-1.5 text-blue-400">
              <Settings className="h-3 w-3" />
              How to Configure
            </div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Open the Secrets tab in the Replit sidebar</li>
              <li>Add or update the key: <code className="font-mono text-blue-400">{secretKeyName}</code></li>
              <li>Paste your API key value</li>
              <li>Click "Add Secret" or "Update"</li>
            </ol>
            <p className="text-xs text-muted-foreground mt-2">
              After updating, restart the server for changes to take effect.
            </p>
          </div>

          {integrationData?.configured && (
            <div className="p-3 rounded-md border border-border/50 bg-card/50 space-y-2">
              <div className="text-xs font-medium">Recent Activity</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-muted-foreground">Requests (24h)</div>
                <div className="text-right font-mono">{integrationData.count24h ?? 0}</div>
                <div className="text-muted-foreground">Last used</div>
                <div className="text-right">
                  {integrationData.lastUsedAt 
                    ? new Date(integrationData.lastUsedAt).toLocaleString()
                    : "Never"
                  }
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
