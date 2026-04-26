import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isHomelessRedirect } from "@/lib/routing/canonicalHome";

/**
 * Route guard — redirects unauthenticated users to /auth.
 * Allows the share-link short-circuit (?peerID=...-preview) to render
 * publicly so existing share previews keep working.
 */
export function AuthGuard() {
  const { user, isReady } = useAuthReady();
  const location = useLocation();

  // Public share-link short-circuit on Index.
  const params = new URLSearchParams(location.search);
  const peerID = params.get("peerID") ?? "";
  const isPublicSharePreview =
    location.pathname === "/" && peerID.endsWith("-preview");

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user && !isPublicSharePreview) {
    // Only carry the `from` hint forward when it points at a real deep link.
    // Bare `/` collapses to "no preference" so post-login can route to the
    // canonical home (currently /brain) instead of bouncing back to root.
    const state = isHomelessRedirect(location.pathname)
      ? undefined
      : { from: location };
    return <Navigate to="/auth" replace state={state} />;
  }

  return <Outlet />;
}

export default AuthGuard;