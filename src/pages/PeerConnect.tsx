import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getBrainInviteState, retryBrainInvite, subscribeBrainInvite } from "@/lib/p2p/brainInvite";

/**
 * Landing for a plain peer-connect link (`/connect#peer-…`).
 * The dial itself is handled app-wide by BrainInviteConnection and the
 * startup "invite first" hook; this page only shows progress. It never
 * routes into the Brain or a profile — the user decides where to go next.
 */
export default function PeerConnect() {
  const navigate = useNavigate();
  const state = useSyncExternalStore(subscribeBrainInvite, getBrainInviteState);
  const pending = state.phase === "idle" || state.phase === "starting" || state.phase === "connecting";
  const connected = state.phase === "syncing" || state.phase === "connected";
  // React Router stores the history index; 0 means this link opened a fresh tab.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const shortId = state.peerId ? `${state.peerId.slice(0, 18)}${state.peerId.length > 18 ? "…" : ""}` : "";

  const message = pending
    ? `Connecting to ${shortId || "peer"}…`
    : connected
      ? `Connected to ${shortId || "peer"} as a peer node.`
      : state.phase === "invalid"
        ? "This connect link is invalid, your own, or the peer is blocked."
        : "The peer has not answered yet. They may be offline.";

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            {pending ? (
              <Loader2 className="h-6 w-6 shrink-0 animate-spin text-yellow-500" />
            ) : connected ? (
              <Wifi className="h-6 w-6 shrink-0 text-green-500" />
            ) : (
              <WifiOff className="h-6 w-6 shrink-0 text-muted-foreground" />
            )}
            <h1 className="text-lg font-semibold">Peer connect</h1>
          </div>
          <p role="status" aria-live="polite" className="break-words text-sm text-muted-foreground">
            {message}
          </p>
          {state.peerId && (
            <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-xs" title={state.peerId}>
              {state.peerId}
            </code>
          )}
          <div className="flex flex-wrap gap-2">
            {state.phase === "unavailable" && (
              <Button type="button" variant="outline" size="sm" onClick={retryBrainInvite}>
                Retry
              </Button>
            )}
            {canGoBack && (
              <Button type="button" variant={connected ? "default" : "ghost"} size="sm" onClick={() => navigate(-1)}>
                Back
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/node-dashboard")}>
              Node dashboard
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The connection stays open in the background while you use the app.
          </p>
        </Card>
      </main>
    </div>
  );
}
