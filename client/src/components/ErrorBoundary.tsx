import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorStack: string | null;
  errorInfo: string | null;
}

/**
 * Never-blank Error Boundary
 * 
 * Industry standard: Always show themed content, never a blank/white screen.
 * Catches React render errors and shows a graceful degradation UI.
 * Now includes structured error logging for production debugging.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorStack: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { 
      hasError: true, 
      error,
      errorStack: error?.stack || null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Structured logging for production debugging
    const errorDetails = {
      name: error?.name || 'Unknown',
      message: error?.message || 'No message',
      stack: error?.stack || 'No stack trace',
      componentStack: errorInfo?.componentStack || 'No component stack',
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      timestamp: new Date().toISOString(),
    };
    
    // Log to console with full details
    console.error("[ErrorBoundary] CRASH DETECTED:", JSON.stringify(errorDetails, null, 2));
    console.error("[ErrorBoundary] Error object:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo?.componentStack);
    
    // Store for display in dev mode
    this.setState({ 
      errorInfo: errorInfo?.componentStack || null,
      errorStack: error?.stack || null,
    });
    
    // Attempt to send to server for telemetry (fire and forget)
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorDetails),
        credentials: 'include',
      }).catch(() => { /* ignore telemetry failures */ });
    } catch {
      // Telemetry is best-effort
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorStack: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
              <p className="text-muted-foreground text-sm">
                An unexpected error occurred. This has been logged automatically.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={this.handleRetry} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button 
                variant="outline" 
                onClick={() => window.location.reload()} 
                className="w-full"
              >
                Reload Page
              </Button>
            </div>
            {/* Always show error details in expandable section for debugging */}
            {this.state.error && (
              <details className="mt-4 text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Show error details
                </summary>
                <div className="mt-2 p-3 bg-muted rounded-md space-y-2 max-h-60 overflow-auto">
                  <p className="text-xs font-mono text-destructive break-all">
                    {this.state.error.name}: {this.state.error.message}
                  </p>
                  {this.state.errorStack && (
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {this.state.errorStack}
                    </pre>
                  )}
                  {this.state.errorInfo && (
                    <pre className="text-[10px] font-mono text-muted-foreground/70 whitespace-pre-wrap break-all border-t border-border pt-2 mt-2">
                      {this.state.errorInfo}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function PageErrorFallback() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-14 border-b border-border bg-background" />
      <div className="flex">
        <div className="w-64 border-r border-border bg-background min-h-[calc(100vh-3.5rem)]" />
        <div className="flex-1 p-6 bg-background flex items-center justify-center">
          <div className="text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Failed to load this page</p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Reload
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
