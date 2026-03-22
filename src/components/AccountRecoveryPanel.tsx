import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Copy, Download, Shield, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { useP2P } from "@/hooks/useP2P";
import { createPassphraseBackup } from "@/lib/backup/passphraseBackup";

const BACKUP_DONE_KEY = "passphrase-backup-done";
const BACKUP_PHRASE_KEY = "backup-passphrase";

export function AccountRecoveryPanel() {
  const user = getCurrentUser();
  const { getPeerId } = useP2P();
  const peerId = getPeerId();

  const userId = user?.id ?? "";
  const hasPassphrase = !!localStorage.getItem(`${BACKUP_DONE_KEY}:${userId}`);
  const storedPhrase = localStorage.getItem(`${BACKUP_PHRASE_KEY}:${userId}`);

  const [isLegacy, setIsLegacy] = useState(!hasPassphrase);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);

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

    setSaving(true);
    try {
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
          /* Legacy account — create passphrase */
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Create Recovery Passphrase
              </h3>
              <p className="text-sm text-muted-foreground">
                Your account was created before passphrase backup was available.
                Create one now to protect your identity on the mesh.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-passphrase">Recovery Passphrase (min 200 characters)</Label>
              <Input
                id="new-passphrase"
                type="password"
                placeholder="Enter a long, memorable passphrase…"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                {passphrase.length}/200 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-passphrase">Confirm Passphrase</Label>
              <Input
                id="confirm-passphrase"
                type="password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={saving}
              />
            </div>

            <Button
              onClick={handleCreatePassphrase}
              disabled={saving || !passphrase || !confirm}
              className="w-full"
            >
              {saving ? "Encrypting & distributing…" : "Create Passphrase Backup"}
            </Button>
          </div>
        ) : (
          /* Passphrase exists — download only */
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Recovery Passphrase
              </h3>
              <p className="text-sm text-muted-foreground">
                Your passphrase backup is active. Download it as a text file for safekeeping.
              </p>
            </div>

            {storedPhrase ? (
              <Button onClick={handleDownloadPassphrase} className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Passphrase (.txt)
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your passphrase was set during account creation but is no longer stored locally.
                  You should already have it saved. If not, you'll need to create a new one.
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

      <Alert>
        <AlertDescription className="text-xs">
          <strong>How to recover:</strong>
          <ol className="list-decimal ml-4 mt-2 space-y-1">
            <li>On your new device, navigate to the Auth page</li>
            <li>Select "Recover Account"</li>
            <li>Enter your passphrase to restore your identity from the mesh</li>
            <li>Your account will be transferred to the new device</li>
          </ol>
        </AlertDescription>
      </Alert>
    </div>
  );
}
