import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * Route guard — redirects unauthenticated users to /auth.
 * Allows the share-link short-circuit (?peerID=...-preview) to render
 * publicly so existing share previews keep working.
 */
export function AuthGuard() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  // Public share-link short-circuit on Index.
  const params = new URLSearchParams(location.search);
  const peerID = params.get("peerID") ?? "";
  const isPublicSharePreview =
    location.pathname === "/" && peerID.endsWith("-preview");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user && !isPublicSharePreview) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export default AuthGuard;