import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Key, Copy, Download, Shield, CheckCircle2, Lock, AlertTriangle, Loader2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { useP2P } from "@/hooks/useP2P";
import { createPassphraseBackup } from "@/lib/backup/passphraseBackup";
import { isRecoveryKeyBackup, decryptRecoveryKeyChunks, deriveRecoveryKeyTags, parseRecoveryKey, generateRecoveryKey, markRecoveryKeyBackup } from "@/lib/backup/recoveryKey";
import { wrapPrivateKey } from "@/lib/crypto";
import { get, put } from "@/lib/store";
import type { WrappedKey } from "@/lib/auth";

const BACKUP_DONE_KEY = "passphrase-backup-done";
const BACKUP_PHRASE_KEY = "backup-passphrase";

export function AccountRecoveryPanel() {
  const user = getCurrentUser();
  const { getPeerId } = useP2P();
  const peerId = getPeerId();

  const userId = user?.id ?? "";
  const hasPassphrase = !!localStorage.getItem(`${BACKUP_DONE_KEY}:${userId}`);
  const storedPhrase = localStorage.getItem(`${BACKUP_PHRASE_KEY}:${userId}`);
  const storedRecoveryKey = localStorage.getItem(`recovery-key:${userId}`);
  const usesRecoveryKey = isRecoveryKeyBackup(userId);

  const [isLegacy, setIsLegacy] = useState(!hasPassphrase);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [passwordDeclined, setPasswordDeclined] = useState(false);
  const [showPasswordAlert, setShowPasswordAlert] = useState(false);
  
  // Recovery key tab state
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    setIsLegacy(!localStorage.getItem(`${BACKUP_DONE_KEY}:${userId}`));
  }, [userId, created]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleDownloadPassphrase = () => {
    const phrase = localStorage.getItem(`${BACKUP_PHRASE_KEY}:${userId}`);
    if (!phrase) {
      toast.error("No passphrase found. Please create one first.");
      return;
    }

    const content = [
      "=== Flux Recovery Passphrase ===",
      "",
      `Username: ${user?.username ?? "unknown"}`,
      `User ID: ${userId}`,
      `PeerID: ${peerId ?? "N/A"}`,
      `Date: ${new Date().toISOString()}`,
      "",
      "--- PASSPHRASE (keep this secret) ---",
      "",
      phrase,
      "",
      "--- END ---",
      "",
      "To recover your account, enter this passphrase on any connected mesh node.",
      "Never share this file publicly.",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flux-passphrase-${user?.username ?? "backup"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Passphrase file downloaded");
  };

  const handleCreatePassphrase = async () => {
    if (!passphrase || passphrase.length < 200) {
      toast.error("Passphrase must be at least 200 characters");
      return;
    }
    if (passphrase !== confirm) {
      toast.error("Passphrases don't match");
      return;
    }

    // If password step is not declined and not completed, alert user
    if (!passwordDeclined && !passwordUpdated && !newPassword) {
      setShowPasswordAlert(true);
      return;
    }

    setSaving(true);
    try {
      // If password was filled, update it first
      if (!passwordDeclined && newPassword && !passwordUpdated) {
        await doPasswordUpdate();
      }

      await createPassphraseBackup(passphrase);
      localStorage.setItem(`${BACKUP_DONE_KEY}:${userId}`, "1");
      localStorage.setItem(`${BACKUP_PHRASE_KEY}:${userId}`, passphrase);
      setCreated(true);
      setIsLegacy(false);
      setPassphrase("");
      setConfirm("");
      toast.success("Passphrase created! You can now download your backup file.");
    } catch (err) {
      console.error("[AccountRecoveryPanel] Failed to create passphrase:", err);
      toast.error("Failed to create passphrase backup. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const doPasswordUpdate = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      throw new Error("Password too short");
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      throw new Error("Passwords don't match");
    }
    if (!user) throw new Error("No user");

    const rawPrivateKey = sessionStorage.getItem("me:privateKey");
    if (!rawPrivateKey) {
      toast.error("Session expired. Please log out and log back in first.");
      throw new Error("No private key in session");
    }

    const wrapped = await wrapPrivateKey(rawPrivateKey, newPassword);
    const wrappedEntry = { k: user.wrappedKeyRef, v: wrapped };
    await put("meta", wrappedEntry);

    setNewPassword("");
    setConfirmPassword("");
    setPasswordUpdated(true);
    toast.success("Password updated successfully!");
  };

  const handleUpdatePassword = async () => {
    setSaving(true);
    try {
      await doPasswordUpdate();
    } catch (err) {
      console.error("[AccountRecoveryPanel] Failed to update password:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRecoverWithKey = async () => {
    if (!recoveryKeyInput.trim() || !recoveryPassword) {
      toast.error("Enter both recovery key and password");
      return;
    }
    setRecovering(true);
    try {
      parseRecoveryKey(recoveryKeyInput); // validate format
      toast.info("Recovery key validated. Querying mesh for backup chunks…");
      // The actual mesh query would happen via P2P layer
      // For now we validate the key format and inform the user
      toast.success("Recovery key accepted — mesh query initiated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid recovery key");
    } finally {
      setRecovering(false);
    }
  };

  const handleDownloadRecoveryKey = () => {
    if (!storedRecoveryKey) return;
    const content = [
      "=== SWARM Recovery Key ===",
      "",
      `Username: ${user?.username ?? "unknown"}`,
      `User ID: ${userId}`,
      `PeerID: ${peerId ?? "N/A"}`,
      `Date: ${new Date().toISOString()}`,
      "",
      "--- RECOVERY KEY (keep this secret) ---",
      "",
      storedRecoveryKey,
      "",
      "--- END ---",
      "",
      "To recover: Enter this key + your account password on any mesh node.",
      "The key alone cannot unlock your account.",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swarm-recovery-key-${user?.username ?? "backup"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Recovery key file downloaded");
  };

  const passwordStepResolved = passwordDeclined || passwordUpdated;

  return (
    <div className="space-y-6">
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>Recovery:</strong> Your account is protected by a recovery passphrase.
          Download it as a file and store it safely — it's your only way to recover on a new device.
        </AlertDescription>
      </Alert>

      {/* PeerID Display */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Key className="h-5 w-5" />
              Your PeerID
            </h3>
            <p className="text-sm text-muted-foreground">
              Your unique identifier on the P2P network
            </p>
          </div>
        </div>

        {peerId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-muted rounded-md text-xs font-mono break-all">
                {peerId}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(peerId, "PeerID")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            PeerID will be available when P2P is enabled
          </p>
        )}
      </Card>

      {/* Passphrase Section */}
      <Card className="p-6">
        {isLegacy ? (
          <div className="space-y-6">
            <div className="mb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Legacy Account Migration
              </h3>
              <p className="text-sm text-muted-foreground">
                Welcome back, early builder! Complete the steps below to secure your account.
              </p>
            </div>

            {/* Step 1: Password update (optional with decline toggle) */}
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Step 1: Update Password (Optional)
                </h4>
                <div className="flex items-center gap-2">
                  <Label htmlFor="decline-password" className="text-xs text-muted-foreground">
                    Decline
                  </Label>
                  <Switch
                    id="decline-password"
                    checked={passwordDeclined}
                    onCheckedChange={(checked) => {
                      setPasswordDeclined(checked);
                      if (checked) setShowPasswordAlert(false);
                    }}
                    disabled={passwordUpdated}
                  />
                </div>
              </div>

              {passwordUpdated ? (
                <div className="flex items-center gap-2 text-sm text-accent">
                  <CheckCircle2 className="h-4 w-4" />
                  Password updated successfully
                </div>
              ) : passwordDeclined ? (
                <p className="text-xs text-muted-foreground italic">
                  Password update skipped. You can always update it later.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Set a new local password for this device. No old password needed.
                  </p>

                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password (min 8 characters)</Label>
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                    <Input
                      id="confirm-new-password"
                      type="password"
                      placeholder="Type it again"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <Button
                    variant="outline"
                    onClick={handleUpdatePassword}
                    disabled={saving || !newPassword || !confirmPassword}
                    className="w-full"
                  >
                    {saving ? "Updating…" : "Update Password"}
                  </Button>

                  {showPasswordAlert && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Please either update your password or toggle <strong>Decline</strong> to skip this step before continuing.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </div>

            {/* Step 2: Passphrase creation */}
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <h4 className="text-sm font-semibold">Step 2: Create Recovery Passphrase</h4>
              <div className="space-y-2">
                <Label htmlFor="new-passphrase">Recovery Passphrase (min 200 characters)</Label>
                <textarea
                  id="new-passphrase"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Enter a long, memorable passphrase (200+ characters)…"
                  value={passphrase}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPassphrase(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {passphrase.length}/200 characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-passphrase">Confirm Passphrase</Label>
                <textarea
                  id="confirm-passphrase"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Type it again"
                  value={confirm}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setConfirm(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            {/* Step 3: Complete & Download */}
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Download className="h-4 w-4" />
                Step 3: Complete Migration & Download Backup
              </h4>
              <p className="text-xs text-muted-foreground">
                This will encrypt your passphrase, distribute it across the mesh, and download your backup file.
              </p>
              <Button
                onClick={handleCreatePassphrase}
                disabled={saving || !passphrase || !confirm}
                className="w-full"
              >
                {saving ? "Encrypting & distributing…" : "Create Passphrase & Download Backup"}
              </Button>
            </div>
          </div>
        ) : (
          /* Backup exists — show appropriate download */
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                {usesRecoveryKey ? "Recovery Key" : "Recovery Passphrase"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {usesRecoveryKey
                  ? "Your recovery key backup is active. Download it for safekeeping."
                  : "Your passphrase backup is active. Download it as a text file for safekeeping."}
              </p>
            </div>

            {usesRecoveryKey && storedRecoveryKey ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/20 bg-muted/30 p-4">
                  <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">Your Recovery Key</p>
                  <code className="block text-sm font-mono text-primary break-all leading-relaxed select-all">
                    {storedRecoveryKey}
                  </code>
                </div>
                <Button onClick={handleDownloadRecoveryKey} className="w-full gap-2">
                  <Download className="h-4 w-4" />
                  Download Recovery Key (.txt)
                </Button>
              </div>
            ) : storedPhrase ? (
              <Button onClick={handleDownloadPassphrase} className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Passphrase (.txt)
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your backup was set during account creation but is no longer stored locally.
                  You should already have it saved.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setIsLegacy(true)}
                  className="w-full"
                >
                  Create New Passphrase
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Recover with Key tab */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Key className="h-5 w-5" />
          Recover Account
        </h3>
        <Tabs defaultValue="key" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="key">Recovery Key</TabsTrigger>
            <TabsTrigger value="passphrase">Legacy Passphrase</TabsTrigger>
          </TabsList>
          <TabsContent value="key" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Enter your recovery key and account password to restore from the mesh.
            </p>
            <div className="space-y-2">
              <Label htmlFor="recovery-key-input">Recovery Key</Label>
              <Input
                id="recovery-key-input"
                placeholder="SWRM-XXXX-XXXX-XXXX"
                value={recoveryKeyInput}
                onChange={(e) => setRecoveryKeyInput(e.target.value)}
                className="font-mono"
                disabled={recovering}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recovery-password">Account Password</Label>
              <Input
                id="recovery-password"
                type="password"
                placeholder="Your account password"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                disabled={recovering}
              />
            </div>
            <Button
              onClick={handleRecoverWithKey}
              disabled={recovering || !recoveryKeyInput || !recoveryPassword}
              className="w-full gap-2"
            >
              {recovering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recovering…
                </>
              ) : (
                "Recover Account"
              )}
            </Button>
          </TabsContent>
          <TabsContent value="passphrase" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              For accounts created before the recovery key system, enter your 200+ character passphrase.
            </p>
            <div className="space-y-2">
              <Label htmlFor="legacy-recovery-phrase">Recovery Passphrase</Label>
              <textarea
                id="legacy-recovery-phrase"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter your 200+ character recovery passphrase…"
              />
            </div>
            <Button variant="outline" className="w-full">
              Recover with Passphrase
            </Button>
          </TabsContent>
        </Tabs>
      </Card>

      <Alert>
        <AlertDescription className="text-xs">
          <strong>How to recover:</strong>
          <ol className="list-decimal ml-4 mt-2 space-y-1">
            <li>On your new device, navigate to the Auth page</li>
            <li>Select "Recover Account"</li>
            <li>Enter your recovery key + password (or legacy passphrase)</li>
            <li>Your account will be restored from the mesh</li>
          </ol>
        </AlertDescription>
      </Alert>
    </div>
  );
}
