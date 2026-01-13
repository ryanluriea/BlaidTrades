import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute - Auth gate with themed skeleton loading
 * 
 * Industry-standard pattern:
 * - Always waits for auth verification before showing protected content
 * - Shows themed skeleton shell during loading (never black screen)
 * - Redirects to login only after auth check confirms no session
 * 
 * Security: Never renders children until auth is verified server-side.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Still loading - show themed skeleton shell (not spinner, not black screen)
  if (loading) {
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

  // Auth verified - no user means redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Auth verified with valid user - render protected content
  return <>{children}</>;
}
