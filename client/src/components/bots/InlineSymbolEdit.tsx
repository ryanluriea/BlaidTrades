import { useState, useEffect, useRef } from "react";
import { Check, X, ChevronDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdateBotSymbol } from "@/hooks/useBotInlineEdit";
import { cn } from "@/lib/utils";

interface InlineSymbolEditProps {
  botId: string;
  currentSymbol: string;
  availableSymbols: string[];
  isLocked?: boolean;
  lockReason?: string;
  compact?: boolean; // Shrunk down for inline with dots
}

export function InlineSymbolEdit({
  botId,
  currentSymbol,
  availableSymbols,
  isLocked = false,
  lockReason,
  compact = false,
}: InlineSymbolEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(currentSymbol);
  const containerRef = useRef<HTMLDivElement>(null);
  const updateSymbol = useUpdateBotSymbol();

  useEffect(() => {
    setSelectedSymbol(currentSymbol);
  }, [currentSymbol]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
      if (e.key === "Enter" && isEditing) handleSave();
    };

    if (isEditing) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditing, selectedSymbol]);

  const handleSave = () => {
    if (selectedSymbol !== currentSymbol) {
      updateSymbol.mutate({
        botId,
        oldSymbol: currentSymbol,
        newSymbol: selectedSymbol,
      });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setSelectedSymbol(currentSymbol);
    setIsEditing(false);
  };

  if (isLocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "font-medium text-muted-foreground flex items-center gap-0.5 cursor-not-allowed",
            compact ? "text-[10px]" : "text-sm"
          )}>
            {currentSymbol}
            <Lock className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {lockReason || "Editing locked"}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (isEditing) {
    return (
      <div ref={containerRef} className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
          <SelectTrigger className="h-5 w-16 text-[10px] px-1.5 py-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover z-50">
            {availableSymbols.map((sym) => (
              <SelectItem key={sym} value={sym} className="text-xs">
                {sym}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-emerald-400 hover:text-emerald-300"
          onClick={handleSave}
          disabled={updateSymbol.isPending}
        >
          <Check className="w-3 h-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleCancel}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          className={cn(
            "font-medium text-foreground cursor-pointer",
            "transition-colors inline-flex items-center gap-0 group",
            "hover:text-primary",
            compact ? "text-[10px]" : "text-sm"
          )}
        >
          {currentSymbol}
          <ChevronDown className={cn(
            "opacity-40 group-hover:opacity-70 transition-opacity",
            compact ? "w-2.5 h-2.5" : "w-3.5 h-3.5"
          )} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Click to change instrument
      </TooltipContent>
    </Tooltip>
  );
}
