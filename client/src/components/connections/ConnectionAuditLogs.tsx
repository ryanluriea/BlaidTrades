import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, AlertTriangle, XCircle, RefreshCw, Key, Zap } from "lucide-react";
import { useSystemEvents } from "@/hooks/useTrading";
import { format } from "date-fns";

export function ConnectionAuditLogs() {
  const { data: events = [], isLoading } = useSystemEvents(100);
  
  // Filter to connection-related events
  const connectionEvents = events.filter(e => 
    e.event_type.includes('integration') || 
    e.event_type.includes('connection') ||
    e.event_type.includes('verify') ||
    e.event_type.includes('broker') ||
    e.event_type.includes('provider') ||
    e.event_type.includes('failover')
  );

  const getEventIcon = (eventType: string, severity: string) => {
    if (eventType.includes('verify') || eventType.includes('success')) {
      return <CheckCircle className="w-4 h-4 text-profit" />;
    }
    if (eventType.includes('error') || severity === 'error') {
      return <XCircle className="w-4 h-4 text-loss" />;
    }
    if (eventType.includes('key') || eventType.includes('credential')) {
      return <Key className="w-4 h-4 text-primary" />;
    }
    if (eventType.includes('failover')) {
      return <RefreshCw className="w-4 h-4 text-warning" />;
    }
    if (severity === 'warning') {
      return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
    return <Zap className="w-4 h-4 text-muted-foreground" />;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return 'bg-loss/10 text-loss border-loss/20';
      case 'warning': return 'bg-warning/10 text-warning border-warning/20';
      case 'info': return 'bg-primary/10 text-primary border-primary/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Connection Audit Logs</CardTitle>
        </div>
        <CardDescription>
          History of connection events, verifications, and failovers
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : connectionEvents.length > 0 ? (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {connectionEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
                >
                  {getEventIcon(event.event_type, event.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{event.title}</p>
                      <Badge className={`${getSeverityColor(event.severity)} text-[9px]`}>
                        {event.severity}
                      </Badge>
                    </div>
                    {event.message && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {event.message}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {format(new Date(event.created_at), "MMM d, yyyy HH:mm:ss")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">No connection events yet</p>
            <p className="text-xs mt-1">
              Events will appear when you add, verify, or modify connections
            </p>
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Tracked Events</p>
          <div className="flex flex-wrap gap-1 mt-2">
            <Badge variant="outline" className="text-[9px]">Key Added</Badge>
            <Badge variant="outline" className="text-[9px]">Key Rotated</Badge>
            <Badge variant="outline" className="text-[9px]">Verification</Badge>
            <Badge variant="outline" className="text-[9px]">Failover</Badge>
            <Badge variant="outline" className="text-[9px]">Error</Badge>
            <Badge variant="outline" className="text-[9px]">Degradation</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
