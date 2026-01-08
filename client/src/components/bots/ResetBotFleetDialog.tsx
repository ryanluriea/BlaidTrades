import { useState, useEffect } from "react";
import { AlertTriangle, Trash2, Check, Loader2, Bot, CheckCircle2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import http from "@/lib/http";

interface ResetBotFleetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ResetPhase = "select" | "confirm" | "deleting" | "complete" | "error";

interface BotItem {
  id: string;
  name: string;
  symbol: string;
  stage: string;
}

export function ResetBotFleetDialog({ open, onOpenChange }: ResetBotFleetDialogProps) {
  const [selectedBots, setSelectedBots] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<ResetPhase>("select");
  const [deletedCount, setDeletedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: botsData, isLoading } = useQuery<{ success: boolean; data: BotItem[] }>({
    queryKey: ["/api/bots"],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data: BotItem[] }>("/api/bots");
      if (!response.ok) throw new Error(response.error || "Failed to fetch bots");
      return response.data;
    },
    enabled: open,
  });

  const bots = botsData?.data || [];

  useEffect(() => {
    if (!open) {
      setSelectedBots(new Set());
      setPhase("select");
      setDeletedCount(0);
      setErrorMessage(null);
    }
  }, [open]);

  const handleToggleBot = (botId: string) => {
    setSelectedBots(prev => {
      const next = new Set(prev);
      if (next.has(botId)) {
        next.delete(botId);
      } else {
        next.add(botId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedBots.size === bots.length) {
      setSelectedBots(new Set());
    } else {
      setSelectedBots(new Set(bots.map(b => b.id)));
    }
  };

  const handleProceedToConfirm = () => {
    if (selectedBots.size === 0) {
      toast.error("Please select at least one bot to reset");
      return;
    }
    setPhase("confirm");
  };

  const handleReset = async () => {
    setPhase("deleting");
    setDeletedCount(0);

    try {
      const botIds = Array.from(selectedBots);
      let deleted = 0;

      for (const botId of botIds) {
        try {
          const response = await http.delete<{ success: boolean; error?: string }>(`/api/bots/${botId}`);
          if (response.ok && response.data?.success) {
            deleted++;
            setDeletedCount(deleted);
          }
        } catch (err) {
          console.error(`Failed to delete bot ${botId}:`, err);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["botList"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots-overview"] });

      setDeletedCount(deleted);
      setPhase("complete");
      toast.success(`Successfully deleted ${deleted} bot${deleted !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error("Reset error:", error);
      setPhase("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete bots");
    }
  };

  const handleClose = () => {
    if (phase === "deleting") {
      return;
    }
    onOpenChange(false);
  };

  const selectedBotNames = bots.filter(b => selectedBots.has(b.id)).map(b => b.name);

  if (phase === "select") {
    return (
      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Reset Bots
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              Select which bots you want to delete. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : bots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No bots to reset</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    className="text-xs h-7"
                  >
                    {selectedBots.size === bots.length ? "Deselect All" : "Select All"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {selectedBots.size} of {bots.length} selected
                  </span>
                </div>

                <ScrollArea className="h-64 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {bots.map((bot) => (
                      <label
                        key={bot.id}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedBots.has(bot.id)}
                          onCheckedChange={() => handleToggleBot(bot.id)}
                          data-testid={`checkbox-bot-${bot.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{bot.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {bot.symbol} | {bot.stage}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleProceedToConfirm}
              disabled={selectedBots.size === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete {selectedBots.size > 0 ? `(${selectedBots.size})` : ""}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (phase === "confirm") {
    return (
      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-3">
              <p>
                Are you sure you want to delete <strong>{selectedBots.size} bot{selectedBots.size !== 1 ? 's' : ''}</strong>?
              </p>
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm">
                <p className="font-medium text-destructive">This action cannot be undone.</p>
                <p className="text-muted-foreground text-xs mt-1">
                  All bot history, generations, and configurations will be permanently deleted.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            <ScrollArea className="h-32 border rounded-lg p-2">
              <div className="space-y-1">
                {selectedBotNames.map((name) => (
                  <div key={name} className="text-sm text-muted-foreground flex items-center gap-2">
                    <Bot className="w-3 h-3" />
                    {name}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPhase("select")}>
              Back
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              <Trash2 className="w-4 h-4 mr-2" />
              Yes, Delete {selectedBots.size} Bot{selectedBots.size !== 1 ? 's' : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (phase === "deleting") {
    return (
      <AlertDialog open={open} onOpenChange={() => {}}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              Deleting Bots...
            </AlertDialogTitle>
          </AlertDialogHeader>

          <div className="py-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Deleted {deletedCount} of {selectedBots.size} bots...
            </p>
          </div>

          <AlertDialogFooter>
            <p className="text-xs text-muted-foreground w-full text-center">
              Please wait, do not close this dialog...
            </p>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (phase === "complete") {
    return (
      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              Reset Complete
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              Successfully deleted {deletedCount} bot{deletedCount !== 1 ? 's' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (phase === "error") {
    return (
      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Reset Failed
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {errorMessage || "An unexpected error occurred."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
            <Button onClick={() => setPhase("select")}>
              Try Again
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return null;
}
