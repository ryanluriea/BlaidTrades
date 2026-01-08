import { useState } from "react";
import { AlertTriangle, Copy, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyDebugBundle } from "@/lib/debugBundle";
import { cn } from "@/lib/utils";

interface ErrorBannerProps {
  endpoint?: string;
  status?: number;
  message: string;
  requestId?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({
  endpoint,
  status,
  message,
  requestId,
  onRetry,
  onDismiss,
  className,
}: ErrorBannerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyDebug = async () => {
    const success = await copyDebugBundle({
      failingEndpoint: endpoint,
      failingStatus: status,
      failingError: message,
      failingRequestId: requestId,
    });
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Determine severity color
  const isTimeout = status === 408 || message.toLowerCase().includes('timeout');
  const is503 = status === 503;
  const isSchemaCache = message.toLowerCase().includes('schema cache') || message.includes('PGRST002');
  
  const bgColor = isSchemaCache || is503 
    ? "bg-amber-500/10 border-amber-500/30" 
    : "bg-destructive/10 border-destructive/30";
  
  const iconColor = isSchemaCache || is503 
    ? "text-amber-500" 
    : "text-destructive";

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        bgColor,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn("h-5 w-5 mt-0.5 flex-shrink-0", iconColor)} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">
              {isSchemaCache 
                ? "Database temporarily unavailable" 
                : isTimeout 
                  ? "Request timed out" 
                  : "Request failed"}
            </span>
            {status && status > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                {status}
              </span>
            )}
          </div>
          
          <p className="text-sm text-muted-foreground mt-1 break-words">
            {isSchemaCache
              ? "Backend REST is temporarily unavailable (schema cache rebuild). Limited Mode stays usable; REST retries are paused."
              : message}
          </p>
          
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
            {endpoint && (
              <span className="font-mono truncate max-w-[200px]">{endpoint}</span>
            )}
            {requestId && (
              <span className="font-mono opacity-60">ID: {requestId}</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 flex-shrink-0">
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-8 px-2"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyDebug}
            className="h-8 px-2"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">Debug</span>
          </Button>
          
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDismiss}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading state component with timeout warning
interface LoadingStateProps {
  isLoading: boolean;
  loadingStartTime?: number;
  children: React.ReactNode;
  onCancel?: () => void;
  onRetry?: () => void;
  loadingComponent?: React.ReactNode;
}

export function LoadingState({
  isLoading,
  loadingStartTime,
  children,
  onCancel,
  onRetry,
  loadingComponent,
}: LoadingStateProps) {
  const [showStillLoading, setShowStillLoading] = useState(false);

  // Check if loading has been going on too long
  const elapsed = loadingStartTime ? Date.now() - loadingStartTime : 0;
  const showWarning = isLoading && elapsed > 10000;

  if (!isLoading) {
    return <>{children}</>;
  }

  if (showWarning) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="text-center">
          <p className="text-muted-foreground">Still loading...</p>
          <p className="text-xs text-muted-foreground mt-1">
            This is taking longer than expected ({Math.round(elapsed / 1000)}s)
          </p>
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {onRetry && (
            <Button variant="default" size="sm" onClick={onRetry}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return <>{loadingComponent}</>;
}
