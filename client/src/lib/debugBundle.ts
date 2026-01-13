/**
 * Debug Bundle - Collects diagnostic information for troubleshooting.
 * One-click copy to clipboard for support.
 */

import { getRecentFailures } from './http';

// Store recent console errors
const recentErrors: Array<{
  timestamp: string;
  message: string;
  stack?: string;
}> = [];

const MAX_ERRORS = 25;

// Hook console.error to capture errors
const originalConsoleError = console.error;
console.error = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  recentErrors.unshift({
    timestamp: new Date().toISOString(),
    message: message.slice(0, 500), // Truncate long messages
    stack: new Error().stack?.split('\n').slice(2, 5).join('\n'),
  });
  
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.pop();
  }
  
  originalConsoleError.apply(console, args);
};

export interface DebugBundle {
  timestamp: string;
  route: string;
  buildVersion: string;
  userAgent: string;
  viewport: { width: number; height: number };
  
  // Auth info (non-sensitive)
  userId?: string;
  sessionId?: string;
  isAuthenticated: boolean;
  
  // Environment
  env: string;
  supabaseUrl?: string;
  
  // Failures
  recentNetworkFailures: Array<{
    timestamp: string;
    url: string;
    method: string;
    status: number;
    error: string;
    requestId: string;
  }>;
  
  recentConsoleErrors: Array<{
    timestamp: string;
    message: string;
    stack?: string;
  }>;
  
  // Websocket status
  websocket: {
    connected: boolean;
    lastError?: string;
  };
  
  // Specific failure context
  failingEndpoint?: string;
  failingStatus?: number;
  failingError?: string;
  failingRequestId?: string;
}

// Track websocket status
let wsConnected = false;
let wsLastError: string | undefined;

export function setWebsocketStatus(connected: boolean, error?: string) {
  wsConnected = connected;
  wsLastError = error;
}

export function createDebugBundle(context?: {
  failingEndpoint?: string;
  failingStatus?: number;
  failingError?: string;
  failingRequestId?: string;
}): DebugBundle {
  // Try to get user info from localStorage (set by AuthContext on login/session check)
  let userId: string | undefined;
  let sessionId: string | undefined;
  let isAuthenticated = false;
  
  try {
    // Check for Express session auth state (set by AuthContext)
    const authState = localStorage.getItem('blaidtrades-auth-state');
    if (authState) {
      const parsed = JSON.parse(authState);
      userId = parsed?.userId;
      isAuthenticated = !!parsed?.userId;
    }
  } catch {
    // Ignore
  }
  
  return {
    timestamp: new Date().toISOString(),
    route: window.location.pathname + window.location.search,
    buildVersion: import.meta.env.VITE_BUILD_SHA || 'dev',
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    
    userId,
    sessionId,
    isAuthenticated,
    
    env: import.meta.env.MODE,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.replace(/https?:\/\//, '').split('.')[0],
    
    recentNetworkFailures: getRecentFailures(),
    recentConsoleErrors: [...recentErrors],
    
    websocket: {
      connected: wsConnected,
      lastError: wsLastError,
    },
    
    ...context,
  };
}

export async function copyDebugBundle(context?: Parameters<typeof createDebugBundle>[0]): Promise<boolean> {
  try {
    const bundle = createDebugBundle(context);
    const text = JSON.stringify(bundle, null, 2);
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy debug bundle:', err);
    return false;
  }
}

export function getRecentConsoleErrors() {
  return [...recentErrors];
}
