import { createContext, useContext, useEffect, useState } from "react";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
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
          } else {
            console.log("[Auth] No session");
            setUser(null);
            setSession(null);
          }
        } else {
          setUser(null);
          setSession(null);
        }
      } catch (error) {
        console.error("[Auth] Check session error", error);
        setUser(null);
        setSession(null);
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
        }
      }
    } catch (error) {
      console.error("[Auth] Refresh user error", error);
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
