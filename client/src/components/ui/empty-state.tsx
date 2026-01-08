import { ReactNode } from "react";
import { LucideIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  className?: string;
  children?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: EmptyStateProps) {
  const ActionIcon = action?.icon || Plus;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-muted-foreground/25 bg-muted/5",
        className
      )}
    >
      {Icon && (
        <div className="rounded-full bg-muted p-3 mb-4">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      
      <h3 className="font-medium text-foreground">{title}</h3>
      
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      
      {action && (
        <Button
          variant="default"
          size="sm"
          onClick={action.onClick}
          className="mt-4"
        >
          <ActionIcon className="h-4 w-4 mr-1" />
          {action.label}
        </Button>
      )}
      
      {children}
    </div>
  );
}
