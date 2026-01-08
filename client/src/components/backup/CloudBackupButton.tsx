import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CloudBackupDialog } from "./CloudBackupDialog";

interface BackupStatus {
  connected: boolean;
  backingUp: boolean;
  lastBackupSuccess: boolean | null;
  lastBackupAt: string | null;
}

interface CloudBackupButtonProps {
  variant?: "icon" | "full";
  className?: string;
}

export function CloudBackupButton({ variant = "icon", className }: CloudBackupButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: statusData } = useQuery<{ success: boolean; data: BackupStatus }>({
    queryKey: ["/api/cloud-backup/status"],
    queryFn: async () => {
      const res = await fetch("/api/cloud-backup/status", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const status = statusData?.data;

  const getStatusColor = () => {
    if (!status?.connected) return "bg-muted-foreground/50";
    if (status?.backingUp) return "bg-yellow-500 animate-pulse";
    if (status?.lastBackupSuccess === false) return "bg-destructive";
    if (status?.lastBackupSuccess === true) return "bg-emerald-500";
    return "bg-emerald-500";
  };

  const getTooltip = () => {
    if (!status?.connected) return "Google Drive not connected - Click to connect";
    if (status?.backingUp) return "Backup in progress...";
    if (status?.lastBackupAt) {
      const date = new Date(status.lastBackupAt);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor(diffMs / (1000 * 60));
      
      if (diffMins < 60) {
        return `Last backup: ${diffMins}m ago`;
      } else if (diffHours < 24) {
        return `Last backup: ${diffHours}h ago`;
      } else {
        return `Last backup: ${Math.floor(diffHours / 24)}d ago`;
      }
    }
    return "Cloud Backup - No backups yet";
  };

  if (variant === "full") {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground hover:bg-sidebar-accent w-full",
            className
          )}
          data-testid="button-cloud-backup-mobile"
        >
          <div className="relative">
            <Cloud className="w-5 h-5" />
            <span 
              className={cn(
                "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar",
                getStatusColor()
              )}
            />
          </div>
          <span>Cloud Backup</span>
          {status?.backingUp && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
        </button>
        <CloudBackupDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        title={getTooltip()}
        className={cn(
          "flex items-center justify-center p-2 rounded-md transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full relative",
          className
        )}
        onClick={() => setDialogOpen(true)}
        data-testid="button-cloud-backup"
      >
        {status?.backingUp ? (
          <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />
        ) : (
          <>
            <Cloud className="w-4 h-4" />
            <span 
              className={cn(
                "absolute top-1.5 right-1.5 w-2 h-2 rounded-full border border-sidebar",
                getStatusColor()
              )}
            />
          </>
        )}
      </button>
      <CloudBackupDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
