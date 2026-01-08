import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRenameSession } from "@/hooks/useGeneticsSession";

interface SessionNameEditProps {
  sessionId: string;
  currentName: string;
  className?: string;
}

export function SessionNameEdit({ sessionId, currentName, className }: SessionNameEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameSession = useRenameSession();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(currentName);
  }, [currentName]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(currentName);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(currentName);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed.length < 3 || trimmed.length > 80) {
      return;
    }
    if (trimmed === currentName) {
      setIsEditing(false);
      return;
    }
    renameSession.mutate(
      { session_id: sessionId, name: trimmed },
      {
        onSuccess: () => setIsEditing(false),
        onError: () => setEditValue(currentName),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex items-center gap-1", className)} onClick={e => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Small delay to allow button clicks to register
            setTimeout(() => {
              if (document.activeElement !== inputRef.current) {
                handleCancel();
              }
            }, 150);
          }}
          className="h-7 text-sm font-medium px-2"
          disabled={renameSession.isPending}
          maxLength={80}
          minLength={3}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleSave}
          disabled={renameSession.isPending || editValue.trim().length < 3}
        >
          {renameSession.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCancel}
          disabled={renameSession.isPending}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1 group", className)}>
      <span className="text-sm font-medium truncate">{currentName}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleStartEdit}
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}
