import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type SourceHealth = 'green' | 'yellow' | 'red' | 'loading';

export interface SourceHealthData {
  id: string;
  name: string;
  health: SourceHealth;
}

interface SignalHealthBarsProps {
  sources: SourceHealthData[];
  className?: string;
}

export function SignalHealthBars({ sources, className }: SignalHealthBarsProps) {
  const totalBars = sources.length;
  const barHeights = [3, 5, 7, 9, 11, 13, 15, 17];
  
  const healthySources = sources.filter(s => s.health === 'green');
  const unverifiedSources = sources.filter(s => s.health === 'yellow');
  const downSources = sources.filter(s => s.health === 'red');
  const loadingSources = sources.filter(s => s.health === 'loading');
  
  const isAllLoading = loadingSources.length === sources.length;
  const litCount = totalBars - downSources.length;
  const healthPercent = totalBars > 0 ? (litCount / totalBars) * 100 : 0;
  
  const getOverallColor = (): string => {
    if (isAllLoading) return 'bg-muted-foreground/40';
    if (healthPercent >= 100) return 'bg-emerald-500';
    if (healthPercent >= 75) return 'bg-emerald-500';
    if (healthPercent >= 50) return 'bg-yellow-500';
    if (healthPercent >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };
  
  const litColor = getOverallColor();
  const unlitColor = 'bg-muted-foreground/20';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn("flex items-end gap-[2px] h-[17px] cursor-pointer", className)}
          data-testid="signal-health-bars"
        >
          {Array.from({ length: totalBars }).map((_, index) => {
            const isLit = index < litCount;
            return (
              <div
                key={index}
                className={cn(
                  "w-[3px] rounded-[1px] transition-colors",
                  isLit ? litColor : unlitColor
                )}
                style={{ height: `${barHeights[index] || barHeights[barHeights.length - 1]}px` }}
                data-testid={`bar-${index}`}
              />
            );
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px]">
        <div className="space-y-2">
          <p className="text-xs font-medium">
            Signal Sources: {litCount}/{totalBars} online
          </p>
          {healthySources.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-emerald-400 font-medium">Healthy ({healthySources.length})</p>
              <p className="text-[10px] text-muted-foreground">
                {healthySources.map(s => s.name).join(', ')}
              </p>
            </div>
          )}
          {unverifiedSources.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-yellow-400 font-medium">Unverified ({unverifiedSources.length})</p>
              <p className="text-[10px] text-muted-foreground">
                {unverifiedSources.map(s => s.name).join(', ')}
              </p>
            </div>
          )}
          {downSources.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-red-400 font-medium">Down ({downSources.length})</p>
              <p className="text-[10px] text-muted-foreground">
                {downSources.map(s => s.name).join(', ')}
              </p>
            </div>
          )}
          {loadingSources.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground font-medium">Loading ({loadingSources.length})</p>
              <p className="text-[10px] text-muted-foreground/70">
                {loadingSources.map(s => s.name).join(', ')}
              </p>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
