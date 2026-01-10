import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  Settings,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  AlertTriangle,
  Loader2,
  Package,
  Bot,
  Download,
  FolderOpen,
  FileText,
  FileJson,
  ChevronDown,
  Unlink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow, format, differenceInSeconds } from "date-fns";

function useCountdown(targetDate: string | null | undefined) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  
  useEffect(() => {
    if (!targetDate) {
      setTimeLeft("");
      return;
    }
    
    const calculateTimeLeft = () => {
      const target = new Date(targetDate);
      const now = new Date();
      const diffSecs = differenceInSeconds(target, now);
      
      if (diffSecs <= 0) {
        return "any moment";
      }
      
      const hours = Math.floor(diffSecs / 3600);
      const minutes = Math.floor((diffSecs % 3600) / 60);
      const seconds = diffSecs % 60;
      
      if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      } else {
        return `${seconds}s`;
      }
    };
    
    setTimeLeft(calculateTimeLeft());
    
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    
    return () => clearInterval(interval);
  }, [targetDate]);
  
  return timeLeft;
}

interface BackupMetadata {
  id: string;
  name: string;
  createdTime: string;
  size: string;
  description?: string;
}

interface BackupSettings {
  autoBackupEnabled: boolean;
  backupFrequency: "hourly" | "daily" | "weekly";
  backupRetentionCount: number;
  includeBacktests: boolean;
  includeTradeLogs: boolean;
  lastBackupAt: string | null;
  nextBackupAt: string | null;
}

interface CloudBackupDashboard {
  connected: boolean;
  settings: BackupSettings;
  status: {
    connected: boolean;
    folderExists: boolean;
    backupCount: number;
    latestBackup: BackupMetadata | null;
    totalSizeBytes: number;
  };
  recentBackups: BackupMetadata[];
}

interface CloudBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "overview" | "packs" | "backups" | "settings";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function ConnectGoogleDriveSection({ onConnected }: { onConnected: () => void }) {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch("/api/auth/google-drive/authorize", { 
        credentials: "include",
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json();
      
      if (data.success && data.data?.authUrl) {
        window.location.href = data.data.authUrl;
      } else {
        toast({ 
          title: "Connection Failed", 
          description: data.message || "Could not start Google Drive authorization. Please ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.",
          variant: "destructive" 
        });
        setIsConnecting(false);
      }
    } catch (error: any) {
      const message = error.name === 'AbortError' 
        ? "Request timed out. Server is busy - try again in a moment."
        : String(error);
      toast({ 
        title: "Connection Failed", 
        description: message,
        variant: "destructive" 
      });
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 select-none">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Cloud className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-lg font-medium">Connect to Google Drive</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Link your Google Drive to automatically backup your bots, strategies, and settings to the cloud.
        </p>
      </div>
      <Button
        onClick={handleConnect}
        disabled={isConnecting}
        className="gap-2"
        data-testid="button-connect-google-drive"
      >
        {isConnecting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Cloud className="w-4 h-4" />
        )}
        {isConnecting ? "Connecting..." : "Connect Google Drive"}
      </Button>
      <p className="text-xs text-muted-foreground">
        You will be redirected to authorize BlaidTrades to access your Drive.
      </p>
    </div>
  );
}

export function CloudBackupDialog({ open, onOpenChange, initialTab = "overview" }: CloudBackupDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  
  // Reset to initialTab when dialog opens and refetch fresh data
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      // Invalidate cache to get fresh nextBackupAt from scheduler
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
    }
  }, [open, initialTab, queryClient]);
  
  // Track if backup is in progress globally - survives dialog close/reopen
  // This ensures polling continues even when dialog is closed during backup
  const isBackingUpRef = useRef<boolean>(false);

  const { data: dashboardData, isLoading, isError, refetch } = useQuery<{ success: boolean; data: CloudBackupDashboard }>({
    queryKey: ["/api/cloud-backup/dashboard"],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch("/api/cloud-backup/dashboard", { 
          credentials: "include",
          signal: controller.signal,
          cache: "no-store"  // Bypass browser cache to get fresh nextBackupAt
        });
        clearTimeout(timeout);
        if (res.status === 401) {
          return { success: true, data: { connected: false, settings: {} as BackupSettings, status: { connected: false, folderExists: false, backupCount: 0, latestBackup: null, totalSizeBytes: 0 }, recentBackups: [] } };
        }
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      } catch (e: any) {
        clearTimeout(timeout);
        throw e;
      }
    },
    // ALWAYS enabled - prefetch on mount, use cached data when dialog opens
    enabled: true,
    refetchInterval: open ? 60000 : false,
    retry: 1,
    staleTime: 60000, // Cache for 60 seconds - dialog opens instantly with cached data
    gcTime: 30 * 1000, // 30 seconds - prevent memory bloat from accumulated cache entries
  });

  // Status query with caching to survive dialog close/reopen
  // CRITICAL: Keep polling even when dialog is closed IF a backup is in progress
  // Poll faster (1s) during active backup for live progress updates
  const { data: statusData, isLoading: isStatusLoading, isFetching: isStatusFetching } = useQuery<{ success: boolean; data: { connected: boolean; backingUp: boolean; lastBackupSuccess: boolean | null; lastBackupAt: string | null; progress: { phase: string; currentItem: string; itemsProcessed: number; totalItems: number; bytesUploaded: number; totalBytes: number; startedAt: string | null } | null } }>({
    queryKey: ["/api/cloud-backup/status"],
    queryFn: async () => {
      const res = await fetch("/api/cloud-backup/status", { credentials: "include" });
      if (res.status === 401) {
        return { success: true, data: { connected: false, backingUp: false, lastBackupSuccess: null, lastBackupAt: null, progress: null } };
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Update the backing-up ref so polling continues even when dialog closes
      isBackingUpRef.current = data?.data?.backingUp === true;
      return data;
    },
    // ALWAYS enabled - cached data available immediately when dialog opens
    enabled: true,
    // Poll every 1s during active backup, every 5s when dialog open, otherwise stop
    refetchInterval: isBackingUpRef.current ? 1000 : (open ? 5000 : false),
    retry: 2,
    staleTime: 2000, // Short stale time for live progress updates
    gcTime: 30 * 1000, // 30 seconds - prevent memory bloat from accumulated cache entries
  });

  const dashboard = dashboardData?.data;
  const backupStatus = statusData?.data;
  
  // Live streaming countdown for next backup
  const nextBackupCountdown = useCountdown(dashboard?.settings?.nextBackupAt);
  
  // Connection detection with BULLETPROOF state management
  // Problem: Status endpoint can return connected:false during token refresh
  // Solution: Use sticky "connected" state - once connected, stay connected until CONFIRMED disconnect
  
  const dashboardConnectedRaw = dashboard?.connected;
  const statusConnectedRaw = backupStatus?.connected;
  const isBackupRunning = backupStatus?.backingUp === true;
  
  // Track if we've EVER seen a successful connection in this session
  // This survives across renders but not across full page reloads
  const hasEverConnectedRef = useRef<boolean>(false);
  
  // If EITHER endpoint says connected, OR if a backup is running (which proves we're connected), we're connected
  const eitherSaysConnected = dashboardConnectedRaw === true || statusConnectedRaw === true || isBackupRunning;
  if (eitherSaysConnected) {
    hasEverConnectedRef.current = true;
  }
  
  // Only consider disconnected if:
  // 1. Both queries have returned data, AND
  // 2. Both explicitly say disconnected (not just undefined), AND
  // 3. No backup is currently running (a running backup proves we're connected)
  const dashboardHasData = dashboardData !== undefined;
  const statusHasData = statusData !== undefined;
  
  // Check what each query says (undefined means no data yet, not "disconnected")
  const dashboardSaysDisconnected = dashboardHasData && dashboardConnectedRaw === false;
  const statusSaysDisconnected = statusHasData && statusConnectedRaw === false;
  
  // Both must have data AND both must explicitly say disconnected AND no backup running to reset
  const confirmedDisconnected = dashboardHasData && statusHasData && 
    dashboardSaysDisconnected && statusSaysDisconnected && !isBackupRunning;
  
  if (confirmedDisconnected) {
    hasEverConnectedRef.current = false;
  }
  
  // Final connection state: connected if we've ever connected OR either endpoint says connected OR backup is running
  const isConnected = hasEverConnectedRef.current || eitherSaysConnected || isBackupRunning;
  
  // Show loading spinner ONLY if we have NO cached data at all
  // If we have cached data (dashboardData or statusData exists), show it immediately
  const hasAnyData = dashboardData !== undefined || statusData !== undefined;
  const isCheckingConnection = !isConnected && !hasAnyData;

  const progressRef = useRef<{ phase?: string; bytes?: number; items?: number; lastUpdate?: number }>({});
  
  useEffect(() => {
    if (backupStatus?.progress) {
      const now = Date.now();
      const prev = progressRef.current;
      const curr = backupStatus.progress;
      if (prev.phase !== curr.phase || prev.bytes !== curr.bytesUploaded || prev.items !== curr.itemsProcessed) {
        progressRef.current = {
          phase: curr.phase,
          bytes: curr.bytesUploaded,
          items: curr.itemsProcessed,
          lastUpdate: now,
        };
      }
    }
  }, [backupStatus?.progress]);

  const createBackupMutation = useMutation({
    mutationFn: async () => {
      console.log('[BACKUP] mutationFn ENTERED');
      
      const res = await fetch("/api/cloud-backup/create", { 
        method: "POST", 
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      console.log('[BACKUP] Fetch completed, status:', res.status);
      
      // Handle 202 Accepted (backup already in progress)
      if (res.status === 202) {
        const data = await res.json();
        throw new Error(data.message || "A backup is already in progress");
      }
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText);
      }
      
      return res.json();
    },
    onMutate: () => {
      // IMPORTANT: Do NOT invalidate queries here - it can cancel the mutation in TanStack Query v5
      console.log('[BACKUP] onMutate fired');
      toast({ 
        title: "Backup Started", 
        description: "You can close this dialog - we'll notify you when complete." 
      });
    },
    onSuccess: () => {
      console.log('[BACKUP] onSuccess fired');
      // Invalidate queries AFTER the mutation completes, not during
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
    },
    onError: (error) => {
      console.log('[BACKUP] onError fired:', error);
      toast({ title: "Backup Failed", description: String(error), variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/status"] });
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (backupId: string) => {
      setRestoringId(backupId);
      const res = await fetch(`/api/cloud-backup/restore/${backupId}`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mergeBots: true, mergeStrategies: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data: any) => {
      const restored = data?.data;
      toast({ 
        title: "Restore Complete", 
        description: `Restored ${restored?.bots || 0} bots, ${restored?.strategies || 0} strategies, ${restored?.accounts || 0} accounts.` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-candidates"] });
      setRestoringId(null);
    },
    onError: (error) => {
      toast({ title: "Restore Failed", description: String(error), variant: "destructive" });
      setRestoringId(null);
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (backupId: string) => {
      const res = await fetch(`/api/cloud-backup/${backupId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Backup Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
    },
    onError: (error) => {
      toast({ title: "Delete Failed", description: String(error), variant: "destructive" });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<BackupSettings>) => {
      const res = await fetch("/api/cloud-backup/settings", { 
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
    },
    onError: (error) => {
      toast({ title: "Update Failed", description: String(error), variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/google-drive/disconnect", { 
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      hasEverConnectedRef.current = false;
      toast({ title: "Google Drive Disconnected", description: "Your Google Drive has been unlinked from BlaidTrades." });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/google-drive/status"] });
    },
    onError: (error) => {
      toast({ title: "Disconnect Failed", description: String(error), variant: "destructive" });
    },
  });

  // Combined backup progress flag - includes both local mutation AND server-reported backup status
  // Must be defined AFTER createBackupMutation to avoid temporal dead zone
  const isBackupInProgress = createBackupMutation.isPending || backupStatus?.backingUp === true;
  
  // Track previous backingUp state to detect completion and fire toast
  // We only fire the "completion" toast here - the "started" toast fires immediately in onMutate
  const prevBackingUpRef = useRef<boolean>(false);
  useEffect(() => {
    const currentBackingUp = backupStatus?.backingUp === true;
    // Fire toast when transitioning from backing-up to not-backing-up (backup completed)
    if (!currentBackingUp && prevBackingUpRef.current) {
      toast({ title: "Backup Complete", description: "Your data has been backed up to Google Drive." });
      queryClient.invalidateQueries({ queryKey: ["/api/cloud-backup/dashboard"] });
    }
    prevBackingUpRef.current = currentBackingUp;
  }, [backupStatus?.backingUp, toast, queryClient]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            Cloud Backup
            {isConnected && (
              <>
                <Badge 
                  variant={backupStatus?.backingUp || createBackupMutation.isPending ? "secondary" : backupStatus?.lastBackupSuccess === false ? "destructive" : "outline"} 
                  className="ml-auto gap-1"
                >
                  {backupStatus?.backingUp || createBackupMutation.isPending ? (
                    <><Loader2 className="w-3 h-3 animate-spin" />Backing up...</>
                  ) : backupStatus?.lastBackupSuccess === false ? (
                    <><XCircle className="w-3 h-3" />Last backup failed</>
                  ) : ((dashboard?.status?.backupCount ?? 0) > 0 || backupStatus?.lastBackupAt) ? (
                    <><CheckCircle2 className="w-3 h-3 text-emerald-500" />{backupStatus?.lastBackupAt ? `Last: ${formatDistanceToNow(new Date(backupStatus.lastBackupAt), { addSuffix: true })}` : `${dashboard?.status?.backupCount ?? 0} backup${(dashboard?.status?.backupCount ?? 0) !== 1 ? 's' : ''}`}</>
                  ) : (
                    <><Clock className="w-3 h-3" />No backups yet</>
                  )}
                </Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 mr-6 text-muted-foreground hover:text-destructive"
                      onClick={() => disconnectMutation.mutate()}
                      disabled={disconnectMutation.isPending}
                      aria-label="Disconnect Google Drive"
                      data-testid="button-disconnect-google-drive"
                    >
                      {disconnectMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Unlink className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Disconnect Google Drive</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            Back up your bots, strategies, and settings to Google Drive
          </DialogDescription>
        </DialogHeader>

        {isCheckingConnection ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !isConnected ? (
          <ConnectGoogleDriveSection onConnected={() => refetch()} />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview" data-testid="tab-backup-overview">Overview</TabsTrigger>
              <TabsTrigger value="packs" data-testid="tab-backup-packs">Packs</TabsTrigger>
              <TabsTrigger value="backups" data-testid="tab-backup-history">Backups</TabsTrigger>
              <TabsTrigger value="settings" data-testid="tab-backup-settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex-1 overflow-auto mt-4 space-y-4 min-h-[380px]">
              {/* Live Progress Display - Only shows when there's detailed progress data */}
              {isBackupInProgress && backupStatus?.progress && (backupStatus.progress.totalItems > 0 || backupStatus.progress.totalBytes > 0 || backupStatus.progress.currentItem) && (
                <div className="p-4 rounded-md border bg-card border-primary/30 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Items</div>
                      <div className="font-mono font-medium">
                        {backupStatus.progress.itemsProcessed ?? 0} items
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Size</div>
                      <div className="font-mono font-medium">
                        {formatBytes(backupStatus.progress.totalBytes ?? 0)}
                      </div>
                    </div>
                  </div>
                  {backupStatus.progress.currentItem && (
                    <div className="text-xs text-muted-foreground truncate">
                      {backupStatus.progress.currentItem}
                    </div>
                  )}
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    {backupStatus.progress.phase === 'complete' ? (
                      <div className="absolute inset-0 bg-primary rounded-full" />
                    ) : (
                      <div className="absolute inset-0 bg-primary rounded-full animate-pulse opacity-70" 
                           style={{ width: backupStatus.progress.phase === 'preparing' ? '30%' : '70%' }} />
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-md border bg-card">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <HardDrive className="w-4 h-4" />
                    Total Backups
                  </div>
                  {isLoading ? (
                    <>
                      <Skeleton className="h-8 w-12 mb-1" />
                      <Skeleton className="h-3 w-20" />
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold">{dashboard?.status?.backupCount ?? 0}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(dashboard?.status?.totalSizeBytes ?? 0)} stored
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 rounded-md border bg-card">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Clock className="w-4 h-4" />
                    Last Backup
                  </div>
                  {isStatusLoading ? (
                    <>
                      <Skeleton className="h-6 w-28 mb-1" />
                      <Skeleton className="h-3 w-24" />
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-medium">
                        {backupStatus?.lastBackupAt 
                          ? formatDistanceToNow(new Date(backupStatus.lastBackupAt), { addSuffix: true })
                          : "Never"}
                      </div>
                      {nextBackupCountdown && (
                        <div className="text-xs text-muted-foreground font-mono">
                          Next: {nextBackupCountdown}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-md border bg-card">
                <div>
                  <div className="font-medium">Auto Backup</div>
                  <div className="text-sm text-muted-foreground">
                    {dashboard?.settings?.autoBackupEnabled 
                      ? nextBackupCountdown
                        ? <span>Next backup in <span className="font-mono">{nextBackupCountdown}</span></span>
                        : `Running ${dashboard?.settings?.backupFrequency ?? 'daily'}`
                      : "Disabled"}
                  </div>
                </div>
                <Badge variant={dashboard?.settings?.autoBackupEnabled ? "default" : "secondary"}>
                  {dashboard?.settings?.autoBackupEnabled ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" />Active</>
                  ) : (
                    <><XCircle className="w-3 h-3 mr-1" />Inactive</>
                  )}
                </Badge>
              </div>

              <Separator />

              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    // Guard against duplicate clicks
                    if (createBackupMutation.isPending || isBackupInProgress) {
                      console.log('[BACKUP] Blocked duplicate click');
                      return;
                    }
                    console.log('[BACKUP] Button clicked, calling mutate()');
                    createBackupMutation.mutate();
                  }}
                  disabled={isBackupInProgress || createBackupMutation.isPending}
                  className="flex-1"
                  data-testid="button-create-backup"
                >
                  {isBackupInProgress ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4 mr-2" />
                  )}
                  {isBackupInProgress ? "Backing up..." : "Backup Now"}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => refetch()}
                  size="icon"
                  data-testid="button-refresh-backup"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="packs" className="flex-1 overflow-auto mt-4 space-y-4 min-h-[380px]">
              <div className="text-sm text-muted-foreground mb-4">
                Download individual bot configurations from your latest cloud backup.
              </div>

              {!dashboard?.status?.latestBackup ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Package className="w-8 h-8 mb-2" />
                  <p>No backups available</p>
                  <p className="text-xs mt-1">Create a backup first to access your bot packs</p>
                </div>
              ) : (
                <ScrollArea className="h-[320px]">
                  <div className="space-y-3">
                    {/* Latest backup info */}
                    <div className="p-3 rounded-md border bg-card/50">
                      <div className="flex items-center gap-2 text-sm">
                        <FolderOpen className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">Latest Backup</span>
                        <Badge variant="outline" className="ml-auto">
                          {formatDistanceToNow(new Date(dashboard.status.latestBackup.createdTime), { addSuffix: true })}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatBytes(parseInt(dashboard.status.latestBackup.size ?? '0'))}
                      </div>
                    </div>

                    <Separator />

                    {/* Bot packs - parsed from latest backup description */}
                    {(() => {
                      const desc = dashboard?.status?.latestBackup?.description || '';
                      const botsMatch = desc.match(/(\d+)\s*bots?/i);
                      const strategiesMatch = desc.match(/(\d+)\s*strateg/i);
                      const botCount = botsMatch ? parseInt(botsMatch[1]) : 0;
                      const strategyCount = strategiesMatch ? parseInt(strategiesMatch[1]) : 0;

                      const handleDownload = (type: 'bots' | 'strategies', format: 'json' | 'md') => {
                        const url = `/api/cloud-backup/export/${type}?format=${format}`;
                        window.open(url, '_blank');
                      };

                      return (
                        <div className="space-y-2">
                          {/* Bots pack */}
                          <div className="flex items-center justify-between p-3 rounded-md border bg-card hover-elevate">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-md bg-primary/10">
                                <Bot className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <div className="font-medium text-sm">Trading Bots</div>
                                <div className="text-xs text-muted-foreground">
                                  {botCount > 0 ? `${botCount} bot${botCount !== 1 ? 's' : ''} with generations` : 'All bots + generation history'}
                                </div>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid="button-download-bots-pack"
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleDownload('bots', 'md')} data-testid="download-bots-markdown">
                                  <FileText className="w-4 h-4 mr-2" />
                                  Human-Readable (.md)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownload('bots', 'json')} data-testid="download-bots-json">
                                  <FileJson className="w-4 h-4 mr-2" />
                                  Raw Data (.json)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Strategies pack */}
                          <div className="flex items-center justify-between p-3 rounded-md border bg-card hover-elevate">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-md bg-emerald-500/10">
                                <Package className="w-4 h-4 text-emerald-500" />
                              </div>
                              <div>
                                <div className="font-medium text-sm">Strategies</div>
                                <div className="text-xs text-muted-foreground">
                                  {strategyCount > 0 ? `${strategyCount} strateg${strategyCount !== 1 ? 'ies' : 'y'} with rules` : 'All strategy candidates + rules'}
                                </div>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid="button-download-strategies-pack"
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleDownload('strategies', 'md')} data-testid="download-strategies-markdown">
                                  <FileText className="w-4 h-4 mr-2" />
                                  Human-Readable (.md)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownload('strategies', 'json')} data-testid="download-strategies-json">
                                  <FileJson className="w-4 h-4 mr-2" />
                                  Raw Data (.json)
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Settings pack */}
                          <div className="flex items-center justify-between p-3 rounded-md border bg-card hover-elevate">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-md bg-blue-500/10">
                                <Settings className="w-4 h-4 text-blue-500" />
                              </div>
                              <div>
                                <div className="font-medium text-sm">Settings</div>
                                <div className="text-xs text-muted-foreground">
                                  Platform configuration & preferences
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => dashboard?.status?.latestBackup?.id && restoreBackupMutation.mutate(dashboard.status.latestBackup.id)}
                              disabled={restoreBackupMutation.isPending}
                              data-testid="button-download-settings-pack"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              Restore
                            </Button>
                          </div>
                        </div>
                      );
                    })()}

                    <Separator />

                    {/* Full restore option */}
                    <div className="p-4 rounded-md border border-dashed bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">Full Restore</div>
                          <div className="text-xs text-muted-foreground">
                            Restore all bots, strategies, and settings from backup
                          </div>
                        </div>
                        <Button
                          onClick={() => dashboard?.status?.latestBackup?.id && restoreBackupMutation.mutate(dashboard.status.latestBackup.id)}
                          disabled={restoreBackupMutation.isPending}
                          data-testid="button-full-restore"
                        >
                          {restoreBackupMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <CloudDownload className="w-4 h-4 mr-2" />
                          )}
                          Restore All
                        </Button>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="backups" className="flex-1 overflow-hidden mt-4 min-h-[380px]">
              <ScrollArea className="h-[350px]">
                {(dashboard?.recentBackups?.length ?? 0) === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Cloud className="w-8 h-8 mb-2" />
                    <p>No backups yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(dashboard?.recentBackups ?? []).map((backup) => (
                      <div 
                        key={backup.id} 
                        className="flex items-center justify-between p-3 rounded-md border bg-card"
                        data-testid={`backup-item-${backup.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{backup.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(backup.createdTime), "MMM d, yyyy h:mm a")} · {formatBytes(parseInt(backup.size))}
                          </div>
                          {backup.description && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5">
                              {backup.description}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restoreBackupMutation.mutate(backup.id)}
                            disabled={restoringId === backup.id}
                            data-testid={`button-restore-${backup.id}`}
                          >
                            {restoringId === backup.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CloudDownload className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteBackupMutation.mutate(backup.id)}
                            disabled={deleteBackupMutation.isPending}
                            data-testid={`button-delete-${backup.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 overflow-auto mt-4 space-y-6 min-h-[380px]">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-backup">Auto Backup</Label>
                  <p className="text-sm text-muted-foreground">Automatically back up on a schedule</p>
                </div>
                <Switch
                  id="auto-backup"
                  checked={dashboard?.settings?.autoBackupEnabled ?? false}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({ autoBackupEnabled: checked })}
                  data-testid="switch-auto-backup"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Backup Frequency</Label>
                <Select
                  value={dashboard?.settings?.backupFrequency ?? 'daily'}
                  onValueChange={(value) => updateSettingsMutation.mutate({ backupFrequency: value as any })}
                  disabled={!dashboard?.settings?.autoBackupEnabled}
                >
                  <SelectTrigger data-testid="select-backup-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Keep Last N Backups</Label>
                <Select
                  value={String(dashboard?.settings?.backupRetentionCount ?? 7)}
                  onValueChange={(value) => updateSettingsMutation.mutate({ backupRetentionCount: parseInt(value) })}
                >
                  <SelectTrigger data-testid="select-retention-count">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 backups</SelectItem>
                    <SelectItem value="14">14 backups</SelectItem>
                    <SelectItem value="30">30 backups</SelectItem>
                    <SelectItem value="60">60 backups</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-backtests">Include Backtests</Label>
                  <p className="text-sm text-muted-foreground">Back up backtest session data</p>
                </div>
                <Switch
                  id="include-backtests"
                  checked={dashboard?.settings?.includeBacktests ?? true}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({ includeBacktests: checked })}
                  data-testid="switch-include-backtests"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-trades">Include Trade Logs</Label>
                  <p className="text-sm text-muted-foreground">Back up individual trade records</p>
                </div>
                <Switch
                  id="include-trades"
                  checked={dashboard?.settings?.includeTradeLogs ?? true}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({ includeTradeLogs: checked })}
                  data-testid="switch-include-trades"
                />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
