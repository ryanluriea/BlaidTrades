import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings,
  Trash2,
  Key,
  Zap,
  Clock,
  Link2,
} from "lucide-react";
import {
  useIntegrations,
  useVerifyIntegration,
  useDisableIntegration,
  useDeleteIntegration,
  useSyncBrokerAccounts,
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

export function BrokersSection() {
  const { data: integrations = [], isLoading } = useIntegrations();
  const verifyIntegration = useVerifyIntegration();
  const disableIntegration = useDisableIntegration();
  const deleteIntegration = useDeleteIntegration();
  const syncBrokerAccounts = useSyncBrokerAccounts();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editIntegration, setEditIntegration] = useState<Integration | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDeleteId, setSelectedDeleteId] = useState<string | null>(null);

  const brokerIntegrations = integrations.filter(i => i.kind === 'BROKER');

  const handleAdd = () => {
    setEditIntegration(null);
    setAddDialogOpen(true);
  };

  const handleEdit = (integration: Integration) => {
    setEditIntegration(integration);
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

  // TRUTHFUL status colors - UNVERIFIED is distinct from VERIFIED
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'VERIFIED': return 'bg-profit/10 text-profit border-profit/20';
      case 'CONNECTED': return 'bg-profit/10 text-profit border-profit/20'; // Legacy
      case 'ERROR': return 'bg-loss/10 text-loss border-loss/20';
      case 'DEGRADED': return 'bg-warning/10 text-warning border-warning/20';
      case 'VERIFYING': return 'bg-primary/10 text-primary border-primary/20';
      case 'DISABLED': return 'bg-muted text-muted-foreground border-muted';
      case 'UNVERIFIED': return 'bg-muted text-muted-foreground border-muted-foreground/30';
      default: return 'bg-muted text-muted-foreground border-muted';
    }
  };

  // TRUTHFUL status icons
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'VERIFIED':
        return <CheckCircle className="w-4 h-4 text-profit" />;
      case 'CONNECTED':
        return <CheckCircle className="w-4 h-4 text-profit" />;
      case 'ERROR':
        return <XCircle className="w-4 h-4 text-loss" />;
      case 'DEGRADED':
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'VERIFYING':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'DISABLED':
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
      case 'UNVERIFIED':
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  // Map status to truthful display label
  const getStatusLabel = (status: string, integration: Integration) => {
    switch (status) {
      case 'VERIFIED': return 'Verified';
      case 'CONNECTED': 
        return integration.last_success_at ? 'Verified' : 'Unverified';
      case 'ERROR': return 'Error';
      case 'DEGRADED': return 'Degraded';
      case 'VERIFYING': return 'Verifying...';
      case 'DISABLED': return 'Disabled';
      case 'UNVERIFIED': return 'Unverified';
      default: return 'Unverified';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Broker Connections</CardTitle>
          </div>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" />
            Add Broker
          </Button>
        </div>
        <CardDescription>
          Connect broker accounts for live trading (Ironbeam, Tradovate)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : brokerIntegrations.length > 0 ? (
          <div className="space-y-4">
            {brokerIntegrations.map((integration) => (
              <div key={integration.id} className="space-y-3">
                <div className="p-4 rounded-lg border border-border bg-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Building2 className="w-5 h-5 text-primary" />
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
                        onClick={() => syncBrokerAccounts.mutate(integration.id)}
                        disabled={syncBrokerAccounts.isPending}
                      >
                        {syncBrokerAccounts.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3" />
                        )}
                        <span className="ml-1">Sync</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => verifyIntegration.mutate(integration.id)}
                        disabled={verifyIntegration.isPending}
                      >
                        <RefreshCw className="w-3 h-3" />
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
                </div>

                {/* Broker Accounts Table */}
                {integration.broker_accounts && integration.broker_accounts.length > 0 && (
                  <div className="ml-12 rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Account ID</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Currency</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {integration.broker_accounts.map((acc) => (
                          <TableRow key={acc.id}>
                            <TableCell className="font-mono text-xs">
                              {acc.broker_account_ref}
                            </TableCell>
                            <TableCell className="text-xs">{acc.broker_account_name}</TableCell>
                            <TableCell className="text-xs">{acc.currency}</TableCell>
                            <TableCell>
                              <Badge variant={acc.is_active ? 'default' : 'secondary'} className="text-[9px]">
                                {acc.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="h-6 text-xs">
                                <Link2 className="w-3 h-3 mr-1" />
                                Link to Account
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">No brokers connected</p>
            <p className="text-xs mt-1">Add Ironbeam or Tradovate for live trading</p>
            <Button size="sm" className="mt-4" onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-1" />
              Add Broker
            </Button>
          </div>
        )}
      </CardContent>

      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        kind="BROKER"
        editIntegration={editIntegration}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Broker Connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the broker connection and its credentials.
              Linked trading accounts will need to be reassigned.
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
    </Card>
  );
}
