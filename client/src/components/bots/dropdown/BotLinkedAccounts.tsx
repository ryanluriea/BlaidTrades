import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useBotInstances } from "@/hooks/useBotDetails";
import { useDeleteBotInstance, useStartBotInstance, useStopBotInstance } from "@/hooks/useBotInstances";
import { useBot } from "@/hooks/useBots";
import { AttachToAccountDialog } from "../AttachToAccountDialog";
import { Link2, Play, Square, Trash2, Plus } from "lucide-react";
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
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotLinkedAccountsProps {
  botId: string;
}

export function BotLinkedAccounts({ botId }: BotLinkedAccountsProps) {
  const { data: instances, isLoading, isError } = useBotInstances(botId);
  const { data: bot } = useBot(botId);
  const startInstance = useStartBotInstance();
  const stopInstance = useStopBotInstance();
  const deleteInstance = useDeleteBotInstance();
  
  const isDegraded = isError || (!isLoading && instances === undefined);
  
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  const handleDelete = (instanceId: string) => {
    setSelectedInstanceId(instanceId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedInstanceId) {
      deleteInstance.mutate(selectedInstanceId);
    }
    setDeleteDialogOpen(false);
    setSelectedInstanceId(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Linked Accounts & Instances
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner message="Instance data unavailable" variant="inline" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Linked Accounts & Instances
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-6 text-xs px-2"
            onClick={() => setAttachDialogOpen(true)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Attach
          </Button>
        </CardHeader>
        <CardContent className="p-3 pt-0">
        {instances && instances.length > 0 ? (
            <div className="space-y-2">
              {instances.map((instance) => {
                // Check if this is a sandbox (VIRTUAL/SIM account with sandbox balance)
                const isSandbox = instance.sandbox_current_balance !== null && instance.sandbox_current_balance !== undefined;
                const sandboxPnL = isSandbox && instance.sandbox_initial_balance 
                  ? (instance.sandbox_current_balance ?? 0) - instance.sandbox_initial_balance 
                  : 0;
                
                return (
                <div 
                  key={instance.id} 
                  className="flex items-center justify-between bg-muted/30 rounded p-2 gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium truncate">
                        {instance.account?.name || "Unknown Account"}
                      </p>
                      {isSandbox && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                          Sandbox
                        </span>
                      )}
                    </div>
                    {isSandbox && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ${(instance.sandbox_current_balance ?? 0).toLocaleString()} 
                        <span className={sandboxPnL >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {' '}({sandboxPnL >= 0 ? '+' : ''}${sandboxPnL.toLocaleString()})
                        </span>
                      </p>
                    )}
                    <div className="flex gap-1 mt-0.5">
                      <StatusBadge status={instance.account?.account_type as any} />
                      <StatusBadge status={instance.mode as any} />
                      <StatusBadge status={instance.status as any} />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {instance.status === "running" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => stopInstance.mutate(instance.id)}
                        disabled={stopInstance.isPending}
                      >
                        <Square className="w-3 h-3" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => startInstance.mutate(instance.id)}
                        disabled={startInstance.isPending}
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => handleDelete(instance.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )})}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No linked accounts. Attach this bot to an account to start trading.
            </div>
          )}
        </CardContent>
      </Card>

      {bot && (
        <AttachToAccountDialog
          open={attachDialogOpen}
          onOpenChange={setAttachDialogOpen}
          bot={bot}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Bot Instance</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to detach this bot from the account? 
              This will stop any active trading.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
