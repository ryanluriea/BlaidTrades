import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  useUWCoverage, 
  useUWProbe, 
  useUWUpdateCoverage,
  useMacroRiskOverlay,
  useUWFetchSignals,
  type UWCoverageItem 
} from '@/hooks/useUnusualWhales';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  RefreshCw,
  Zap,
  Shield,
  Eye,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Lock,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';

function ProbeStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PASS':
      return (
        <Badge className="bg-profit/10 text-profit border-profit/20">
          <CheckCircle className="w-3 h-3 mr-1" /> PASS
        </Badge>
      );
    case 'FAIL':
      return (
        <Badge className="bg-loss/10 text-loss border-loss/20">
          <XCircle className="w-3 h-3 mr-1" /> FAIL
        </Badge>
      );
    case 'DEGRADED':
      return (
        <Badge className="bg-warning/10 text-warning border-warning/20">
          <AlertTriangle className="w-3 h-3 mr-1" /> DEGRADED
        </Badge>
      );
    case 'PLAN_LIMITATION':
      return (
        <Badge className="bg-muted text-muted-foreground border-muted-foreground/20">
          <Lock className="w-3 h-3 mr-1" /> PLAN
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Clock className="w-3 h-3 mr-1" /> UNVERIFIED
        </Badge>
      );
  }
}

function RiskOverlayCard() {
  const { data: overlay, isLoading } = useMacroRiskOverlay();
  const fetchSignals = useUWFetchSignals();
  
  if (isLoading) {
    return <Skeleton className="h-24" />;
  }
  
  const riskMode = overlay?.risk_mode || 'NEUTRAL';
  const confidence = overlay?.confidence || 0;
  
  const getRiskModeDisplay = () => {
    switch (riskMode) {
      case 'RISK_ON':
        return { icon: TrendingUp, color: 'text-profit', bg: 'bg-profit/10', label: 'RISK ON' };
      case 'RISK_OFF':
        return { icon: TrendingDown, color: 'text-loss', bg: 'bg-loss/10', label: 'RISK OFF' };
      default:
        return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted', label: 'NEUTRAL' };
    }
  };
  
  const display = getRiskModeDisplay();
  const Icon = display.icon;
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Macro Risk Overlay
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fetchSignals.mutate()}
            disabled={fetchSignals.isPending}
          >
            {fetchSignals.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-lg ${display.bg}`}>
            <Icon className={`w-6 h-6 ${display.color}`} />
          </div>
          <div className="flex-1">
            <p className={`text-lg font-bold ${display.color}`}>{display.label}</p>
            <p className="text-xs text-muted-foreground">
              Confidence: {(confidence * 100).toFixed(0)}%
            </p>
          </div>
          {overlay?.last_computed_at && (
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(overlay.last_computed_at), { addSuffix: true })}
            </p>
          )}
        </div>
        {overlay?.drivers_json && Object.keys(overlay.drivers_json).length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Drivers</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(overlay.drivers_json).slice(0, 4).map(([key, value]) => (
                <Badge key={key} variant="outline" className="text-[10px]">
                  {key}: {typeof value === 'number' ? value.toFixed(2) : String(value)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoverageRow({ 
  item, 
  onToggle 
}: { 
  item: UWCoverageItem; 
  onToggle: (key: string, field: string, value: boolean) => void;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  
  const handleToggle = async (field: string, value: boolean) => {
    setUpdating(field);
    await onToggle(item.feature_key, field, value);
    setUpdating(null);
  };
  
  return (
    <div className="p-3 rounded-lg bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch 
            checked={item.enabled}
            onCheckedChange={(checked) => handleToggle('enabled', checked)}
            disabled={updating === 'enabled'}
          />
          <div>
            <p className="font-medium text-sm">{item.feature_key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{item.endpoint}</p>
          </div>
        </div>
        <ProbeStatusBadge status={item.last_probe_status} />
      </div>
      
      <p className="text-xs text-muted-foreground">{item.description}</p>
      
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-1 cursor-pointer">
                <Switch 
                  checked={item.wired_to_signal_bus}
                  onCheckedChange={(checked) => handleToggle('wired_to_signal_bus', checked)}
                  disabled={updating === 'wired_to_signal_bus' || !item.enabled}
                  className="scale-75"
                />
                <Zap className={`w-3 h-3 ${item.wired_to_signal_bus ? 'text-warning' : 'text-muted-foreground'}`} />
              </label>
            </TooltipTrigger>
            <TooltipContent>Signal Bus</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-1 cursor-pointer">
                <Switch 
                  checked={item.wired_to_risk_engine}
                  onCheckedChange={(checked) => handleToggle('wired_to_risk_engine', checked)}
                  disabled={updating === 'wired_to_risk_engine' || !item.enabled}
                  className="scale-75"
                />
                <Shield className={`w-3 h-3 ${item.wired_to_risk_engine ? 'text-primary' : 'text-muted-foreground'}`} />
              </label>
            </TooltipTrigger>
            <TooltipContent>Risk Engine</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-1 cursor-pointer">
                <Switch 
                  checked={item.wired_to_why_panel}
                  onCheckedChange={(checked) => handleToggle('wired_to_why_panel', checked)}
                  disabled={updating === 'wired_to_why_panel' || !item.enabled}
                  className="scale-75"
                />
                <Eye className={`w-3 h-3 ${item.wired_to_why_panel ? 'text-profit' : 'text-muted-foreground'}`} />
              </label>
            </TooltipTrigger>
            <TooltipContent>Why Panel</TooltipContent>
          </Tooltip>
        </div>
        
        <div className="flex items-center gap-2 text-muted-foreground">
          {item.plan_required && (
            <Badge variant="outline" className="text-[10px]">{item.plan_required}</Badge>
          )}
          {item.last_probe_latency_ms && (
            <span className="font-mono">{item.last_probe_latency_ms}ms</span>
          )}
          {item.last_probe_at && (
            <span>{formatDistanceToNow(new Date(item.last_probe_at), { addSuffix: true })}</span>
          )}
        </div>
      </div>
      
      {item.last_probe_error && (
        <p className="text-xs text-loss bg-loss/10 p-2 rounded">{item.last_probe_error}</p>
      )}
    </div>
  );
}

export function UnusualWhalesCoveragePanel() {
  const { data: coverage = [], isLoading } = useUWCoverage();
  const probe = useUWProbe();
  const updateCoverage = useUWUpdateCoverage();
  
  const handleToggle = async (featureKey: string, field: string, value: boolean) => {
    await updateCoverage.mutateAsync({
      feature_key: featureKey,
      updates: { [field]: value },
    });
  };
  
  const passCount = coverage.filter(c => c.last_probe_status === 'PASS').length;
  const failCount = coverage.filter(c => c.last_probe_status === 'FAIL').length;
  const planCount = coverage.filter(c => c.last_probe_status === 'PLAN_LIMITATION').length;
  const unverifiedCount = coverage.filter(c => c.last_probe_status === 'UNVERIFIED').length;
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Macro Risk Overlay */}
      <RiskOverlayCard />
      
      {/* Coverage Map */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Unusual Whales Coverage Map</CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => probe.mutate(undefined)}
              disabled={probe.isPending}
            >
              {probe.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              <span className="ml-1">Verify All</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Summary */}
          <div className="flex items-center gap-2 mb-3 text-xs">
            <Badge className="bg-profit/10 text-profit">{passCount} PASS</Badge>
            {failCount > 0 && <Badge className="bg-loss/10 text-loss">{failCount} FAIL</Badge>}
            {planCount > 0 && <Badge variant="outline">{planCount} PLAN</Badge>}
            {unverifiedCount > 0 && <Badge variant="outline" className="text-muted-foreground">{unverifiedCount} UNVERIFIED</Badge>}
          </div>
          
          {/* Wiring Legend */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-2 pb-2 border-b border-border">
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Signal Bus</span>
            <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Risk Engine</span>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> Why Panel</span>
          </div>
          
          {/* Coverage Rows */}
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {coverage.map((item) => (
              <CoverageRow 
                key={item.feature_key} 
                item={item} 
                onToggle={handleToggle}
              />
            ))}
          </div>
          
          {coverage.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No coverage data. Click "Verify All" to probe endpoints.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
