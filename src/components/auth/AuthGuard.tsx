import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";

import { isHomelessRedirect } from "@/lib/routing/canonicalHome";

/**
 * Route guard — redirects unauthenticated users to /auth.
 * Allows the share-link short-circuit (?peerID=...-preview) to render
 * publicly so existing share previews keep working.
 */
export function AuthGuard() {
  const { user, status, storageUnavailable } = useSession();
  const isReady = status !== "unknown";
  const location = useLocation();

  // Public share-link short-circuit on Index.
  const params = new URLSearchParams(location.search);
  const peerID = params.get("peerID") ?? "";
  const isPublicSharePreview =
    location.pathname === "/" && peerID.endsWith("-preview");

  if (!isReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        {storageUnavailable && (
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            Restoring your session — this device's storage is busy. Close any
            other tabs of this app and it will continue automatically.
          </p>
        )}
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