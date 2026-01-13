import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface BootContextValue {
  isBooted: boolean;
  markReady: () => void;
}

const BootContext = createContext<BootContextValue | null>(null);

export function BootProvider({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useAuth();
  const [pageReady, setPageReady] = useState(false);
  const [isBooted, setIsBooted] = useState(false);
  const hasMarkedReady = useRef(false);
  
  const markReady = useCallback(() => {
    if (hasMarkedReady.current) return;
    hasMarkedReady.current = true;
    setPageReady(true);
  }, []);
  
  useEffect(() => {
    if (!authLoading && pageReady && !isBooted) {
      setIsBooted(true);
    }
  }, [authLoading, pageReady, isBooted]);
  
  useEffect(() => {
    if (isBooted) {
      const loader = document.getElementById("initial-loader");
      if (loader) {
        loader.classList.add("hidden");
        setTimeout(() => loader.remove(), 150);
      }
    }
  }, [isBooted]);
  
  useEffect(() => {
    if (authLoading) return;
    const timeout = setTimeout(() => {
      if (!hasMarkedReady.current) {
        console.warn("[BOOT] Forcing boot after 5s timeout (auth resolved but page not ready)");
        markReady();
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [authLoading, markReady]);
  
  return (
    <BootContext.Provider value={{ isBooted, markReady }}>
      {children}
    </BootContext.Provider>
  );
}

export function useBootReady() {
  const ctx = useContext(BootContext);
  if (!ctx) throw new Error("useBootReady must be used within BootProvider");
  return ctx.markReady;
}

export function useIsBooted() {
  const ctx = useContext(BootContext);
  return ctx?.isBooted ?? false;
}
