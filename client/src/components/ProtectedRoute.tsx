import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute - Institutional-grade auth gate
 * 
 * Performance-first pattern:
 * - Trusts cached auth immediately for instant navigation (< 50ms)
 * - NEVER unmounts children during background verification
 * - Shows skeleton only on true cold start (no cached session)
 * - Redirects to login only after verification confirms no session
 * 
 * Security: Session is verified in background, logout if server rejects.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, isVerified } = useAuth();
  const location = useLocation();

  // Have cached user - render immediately, verify in background
  // This is the key to instant navigation - trust cache, verify async
  if (user) {
    return <>{children}</>;
  }

  // No cached user but still loading - show skeleton (cold start only)
  if (loading && !isVerified) {
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

  // Verified with no user - redirect to login
  return <Navigate to="/login" state={{ from: location }} replace />;
}
