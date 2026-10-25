/** Lock / unlock the signing wallet. Unlocked stays unlocked across visits until the user locks it. */
import { useCallback, useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isWalletExplicitlyLocked, isWalletUnlocked, lockWallet, unlockWallet, WALLET_LOCK_EVENT } from "@/lib/auth";

export function WalletLockControl() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { void isWalletUnlocked().then(setUnlocked); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(WALLET_LOCK_EVENT, refresh);
    return () => window.removeEventListener(WALLET_LOCK_EVENT, refresh);
  }, [refresh]);

  const doUnlock = async () => {
    setBusy(true);
    try {
      await unlockWallet(pass);
      setPass(""); setUnlockOpen(false);
      toast.success("Wallet unlocked");
    } catch {
      toast.error("Wrong passphrase — wallet stays locked.");
    } finally { setBusy(false); refresh(); }
  };

  if (unlocked === null) return null;

  return (
    <>
      {unlocked ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmLock(true)}>
          <Lock className="mr-1 h-3 w-3" />Lock wallet
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={() => setUnlockOpen(true)}>
          <Unlock className="mr-1 h-3 w-3" />{isWalletExplicitlyLocked() ? "Unlock wallet" : "Set up signing on this device"}
        </Button>
      )}

      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock your wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Locking your wallet will require your account passphrase to unlock again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void lockWallet().then(() => { toast.success("Wallet locked"); refresh(); }); }}>
              Lock wallet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={unlockOpen} onOpenChange={(v) => !busy && setUnlockOpen(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Unlock wallet</DialogTitle></DialogHeader>
          <div role="form" className="space-y-2">
            <Label htmlFor="wl-pass">Account passphrase</Label>
            <Input id="wl-pass" type="password" value={pass} autoComplete="current-password"
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && pass) void doUnlock(); }} />
            {!isWalletExplicitlyLocked() && <p className="text-xs text-muted-foreground">One time only: this device has not saved your signing key yet (it was signed in before auto-unlock existed). Your passphrase is the only thing that can create it.</p>}
            <p className="text-xs text-muted-foreground">Stays unlocked on this device until you lock it or sign out.</p>
          </div>
          <DialogFooter>
            <Button type="button" disabled={busy || !pass} onClick={() => void doUnlock()}>
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
