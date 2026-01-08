import { useState, useEffect, useRef } from "react";
import { Settings, Zap, Clock, Target, Sparkles, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PerplexityModel, SearchRecency } from "@/hooks/useStrategyLab";

interface StrategyLabSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSettings: {
    perplexityModel: PerplexityModel;
    searchRecency: SearchRecency;
    customFocus: string;
    costEfficiencyMode?: boolean;
  };
  onSave: (settings: {
    perplexityModel: PerplexityModel;
    searchRecency: SearchRecency;
    customFocus: string;
    costEfficiencyMode: boolean;
  }) => void;
  isSaving?: boolean;
}

const MODEL_OPTIONS: { value: PerplexityModel; label: string; description: string; icon: string }[] = [
  { value: "QUICK", label: "Quick Scan", description: "Fast, basic research (~$0.001/query)", icon: "Zap" },
  { value: "BALANCED", label: "Balanced", description: "Standard depth (~$0.003/query)", icon: "Target" },
  { value: "DEEP", label: "Deep Research", description: "Multi-step deep dives (~$0.005/query)", icon: "Sparkles" },
];

const RECENCY_OPTIONS: { value: SearchRecency; label: string; description: string }[] = [
  { value: "HOUR", label: "Live (1h)", description: "Breaking news, real-time events" },
  { value: "DAY", label: "24 Hours", description: "Today's developments" },
  { value: "WEEK", label: "Weekly", description: "Recent trends" },
  { value: "MONTH", label: "Monthly", description: "Current market context" },
  { value: "YEAR", label: "Annual", description: "Broader historical context" },
];

export function StrategyLabSettingsDialog({
  open,
  onOpenChange,
  currentSettings,
  onSave,
  isSaving = false,
}: StrategyLabSettingsDialogProps) {
  const [perplexityModel, setPerplexityModel] = useState<PerplexityModel>(currentSettings.perplexityModel);
  const [searchRecency, setSearchRecency] = useState<SearchRecency>(currentSettings.searchRecency);
  const [customFocus, setCustomFocus] = useState(currentSettings.customFocus);
  const [costEfficiencyMode, setCostEfficiencyMode] = useState(currentSettings.costEfficiencyMode ?? false);

  const prevOpenRef = useRef(open);
  
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setPerplexityModel(currentSettings.perplexityModel);
      setSearchRecency(currentSettings.searchRecency);
      setCustomFocus(currentSettings.customFocus);
      setCostEfficiencyMode(currentSettings.costEfficiencyMode ?? false);
    }
    prevOpenRef.current = open;
  }, [open, currentSettings]);
  
  // Force QUICK model when cost efficiency mode is enabled
  useEffect(() => {
    if (costEfficiencyMode && perplexityModel !== "QUICK") {
      setPerplexityModel("QUICK");
    }
  }, [costEfficiencyMode]);

  const handleSave = () => {
    onSave({
      perplexityModel,
      searchRecency,
      customFocus,
      costEfficiencyMode,
    });
  };

  const hasChanges =
    perplexityModel !== currentSettings.perplexityModel ||
    searchRecency !== currentSettings.searchRecency ||
    customFocus !== currentSettings.customFocus ||
    costEfficiencyMode !== (currentSettings.costEfficiencyMode ?? false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Research Settings
          </DialogTitle>
          <DialogDescription>
            Configure AI research depth and data recency for strategy discovery
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-3 rounded-md border border-green-500/30 bg-green-500/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-500/10">
                <Wallet className="h-4 w-4 text-green-500" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Cost Efficiency Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Groq-only LLM calls, Quick Scan research, no expensive fallbacks
                </p>
              </div>
            </div>
            <Switch
              checked={costEfficiencyMode}
              onCheckedChange={setCostEfficiencyMode}
              data-testid="switch-cost-efficiency"
            />
          </div>
          
          {costEfficiencyMode && (
            <div className="p-2 rounded-md bg-muted/50 border border-dashed text-xs text-muted-foreground">
              Cost savings: Uses free/cheap Groq API only. No fallback to OpenAI, Anthropic, or other paid providers.
            </div>
          )}
          
          <div className={cn("space-y-3", costEfficiencyMode && "opacity-50 pointer-events-none")}>
            <Label className="text-sm font-medium">Research Depth</Label>
            <div className="grid gap-2">
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPerplexityModel(option.value)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-md border text-left transition-colors",
                    perplexityModel === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover-elevate"
                  )}
                  data-testid={`select-model-${option.value.toLowerCase()}`}
                >
                  {option.value === "QUICK" && <Zap className="h-4 w-4 text-amber-500" />}
                  {option.value === "BALANCED" && <Target className="h-4 w-4 text-blue-500" />}
                  {option.value === "DEEP" && <Sparkles className="h-4 w-4 text-purple-500" />}
                  <div className="flex-1">
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-muted-foreground">{option.description}</div>
                  </div>
                  {perplexityModel === option.value && (
                    <Badge variant="outline" className="text-[10px]">Selected</Badge>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Search Recency</Label>
            <Select value={searchRecency} onValueChange={(v) => setSearchRecency(v as SearchRecency)}>
              <SelectTrigger data-testid="select-recency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-xs">- {option.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Custom Research Focus (Optional)</Label>
            <Textarea
              placeholder="e.g., Focus on momentum strategies for ES futures, avoid mean reversion..."
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              className="min-h-[80px] text-sm"
              data-testid="input-custom-focus"
            />
            <p className="text-xs text-muted-foreground">
              Add specific priorities or exclusions for the AI researcher
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges || isSaving}
            data-testid="button-save-settings"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
