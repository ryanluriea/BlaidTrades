import { createContext, useContext, useEffect, useState, useRef } from "react";
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
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_CACHE_KEY = 'blaidtrades-auth-state';

function getCachedAuth(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Backward compatible: accept old format (userId only) or new format (userId + email)
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
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const hasCheckedAuth = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;

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
            console.log("[Auth] Session found", data.user);
            setUser(data.user);
            setSession({
              user: data.user,
              access_token: "session-based",
            });
            setCachedAuth(data.user);
          } else {
            console.log("[Auth] No session");
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
        console.error("[Auth] Check session error", error);
        setUser(null);
        setSession(null);
        setCachedAuth(null);
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
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut, refreshUser }}>
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
