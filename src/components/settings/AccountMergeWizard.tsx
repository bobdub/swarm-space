/**
 * Settings → Security → Merge Account.
 *
 * Pure pull: nothing here notifies. Device B only learns about Device A's
 * offer when this dialog is open (it probes connected peers on open).
 * All status is inline; no toasts, banners or sounds.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { AlertTriangle, CheckCircle2, Copy, Crown, Link2, Loader2, LogOut, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import {
  MERGE_CODE_TTL_MS,
  ensureMergeAttached,
  formatMergeCode,
  getMergeController,
  type MergeOffer,
  type MergeSessionView,
} from "@/lib/p2p/mergeProtocol";
import type { MergeAccountSummary } from "@/lib/blockchain/accountMerge";

const STEPS = ["Pair", "Verify", "Compare", "Authorize", "Merge", "Finish"] as const;

function stepIndex(session: MergeSessionView | null): number {
  if (!session) return 0;
  switch (session.phase) {
    case "offering":
    case "entering-code":
      return 0;
    case "verifying":
      return 1;
    case "paired":
      return session.masterUserId ? 3 : 2;
    case "executing":
      return 4;
    case "done":
      return 5;
    default:
      return 0;
  }
}

interface ConnectedPeer {
  peerId: string;
  userId?: string;
  label: string;
  discriminator?: string;
}

function useConnectedPeers(open: boolean): { peers: ConnectedPeer[]; selfPeerId: string | null } {
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);
  const [selfPeerId, setSelfPeerId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/lib/p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) => {
      if (cancelled) return;
      const mesh = getSwarmMeshStandalone();
      const read = () => {
        const library = new Map(mesh.getLibrary().map((p) => [p.peerId, p]));
        setPeers(mesh.getConnectedPeerIds().map((peerId) => {
          const entry = library.get(peerId);
          return {
            peerId,
            userId: entry?.userId,
            label: entry?.username || entry?.displayName || entry?.alias || peerId.slice(0, 14),
            discriminator: entry?.discriminator,
          };
        }));
        try { setSelfPeerId(mesh.getPeerId?.() ?? null); } catch { setSelfPeerId(null); }
      };
      read();
      const offPeers = mesh.onPeersChange(() => read());
      const offLib = mesh.onLibraryChange(() => read());
      stop = () => { offPeers(); offLib(); };
    });
    return () => { cancelled = true; stop?.(); };
  }, [open]);
  return { peers, selfPeerId };
}

function handleOf(name: string, disc?: string | null): string {
  return disc ? `@${name} #${disc}` : `@${name}`;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function joined(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, expiresAt - now);
  const secs = Math.ceil(left / 1000);
  return (
    <div className="space-y-1">
      <Progress value={(left / MERGE_CODE_TTL_MS) * 100} className="h-1.5" />
      <p className="text-center text-xs text-foreground/60">
        Expires in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </p>
    </div>
  );
}

function Stepper({ active }: { active: number }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Merge progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === active ? "step" : undefined}
          className={`rounded-full px-2 py-0.5 ${i < active ? "bg-primary/20 text-primary" : i === active ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-foreground/50"}`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function ComparisonTable({ local, remote, master, onPick, disabled }: {
  local: MergeAccountSummary;
  remote: MergeAccountSummary | null;
  master: string | null;
  onPick: (userId: string) => void;
  disabled: boolean;
}) {
  const cols: Array<{ s: MergeAccountSummary | null; mine: boolean }> = [{ s: local, mine: true }, { s: remote, mine: false }];
  const rows: Array<[string, (s: MergeAccountSummary) => string]> = [
    ["Handle", (s) => handleOf(s.username, s.discriminator)],
    ["Joined", (s) => joined(s.createdAt)],
    ["SWARM", (s) => `${fmt(s.swarm, 4)} SWARM`],
    ["Credits", (s) => `${fmt(s.credits)} Credits`],
    ["MintMe", (s) => `${fmt(s.mintme, 4)} MINTME`],
    ["Published posts", (s) => `${s.posts} posts`],
    ["Contacts", (s) => `${s.contacts} contacts`],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-foreground/60">
            <th className="py-1 pr-2 font-medium">Metric</th>
            {cols.map(({ s, mine }, i) => (
              <th key={i} className="py-1 pr-2 font-medium">
                {s ? `${mine ? "This device" : "Other device"}` : "Waiting…"}
                {s && master === s.userId && <Crown className="ml-1 inline h-3.5 w-3.5 text-amber-400" aria-label="Master" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className="border-t border-foreground/10">
              <td className="py-1.5 pr-2 text-foreground/60">{label}</td>
              {cols.map(({ s }, i) => (
                <td key={i} className={`py-1.5 pr-2 font-mono text-xs ${s && master === s.userId ? "text-primary" : ""}`}>{s ? get(s) : "…"}</td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-foreground/10">
            <td />
            {cols.map(({ s }, i) => (
              <td key={i} className="pt-2 pr-2">
                {s && (
                  <Button size="sm" variant={master === s.userId ? "default" : "outline"} disabled={disabled} onClick={() => onPick(s.userId)}>
                    {master === s.userId ? "Master" : "Keep as Master"}
                  </Button>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function AccountMergeWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const controller = getMergeController();
  const subscribe = useCallback((cb: () => void) => controller.subscribe(cb), [controller]);
  const getSnap = useCallback(() => controller.snapshot(), [controller]);
  // snapshot() returns a fresh object; memoise on its parts to keep React stable.
  const snap = useSyncExternalStore(subscribe, () => JSON.stringify(getSnap()));
  const { session, offers } = useMemo(() => JSON.parse(snap) as { session: MergeSessionView | null; offers: MergeOffer[] }, [snap]);
  const { peers, selfPeerId } = useConnectedPeers(open);
  const me = getCurrentUser();

  const [attachError, setAttachError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Post-merge (retiring device)
  const [finishMode, setFinishMode] = useState<"choose" | "sync">("choose");
  const [masterPhrase, setMasterPhrase] = useState("");
  const [newLocalPassword, setNewLocalPassword] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void ensureMergeAttached()
      .then((c) => { if (!cancelled) c.probe(); })
      .catch((err) => { if (!cancelled) setAttachError(err instanceof Error ? err.message : "The mesh is not running yet."); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    setActionError(null);
    if (session?.phase !== "entering-code") setCode("");
    if (session?.phase !== "paired") setPassword("");
  }, [session?.phase, session?.masterUserId]);

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const mergeable = peers.filter((p) => !p.userId || p.userId !== me?.id);
  const inviteUrl = selfPeerId ? `${window.location.origin}/connect#${encodeURIComponent(selfPeerId)}` : "";
  const local = session?.localSummary ?? null;
  const remote = session?.remoteSummary ?? null;
  const master = session?.masterUserId ?? null;
  const localIsMaster = !!master && master === local?.userId;
  const retiringSummary = master ? (master === local?.userId ? remote : local) : null;
  const masterSummary = master ? (master === local?.userId ? local : remote) : null;

  const close = (next: boolean) => {
    if (!next && session?.phase === "executing") return; // never hide a running merge
    onOpenChange(next);
  };

  const body = () => {
    if (!me) return <p className="text-sm text-foreground/60">Sign in to merge accounts.</p>;
    if (attachError) {
      return (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-xs">{attachError}</AlertDescription>
        </Alert>
      );
    }

    // ── Start: pick a peer, or answer a pending offer ──
    if (!session) {
      return (
        <div className="space-y-5">
          {offers.length > 0 && (
            <div className="space-y-2">
              {offers.map((offer) => (
                <div key={offer.sessionId} className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-semibold">Pending Merge Available</p>
                  <p className="text-xs text-foreground/70">
                    From connected peer: <span className="font-mono">{handleOf(offer.from.username, offer.from.discriminator)}</span>
                  </p>
                  <p className="mt-1 text-xs text-foreground/60">This device is offering to pair for an account merge.</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => void run(() => controller.accept(offer.sessionId))}>Accept</Button>
                    <Button size="sm" variant="ghost" onClick={() => controller.decline(offer.sessionId)}>Decline</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>Connected devices</Label>
            {mergeable.length === 0 ? (
              <div className="space-y-3 rounded-2xl border border-foreground/10 p-4">
                <p className="text-sm text-foreground/70">
                  No other device is connected. Open this link on the other device (or scan the code) to connect it over the mesh.
                </p>
                {inviteUrl ? (
                  <>
                    <div className="flex gap-2">
                      <Input value={inviteUrl} readOnly className="font-mono text-xs" aria-label="Device invite link" />
                      <Button variant="outline" size="icon" aria-label="Copy invite link" onClick={() => void navigator.clipboard.writeText(inviteUrl).catch(() => undefined)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex justify-center rounded-xl bg-white p-3">
                      <QRCodeSVG value={inviteUrl} size={156} bgColor="#ffffff" fgColor="#000000" aria-label="Device invite QR code" />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-foreground/50">Waiting for this device to join the mesh…</p>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {mergeable.map((p) => (
                  <li key={p.peerId} className="flex items-center justify-between gap-2 rounded-2xl border border-foreground/10 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <Smartphone className="h-4 w-4 shrink-0 text-foreground/50" />
                      <span className="truncate font-mono">{handleOf(p.label, p.discriminator)}</span>
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => void run(() => { controller.initiate(p.peerId); })}>
                      Initiate Merge
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-foreground/50">
              On the other device, open Settings → Security → Merge Account. Offers only appear there; nothing pops up.
            </p>
          </div>
        </div>
      );
    }

    switch (session.phase) {
      case "offering":
        return (
          <div className="space-y-4 text-center">
            <p className="text-sm text-foreground/70">On the other device, open Settings → Security → Merge Account, accept, and enter:</p>
            <p className="font-mono text-4xl tracking-[0.3em]" aria-label="Verification code">{session.code ? formatMergeCode(session.code) : "—"}</p>
            <Countdown expiresAt={session.expiresAt} />
            {session.attemptsLeft < 3 && <p className="text-xs text-amber-500">{session.attemptsLeft} attempt{session.attemptsLeft === 1 ? "" : "s"} left</p>}
            <Button variant="ghost" onClick={() => controller.cancel()}>Cancel</Button>
          </div>
        );
      case "entering-code":
      case "verifying":
        return (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">Enter Verification Code</p>
              <p className="text-xs text-foreground/60">
                Enter the 6-digit code shown on {session.remote ? handleOf(session.remote.username, session.remote.discriminator) : "the other device"}'s screen:
              </p>
            </div>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode} disabled={session.phase === "verifying"} inputMode="numeric" pattern="^[0-9]*$">
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Countdown expiresAt={session.expiresAt} />
            {session.error && <p className="text-center text-xs text-amber-500">{session.error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => controller.cancel()}>Cancel</Button>
              <Button disabled={code.length !== 6 || session.phase === "verifying"} onClick={() => void run(() => controller.submitCode(code))} className="gap-2">
                {session.phase === "verifying" && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify
              </Button>
            </div>
          </div>
        );
      case "paired":
        return (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-green-500">
              <ShieldCheck className="h-4 w-4" /> Devices Paired &amp; Verified
            </p>
            {local ? (
              <ComparisonTable local={local} remote={remote} master={master} disabled={busy || !remote} onPick={(id) => controller.selectMaster(id)} />
            ) : (
              <p className="text-sm text-foreground/60">{session.error ?? "Reading this account…"}</p>
            )}

            {master && masterSummary && retiringSummary && (
              <div className="space-y-3 rounded-2xl border border-foreground/10 p-4">
                <p className="text-xs text-foreground/60">
                  Master identity (kept): <span className="font-mono">{handleOf(masterSummary.username, masterSummary.discriminator)}</span>
                  <br />
                  Retiring identity (merged &amp; closed): <span className="font-mono">{handleOf(retiringSummary.username, retiringSummary.discriminator)}</span>
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-foreground/80">
                  <li>Assets moving to Master: +{fmt(retiringSummary.swarm, 4)} SWARM, +{fmt(retiringSummary.credits)} Credits, +{fmt(retiringSummary.mintme, 4)} MINTME.</li>
                  <li>{retiringSummary.posts} posts re-attributed with a verified merge link; {retiringSummary.contacts} contacts added to Master's library.</li>
                  <li>Retirement: the retiring key signs an account tombstone and its recovery vault is retired across the mesh.</li>
                  <li>Comments the retiring account left on other posts are removed by its tombstone. Engraved or locked coins are not spendable balances and stay with it.</li>
                  {retiringSummary.mintme > 0 && (
                    <li>MINTME held on the MintMe chain is sent there for real (1 MINTME gas hold). The master is credited once MintMe confirms it.</li>
                  )}
                </ul>
                <div className="space-y-1.5">
                  <Label htmlFor="merge-password">
                    {localIsMaster
                      ? `Enter password for ${handleOf(local?.username ?? "")} to accept merge.`
                      : `Enter password for ${handleOf(local?.username ?? "")} to release assets and retire.`}
                  </Label>
                  <div className="flex gap-2">
                    <Input id="merge-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={session.localAuthorized} />
                    <Button variant="outline" disabled={busy || session.localAuthorized || !password} onClick={() => void run(async () => { await controller.authorize(password); setPassword(""); })}>
                      {session.localAuthorized ? "Unlocked" : "Unlock"}
                    </Button>
                  </div>
                  <p className="text-xs text-foreground/60">
                    This device: {session.localAuthorized ? "authorized" : "waiting"} · Other device: {session.remoteAuthorized ? "authorized" : "waiting"}
                  </p>
                </div>
                <Button className="w-full" disabled={busy || !controller.canExecute()} onClick={() => void run(() => controller.execute())}>
                  Execute Merge
                </Button>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => controller.cancel()}>Cancel</Button>
            </div>
          </div>
        );
      case "executing":
        return (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" /> Merging… keep both devices open.</p>
            <ol className="space-y-1 text-xs text-foreground/70">
              {session.progress.map((p, i) => <li key={i}>✓ {p}</li>)}
            </ol>
          </div>
        );
      case "done":
        if (session.retired) {
          return finishMode === "choose" ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-green-500">
                <CheckCircle2 className="h-4 w-4" /> Merged into @{session.retired.masterUsername}. This account is retired.
              </p>
              {!session.retired.tombstoned && (
                <p className="text-xs text-amber-500">The account tombstone could not be signed here; peers will keep the old posts until it is.</p>
              )}
              <p className="text-sm">What would you like this device to do?</p>
              <div className="grid gap-2">
                <Button className="justify-start gap-2" onClick={() => setFinishMode("sync")}>
                  <RefreshCw className="h-4 w-4" /> Sync to Master Account (recommended)
                </Button>
                <Button variant="outline" className="justify-start gap-2" disabled={busy} onClick={() => void run(async () => {
                  const merge = await import("@/lib/blockchain/accountMerge");
                  const { logoutUser } = await import("@/lib/auth");
                  const retiringId = getCurrentUser()?.id;
                  if (retiringId) await merge.removeRetiredAccountFromDevice(retiringId);
                  controller.clear();
                  logoutUser();
                  window.location.assign("/");
                })}>
                  <LogOut className="h-4 w-4" /> Sign Out (remove the retired account from this browser)
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-foreground/70">
                The master identity arrives here as its encrypted recovery vault, fetched from the master device. Its key
                never travels in the clear: enter the master's Recovery Passphrase to open it (until a separate phrase is
                wrapped, that is the master's account password).
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="master-phrase">Master Recovery Passphrase</Label>
                <Input id="master-phrase" type="password" value={masterPhrase} onChange={(e) => setMasterPhrase(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-local-password">New local password for this device (min 8)</Label>
                <Input id="new-local-password" type="password" value={newLocalPassword} onChange={(e) => setNewLocalPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setFinishMode("choose")}>Back</Button>
                <Button disabled={busy || !masterPhrase || newLocalPassword.trim().length < 8} className="gap-2" onClick={() => void run(async () => {
                  const retired = session.retired!;
                  const [{ queryVaultFromPeer, adoptRestoredVault }, { openRecoveryVault }, { restoreAccountFromVault }, merge] = await Promise.all([
                    import("@/lib/backup/vaultCustody"),
                    import("@/lib/backup/recoveryVault"),
                    import("@/lib/auth"),
                    import("@/lib/blockchain/accountMerge"),
                  ]);
                  const envelope = await queryVaultFromPeer(session.remotePeerId, retired.masterId, 15_000);
                  if (!envelope) throw new Error("The master device did not return its recovery vault. Keep it connected, and make sure it has sealed one (Settings → Security).");
                  let payload;
                  try {
                    payload = await openRecoveryVault(envelope, masterPhrase);
                  } catch {
                    throw new Error("That passphrase does not open the master's recovery vault.");
                  }
                  const retiringId = getCurrentUser()?.id;
                  await restoreAccountFromVault(payload, newLocalPassword);
                  await adoptRestoredVault(envelope).catch(() => undefined);
                  if (retiringId && retiringId !== retired.masterId) await merge.removeRetiredAccountFromDevice(retiringId);
                  controller.clear();
                  window.location.assign("/");
                })}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Install Master on this device
                </Button>
              </div>
            </div>
          );
        }
        return (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-green-500">
              <CheckCircle2 className="h-4 w-4" /> Merge complete! Your balances and history have been consolidated.
            </p>
            {session.absorbed && (
              <p className="text-xs text-foreground/70">
                {session.absorbed.postsReattributed} posts re-attributed · {session.absorbed.contactsAdded} contacts added.
              </p>
            )}
            <ol className="space-y-1 text-xs text-foreground/60">
              {session.progress.map((p, i) => <li key={i}>✓ {p}</li>)}
            </ol>
            <div className="flex justify-end">
              <Button onClick={() => { controller.clear(); onOpenChange(false); }}>Done</Button>
            </div>
          </div>
        );
      default: {
        const text: Record<string, string> = {
          expired: "The code expired. Start again from either device.",
          declined: "The other device declined the merge.",
          cancelled: session.error ?? "The merge was cancelled.",
          failed: session.error ?? "The merge stopped.",
        };
        return (
          <div className="space-y-3">
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-xs leading-relaxed">{text[session.phase] ?? "The merge ended."}</AlertDescription>
            </Alert>
            {session.progress.length > 0 && (
              <ol className="space-y-1 text-xs text-foreground/60">
                {session.progress.map((p, i) => <li key={i}>✓ {p}</li>)}
              </ol>
            )}
            <div className="flex justify-end">
              <Button onClick={() => controller.clear()}>Start over</Button>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Merge Account</DialogTitle>
          <DialogDescription>
            Fold two of your accounts into one. Both devices must be connected, show the same code, and be unlocked with their own password.
          </DialogDescription>
        </DialogHeader>
        <Stepper active={stepIndex(session)} />
        {body()}
        {actionError && <p className="mt-2 text-xs text-amber-500">{actionError}</p>}
      </DialogContent>
    </Dialog>
  );
}
