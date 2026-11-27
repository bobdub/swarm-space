import { useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hasSeparateWalletPassphrase, unlockWallet } from '@/lib/auth';

/**
 * Shown in place of a direct-message thread while the wallet is manually
 * locked. Direct messages are signed and sealed with the wallet's keys, so
 * they wait for an unlock; Brain Chat and project chats keep working.
 */
export function DirectMessageUnlockGate({ peerName }: { peerName?: string }): JSX.Element {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [separate, setSeparate] = useState(false);

  useEffect(() => {
    void hasSeparateWalletPassphrase().then(setSeparate).catch(() => undefined);
  }, []);

  const unlock = async () => {
    if (!pass) return;
    setBusy(true);
    try {
      await unlockWallet(pass);
      setPass('');
    } catch {
      toast.error('Wrong passphrase. Your wallet stays locked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-[hsla(180,80%,60%,0.18)] bg-[hsla(265,70%,8%,0.55)] p-6 text-center"
      data-testid="dm-unlock-gate"
    >
      <Lock className="h-8 w-8 text-primary" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Unlock your wallet to message {peerName ?? 'peers'}</p>
        <p className="max-w-sm text-xs text-foreground/60">
          Direct messages are signed and sealed with your wallet keys, so they wait while it is locked. Brain Chat and
          your project chats still work.
        </p>
      </div>
      <form
        className="flex w-full max-w-xs items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <Input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={separate ? 'Wallet passphrase' : 'Account passphrase'}
          aria-label={separate ? 'Wallet passphrase' : 'Account passphrase'}
          autoComplete="current-password"
          className="h-9 text-sm"
        />
        <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!pass || busy}>
          <Unlock className="mr-1 h-3.5 w-3.5" />
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}
