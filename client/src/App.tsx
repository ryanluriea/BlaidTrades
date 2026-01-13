import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ServerClockProvider } from "@/contexts/ServerClockContext";
import { LivePnLProvider } from "@/contexts/LivePnLContext";
import { StrategyLabDialogProvider } from "@/contexts/StrategyLabDialogContext";
import { BootProvider } from "@/contexts/BootContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/queryClient";
import { Spinner } from "@/components/ui/spinner";
import { institutionalPersister, isCacheKillSwitchActive, CACHE_SCHEMA_VERSION } from "@/lib/cacheInfrastructure";

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
    <div className="min-h-screen bg-background">
      <div className="h-14 border-b border-border bg-background" />
      <div className="flex">
        <div className="w-64 border-r border-border bg-background min-h-[calc(100vh-3.5rem)]" />
        <div className="flex-1 p-6 bg-background">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-4 w-96 bg-muted rounded" />
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="h-32 bg-muted rounded" />
              <div className="h-32 bg-muted rounded" />
              <div className="h-32 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LazyFallback />}>{children}</Suspense>;
}

const persister = typeof window !== "undefined" ? institutionalPersister : undefined;

if (typeof window !== "undefined") {
  console.info(`[CACHE_INFRA] Schema version: ${CACHE_SCHEMA_VERSION}, Kill switch: ${isCacheKillSwitchActive() ? "ACTIVE" : "off"}`);
}

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
            // IMPORTANT: Strategy Lab queries are EXCLUDED from persistence
            // to prevent black-screen crashes on tab return due to malformed cached data.
            // The complex nested objects (scores, blueprint, regimeAdjustment) can become
            // corrupted in IndexedDB and crash the UI when rehydrated.
            const excludedKeys = [
              '/api/strategy-lab',
              'strategy-candidates', 
              'strategy-lab-sessions',
              'strategy-lab',
            ];
            if (excludedKeys.some(key => queryKey.includes(key))) {
              return false;
            }
            
            const persistableKeys = [
              'bots-overview',
              'app_settings',
              '/api/accounts',
              '/api/bots',
              '/api/settings',
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
            <ErrorBoundary>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AuthProvider>
              <BootProvider>
            <div className="min-h-screen bg-background text-foreground">
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
            </div>
              </BootProvider>
              </AuthProvider>
            </BrowserRouter>
            </ErrorBoundary>
            </StrategyLabDialogProvider>
          </LivePnLProvider>
        </TooltipProvider>
      </ServerClockProvider>
    </ThemeProvider>
  </PersistQueryClientProvider>
);

export default App;
