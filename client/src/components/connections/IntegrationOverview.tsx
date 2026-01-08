import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  ExternalLink,
  Clock,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { http } from "@/lib/http";
import { formatDistanceToNow } from "date-fns";

interface Integration {
  provider: string;
  category: string;
  displayName: string;
  description: string;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  configured: boolean;
  connected: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
  last_used_by_bot_id: string | null;
  proof_of_use_count_24h: number;
  degraded: boolean;
  error_code: string | null;
  message: string;
  missing_env_vars: string[];
  suggested_fix: string | null;
  trace_id: string;
}

interface IntegrationStatusResponse {
  success: boolean;
  trace_id: string;
  data: {
    integrations: Integration[];
    summary: {
      total: number;
      configured: number;
      connected: number;
      degraded: number;
      withProofOfUse: number;
    };
  };
}

interface UsageEvent {
  id: string;
  bot_id: string | null;
  operation: string;
  status: string;
  latency_ms: number;
  created_at: string;
  trace_id: string;
}

export function IntegrationOverview() {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<Integration | null>(null);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const { data: statusData, isLoading, refetch } = useQuery<IntegrationStatusResponse>({
    queryKey: ['/api/integrations/status'],
    refetchInterval: 30000,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery<{ success: boolean; data: { events: UsageEvent[] } }>({
    queryKey: [`/api/integrations/${selectedProvider?.provider}/events`],
    enabled: !!selectedProvider,
  });

  const verifyMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await http.post('/api/integrations/verify', { provider });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/status'] });
    },
  });

  const handleCopyEnvVar = (envVar: string) => {
    navigator.clipboard.writeText(envVar);
    setCopiedVar(envVar);
    setTimeout(() => setCopiedVar(null), 2000);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  const integrations = statusData?.data?.integrations || [];
  const summary = statusData?.data?.summary || { total: 0, configured: 0, connected: 0, degraded: 0, withProofOfUse: 0 };

  const getStatusIcon = (integration: Integration) => {
    if (integration.connected) {
      return <CheckCircle className="w-4 h-4 text-profit" />;
    }
    if (integration.configured && integration.degraded) {
      return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
    return <XCircle className="w-4 h-4 text-loss" />;
  };

  const getStatusBadge = (integration: Integration) => {
    if (integration.connected) {
      return <Badge variant="outline" className="text-profit border-profit">Connected</Badge>;
    }
    if (integration.configured && integration.degraded) {
      return <Badge variant="outline" className="text-warning border-warning">Needs Verify</Badge>;
    }
    if (!integration.configured) {
      return <Badge variant="outline" className="text-loss border-loss">Not Configured</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'data': return 'text-blue-500';
      case 'broker': return 'text-purple-500';
      case 'ai': return 'text-pink-500';
      case 'alerts': return 'text-orange-500';
      case 'storage': return 'text-cyan-500';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-3">
          <div className="text-2xl font-bold">{summary.total}</div>
          <div className="text-xs text-muted-foreground">Total Providers</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-profit">{summary.connected}</div>
          <div className="text-xs text-muted-foreground">Connected</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-warning">{summary.degraded}</div>
          <div className="text-xs text-muted-foreground">Needs Verify</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-loss">{summary.total - summary.configured}</div>
          <div className="text-xs text-muted-foreground">Not Configured</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-blue-500">{summary.withProofOfUse}</div>
          <div className="text-xs text-muted-foreground">With Usage</div>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-lg">All Integrations</CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            data-testid="button-refresh-integrations"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Verified</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Usage 24h</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {integrations.map((integration) => (
                <TableRow 
                  key={integration.provider}
                  data-testid={`row-integration-${integration.provider}`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(integration)}
                      {integration.displayName}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={getCategoryColor(integration.category)}>
                      {integration.category}
                    </span>
                  </TableCell>
                  <TableCell>{getStatusBadge(integration)}</TableCell>
                  <TableCell>
                    {integration.last_verified_at ? (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(integration.last_verified_at), { addSuffix: true })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {integration.last_used_at ? (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(integration.last_used_at), { addSuffix: true })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="text-xs">
                      {integration.proof_of_use_count_24h}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => verifyMutation.mutate(integration.provider)}
                        disabled={verifyMutation.isPending}
                        data-testid={`button-verify-${integration.provider}`}
                      >
                        {verifyMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedProvider(integration)}
                        data-testid={`button-details-${integration.provider}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedProvider} onOpenChange={() => setSelectedProvider(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedProvider && getStatusIcon(selectedProvider)}
              {selectedProvider?.displayName} Connection Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedProvider && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card className="p-3">
                  <div className="text-sm font-medium">Configuration</div>
                  <div className="mt-2">
                    {selectedProvider.configured ? (
                      <div className="flex items-center gap-2 text-profit">
                        <CheckCircle className="w-4 h-4" />
                        <span>Configured</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-loss">
                        <XCircle className="w-4 h-4" />
                        <span>Missing: {selectedProvider.missing_env_vars.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-sm font-medium">Connection</div>
                  <div className="mt-2">
                    {selectedProvider.connected ? (
                      <div className="flex items-center gap-2 text-profit">
                        <CheckCircle className="w-4 h-4" />
                        <span>Connected</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-warning">
                        <AlertTriangle className="w-4 h-4" />
                        <span>{selectedProvider.message}</span>
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              <Card className="p-4">
                <div className="text-sm font-medium mb-3">How to Connect</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Required Environment Variables:</div>
                    <div className="space-y-1">
                      {selectedProvider.requiredEnvVars.map((envVar) => (
                        <div key={envVar} className="flex items-center justify-between bg-muted/50 p-2 rounded">
                          <code className="text-xs">{envVar}</code>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleCopyEnvVar(envVar)}
                          >
                            {copiedVar === envVar ? (
                              <Check className="w-3 h-3 text-profit" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {selectedProvider.optionalEnvVars.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Optional:</div>
                      <div className="space-y-1">
                        {selectedProvider.optionalEnvVars.map((envVar) => (
                          <div key={envVar} className="flex items-center justify-between bg-muted/30 p-2 rounded">
                            <code className="text-xs text-muted-foreground">{envVar}</code>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleCopyEnvVar(envVar)}
                            >
                              {copiedVar === envVar ? (
                                <Check className="w-3 h-3 text-profit" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-blue-500/10 p-3 rounded text-sm">
                    <div className="font-medium mb-1">Instructions:</div>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                      <li>Click on "Secrets" in the Replit sidebar (lock icon)</li>
                      <li>Add each required variable above with your API key value</li>
                      <li>Click "Verify" to test the connection</li>
                    </ol>
                  </div>

                  <Button 
                    className="w-full"
                    onClick={() => {
                      verifyMutation.mutate(selectedProvider.provider);
                    }}
                    disabled={verifyMutation.isPending}
                    data-testid={`button-verify-modal-${selectedProvider.provider}`}
                  >
                    {verifyMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Verify Connection
                  </Button>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium">Proof of Use (24h)</div>
                  <Badge variant="secondary">{selectedProvider.proof_of_use_count_24h} events</Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-muted/30 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Last Used</div>
                    <div className="text-sm">
                      {selectedProvider.last_used_at 
                        ? formatDistanceToNow(new Date(selectedProvider.last_used_at), { addSuffix: true })
                        : 'Never'}
                    </div>
                  </div>
                  <div className="bg-muted/30 p-2 rounded">
                    <div className="text-xs text-muted-foreground">Last Verified</div>
                    <div className="text-sm">
                      {selectedProvider.last_verified_at 
                        ? formatDistanceToNow(new Date(selectedProvider.last_verified_at), { addSuffix: true })
                        : 'Never'}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground mb-2">Recent Events</div>
                <ScrollArea className="h-48">
                  {eventsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(eventsData?.data?.events || []).map((event) => (
                        <div 
                          key={event.id}
                          className="flex items-center justify-between p-2 bg-muted/30 rounded text-xs"
                        >
                          <div className="flex items-center gap-2">
                            {event.status === 'OK' ? (
                              <CheckCircle className="w-3 h-3 text-profit" />
                            ) : (
                              <XCircle className="w-3 h-3 text-loss" />
                            )}
                            <span>{event.operation}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{event.latency_ms}ms</span>
                            <span>{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</span>
                          </div>
                        </div>
                      ))}
                      {(!eventsData?.data?.events || eventsData.data.events.length === 0) && (
                        <div className="text-center text-muted-foreground py-4">
                          No usage events recorded yet
                        </div>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
