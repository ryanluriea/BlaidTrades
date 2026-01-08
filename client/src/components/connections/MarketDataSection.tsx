import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Database,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings,
  Trash2,
  Key,
  Activity,
  Clock,
  Newspaper,
  TrendingUp,
} from "lucide-react";
import {
  useIntegrations,
  useVerifyIntegration,
  useDisableIntegration,
  useDeleteIntegration,
  type Integration,
} from "@/hooks/useIntegrations";
import { AddIntegrationDialog } from "@/components/integrations/AddIntegrationDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { UnusualWhalesCoveragePanel } from "./UnusualWhalesCoveragePanel";

export function MarketDataSection() {
  const { data: integrations = [], isLoading } = useIntegrations();
  const verifyIntegration = useVerifyIntegration();
  const disableIntegration = useDisableIntegration();
  const deleteIntegration = useDeleteIntegration();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogKind, setAddDialogKind] = useState<'MARKET_DATA' | 'ALT_DATA'>('MARKET_DATA');
  const [editIntegration, setEditIntegration] = useState<Integration | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDeleteId, setSelectedDeleteId] = useState<string | null>(null);

  const marketDataIntegrations = integrations.filter(i => i.kind === 'MARKET_DATA');
  const altDataIntegrations = integrations.filter(i => i.kind === 'ALT_DATA');
  const allDataIntegrations = [...marketDataIntegrations, ...altDataIntegrations];
  const hasUnusualWhales = altDataIntegrations.some(i => i.provider === 'UNUSUAL_WHALES');

  const handleAddMarketData = () => {
    setEditIntegration(null);
    setAddDialogKind('MARKET_DATA');
    setAddDialogOpen(true);
  };

  const handleAddAltData = () => {
    setEditIntegration(null);
    setAddDialogKind('ALT_DATA');
    setAddDialogOpen(true);
  };

  const handleEdit = (integration: Integration) => {
    setEditIntegration(integration);
    setAddDialogKind(integration.kind as 'MARKET_DATA' | 'ALT_DATA');
    setAddDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setSelectedDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedDeleteId) {
      deleteIntegration.mutate(selectedDeleteId);
    }
    setDeleteDialogOpen(false);
    setSelectedDeleteId(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'VERIFIED':
      case 'CONNECTED':
        return <CheckCircle className="w-4 h-4 text-profit" />;
      case 'ERROR':
        return <XCircle className="w-4 h-4 text-loss" />;
      case 'DEGRADED':
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'VERIFYING':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'VERIFIED':
      case 'CONNECTED':
        return 'bg-profit/10 text-profit border-profit/20';
      case 'ERROR':
        return 'bg-loss/10 text-loss border-loss/20';
      case 'DEGRADED':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'VERIFYING':
        return 'bg-primary/10 text-primary border-primary/20';
      default:
        return 'bg-muted text-muted-foreground border-muted';
    }
  };

  const getStatusLabel = (status: string, integration: Integration) => {
    switch (status) {
      case 'VERIFIED':
        return 'Verified';
      case 'CONNECTED':
        return integration.last_success_at ? 'Verified' : 'Unverified';
      case 'ERROR':
        return 'Error';
      case 'DEGRADED':
        return 'Degraded';
      case 'VERIFYING':
        return 'Verifying...';
      case 'DISABLED':
        return 'Disabled';
      default:
        return 'Unverified';
    }
  };

  const getProviderIcon = (integration: Integration) => {
    if (integration.kind === 'ALT_DATA') {
      if (integration.provider === 'UNUSUAL_WHALES') {
        return <TrendingUp className="w-5 h-5 text-primary" />;
      }
      return <Newspaper className="w-5 h-5 text-primary" />;
    }
    return <Database className="w-5 h-5 text-primary" />;
  };

  const renderIntegrationCard = (integration: Integration) => (
    <div
      key={integration.id}
      className="p-4 rounded-lg border border-border bg-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            {getProviderIcon(integration)}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{integration.label}</p>
              {integration.is_primary && (
                <Badge variant="secondary" className="text-[10px]">Primary</Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {integration.provider}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {integration.key_fingerprint && (
                <span className="font-mono flex items-center gap-1">
                  <Key className="w-3 h-3" />
                  {integration.key_fingerprint}
                </span>
              )}
              {integration.last_verified_at && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Verified {format(new Date(integration.last_verified_at), "MMM d, HH:mm")}
                </span>
              )}
            </div>
            {integration.last_error_message && integration.status === 'ERROR' && (
              <p className="text-xs text-loss mt-1 line-clamp-1">
                {integration.last_error_message}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${getStatusColor(integration.status)} text-[10px]`}>
            {getStatusIcon(integration.status)}
            <span className="ml-1">{getStatusLabel(integration.status, integration)}</span>
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => verifyIntegration.mutate(integration.id)}
            disabled={verifyIntegration.isPending}
          >
            {verifyIntegration.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(integration)}
          >
            <Settings className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => handleDelete(integration.id)}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Switch
            checked={integration.is_enabled}
            onCheckedChange={(checked) => {
              if (!checked) disableIntegration.mutate(integration.id);
            }}
          />
        </div>
      </div>
      {integration.kind === 'MARKET_DATA' && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Latency:</span>
            <span className="font-mono">--ms</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Last Tick:</span>
            <span className="font-mono">--</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Database className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Coverage:</span>
            <Badge variant="outline" className="text-[9px]">Futures</Badge>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {hasUnusualWhales && <UnusualWhalesCoveragePanel />}
      
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Data Sources</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  allDataIntegrations
                    .filter(i => i.is_enabled)
                    .forEach(i => verifyIntegration.mutate(i.id));
                }}
                disabled={verifyIntegration.isPending}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${verifyIntegration.isPending ? 'animate-spin' : ''}`} />
                Test All
              </Button>
              <Button size="sm" onClick={handleAddMarketData}>
                <Plus className="w-4 h-4 mr-1" />
                Add Provider
              </Button>
            </div>
          </div>
          <CardDescription>
            Market data feeds and alternative data sources (news, sentiment, options flow)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Market Data Section */}
              {marketDataIntegrations.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Market Data</span>
                    <Badge variant="outline" className="text-[10px]">{marketDataIntegrations.length}</Badge>
                  </div>
                  {marketDataIntegrations.map(renderIntegrationCard)}
                </div>
              )}
              
              {/* Alt Data Section */}
              {altDataIntegrations.length > 0 && (
                <>
                  {marketDataIntegrations.length > 0 && <Separator className="my-4" />}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Newspaper className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Alternative Data</span>
                        <Badge variant="outline" className="text-[10px]">{altDataIntegrations.length}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" onClick={handleAddAltData}>
                        <Plus className="w-3 h-3 mr-1" />
                        Add Source
                      </Button>
                    </div>
                    {altDataIntegrations.map(renderIntegrationCard)}
                  </div>
                </>
              )}
              
              {/* Empty State */}
              {allDataIntegrations.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">No data providers connected</p>
                  <p className="text-xs mt-1">Add Databento, Polygon, or alternative data sources</p>
                  <div className="flex gap-2 justify-center mt-4">
                    <Button size="sm" onClick={handleAddMarketData}>
                      <Plus className="w-4 h-4 mr-1" />
                      Add Market Data
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleAddAltData}>
                      <Plus className="w-4 h-4 mr-1" />
                      Add Alt Data
                    </Button>
                  </div>
                </div>
              )}
              
              {/* Show add alt data button if only market data exists */}
              {marketDataIntegrations.length > 0 && altDataIntegrations.length === 0 && (
                <>
                  <Separator className="my-4" />
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Newspaper className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">No alternative data sources</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleAddAltData}>
                      <Plus className="w-3 h-3 mr-1" />
                      Add Source
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        kind={addDialogKind}
        editIntegration={editIntegration}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Integration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the integration and its credentials.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
