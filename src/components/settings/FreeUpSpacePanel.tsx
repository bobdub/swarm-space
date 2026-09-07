import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Trash2, RefreshCw, Server, AlertTriangle } from 'lucide-react';
import {
  estimateLocalUsage,
  downloadUserData,
  clearBulkLocal,
  formatBytes,
  type UsageBreakdown,
} from '@/lib/storage/offload';
import { activeBulkTarget } from '@/lib/storage/providers/personalServerTier';
import { backfillPersonalServerSync, retryPersonalServerSync } from '@/lib/storage/providers/personalServerSync';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export function FreeUpSpacePanel() {
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const target = activeBulkTarget();

  const refresh = useCallback(async () => {
    try {
      setUsage(await estimateLocalUsage());
    } catch (err) {
      console.warn('[FreeUpSpace] usage estimate failed', err);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDownload = async () => {
    setBusy(true);
    try {
      await downloadUserData();
      setDownloaded(true);
      toast.success('Copy downloaded — you can now clear the local media.');
    } catch (err) {
      toast.error(`Download failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const result = await clearBulkLocal((done, total) => {
        setProgress(`Clearing ${done} of ${total}…`);
      });
      toast.success(`Removed ${result.removed} items — about ${formatBytes(result.freedBytes)} freed.`);
      await refresh();
    } catch (err) {
      toast.error(`Clearing failed: ${(err as Error).message}`);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const handleMoveToServer = async () => {
    setBusy(true);
    try {
      await backfillPersonalServerSync();
      const result = await retryPersonalServerSync();
      toast.success(`Uploading to your server — ${result.queued} item(s) queued.`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      role="form"
      className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Free up space</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="mb-4 text-sm text-foreground/60">
        Download a copy of your posts and media, then clear the bulky media from this browser.
        Your account, keys, wallet and posts always stay here.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-border/40 px-3 py-2 text-sm">
        <Server className="h-4 w-4 text-primary" />
        <span className="text-foreground/80">
          New uploads go to:{' '}
          <b>{target.label}</b>
          {target.total > 0 && ` — ${formatBytes(target.used)} of ${formatBytes(target.total)} used`}
        </span>
      </div>

      {usage && (
        <ul className="mb-4 space-y-1 text-sm text-foreground/80">
          <li>Media &amp; file records: <b>{formatBytes(usage.mediaBytes)}</b> ({usage.mediaCount} items)</li>
          <li>Posts &amp; comments: <b>{formatBytes(usage.postBytes)}</b> ({usage.postCount} posts) — kept</li>
          <li>Account, keys &amp; wallet: <b>{formatBytes(usage.accountBytes)}</b> — kept</li>
        </ul>
      )}

      {progress && <p className="mb-3 text-xs text-foreground/60">{progress}</p>}

      {!downloaded && (
        <Alert className="mb-4 border-yellow-500/30 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Download your copy first — clearing stays locked until it succeeds.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" className="flex-1 gap-2" onClick={handleDownload} disabled={busy}>
          <Download className="h-4 w-4" />
          Download everything
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="flex-1 gap-2"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || !downloaded}
        >
          <Trash2 className="h-4 w-4" />
          Clear downloaded media
        </Button>
        {target.id === 'personal-server' && (
          <Button type="button" variant="outline" className="flex-1 gap-2" onClick={handleMoveToServer} disabled={busy}>
            <Server className="h-4 w-4" />
            Move existing media to my server
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear local media?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes media pieces, file records and stored replicas from this browser
              {usage ? ` (about ${formatBytes(usage.mediaBytes)})` : ''}. Your account, identity,
              keys, wallet, coins, posts and settings stay untouched. Anything other people on the
              network still hold can be fetched again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={handleClear}>Clear media</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
