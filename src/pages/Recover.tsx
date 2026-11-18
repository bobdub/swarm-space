/**
 * /recover?id=<userId>&v=<shellVersion>&peer=<hostPeerId>
 *
 * Invite-style sovereign recovery: boots a guest transport, dials the host
 * peer through the manual (user-intent) path, asks connected peers for the
 * highest signed vault envelope for `id`, then opens the outer shell locally
 * with the Recovery Passphrase and rehydrates the identity under a new local
 * password. Nothing typed here is ever sent to a peer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, KeyRound, Loader2, RefreshCw, ShieldCheck, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useP2PContext } from "@/contexts/P2PContext";
import { ensureGuestIdentity } from "@/lib/preview/guestMode";
import { isGuestUser } from "@/lib/preview/guestAccess";
import { restoreAccountFromVault } from "@/lib/auth";
import {
  openRecoveryVault,
  parseRecoveryParams,
  WrongRecoveryPassphraseError,
  type RecoveryVaultEnvelope,
} from "@/lib/backup/recoveryVault";
import { adoptRestoredVault, bestKnownVault, queryVaultFromPeer } from "@/lib/backup/vaultCustody";
import { MEMBER_HOME } from "@/lib/routing/canonicalHome";

type Phase = "no-link" | "starting" | "searching" | "found" | "not-found";

const SEARCH_TIMEOUT_MS = 60_000;
const QUERY_INTERVAL_MS = 3_000;

export default function Recover() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => parseRecoveryParams(location.search), [location.search]);
  const { user, isReady } = useAuthReady();
  const { isEnabled, isConnecting, enable, connectToPeer, stats } = useP2PContext();

  const [phase, setPhase] = useState<Phase>(params ? "starting" : "no-link");
  const [envelope, setEnvelope] = useState<RecoveryVaultEnvelope | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialedRef = useRef<string | null>(null);
  const queriedRef = useRef(new Map<string, number>());

  const memberSignedIn = !!user && !isGuestUser(user);
  const restoringOwnAccount = memberSignedIn && user?.id === params?.id;

  useEffect(() => {
    setPhase(params ? "starting" : "no-link");
    setEnvelope(null);
    dialedRef.current = null;
    queriedRef.current.clear();
  }, [params, attempt]);

  // 1. A transport needs an identity: provision an ephemeral guest if signed out.
  useEffect(() => {
    if (!params || !isReady || user) return;
    void ensureGuestIdentity().catch(() => { /* surfaced as not-found after timeout */ });
  }, [params, isReady, user]);

  // 2. Enable the mesh and attach the custody channel.
  useEffect(() => {
    if (!params || !isReady || !user) return;
    void import("@/lib/backup/vaultCustodyMesh").then((m) => m.attachVaultCustodyToMesh()).catch(() => {});
    if (!isEnabled && !isConnecting) void enable().catch(() => {});
  }, [params, isReady, user, isEnabled, isConnecting, enable]);

  // 3. Local copy first (this device may already hold the vault), then peers.
  useEffect(() => {
    if (!params || phase !== "starting") return;
    let cancelled = false;
    void bestKnownVault(params.id).then((local) => {
      if (cancelled) return;
      if (local && local.version >= params.v) {
        setEnvelope(local);
        setPhase("found");
      } else {
        if (local) setEnvelope(local);
        setPhase("searching");
      }
    });
    return () => { cancelled = true; };
  }, [params, phase]);

  const consider = useCallback((candidate: RecoveryVaultEnvelope | null) => {
    if (!candidate || !params) return;
    setEnvelope((prev) => (prev && prev.version >= candidate.version ? prev : candidate));
    if (candidate.version >= params.v) setPhase("found");
  }, [params]);

  // 4. Dial the host peer (manual, user-intent path) and query connected peers.
  useEffect(() => {
    if (!params || phase !== "searching" || !isEnabled) return;
    const startedAt = Date.now();
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
      const mesh = getSwarmMeshStandalone();
      const online = stats.status === "online" || stats.status === "waiting" || stats.status === "connecting";
      if (params.peer && dialedRef.current !== params.peer && online) {
        const connected = mesh.getConnectedPeerIds().includes(params.peer);
        if (connected || connectToPeer(params.peer, { manual: true, source: "recovery" })) dialedRef.current = params.peer;
      }
      const connected = mesh.getConnectedPeerIds();
      // Ask the host first; any other connected peer may hold a copy too.
      const ordered = params.peer && connected.includes(params.peer)
        ? [params.peer, ...connected.filter((p) => p !== params.peer)]
        : connected;
      for (const peerId of ordered) {
        const last = queriedRef.current.get(peerId) ?? 0;
        if (Date.now() - last < 15_000) continue;
        queriedRef.current.set(peerId, Date.now());
        void queryVaultFromPeer(peerId, params.id, 12_000).then((env) => { if (!stopped) consider(env); });
      }
      if (Date.now() - startedAt > SEARCH_TIMEOUT_MS) {
        setPhase((p) => (p === "searching" ? "not-found" : p));
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), QUERY_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [params, phase, isEnabled, stats.status, connectToPeer, consider]);

  const openLink = () => {
    try {
      const url = new URL(linkInput.trim(), window.location.origin);
      const hashQuery = /^#!?\/recover\/?(\?.*)$/.exec(url.hash)?.[1];
      const search = hashQuery ?? url.search;
      if (!parseRecoveryParams(search)) throw new Error("bad link");
      navigate(`/recover${search}`);
    } catch {
      toast.error("That doesn't look like a Recovery Link");
    }
  };

  const handleRestore = async () => {
    if (!envelope) return;
    if (localPassword.trim().length < 8) {
      toast.error("Choose a local password of at least 8 characters");
      return;
    }
    if (localPassword !== confirmPassword) {
      toast.error("Local passwords don't match");
      return;
    }
    setRestoring(true);
    try {
      const payload = await openRecoveryVault(envelope, passphrase);
      await restoreAccountFromVault(payload, localPassword);
      await adoptRestoredVault(envelope);
      setPassphrase("");
      setLocalPassword("");
      setConfirmPassword("");
      toast.success(`Welcome back, ${payload.user.displayName || payload.user.username}`);
      navigate(MEMBER_HOME, { replace: true });
    } catch (err) {
      if (err instanceof WrongRecoveryPassphraseError) {
        toast.error(`That passphrase does not open outer shell v${envelope.version}`);
      } else {
        console.error("[Recover] restore failed", err);
        toast.error(err instanceof Error ? err.message : "Recovery failed");
      }
    } finally {
      setRestoring(false);
    }
  };

  const staleVersion = envelope && params && envelope.version < params.v;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-primary/5 to-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Recover your identity</CardTitle>
          <CardDescription>
            Your encrypted vault is fetched from a peer and opened here. Your passphrase never leaves this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "no-link" && (
            <div className="space-y-3">
              <Label htmlFor="recovery-link">Recovery Link</Label>
              <Input
                id="recovery-link"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://…/recover?id=…&v=…&peer=…"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                It's in your <code>swarm-identity-*.md</code> file and in Settings → Security on any device still signed in.
              </p>
              <Button className="w-full" onClick={openLink} disabled={!linkInput.trim()}>Continue</Button>
            </div>
          )}

          {params && (
            <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
              <div>Identity <code className="text-foreground">{params.id}</code>, shell v{params.v} or newer</div>
              {params.peer && <div className="truncate">Host peer <code>{params.peer}</code></div>}
            </div>
          )}

          {restoringOwnAccount && (
            <Alert>
              <AlertDescription className="text-xs">This identity is already signed in on this device.</AlertDescription>
            </Alert>
          )}
          {memberSignedIn && !restoringOwnAccount && params && (
            <Alert>
              <AlertDescription className="text-xs">
                Another account is signed in. Recovering will switch this device to the recovered identity; the other
                account stays stored here.
              </AlertDescription>
            </Alert>
          )}

          {(phase === "starting" || phase === "searching") && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {!isEnabled || isConnecting
                  ? "Starting a secure peer connection…"
                  : params?.peer
                    ? "Reaching your host peer and asking for your vault…"
                    : "Asking connected peers for your vault…"}
              </span>
            </div>
          )}

          {staleVersion && phase !== "found" && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-xs">
                A peer holds an older shell (v{envelope.version}). Still looking for v{params!.v}.
              </AlertDescription>
            </Alert>
          )}

          {phase === "not-found" && (
            <div className="space-y-3">
              <Alert className="border-amber-500/50 bg-amber-500/10">
                <Wifi className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-xs">
                  No connected peer has returned your vault yet. Make sure the host peer is online, then try again.
                  {envelope && ` An older shell (v${envelope.version}) is available below.`}
                </AlertDescription>
              </Alert>
              <Button variant="outline" className="w-full gap-2" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          )}

          {envelope && (phase === "found" || phase === "not-found") && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleRestore();
              }}
            >
              <div className="flex items-center gap-2 text-sm text-green-500">
                <ShieldCheck className="h-4 w-4" />
                Signed vault found (outer shell v{envelope.version})
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recover-passphrase">Recovery Passphrase</Label>
                <Input id="recover-passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" required />
                <p className="text-xs text-muted-foreground">
                  The active shell's passphrase{envelope.version === 1 ? " (for v1, your signup password)" : ""}.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recover-local-password">New local password for this device</Label>
                <Input id="recover-local-password" type="password" value={localPassword} onChange={(e) => setLocalPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recover-local-confirm">Confirm local password</Label>
                <Input id="recover-local-confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={restoring || !passphrase}>
                {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {restoring ? "Opening vault…" : "Unlock and restore"}
              </Button>
            </form>
          )}

          <Button variant="ghost" className="w-full text-xs" onClick={() => navigate("/auth")}>Back to sign in</Button>
        </CardContent>
      </Card>
    </div>
  );
}
