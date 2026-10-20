import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Trash2, RefreshCw, Server, ShieldCheck, FileCheck, CheckCircle2 } from 'lucide-react';
import {
  estimateLocalUsage,
  downloadUserData,
  verifyDownloadedFile,
  clearBulkLocal,
  formatBytes,
  type UsageBreakdown,
  type ExportScope,
  type DownloadReceipt,
} from '@/lib/storage/offload';
import { activeBulkTarget } from '@/lib/storage/providers/personalServerTier';
import { backfillPersonalServerSync, retryPersonalServerSync } from '@/lib/storage/providers/personalServerSync';
import { toast } from 'sonner';

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_LABELS = ['Scan', 'Choose', 'Download', 'Verify', 'Clear'];

export function FreeUpSpacePanel() {
  const [step, setStep] = useState<Step>(1);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [scope, setScope] = useState<ExportScope>('media');
  const [receipt, setReceipt] = useState<DownloadReceipt | null>(null);
  const [verified, setVerified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [freed, setFreed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = activeBulkTarget();

  const refresh = useCallback(async () => {
    try { setUsage(await estimateLocalUsage()); } catch (err) { console.warn('[FreeUpSpace] scan failed', err); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => {
    setStep(1); setReceipt(null); setVerified(false); setConfirmed(false); setFreed(null); void refresh();
  };

  const estimate = usage
    ? scope === 'everything' ? usage.mediaBytes + usage.postBytes : usage.mediaBytes
    : 0;

  const handleDownload = async () => {
    setBusy(true);
    try {
      const r = await downloadUserData(scope);
      setReceipt(r); setVerified(false); setStep(4);
      toast.success('Download started — now confirm the saved file.');
    } catch (err) {
      toast.error(`Download failed: ${(err as Error).message}`);
    } finally { setBusy(false); }
  };

  const handleVerify = async (file: File | undefined) => {
    if (!file || !receipt) return;
    setBusy(true);
    try {
      const ok = await verifyDownloadedFile(file, receipt);
      setVerified(ok);
      if (ok) { toast.success('File verified — it matches exactly.'); setStep(5); }
      else toast.error('That file does not match the download. Nothing will be cleared.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleClear = async () => {
    if (!verified || !confirmed) return;
    setBusy(true);
    try {
      const result = await clearBulkLocal((done, total) => setProgress(`Clearing ${done} of ${total}…`));
      setFreed(`Removed ${result.removed} items — about ${formatBytes(result.freedBytes)} freed.`);
      await refresh();
    } catch (err) {
      toast.error(`Clearing failed: ${(err as Error).message}`);
    } finally { setProgress(null); setBusy(false); }
  };

  const handleMoveToServer = async () => {
    setBusy(true);
    try {
      await backfillPersonalServerSync();
      const result = await retryPersonalServerSync();
      toast.success(`Uploading to your server — ${result.queued} item(s) queued.`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    } finally { setBusy(false); }
  };

  return (
    <Card role="form" className="rounded-3xl border border-border/40 bg-card/60 p-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Free up space</h2>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy} aria-label="Start over">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <ol className="mb-4 flex flex-wrap gap-1 text-xs">
        {STEP_LABELS.map((label, i) => (
          <li
            key={label}
            className={`rounded-full px-2 py-0.5 ${i + 1 === step ? 'bg-primary text-primary-foreground' : i + 1 < step ? 'bg-primary/20 text-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="mb-4 flex items-start gap-2 rounded-2xl border border-border/40 px-3 py-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="text-foreground/80">
          Your account, identity keys, wallet, coins and posts always stay on this device. Only media is cleared.
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          {usage ? (
            <ul className="space-y-1 text-sm text-foreground/80">
              <li>Media &amp; file records: <b>{formatBytes(usage.mediaBytes)}</b> ({usage.mediaCount} items) — can be cleared</li>
              <li>Posts &amp; comments: <b>{formatBytes(usage.postBytes)}</b> ({usage.postCount} posts) — kept</li>
              <li>Account, keys &amp; wallet: <b>{formatBytes(usage.accountBytes)}</b> — kept</li>
            </ul>
          ) : <p className="text-sm text-muted-foreground">Scanning…</p>}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            New uploads go to <b>{target.label}</b>
            {target.total > 0 && ` — ${formatBytes(target.used)} of ${formatBytes(target.total)} used`}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="flex-1" onClick={() => setStep(2)} disabled={!usage || busy}>Next</Button>
            {target.id === 'personal-server' && (
              <Button type="button" variant="outline" className="flex-1 gap-2" onClick={handleMoveToServer} disabled={busy}>
                <Server className="h-4 w-4" /> Move media to my server
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">What should the download contain?</p>
          {([
            ['media', 'Condense & download large files', 'Media and file records only — smallest file.'],
            ['everything', 'Export everything', 'Media plus your posts and comments, for a full copy.'],
          ] as const).map(([value, title, desc]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`w-full rounded-2xl border p-3 text-left ${scope === value ? 'border-primary bg-primary/10' : 'border-border/40'}`}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </button>
          ))}
          <p className="text-xs text-muted-foreground">
            Estimated size before compression: <b>{formatBytes(estimate)}</b>. Space freed afterwards: about{' '}
            <b>{formatBytes(usage?.mediaBytes ?? 0)}</b>.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button type="button" className="flex-1" onClick={() => setStep(3)}>Next</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm">Save the file somewhere safe. Next you'll pick it again so we can check it arrived intact.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={busy}>Back</Button>
            <Button type="button" className="flex-1 gap-2" onClick={handleDownload} disabled={busy}>
              <Download className="h-4 w-4" /> {busy ? 'Preparing…' : `Download (${formatBytes(estimate)})`}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && receipt && (
        <div className="space-y-3">
          <p className="text-sm">
            Choose the file you just saved (<b className="break-all">{receipt.filename}</b>, {formatBytes(receipt.size)}).
            We compare it byte-for-byte; nothing is cleared unless it matches.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            className="hidden"
            onChange={(e) => void handleVerify(e.target.files?.[0])}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={handleDownload} disabled={busy}>Download again</Button>
            <Button type="button" className="flex-1 gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FileCheck className="h-4 w-4" /> {busy ? 'Checking…' : 'Verify saved file'}
            </Button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          {freed ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription className="text-sm">{freed}</AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm">
                Verified. This removes about <b>{formatBytes(usage?.mediaBytes ?? 0)}</b> of media from this browser.
                Anything other people on the network still hold can be fetched again later.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I have my verified copy and want to clear local media.
              </label>
              {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
              <Button
                type="button"
                variant="destructive"
                className="w-full gap-2"
                onClick={handleClear}
                disabled={busy || !verified || !confirmed}
              >
                <Trash2 className="h-4 w-4" /> Clear local media
              </Button>
            </>
          )}
          {freed && <Button type="button" variant="outline" className="w-full" onClick={reset}>Done</Button>}
        </div>
      )}
    </Card>
  );
}
