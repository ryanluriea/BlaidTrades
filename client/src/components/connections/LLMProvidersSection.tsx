import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  Plus,
  CheckCircle,
  Sparkles,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings,
  Trash2,
  Key,
  Clock,
  Zap,
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

export function LLMProvidersSection() {
  const { data: integrations = [], isLoading } = useIntegrations();
  const verifyIntegration = useVerifyIntegration();
  const disableIntegration = useDisableIntegration();
  const deleteIntegration = useDeleteIntegration();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editIntegration, setEditIntegration] = useState<Integration | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDeleteId, setSelectedDeleteId] = useState<string | null>(null);

  const llmIntegrations = integrations.filter(i => i.kind === 'AI_LLM' || i.kind === 'AI');

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
            <Brain className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">AI / LLM Providers</CardTitle>
          </div>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" />
            Add Provider
          </Button>
        </div>
        <CardDescription>
          AI models for briefings, analysis, and bot evolution
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Built-in Lovable AI */}
        <div className="p-4 rounded-lg border border-border bg-card mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">Lovable AI Gateway</p>
                  <Badge variant="secondary" className="text-[10px]">Built-in</Badge>
                  <Badge variant="default" className="text-[10px]">Primary</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Gemini 2.5 Flash / Pro • Auto-configured • No API key required
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-[9px]">Briefings</Badge>
                  <Badge variant="outline" className="text-[9px]">Evolution</Badge>
                  <Badge variant="outline" className="text-[9px]">Graduation</Badge>
                  <Badge variant="outline" className="text-[9px]">Analysis</Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-profit/10 text-profit border-profit/20 text-[10px]">
                <CheckCircle className="w-3 h-3 mr-1" />
                HEALTHY
              </Badge>
            </div>
          </div>
        </div>

        {/* User-added LLM providers */}
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : llmIntegrations.length > 0 ? (
          <div className="space-y-4">
            {llmIntegrations.map((integration) => (
              <div key={integration.id} className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      {integration.provider === 'OPENROUTER' ? (
                        <Zap className="w-5 h-5 text-primary" />
                      ) : (
                        <Brain className="w-5 h-5 text-primary" />
                      )}
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
                      {integration.provider === 'OPENROUTER' && integration.capabilities_json && (
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[9px]">
                            {(integration.capabilities_json as any).default_model || 'claude-3.5-sonnet'}
                          </Badge>
                          <Badge variant="outline" className="text-[9px]">Why Trade</Badge>
                          <Badge variant="outline" className="text-[9px]">Backtest Summary</Badge>
                        </div>
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
            ))}
          </div>
        ) : null}

        <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <p className="font-medium mb-1">About AI Providers</p>
          <p>
            The Lovable AI Gateway provides access to Google Gemini and OpenAI models without 
            requiring your own API keys. Add OpenRouter for multi-model routing with cost controls,
            or connect direct providers for specific use cases.
          </p>
        </div>
      </CardContent>

      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        kind="AI_LLM"
        editIntegration={editIntegration}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete AI Provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this AI provider and its credentials.
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
