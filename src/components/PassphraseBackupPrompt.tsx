import { useState, useEffect } from "react";
import { Shield, X, Copy, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const BACKUP_DISMISSED_KEY = "passphrase-backup-dismissed";
const BACKUP_DONE_KEY = "passphrase-backup-done";

interface Props {
  userId: string;
  username: string;
}

/**
 * Shows a one-time prompt after signup encouraging the user to
 * create a passphrase backup for mesh-distributed recovery.
 */
export function PassphraseBackupPrompt({ userId, username }: Props) {
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Only show if user hasn't dismissed or completed
    const dismissed = localStorage.getItem(`${BACKUP_DISMISSED_KEY}:${userId}`);
    const done = localStorage.getItem(`${BACKUP_DONE_KEY}:${userId}`);
    if (!dismissed && !done) {
      // Slight delay so it doesn't pop up immediately on page load
      const timer = setTimeout(() => setOpen(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [userId]);

  const handleDismiss = () => {
    localStorage.setItem(`${BACKUP_DISMISSED_KEY}:${userId}`, "1");
    setOpen(false);
  };

  const handleSave = async () => {
    if (!passphrase || passphrase.length < 6) {
      toast.error("Passphrase must be at least 6 characters");
      return;
    }
    if (passphrase !== confirm) {
      toast.error("Passphrases don't match");
      return;
    }

    setSaving(true);
    try {
      // Import and run the mesh backup
      const { createPassphraseBackup } = await import("@/lib/backup/passphraseBackup");
      await createPassphraseBackup(passphrase, userId, username);
      localStorage.setItem(`${BACKUP_DONE_KEY}:${userId}`, "1");
      setSaved(true);
      toast.success("Passphrase backup created! Your identity is protected.");
    } catch (err) {
      console.error("[PassphraseBackup] Failed:", err);
      toast.error("Failed to create backup. Try again later.");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <DialogTitle className="text-xl">Backup Created</DialogTitle>
            <DialogDescription>
              Your identity is now protected. If you lose this device, use your
              passphrase to recover from any connected peer.
            </DialogDescription>
            <Button onClick={() => setOpen(false)} className="mt-2">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[hsl(174,59%,56%)]" />
            Protect Your Account
          </DialogTitle>
          <DialogDescription>
            Create a passphrase to back up your identity to the mesh network.
            If you ever lose this device, you can recover from any connected peer
            using this passphrase.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="backup-passphrase">Recovery Passphrase</Label>
            <Input
              id="backup-passphrase"
              type="password"
              placeholder="Choose a memorable passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="backup-confirm">Confirm Passphrase</Label>
            <Input
              id="backup-confirm"
              type="password"
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={saving}
            />
          </div>
          <p className="text-xs text-foreground/50">
            This passphrase encrypts your identity and distributes it across
            the mesh. Keep it safe — it's your only recovery path.
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={saving}>
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={saving || !passphrase || !confirm}>
            {saving ? "Encrypting & distributing…" : "Create Backup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
