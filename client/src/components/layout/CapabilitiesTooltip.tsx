import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { 
  getCapabilitySummary, 
  getCapabilitiesByStatus,
  type CapabilityCategory,
  type FeatureStatus
} from "@shared/capabilities-registry";

const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  data: "Data",
  execution: "Execution",
  risk: "Risk",
  autonomy: "Autonomy",
  infrastructure: "Infra",
  monitoring: "Monitoring",
  strategy: "Strategy",
};

export function CapabilitiesTooltip() {
  const summary = getCapabilitySummary();
  const implemented = getCapabilitiesByStatus("IMPLEMENTED" as FeatureStatus);

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center p-2 rounded-md transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          data-testid="button-capabilities-info"
        >
          <Info className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="w-72 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Platform Capabilities</span>
            <Badge variant="outline" className="text-xs">
              v1.1.0
            </Badge>
          </div>
          
          <div className="flex flex-wrap gap-1">
            <Badge variant="default" className="text-xs">
              {summary.implemented} Active
            </Badge>
            {summary.partial > 0 && (
              <Badge variant="secondary" className="text-xs">
                {summary.partial} Partial
              </Badge>
            )}
            {summary.planned > 0 && (
              <Badge variant="outline" className="text-xs">
                {summary.planned} Planned
              </Badge>
            )}
          </div>
          
          <div className="border-t border-border/50 pt-2">
            <div className="text-xs text-muted-foreground mb-1">By Category:</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(summary.byCategory).map(([cat, count]) => (
                <div key={cat} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {CATEGORY_LABELS[cat as CapabilityCategory]}
                  </span>
                  <span className="text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">Recent Additions:</div>
            {implemented.slice(-3).map((cap) => (
              <div key={cap.id} className="truncate">
                {cap.name}
              </div>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function CapabilitiesBadge() {
  const summary = getCapabilitySummary();
  
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div 
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground"
          data-testid="badge-capabilities-count"
        >
          <Info className="w-3 h-3" />
          <span>{summary.implemented}/{summary.total}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <span>{summary.implemented} of {summary.total} capabilities implemented</span>
      </TooltipContent>
    </Tooltip>
  );
}
