import { createContext, useContext, useEffect, useCallback } from "react";

interface BootContextValue {
  isBooted: boolean;
}

const BootContext = createContext<BootContextValue | null>(null);

/**
 * BootProvider - Simplified boot sequence
 * 
 * Hides the initial HTML loader as soon as React renders.
 * This is more resilient than coordinating auth + page readiness.
 * Let React's normal loading states (ProtectedRoute, Suspense, skeletons) handle the rest.
 */
export function BootProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Hide and remove initial loader from DOM (fire-and-forget)
    const loader = document.getElementById("initial-loader");
    if (loader) {
      loader.classList.add("hidden");
      setTimeout(() => loader.remove(), 150);
    }
  }, []);
  
  return (
    <BootContext.Provider value={{ isBooted: true }}>
      {children}
    </BootContext.Provider>
  );
}

/**
 * useBootReady - Now a no-op for backward compatibility
 * Pages that call this won't break, but it doesn't do anything anymore.
 */
export function useBootReady() {
  return useCallback(() => {
    // No-op - boot is handled automatically now
  }, []);
}

export function useIsBooted() {
  const ctx = useContext(BootContext);
  return ctx?.isBooted ?? true; // Default to true if no context (resilience)
}
