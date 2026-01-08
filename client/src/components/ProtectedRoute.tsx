import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Spinner } from "@/components/ui/spinner";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute - Auth-only gate (no security checks on boot)
 * 
 * Security checks (2FA, user_security) are now action-time only.
 * They trigger when user attempts high-risk actions like:
 * - Promote to Live
 * - Broker key changes
 * - Emergency controls
 * 
 * This ensures the app loads immediately on refresh without blocking.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Render children immediately - no security gate blocking boot
  return <>{children}</>;
}

