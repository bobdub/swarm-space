/**
 * Settings → Security: the sovereign identity dashboard.
 *
 * Shows the namespace handle (#discriminator), the versioned Recovery Link
 * with live peer-custody status, a downloadable credential `.md`, and the
 * "Wrap New Outer Shell" rotation. Also hosts the local password change,
 * which only re-wraps the on-device key and never touches the vault.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Copy, Download, Info, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { getCachedPrivateKey, getCurrentUser, loginUser, type UserMeta, type WrappedKey } from "@/lib/auth";
import { unwrapPrivateKey, wrapPrivateKey } from "@/lib/crypto";
import { get, put } from "@/lib/store";
import { useP2P } from "@/hooks/useP2P";
import { openRecoveryVault, recoveryUrl } from "@/lib/backup/recoveryVault";
import {
  CUSTODY_EVENT,
  getCustodyAcks,
  getOwnVault,
  rotateRecoveryShell,
  type OwnVaultRecord,
} from "@/lib/backup/vaultCustody";
import { buildIdentityCredentialMarkdown, credentialFileName } from "@/lib/backup/identityCredentialFile";

const MIN_RECOVERY_PASSPHRASE = 12;
const card = "rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6";

async function opensLocalWrap(user: UserMeta, candidate: string): Promise<boolean> {
  const entry = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef).catch(() => undefined);
  if (!entry?.v || entry.v.rawStored || !entry.v.salt || !entry.v.iv) return false;
  try {
    await unwrapPrivateKey({ wrapped: entry.v.wrapped, salt: entry.v.salt, iv: entry.v.iv }, candidate.trim());
    return true;
  } catch {
    return false;
  }
}

/** Rotation must retire the old phrase, so re-using it is refused. */
async function opensCurrentShell(record: OwnVaultRecord, candidate: string): Promise<boolean> {
  try {
    await openRecoveryVault(record.envelope, candidate);
    return true;
  } catch {
    return false;
  }
}

async function unlockKey(accountPassword: string): Promise<string | null> {
  const cached = await getCachedPrivateKey();
  if (cached) return cached;
  if (!accountPassword) return null;
  try {
    return await loginUser(accountPassword.trim());
  } catch {
    return null;
  }
}

export function SovereignSecurityPanel() {
  const user = getCurrentUser();
  const { getPeerId } = useP2P();
  const peerId = getPeerId();

  const [vault, setVault] = useState<OwnVaultRecord | null>(null);
  const [custodyPeers, setCustodyPeers] = useState<Array<{ peerId: string; name?: string }>>([]);
  const [discriminator, setDiscriminator] = useState<string | null>(null);
  const [coldAddress, setColdAddress] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [rotateOpen, setRotateOpen] = useState(false);
  const [newPhrase, setNewPhrase] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [rotatePassword, setRotatePassword] = useState("");
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [rotating, setRotating] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const userId = user?.id ?? "";

  const refresh = useCallback(async () => {
    if (!userId) return;
    const own = await getOwnVault(userId);
    setVault(own);
    const acks = await getCustodyAcks(userId);
    setCustodyPeers(
      own && acks.version === own.envelope.version
        ? Object.entries(acks.peers).map(([id, info]) => ({ peerId: id, name: info.name }))
        : [],
    );
    setLoaded(true);
  }, [userId]);

  // Retire legacy recovery leftovers (chunk dumps, SWRM keys and a phrase
  // that older builds kept in plain localStorage).
  useEffect(() => {
    if (!userId) return;
    for (const prefix of ["recovery-chunks", "recovery-manifest", "recovery-key", "backup-passphrase", "passphrase-backup-done", "recovery-key-backup"]) {
      try { localStorage.removeItem(`${prefix}:${userId}`); } catch { /* ignore */ }
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId === userId) void refresh();
    };
    window.addEventListener(CUSTODY_EVENT, onUpdate);
    return () => window.removeEventListener(CUSTODY_EVENT, onUpdate);
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getColdKeyReceivingAddress } = await import("@/lib/blockchain/wallets/coldKey");
        const address = await getColdKeyReceivingAddress(userId);
        const { namespaceIdentity } = await import("@/lib/uqrc/namespaceIdentity");
        const ns = await namespaceIdentity(userId, address);
        if (!cancelled) {
          setColdAddress(address);
          setDiscriminator(ns.discriminator);
        }
      } catch {
        /* locked with no remembered address: show the bare handle */
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!rotateOpen) return;
    void getCachedPrivateKey().then((k) => setNeedsUnlock(!k)).catch(() => setNeedsUnlock(true));
  }, [rotateOpen]);

  if (!user) return null;

  const version = vault?.envelope.version ?? 0;
  const handle = discriminator ? `${user.username}#${discriminator}` : user.username;
  // The link names a CUSTODIAN (a peer that acked this shell), because the
  // device you recover from is usually not this one. Before any custody, fall
  // back to this node so a second device can still recover while it is online.
  const linkPeer = custodyPeers[0]?.peerId ?? peerId;
  const link = version > 0 ? recoveryUrl(window.location.origin, { id: user.id, v: version, peer: linkPeer }) : "";
  const custodyLabel = !vault
    ? "No recovery vault sealed yet"
    : custodyPeers.length > 0
      ? `Vault v${version} synced to ${custodyPeers.length} peer${custodyPeers.length === 1 ? "" : "s"}`
      : "Waiting for a peer connection";

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Could not copy ${label.toLowerCase()}`),
    );
  };

  const downloadCredentials = () => {
    if (!vault) return;
    const md = buildIdentityCredentialMarkdown({
      username: user.username,
      displayName: user.displayName,
      userId: user.id,
      discriminator,
      shellVersion: version,
      genesisDefault: vault.genesisDefault,
      publicKey: user.publicKey,
      coldAddress,
      recoveryUrl: link,
    });
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = credentialFileName(user.username);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Identity file downloaded");
  };

  const closeRotate = () => {
    setRotateOpen(false);
    setNewPhrase("");
    setConfirmPhrase("");
    setRotatePassword("");
  };

  const handleRotate = async () => {
    const phrase = newPhrase.trim();
    if (phrase.length < MIN_RECOVERY_PASSPHRASE) {
      toast.error(`Use at least ${MIN_RECOVERY_PASSPHRASE} characters`);
      return;
    }
    if (phrase !== confirmPhrase.trim()) {
      toast.error("Recovery passphrases don't match");
      return;
    }
    setRotating(true);
    try {
      const privateKey = await unlockKey(rotatePassword);
      if (!privateKey) {
        toast.error("Enter your account password to unlock your identity key");
        setNeedsUnlock(true);
        return;
      }
      if (await opensLocalWrap(user, phrase)) {
        toast.error("Choose a recovery passphrase different from your account password");
        return;
      }
      if (vault && (await opensCurrentShell(vault, phrase))) {
        toast.error(`That passphrase already opens shell v${vault.envelope.version}; choose a new one`);
        return;
      }
      const record = await rotateRecoveryShell(privateKey, user, phrase);
      toast.success(`Outer shell v${record.envelope.version} sealed and sent to connected peers`);
      closeRotate();
      await refresh();
    } catch (err) {
      console.error("[SovereignSecurityPanel] Rotation failed:", err);
      toast.error("Could not wrap a new outer shell. Try again.");
    } finally {
      setRotating(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword.trim().length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setSavingPassword(true);
    try {
      const privateKey = await unlockKey(currentPassword);
      if (!privateKey) {
        toast.error("Enter your current password to unlock your key first");
        return;
      }
      await put("meta", { k: user.wrappedKeyRef, v: await wrapPrivateKey(privateKey, newPassword.trim()) });
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      toast.success("Local password updated on this device");
    } catch (err) {
      console.error("[SovereignSecurityPanel] Password change failed:", err);
      toast.error("Could not update the password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6" id="security">
        <Card className={card}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Sovereign Identity</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="How peer custody works" className="text-foreground/60 hover:text-foreground">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                Peers hold only an AES-256-GCM encrypted container (zero-knowledge). They cannot view or decrypt your
                private keys. Only your active Recovery Passphrase opens it.
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Namespace handle</Label>
              <div className="flex gap-2">
                <Input value={handle} readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon" aria-label="Copy handle" onClick={() => copy(handle, "Handle")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {!discriminator && (
                <p className="text-xs text-foreground/50">Your #tag appears once your cold receiving address is known (unlock your wallet once).</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Recovery Link</Label>
              {vault ? (
                <div className="flex gap-2">
                  <Input value={link} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" aria-label="Copy recovery link" onClick={() => copy(link, "Recovery link")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-foreground/60">{loaded ? "Seal a recovery vault to get your link." : "Loading…"}</p>
              )}
              <p className="flex items-center gap-1.5 text-xs text-foreground/70">
                <ShieldCheck className={`h-3.5 w-3.5 ${custodyPeers.length > 0 ? "text-green-500" : "text-foreground/40"}`} />
                {custodyLabel}
                {custodyPeers.length > 0 && (
                  <span className="text-foreground/50">
                    ({custodyPeers.map((p) => p.name || p.peerId.slice(0, 12)).join(", ")})
                  </span>
                )}
              </p>
            </div>

            {vault?.genesisDefault && (
              <Alert className="border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-xs leading-relaxed">
                  Your recovery vault (v1) is still sealed with your <strong>signup password</strong>. Wrap a separate
                  Recovery Passphrase so the vault peers hold no longer depends on your account password.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" className="gap-2" onClick={downloadCredentials} disabled={!vault}>
                <Download className="h-4 w-4" />
                Download identity .md
              </Button>
              <Button className="gap-2" onClick={() => setRotateOpen(true)}>
                <RefreshCw className="h-4 w-4" />
                {vault ? "Update Recovery Phrase (Wrap New Outer Shell)" : "Seal Recovery Vault"}
              </Button>
            </div>
            {vault && (
              <p className="text-xs text-foreground/50">
                Active shell: <strong>v{version}</strong>. Your local account password will not open the vault
                {vault.genesisDefault ? " once you wrap a new shell" : ""}.
              </p>
            )}
          </div>
        </Card>

        <Card className={card}>
          <h2 className="mb-1 text-xl font-bold">Local account password</h2>
          <p className="mb-4 text-sm text-foreground/60">
            Encrypts your identity key on this device only. It never leaves the browser and does not change your
            recovery vault.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            <Input type="password" placeholder="New password (min 8)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            <Input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <Button className="mt-3 gap-2" variant="outline" onClick={() => void handlePasswordChange()} disabled={savingPassword}>
            {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Update password
          </Button>
        </Card>

        <Dialog open={rotateOpen} onOpenChange={(open) => (open ? setRotateOpen(true) : closeRotate())}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{vault ? `Wrap outer shell v${version + 1}` : "Seal your recovery vault"}</DialogTitle>
              <DialogDescription>
                Your identity keys are sealed under a new Recovery Passphrase and sent to connected peers, replacing
                older versions. {vault ? `Earlier phrases (v${version} and below) stop working.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-recovery-phrase">New Recovery Passphrase</Label>
                <Input id="new-recovery-phrase" type="password" value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)} placeholder={`At least ${MIN_RECOVERY_PASSPHRASE} characters`} autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-recovery-phrase">Confirm passphrase</Label>
                <Input id="confirm-recovery-phrase" type="password" value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} autoComplete="new-password" />
              </div>
              {needsUnlock && (
                <div className="space-y-1.5">
                  <Label htmlFor="rotate-account-password">Account password (to unlock your key)</Label>
                  <Input id="rotate-account-password" type="password" value={rotatePassword} onChange={(e) => setRotatePassword(e.target.value)} autoComplete="current-password" />
                </div>
              )}
              <p className="text-xs text-foreground/50">
                Write this passphrase down. There is no reset: without it, the vault on the mesh cannot be opened.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={closeRotate} disabled={rotating}>Cancel</Button>
              <Button onClick={() => void handleRotate()} disabled={rotating} className="gap-2">
                {rotating && <Loader2 className="h-4 w-4 animate-spin" />}
                {vault ? "Wrap new shell" : "Seal vault"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
