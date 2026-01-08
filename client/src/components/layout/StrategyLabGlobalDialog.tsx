import { useStrategyLabDialog } from "@/contexts/StrategyLabDialogContext";
import { useStrategyLabAutonomousState, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { StrategyLabSettingsDialog } from "@/components/bots/StrategyLabSettingsDialog";
import { useToast } from "@/hooks/use-toast";

export function StrategyLabGlobalDialog() {
  const { isSettingsOpen, setSettingsOpen } = useStrategyLabDialog();
  const { data: autonomousState } = useStrategyLabAutonomousState();
  const toggleState = useToggleStrategyLabState();
  const { toast } = useToast();

  const currentSettings = {
    perplexityModel: autonomousState?.perplexityModel ?? "BALANCED",
    searchRecency: autonomousState?.searchRecency ?? "WEEK",
    customFocus: autonomousState?.customFocus ?? "",
    costEfficiencyMode: autonomousState?.costEfficiencyMode ?? false,
  };

  const handleSave = (settings: {
    perplexityModel: "QUICK" | "BALANCED" | "DEEP";
    searchRecency: "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";
    customFocus: string;
    costEfficiencyMode: boolean;
  }) => {
    toggleState.mutate(
      {
        perplexityModel: settings.perplexityModel,
        searchRecency: settings.searchRecency,
        customFocus: settings.customFocus,
        costEfficiencyMode: settings.costEfficiencyMode,
      },
      {
        onSuccess: () => {
          toast({
            title: "Research Settings Saved",
            description: "AI research configuration updated successfully.",
          });
          setSettingsOpen(false);
        },
        onError: (err) => {
          toast({
            title: "Failed to save settings",
            description: err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <StrategyLabSettingsDialog
      open={isSettingsOpen}
      onOpenChange={setSettingsOpen}
      currentSettings={currentSettings}
      onSave={handleSave}
      isSaving={toggleState.isPending}
    />
  );
}
