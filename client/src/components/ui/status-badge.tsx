import { cn } from "@/lib/utils";

type StatusType = 
  | "running" | "idle" | "paused" | "error" | "stopped"
  | "connected" | "disconnected" | "degraded"
  | "pending" | "completed" | "failed"
  | "BACKTEST_ONLY" | "SIM_LIVE" | "SHADOW" | "LIVE"
  | "SIM" | "VIRTUAL" | "success" | "warning" | "info" | "critical"
  | "conservative" | "moderate" | "aggressive"
  | "morning" | "night"
  | "shared" | "dedicated"
  | "ironbeam" | "tradovate" | "internal" | "other"
  | "TRIALS" | "PAPER" | "DEGRADED"
  // Integration statuses - truthful, evidence-backed
  | "UNVERIFIED" | "VERIFIED" | "DEGRADED" | "ERROR" | "DISABLED" | "VERIFYING" | "CONNECTED" | "DISCONNECTED"
  // Health states - OK should NOT render (problems-only rule)
  | "OK" | "WARN";

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

const statusConfig: Record<StatusType, { label: string; className: string } | null> = {
  // Bot status
  running: { label: "Running", className: "bg-emerald-500/15 text-emerald-400" },
  idle: { label: "Idle", className: "bg-muted text-muted-foreground" },
  paused: { label: "Paused", className: "bg-amber-500/15 text-amber-400" },
  error: { label: "Error", className: "bg-red-500/15 text-red-400" },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },

  // Connection status (legacy lowercase)
  connected: { label: "Verified", className: "bg-emerald-500/15 text-emerald-400" },
  disconnected: { label: "Disconnected", className: "bg-red-500/15 text-red-400" },
  degraded: { label: "Degraded", className: "bg-amber-500/15 text-amber-400" },

  // Task status
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-400" },

  // Bot modes
  BACKTEST_ONLY: { label: "Backtest", className: "bg-muted text-foreground" },
  SIM_LIVE: { label: "Sim", className: "bg-blue-500/15 text-blue-400" },
  SHADOW: { label: "Shadow", className: "bg-purple-500/15 text-purple-400" },
  LIVE: { label: "Live", className: "bg-emerald-500/15 text-emerald-400" },

  // Stages
  TRIALS: { label: "Trials", className: "bg-muted text-foreground" },
  PAPER: { label: "Paper", className: "bg-emerald-500/15 text-emerald-400" },
  DEGRADED: { label: "Degraded", className: "bg-red-500/15 text-red-400" },

  // Account types
  SIM: { label: "Sim", className: "bg-blue-500/15 text-blue-400" },
  VIRTUAL: { label: "Virtual", className: "bg-purple-500/15 text-purple-400" },

  // General
  success: { label: "Success", className: "bg-emerald-500/15 text-emerald-400" },
  warning: { label: "Warning", className: "bg-amber-500/15 text-amber-400" },
  info: { label: "Info", className: "bg-blue-500/15 text-blue-400" },
  critical: { label: "Critical", className: "bg-red-500/15 text-red-400" },

  // Risk tiers
  conservative: { label: "Conservative", className: "bg-emerald-500/15 text-emerald-400" },
  moderate: { label: "Moderate", className: "bg-muted text-muted-foreground" },
  aggressive: { label: "Aggressive", className: "bg-amber-500/15 text-amber-400" },

  // Briefing types
  morning: { label: "Morning", className: "bg-amber-500/15 text-amber-400" },
  night: { label: "Night", className: "bg-purple-500/15 text-purple-400" },

  // Sharing modes
  shared: { label: "Shared", className: "bg-blue-500/15 text-blue-400" },
  dedicated: { label: "Dedicated", className: "bg-muted text-muted-foreground" },

  // Providers
  ironbeam: { label: "Ironbeam", className: "bg-amber-500/15 text-amber-400" },
  tradovate: { label: "Tradovate", className: "bg-blue-500/15 text-blue-400" },
  internal: { label: "Internal", className: "bg-muted text-muted-foreground" },
  other: { label: "Other", className: "bg-muted text-muted-foreground" },

  // Integration statuses - TRUTHFUL, evidence-backed
  UNVERIFIED: { label: "Unverified", className: "bg-muted text-muted-foreground border border-muted-foreground/30" },
  VERIFIED: { label: "Verified", className: "bg-emerald-500/15 text-emerald-400" },
  ERROR: { label: "Error", className: "bg-red-500/15 text-red-400" },
  DISABLED: { label: "Disabled", className: "bg-muted text-muted-foreground opacity-60" },
  VERIFYING: { label: "Verifying...", className: "bg-blue-500/15 text-blue-400" },
  // Legacy mappings for backwards compatibility
  CONNECTED: { label: "Verified", className: "bg-emerald-500/15 text-emerald-400" },
  DISCONNECTED: { label: "Disconnected", className: "bg-muted text-muted-foreground" },
  
  // Health states - RULE: Only show problems, not OK states
  // OK is a HIDDEN status - it should return null, not render a badge
  OK: null, // Don't render - problems-only UI rule
  WARN: { label: "Warning", className: "bg-amber-500/15 text-amber-400" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  // RULE: Don't render null configs (OK state) or unknown statuses
  // This prevents "OK" badges from appearing - problems-only UI
  if (config === null || config === undefined) {
    return null;
  }
  
  return (
    <span 
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
