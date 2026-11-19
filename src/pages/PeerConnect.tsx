import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Compass, Loader2, MessageCircle, UserRound, Wifi, WifiOff } from "lucide-react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { isGuestUser, setGuestName } from "@/lib/preview/guestMode";
import { useP2PContext } from "@/contexts/P2PContext";
import { BRAIN_JOIN_PATH, getBrainInviteState, retryBrainInvite, subscribeBrainInvite } from "@/lib/p2p/brainInvite";

type InviterProfile = { username: string | null; label: string | null };

/** Resolve the inviter's public name from the live connection or discovery cache. */
function useInviterProfile(peerId: string | null, connected: boolean): InviterProfile {
  const { getActivePeerConnections, getDiscoveredPeers } = useP2PContext();
  const [, tick] = useState(0);
  const read = (): InviterProfile => {
    if (!peerId) return { username: null, label: null };
    let profile;
    try {
      profile =
        getActivePeerConnections().find(peer => peer.peerId === peerId)?.profile ??
        getDiscoveredPeers().find(peer => peer.peerId === peerId)?.profile;
    } catch {
      profile = undefined;
    }
    const username = profile?.username?.trim() || null;
    return { username, label: profile?.displayName?.trim() || (username ? `@${username}` : null) };
  };
  const inviter = read();
  // Profiles arrive a beat after the DataChannel opens; poll until named.
  useEffect(() => {
    if (!connected || inviter.username) return;
    const timer = window.setInterval(() => tick(n => (n + 1) & 0xfff), 1000);
    return () => window.clearInterval(timer);
  }, [connected, inviter.username]);
  return inviter;
}

/** Lets a guest pick the name peers see, before heading anywhere else. */
function GuestNameField() {
  const { user } = useAuth();
  const current = isGuestUser(user) ? user.guestName?.trim() ?? "" : "";
  const [name, setName] = useState(current);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setName(current); }, [current]);
  if (!user || !isGuestUser(user)) return null;
  const trimmed = name.trim();
  const unchanged = trimmed.replace(/\s+/g, " ") === current;
  const save = () => {
    const ok = setGuestName(user.id, name);
    setSaved(ok);
    setFailed(!ok);
  };
  return (
    <form
      className="space-y-2"
      onSubmit={event => {
        event.preventDefault();
        if (trimmed && !unchanged) save();
      }}
    >
      <Label htmlFor="peer-connect-guest-name">Your display name</Label>
      <div className="flex gap-2">
        <Input
          id="peer-connect-guest-name"
          value={name}
          maxLength={32}
          autoComplete="off"
          placeholder="How others will see you"
          onChange={event => {
            setName(event.target.value);
            setSaved(false);
            setFailed(false);
          }}
        />
        <Button type="submit" variant="outline" disabled={!trimmed || unchanged}>
          Save
        </Button>
      </div>
      {saved && unchanged ? (
        <p role="status" className="flex items-center gap-1 text-xs text-green-600">
          <Check className="h-3 w-3" /> Saved. Your connections will see you as {current}.
        </p>
      ) : failed ? (
        <p role="alert" className="text-xs text-destructive">Could not save your name. Please try again.</p>
      ) : (
        <p className="text-xs text-muted-foreground">You're a guest. Pick a name so your connections know who joined.</p>
      )}
    </form>
  );
}

/**
 * Landing for a plain peer-connect link (`/connect#peer-…`).
 * The dial itself is handled app-wide by BrainInviteConnection and the
 * startup "invite first" hook; this page shows progress and, once connected,
 * offers next steps. It never routes on its own — the guest picks where to go.
 */
export default function PeerConnect() {
  const navigate = useNavigate();
  const state = useSyncExternalStore(subscribeBrainInvite, getBrainInviteState);
  const pending = state.phase === "idle" || state.phase === "starting" || state.phase === "connecting";
  const connected = state.phase === "syncing" || state.phase === "connected";
  // React Router stores the history index; 0 means this link opened a fresh tab.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const shortId = state.peerId ? `${state.peerId.slice(0, 18)}${state.peerId.length > 18 ? "…" : ""}` : "";
  const inviter = useInviterProfile(state.peerId, connected);
  const inviterName = inviter.label ?? shortId ?? "peer";

  const message = pending
    ? `Connecting to ${shortId || "peer"}…`
    : connected
      ? `Connected to ${inviterName || "peer"} as a peer node.`
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
          {connected && <GuestNameField />}
          {connected && (
            <nav aria-label="Next steps" className="space-y-2">
              <p className="text-sm font-medium">You're in! Where to next?</p>
              <Button type="button" className="w-full justify-start gap-2" onClick={() => navigate("/explore")}>
                <Compass className="h-4 w-4" />
                Start exploring
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start gap-2"
                onClick={() => navigate(state.peerId ? `${BRAIN_JOIN_PATH}#${encodeURIComponent(state.peerId)}` : "/brain")}
              >
                <MessageCircle className="h-4 w-4" />
                Join live chat
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                disabled={!inviter.username}
                onClick={() => inviter.username && navigate(`/u/${encodeURIComponent(inviter.username)}`)}
              >
                {inviter.username ? <UserRound className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                {inviter.username ? `View ${inviter.label ?? `@${inviter.username}`}'s profile` : "Loading your connection's profile…"}
              </Button>
            </nav>
          )}
          <div className="flex flex-wrap gap-2">
            {state.phase === "unavailable" && (
              <Button type="button" variant="outline" size="sm" onClick={retryBrainInvite}>
                Retry
              </Button>
            )}
            {canGoBack && (
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate(-1)}>
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
