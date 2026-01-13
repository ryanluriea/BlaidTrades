import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ServerClockProvider } from "@/contexts/ServerClockContext";
import { LivePnLProvider } from "@/contexts/LivePnLContext";
import { StrategyLabDialogProvider } from "@/contexts/StrategyLabDialogContext";
import { BootProvider } from "@/contexts/BootContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { queryClient } from "@/lib/queryClient";
import { Spinner } from "@/components/ui/spinner";

import Login from "@/pages/Login";
import Bots from "@/pages/Bots";
import BotDetail from "@/pages/BotDetail";
import NotFound from "@/pages/NotFound";

const StrategyLab = lazy(() => import("@/pages/StrategyLab"));
const Tournaments = lazy(() => import("@/pages/Tournaments"));
const OperationsCenter = lazy(() => import("@/pages/OperationsCenter"));
const BacktestDetail = lazy(() => import("@/pages/BacktestDetail"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const AccountDetail = lazy(() => import("@/pages/AccountDetail"));
const Settings = lazy(() => import("@/pages/Settings"));
const MLModels = lazy(() => import("@/pages/MLModels"));
const RLAgents = lazy(() => import("@/pages/RLAgents"));
const Portfolio = lazy(() => import("@/pages/Portfolio"));
const ExecutionQuality = lazy(() => import("@/pages/ExecutionQuality"));
const AlphaDecay = lazy(() => import("@/pages/AlphaDecay"));
const TradeCostAnalysis = lazy(() => import("@/pages/TradeCostAnalysis"));
const CorrelationAnalysis = lazy(() => import("@/pages/CorrelationAnalysis"));
const ResearchMonitor = lazy(() => import("@/pages/ResearchMonitor"));

function LazyFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LazyFallback />}>{children}</Suspense>;
}

const IDB_CACHE_KEY = 'blaidagent-query-cache-v2';

let idbAvailable: boolean | null = null;

async function checkIdbAvailability(): Promise<boolean> {
  if (idbAvailable !== null) return idbAvailable;
  try {
    const testKey = '__idb_test__';
    await set(testKey, 'test');
    await del(testKey);
    idbAvailable = true;
  } catch {
    idbAvailable = false;
  }
  return idbAvailable;
}

let idbFallbackLogged = false;

const idbPersister = {
  persistClient: async (client: any) => {
    const useIdb = await checkIdbAvailability();
    if (useIdb) {
      try {
        await set(IDB_CACHE_KEY, client);
        return;
      } catch {
        idbAvailable = false;
      }
    }
    try {
      localStorage.setItem(IDB_CACHE_KEY, JSON.stringify(client));
      if (!idbFallbackLogged && typeof console !== 'undefined') {
        console.debug('[CACHE] Using localStorage persister (IndexedDB unavailable in this context)');
        idbFallbackLogged = true;
      }
    } catch {}
  },
  restoreClient: async () => {
    const useIdb = await checkIdbAvailability();
    try {
      if (useIdb) {
        const cached = await get(IDB_CACHE_KEY);
        if (cached) return cached;
      }
      const lsData = localStorage.getItem(IDB_CACHE_KEY);
      if (lsData) return JSON.parse(lsData);
      return undefined;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      const useIdb = await checkIdbAvailability();
      if (useIdb) await del(IDB_CACHE_KEY);
      localStorage.removeItem(IDB_CACHE_KEY);
    } catch {}
  },
};

const persister = typeof window !== 'undefined' ? idbPersister : undefined;

const App = () => (
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      maxAge: 30 * 60 * 1000,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          const queryKey = query.queryKey[0];
          if (typeof queryKey === 'string') {
            const persistableKeys = [
              'bots-overview',
              'app_settings',
              '/api/accounts',
              '/api/bots',
              '/api/settings',
              '/api/strategy-lab',
              'strategy-candidates',
              'strategy-lab-sessions',
            ];
            return persistableKeys.some(key => queryKey.includes(key) || queryKey === key);
          }
          return false;
        },
      },
    }}
  >
    <ThemeProvider defaultTheme="dark" storageKey="blaidagent-theme">
      <ServerClockProvider>
        <TooltipProvider>
          <LivePnLProvider>
            <StrategyLabDialogProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AuthProvider>
              <BootProvider>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route path="/" element={<Navigate to="/bots" replace />} />
              <Route path="/dashboard" element={<Navigate to="/bots" replace />} />
              <Route
                path="/bots"
                element={
                  <ProtectedRoute>
                    <Bots />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bots/:id"
                element={
                  <ProtectedRoute>
                    <BotDetail />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/strategy-lab"
                element={
                  <ProtectedRoute>
                    <LazyRoute><StrategyLab /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/tournaments"
                element={
                  <ProtectedRoute>
                    <LazyRoute><Tournaments /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/operations"
                element={
                  <ProtectedRoute>
                    <LazyRoute><OperationsCenter /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/training"
                element={
                  <ProtectedRoute>
                    <LazyRoute><OperationsCenter /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/backtests"
                element={
                  <ProtectedRoute>
                    <LazyRoute><OperationsCenter /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/backtests/:id"
                element={
                  <ProtectedRoute>
                    <LazyRoute><BacktestDetail /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/accounts"
                element={
                  <ProtectedRoute>
                    <LazyRoute><Accounts /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/accounts/:id"
                element={
                  <ProtectedRoute>
                    <LazyRoute><AccountDetail /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/system-status"
                element={<Navigate to="/operations" replace />}
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <LazyRoute><Settings /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route path="/integrations" element={<Navigate to="/operations" replace />} />

              <Route
                path="/ml-models"
                element={
                  <ProtectedRoute>
                    <LazyRoute><MLModels /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rl-agents"
                element={
                  <ProtectedRoute>
                    <LazyRoute><RLAgents /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portfolio"
                element={
                  <ProtectedRoute>
                    <LazyRoute><Portfolio /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/execution"
                element={
                  <ProtectedRoute>
                    <LazyRoute><ExecutionQuality /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/research-monitor"
                element={
                  <ProtectedRoute>
                    <LazyRoute><ResearchMonitor /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/alpha-decay"
                element={
                  <ProtectedRoute>
                    <LazyRoute><AlphaDecay /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tca"
                element={
                  <ProtectedRoute>
                    <LazyRoute><TradeCostAnalysis /></LazyRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/correlation"
                element={
                  <ProtectedRoute>
                    <LazyRoute><CorrelationAnalysis /></LazyRoute>
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFound />} />
              </Routes>
              </BootProvider>
              </AuthProvider>
            </BrowserRouter>
            </StrategyLabDialogProvider>
          </LivePnLProvider>
        </TooltipProvider>
      </ServerClockProvider>
    </ThemeProvider>
  </PersistQueryClientProvider>
);

export default App;
