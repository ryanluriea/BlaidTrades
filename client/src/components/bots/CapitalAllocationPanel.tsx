import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  DollarSign, 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw,
  TrendingUp,
  XCircle,
  Lock
} from "lucide-react";
import { useCapitalAllocation } from "@/hooks/useCapitalAllocation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function CapitalAllocationPanel() {
  const { 
    allocations, 
    policy, 
    isLoading, 
    runAllocation, 
    toggleKillSwitch 
  } = useCapitalAllocation();
  
  const [showDryRun, setShowDryRun] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  const handleRunAllocation = async (dryRun: boolean) => {
    try {
      const result = await runAllocation.mutateAsync({ dry_run: dryRun });
      if (dryRun) {
        setDryRunResult(result);
        setShowDryRun(true);
      } else {
        toast.success(`Allocated ${result.total_risk_allocated} units to ${result.proven_bots} bots`);
      }
    } catch (error) {
      toast.error(`Allocation failed: ${error}`);
    }
  };

  const handleKillSwitch = async () => {
    const newState = !policy?.kill_switch_active;
    try {
      await toggleKillSwitch.mutateAsync(newState);
      toast[newState ? 'error' : 'success'](
        newState ? '🚨 Kill switch activated - all trading halted' : 'Kill switch deactivated'
      );
    } catch (error) {
      toast.error(`Failed to toggle kill switch: ${error}`);
    }
  };

  const totalAllocated = allocations?.reduce((acc, a) => acc + (a.risk_units || 0), 0) || 0;
  const provenCount = allocations?.filter(a => a.edge_proof_status === 'PROVEN').length || 0;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-muted-foreground">Allocated</span>
            </div>
            <p className="text-xl font-bold mt-1">
              {totalAllocated}/{policy?.total_risk_units || 100}
            </p>
            <Progress 
              value={(totalAllocated / (policy?.total_risk_units || 100)) * 100} 
              className="mt-2 h-1"
            />
          </CardContent>
        </Card>

        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Edge Proven</span>
            </div>
            <p className="text-xl font-bold mt-1">{provenCount}</p>
            <p className="text-[10px] text-muted-foreground">of {allocations?.length || 0} PAPER bots</p>
          </CardContent>
        </Card>

        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Max/Bot</span>
            </div>
            <p className="text-xl font-bold mt-1">{policy?.max_units_per_bot || 20}</p>
            <p className="text-[10px] text-muted-foreground">risk units</p>
          </CardContent>
        </Card>

        <Card className={cn(
          "border-border/50",
          policy?.kill_switch_active ? "bg-red-500/10 border-red-500/30" : "bg-muted/30"
        )}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={cn(
                "w-4 h-4",
                policy?.kill_switch_active ? "text-red-400" : "text-muted-foreground"
              )} />
              <span className="text-xs text-muted-foreground">Kill Switch</span>
            </div>
            <p className={cn(
              "text-sm font-bold mt-1",
              policy?.kill_switch_active ? "text-red-400" : "text-emerald-400"
            )}>
              {policy?.kill_switch_active ? 'ACTIVE' : 'OFF'}
            </p>
            <Button 
              variant={policy?.kill_switch_active ? "destructive" : "outline"} 
              size="sm" 
              className="mt-1 h-6 text-[10px] w-full"
              onClick={handleKillSwitch}
            >
              {policy?.kill_switch_active ? 'Deactivate' : 'Activate'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => handleRunAllocation(true)}
          disabled={runAllocation.isPending}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", runAllocation.isPending && "animate-spin")} />
          Preview Allocation
        </Button>
        <Button
          onClick={() => handleRunAllocation(false)}
          disabled={runAllocation.isPending || policy?.kill_switch_active}
          size="sm"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Run Allocation
        </Button>
      </div>

      {/* Allocations Table */}
      {allocations && allocations.length > 0 && (
        <Card className="bg-muted/20 border-border/50">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Current Allocations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {allocations.map((alloc: any) => (
                <div key={alloc.id} className="px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={
                        alloc.edge_proof_status === 'PROVEN' ? 'default' :
                        alloc.edge_proof_status === 'PENDING' ? 'secondary' : 'destructive'
                      }
                      className="text-[9px]"
                    >
                      {alloc.edge_proof_status}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{alloc.bots?.name || 'Unknown'}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {alloc.bots?.symbol} · Score: {alloc.edge_proof_score}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{alloc.risk_units} units</p>
                    <p className="text-[10px] text-muted-foreground">
                      max {alloc.max_contracts} contracts
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dry Run Results */}
      {showDryRun && dryRunResult && (
        <Card className="bg-blue-500/5 border-blue-500/30">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Allocation Preview (Dry Run)</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowDryRun(false)}>
              <XCircle className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-3 gap-4 mb-4 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Total Bots</p>
                <p className="text-lg font-bold">{dryRunResult.total_bots}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Proven</p>
                <p className="text-lg font-bold text-emerald-400">{dryRunResult.proven_bots}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Units</p>
                <p className="text-lg font-bold">{dryRunResult.total_risk_allocated}</p>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {dryRunResult.allocations?.map((a: any) => (
                <div key={a.bot_id} className="flex items-center justify-between text-xs py-1 px-2 bg-muted/30 rounded">
                  <span className="flex items-center gap-2">
                    {a.edge_proof_status === 'PROVEN' ? (
                      <CheckCircle className="w-3 h-3 text-emerald-400" />
                    ) : a.edge_proof_status === 'PENDING' ? (
                      <RefreshCw className="w-3 h-3 text-amber-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-400" />
                    )}
                    {a.bot_name}
                  </span>
                  <span className="font-medium">{a.risk_units} units</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
