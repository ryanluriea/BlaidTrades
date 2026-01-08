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
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { queryClient } from "@/lib/queryClient";

// Auth pages
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";

// App pages
import Bots from "@/pages/Bots";
import BotDetail from "@/pages/BotDetail";
import BacktestDetail from "@/pages/BacktestDetail";
import Accounts from "@/pages/Accounts";
import AccountDetail from "@/pages/AccountDetail";
import OperationsCenter from "@/pages/OperationsCenter";
import StrategyLab from "@/pages/StrategyLab";
import Tournaments from "@/pages/Tournaments";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";
import MLModels from "@/pages/MLModels";
import RLAgents from "@/pages/RLAgents";
import Portfolio from "@/pages/Portfolio";
import ExecutionQuality from "@/pages/ExecutionQuality";
import AlphaDecay from "@/pages/AlphaDecay";
import TradeCostAnalysis from "@/pages/TradeCostAnalysis";
import CorrelationAnalysis from "@/pages/CorrelationAnalysis";
import ResearchMonitor from "@/pages/ResearchMonitor";

const IDB_CACHE_KEY = 'blaidagent-query-cache-v2';

const idbPersister = {
  persistClient: async (client: any) => {
    try {
      await set(IDB_CACHE_KEY, client);
    } catch (e) {
      console.warn('[CACHE] IndexedDB persist failed, using localStorage fallback');
      try {
        localStorage.setItem(IDB_CACHE_KEY, JSON.stringify(client));
      } catch {}
    }
  },
  restoreClient: async () => {
    try {
      const cached = await get(IDB_CACHE_KEY);
      if (cached) return cached;
      const lsData = localStorage.getItem(IDB_CACHE_KEY);
      if (lsData) return JSON.parse(lsData);
      return undefined;
    } catch (e) {
      console.warn('[CACHE] IndexedDB restore failed');
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await del(IDB_CACHE_KEY);
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
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />

              {/* Protected routes - Bots is the main landing page */}
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

              {/* Strategy Lab - dedicated research page */}
              <Route
                path="/strategy-lab"
                element={
                  <ProtectedRoute>
                    <StrategyLab />
                  </ProtectedRoute>
                }
              />

              {/* Tournaments - bot evolution competitions */}
              <Route
                path="/tournaments"
                element={
                  <ProtectedRoute>
                    <Tournaments />
                  </ProtectedRoute>
                }
              />

              {/* Operations Center - unified autonomy, system status, and connections */}
              <Route
                path="/operations"
                element={
                  <ProtectedRoute>
                    <OperationsCenter />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/training"
                element={
                  <ProtectedRoute>
                    <OperationsCenter />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/backtests"
                element={
                  <ProtectedRoute>
                    <OperationsCenter />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/backtests/:id"
                element={
                  <ProtectedRoute>
                    <BacktestDetail />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/accounts"
                element={
                  <ProtectedRoute>
                    <Accounts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/accounts/:id"
                element={
                  <ProtectedRoute>
                    <AccountDetail />
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
                    <Settings />
                  </ProtectedRoute>
                }
              />

              {/* Redirect old /integrations to Operations Center Connections tab */}
              <Route path="/integrations" element={<Navigate to="/operations" replace />} />

              {/* ML/RL Intelligence Pages */}
              <Route
                path="/ml-models"
                element={
                  <ProtectedRoute>
                    <MLModels />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rl-agents"
                element={
                  <ProtectedRoute>
                    <RLAgents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portfolio"
                element={
                  <ProtectedRoute>
                    <Portfolio />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/execution"
                element={
                  <ProtectedRoute>
                    <ExecutionQuality />
                  </ProtectedRoute>
                }
              />

              {/* Research Monitor - live AI activity feed */}
              <Route
                path="/research-monitor"
                element={
                  <ProtectedRoute>
                    <ResearchMonitor />
                  </ProtectedRoute>
                }
              />

              {/* Analytics Pages */}
              <Route
                path="/alpha-decay"
                element={
                  <ProtectedRoute>
                    <AlphaDecay />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tca"
                element={
                  <ProtectedRoute>
                    <TradeCostAnalysis />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/correlation"
                element={
                  <ProtectedRoute>
                    <CorrelationAnalysis />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFound />} />
              </Routes>
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
