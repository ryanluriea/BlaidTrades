import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export interface AuthUser {
  id: string;
  email: string;
  username?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
}

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  isVerified: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_CACHE_KEY = 'blaidtrades-auth-state';
const AUTH_VERIFIED_KEY = 'blaidtrades-auth-verified';

function getCachedAuth(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.userId) {
        return { 
          id: data.userId, 
          email: data.email || '', 
          username: data.username || null 
        };
      }
    }
  } catch {}
  return null;
}

function setCachedAuth(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ 
        userId: user.id, 
        email: user.email, 
        username: user.username 
      }));
      localStorage.setItem(AUTH_VERIFIED_KEY, Date.now().toString());
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
      localStorage.removeItem(AUTH_VERIFIED_KEY);
    }
  } catch {}
}

function getLastVerifiedTime(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const ts = localStorage.getItem(AUTH_VERIFIED_KEY);
    return ts ? parseInt(ts, 10) : 0;
  } catch {}
  return 0;
}

const VERIFY_INTERVAL_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const cachedUser = getCachedAuth();
  const lastVerified = getLastVerifiedTime();
  const isFreshCache = cachedUser && (Date.now() - lastVerified < VERIFY_INTERVAL_MS);
  
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [session, setSession] = useState<AuthSession | null>(
    cachedUser ? { user: cachedUser, access_token: "session-based" } : null
  );
  const [loading, setLoading] = useState(!isFreshCache);
  const [isVerified, setIsVerified] = useState(!!isFreshCache);
  const hasCheckedAuth = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;

    if (isFreshCache) {
      console.log("[Auth] Using fresh cached session, skipping server verify");
      return;
    }

    let mounted = true;

    async function checkAuth() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });
        
        if (!mounted) return;

        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            console.log("[Auth] Session verified", data.user);
            setUser(data.user);
            setSession({
              user: data.user,
              access_token: "session-based",
            });
            setCachedAuth(data.user);
            setIsVerified(true);
          } else {
            console.log("[Auth] No session from server");
            setUser(null);
            setSession(null);
            setCachedAuth(null);
            setIsVerified(true);
          }
        } else {
          console.log("[Auth] Server rejected session");
          setUser(null);
          setSession(null);
          setCachedAuth(null);
          setIsVerified(true);
        }
      } catch (error) {
        console.error("[Auth] Check session error - keeping cached state", error);
        if (cachedUser) {
          setIsVerified(true);
        } else {
          setUser(null);
          setSession(null);
          setIsVerified(true);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, []);

  const location = useLocation();

  useEffect(() => {
    if (!loading && user && (location.pathname === "/login" || location.pathname === "/signup")) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, loading, location.pathname, navigate]);

  const signUp = async (email: string, password: string, displayName?: string) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, username: displayName }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || "Registration failed");
    }

    setUser(data.user);
    setSession({
      user: data.user,
      access_token: "session-based",
    });
    setCachedAuth(data.user);
    navigate("/dashboard");
  };

  const signIn = async (email: string, password: string, rememberMe: boolean = false) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, rememberMe }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    setUser(data.user);
    setSession({
      user: data.user,
      access_token: "session-based",
    });
    setCachedAuth(data.user);
    navigate("/dashboard");
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("[Auth] Logout error", error);
    }
    
    setUser(null);
    setSession(null);
    setCachedAuth(null);
    navigate("/login");
  };

  const refreshUser = async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          console.log("[Auth] User refreshed", data.user);
          setUser(data.user);
          setSession({
            user: data.user,
            access_token: "session-based",
          });
          setCachedAuth(data.user);
        } else {
          setUser(null);
          setSession(null);
          setCachedAuth(null);
        }
      } else {
        setUser(null);
        setSession(null);
        setCachedAuth(null);
      }
    } catch (error) {
      console.error("[Auth] Refresh user error", error);
      setUser(null);
      setSession(null);
      setCachedAuth(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isVerified, signUp, signIn, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
