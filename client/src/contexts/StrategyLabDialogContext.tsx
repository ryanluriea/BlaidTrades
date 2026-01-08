import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface StrategyLabDialogContextType {
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
}

const StrategyLabDialogContext = createContext<StrategyLabDialogContextType | null>(null);

export function StrategyLabDialogProvider({ children }: { children: ReactNode }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const setSettingsOpen = useCallback((open: boolean) => setIsSettingsOpen(open), []);

  return (
    <StrategyLabDialogContext.Provider
      value={{
        isSettingsOpen,
        openSettings,
        closeSettings,
        setSettingsOpen,
      }}
    >
      {children}
    </StrategyLabDialogContext.Provider>
  );
}

export function useStrategyLabDialog() {
  const context = useContext(StrategyLabDialogContext);
  if (!context) {
    throw new Error("useStrategyLabDialog must be used within a StrategyLabDialogProvider");
  }
  return context;
}
