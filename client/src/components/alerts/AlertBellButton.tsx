import { useState } from "react";
import { Bell } from "lucide-react";
import { useUnreadAlertCount } from "@/hooks/useAlerts";
import { AlertsDrawer } from "./AlertsDrawer";
import { cn } from "@/lib/utils";

interface AlertBellButtonProps {
  className?: string;
  iconOnly?: boolean;
}

export function AlertBellButton({ className, iconOnly = true }: AlertBellButtonProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: unreadCount } = useUnreadAlertCount();

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className={cn(
          "relative flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:text-foreground transition-colors",
          className
        )}
        title="Alerts"
        data-testid="button-alerts"
      >
        <Bell className="w-5 h-5" />
        {!iconOnly && <span className="ml-2">Alerts</span>}
        
        {/* Unread badge - messenger style */}
        {unreadCount && unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      <AlertsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}
