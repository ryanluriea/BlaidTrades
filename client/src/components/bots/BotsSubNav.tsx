import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CostAlertsIndicator } from "./CostAlertsIndicator";

interface BotsSubNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs: { key: string; label: string }[] = [];

export function BotsSubNav({ 
  activeTab, 
  onTabChange,
}: BotsSubNavProps) {
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 text-xs shrink-0",
                activeTab === tab.key && "bg-secondary"
              )}
              onClick={() => onTabChange(tab.key)}
              data-testid={`button-tab-${tab.key}`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <CostAlertsIndicator threshold={5.0} />
      </div>
    </div>
  );
}
