import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Columns3, RotateCcw } from "lucide-react";
import { useBotsTableColumns, BOTS_COLUMNS } from "@/hooks/useBotsTableColumns";

export function ColumnsManager() {
  const { visibleColumns, toggleColumn, isColumnVisible, resetToDefaults } = useBotsTableColumns();

  // Filter out system columns (expand, actions)
  const manageableColumns = BOTS_COLUMNS.filter(
    (col) => col.key !== "expand" && col.key !== "actions" && col.label
  );

  const lockedColumns = manageableColumns.filter((c) => c.locked);
  const toggleableColumns = manageableColumns.filter((c) => !c.locked && c.defaultVisible);
  const optionalColumns = manageableColumns.filter((c) => !c.locked && !c.defaultVisible);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Columns3 className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Visible Columns</h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={resetToDefaults}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          </div>

          {/* Locked columns */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">
              Always Visible
            </p>
            {lockedColumns.map((col) => (
              <div key={col.key} className="flex items-center gap-2">
                <Checkbox checked disabled className="opacity-50" />
                <span className="text-sm text-muted-foreground">{col.label}</span>
              </div>
            ))}
          </div>

          {/* Toggleable columns */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">
              Toggle
            </p>
            {toggleableColumns.map((col) => (
              <div key={col.key} className="flex items-center gap-2">
                <Checkbox
                  checked={isColumnVisible(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                />
                <span className="text-sm">{col.label}</span>
              </div>
            ))}
          </div>

          {/* Optional columns */}
          {optionalColumns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">
                Optional
              </p>
              {optionalColumns.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
                  <Checkbox
                    checked={isColumnVisible(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <span className="text-sm">{col.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
