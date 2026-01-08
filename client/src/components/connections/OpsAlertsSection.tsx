import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Phone,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings,
  Trash2,
  Key,
  Clock,
  MessageSquare,
  Send,
  TestTube,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import http from "@/lib/http";

export function OpsAlertsSection() {
  const { data: integrations = [], isLoading } = useIntegrations();
  const verifyIntegration = useVerifyIntegration();
  const disableIntegration = useDisableIntegration();
  const deleteIntegration = useDeleteIntegration();
  const { session } = useAuth();
  const { toast } = useToast();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editIntegration, setEditIntegration] = useState<Integration | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDeleteId, setSelectedDeleteId] = useState<string | null>(null);
  const [testSmsDialogOpen, setTestSmsDialogOpen] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState("");
  const [testingSms, setTestingSms] = useState(false);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);

  const opsAlertsIntegrations = integrations.filter(i => i.kind === 'OPS_ALERTS');

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

  // Express endpoint for SMS alerts - SINGLE CONTROL PLANE (no Supabase Edge Functions)
  const handleTestSms = async () => {
    if (!selectedIntegrationId || !testPhoneNumber) return;
    
    setTestingSms(true);
    try {
      const response = await http.post<{ success: boolean; error?: string; trace_id?: string }>(
        "/api/alerts/sms/test",
        { 
          integration_id: selectedIntegrationId,
          to_number: testPhoneNumber,
          message: "BlaidAgent test SMS - Your Twilio integration is working correctly!",
          test_mode: true,
        }
      );

      if (!response.ok) {
        throw new Error(response.error || "SMS test request failed");
      }
      
      if (response.data?.success) {
        toast({ title: "Test SMS sent", description: `Sent to ${testPhoneNumber}` });
        setTestSmsDialogOpen(false);
        setTestPhoneNumber("");
      } else {
        toast({ 
          title: "SMS failed", 
          description: response.data?.error || "Unknown error", 
          variant: "destructive" 
        });
      }
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : "Unknown error";
      toast({ title: "SMS test failed", description: errMessage, variant: "destructive" });
    } finally {
      setTestingSms(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONNECTED': return 'bg-profit/10 text-profit border-profit/20';
      case 'ERROR': return 'bg-loss/10 text-loss border-loss/20';
      case 'VERIFYING': return 'bg-primary/10 text-primary border-primary/20';
      case 'DISABLED': return 'bg-muted text-muted-foreground border-muted';
      default: return 'bg-warning/10 text-warning border-warning/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'CONNECTED':
        return <CheckCircle className="w-4 h-4 text-profit" />;
      case 'ERROR':
        return <XCircle className="w-4 h-4 text-loss" />;
      case 'VERIFYING':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'DISABLED':
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'TWILIO':
        return <Phone className="w-5 h-5 text-primary" />;
      case 'DISCORD':
        return <MessageSquare className="w-5 h-5 text-primary" />;
      case 'SLACK':
        return <Send className="w-5 h-5 text-primary" />;
      default:
        return <Phone className="w-5 h-5 text-primary" />;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Ops / Alerts</CardTitle>
          </div>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" />
            Add Channel
          </Button>
        </div>
        <CardDescription>
          SMS, Discord, and Slack notifications for critical alerts
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : opsAlertsIntegrations.length > 0 ? (
          <div className="space-y-4">
            {opsAlertsIntegrations.map((integration) => (
              <div key={integration.id} className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      {getProviderIcon(integration.provider)}
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
                      <span className="ml-1">{integration.status}</span>
                    </Badge>
                    {integration.provider === 'TWILIO' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedIntegrationId(integration.id);
                          setTestSmsDialogOpen(true);
                        }}
                      >
                        <TestTube className="w-3 h-3 mr-1" />
                        Test
                      </Button>
                    )}
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
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Phone className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">No alert channels configured</p>
            <p className="text-xs mt-1">Add Twilio for SMS or Discord/Slack for webhooks</p>
            <Button size="sm" className="mt-4" onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-1" />
              Add Channel
            </Button>
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Alert Types</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="outline" className="text-[9px]">Promotion Ready</Badge>
            <Badge variant="outline" className="text-[9px]">Redis Down</Badge>
            <Badge variant="outline" className="text-[9px]">Stale Data</Badge>
            <Badge variant="outline" className="text-[9px]">Broker Reject</Badge>
            <Badge variant="outline" className="text-[9px]">Audit Fail</Badge>
          </div>
        </div>
      </CardContent>

      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        kind="OPS_ALERTS"
        editIntegration={editIntegration}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert Channel?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this alert channel and its credentials.
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

      {/* Test SMS Dialog */}
      <Dialog open={testSmsDialogOpen} onOpenChange={setTestSmsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test SMS</DialogTitle>
            <DialogDescription>
              Enter a phone number to receive a test SMS message.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                value={testPhoneNumber}
                onChange={(e) => setTestPhoneNumber(e.target.value)}
                placeholder="+1234567890"
              />
              <p className="text-xs text-muted-foreground">
                Include country code (e.g., +1 for US)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestSmsDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleTestSms} 
              disabled={!testPhoneNumber || testingSms}
            >
              {testingSms && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
