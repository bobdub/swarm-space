import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  newServerId, upsertPersonalServer, sealServerCredentials, isUrlAcceptable,
  getPersonalServer, updatePersonalServer,
  type PersonalServerKind, type PersonalServerScope,
} from '@/lib/storage/providers/personalServerStore';
import { probePersonalServer } from '@/lib/storage/providers/personalServerProvider';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

type Step = 'kind' | 'config' | 'probe' | 'scope';

export function AddPersonalServerWizard({ open, onOpenChange, userId }: Props) {
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<PersonalServerKind>('https-blob');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('auto');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [scope, setScope] = useState<PersonalServerScope>('private');
  const [capGiB, setCapGiB] = useState(1);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; steps: { step: string; ok: boolean; error?: string }[] } | null>(null);

  const reset = () => {
    setStep('kind'); setKind('https-blob'); setName(''); setUrl(''); setToken('');
    setBucket(''); setRegion('auto'); setAccessKey(''); setSecretKey('');
    setScope('private'); setCapGiB(1); setPendingId(null); setProbeResult(null);
  };

  const close = () => { reset(); onOpenChange(false); };

  const startProbe = async () => {
    const urlCheck = isUrlAcceptable(url);
    if (!urlCheck.ok) { toast.error(urlCheck.reason ?? 'Invalid URL'); return; }
    if (!name.trim()) { toast.error('Name required'); return; }

    const id = newServerId();
    upsertPersonalServer({
      id, name: name.trim(), kind, url: url.trim(), scope: 'private',
      capBytes: capGiB * 1024 * 1024 * 1024, usedBytes: 0, paused: false,
      createdAt: Date.now(),
      bucket: kind === 's3-compatible' ? bucket.trim() : undefined,
      region: kind === 's3-compatible' ? region.trim() : undefined,
    });
    const creds = kind === 'https-blob'
      ? { token: token.trim() }
      : { accessKeyId: accessKey.trim(), secretAccessKey: secretKey.trim() };
    await sealServerCredentials(id, creds);
    setPendingId(id);
    setStep('probe');
    setProbing(true);
    try {
      const result = await probePersonalServer(id, userId);
      setProbeResult(result);
    } catch (e) {
      setProbeResult({ ok: false, steps: [{ step: 'probe', ok: false, error: (e as Error).message }] });
    } finally {
      setProbing(false);
    }
  };

  const finish = () => {
    if (!pendingId) return;
    const existing = getPersonalServer(pendingId);
    if (!existing) { toast.error('Server vanished'); return; }
    updatePersonalServer(pendingId, {
      scope,
      capBytes: capGiB * 1024 * 1024 * 1024,
    });
    toast.success('Personal server linked');
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add personal server</DialogTitle>
        </DialogHeader>

        {step === 'kind' && (
          <div role="form" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Servers store only encrypted ciphertext. Plaintext and keys never leave your device.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={kind === 'https-blob' ? 'default' : 'outline'}
                onClick={() => setKind('https-blob')}>HTTPS blob</Button>
              <Button type="button" variant={kind === 's3-compatible' ? 'default' : 'outline'}
                onClick={() => setKind('s3-compatible')}>S3-compatible</Button>
            </div>
            <Button type="button" className="w-full" onClick={() => setStep('config')}>Next</Button>
          </div>
        )}

        {step === 'config' && (
          <div role="form" className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My home server" />
            </div>
            <div className="space-y-1">
              <Label>{kind === 'https-blob' ? 'HTTPS URL' : 'S3 endpoint'}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder={kind === 'https-blob' ? 'https://store.example.com' : 'https://<account>.r2.cloudflarestorage.com'} />
            </div>
            {kind === 'https-blob' ? (
              <div className="space-y-1">
                <Label>Bearer token</Label>
                <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Bucket</Label>
                    <Input value={bucket} onChange={(e) => setBucket(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Region</Label>
                    <Input value={region} onChange={(e) => setRegion(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Access key</Label>
                  <Input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Secret key</Label>
                  <Input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
                </div>
              </>
            )}
            <Alert>
              <AlertDescription className="text-xs">
                Credentials are sealed in the in-memory vault and lost on tab close — relink to reuse.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep('kind')}>Back</Button>
              <Button type="button" className="flex-1" onClick={startProbe}>Test connection</Button>
            </div>
          </div>
        )}

        {step === 'probe' && (
          <div className="space-y-3">
            {probing && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Running write / read / delete probe…
              </div>
            )}
            {probeResult && (
              <div className="space-y-2">
                {probeResult.steps.map((s) => (
                  <div key={s.step} className="flex items-center gap-2 text-sm">
                    {s.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="capitalize">{s.step}</span>
                    {s.error && <span className="text-xs text-destructive">{s.error}</span>}
                  </div>
                ))}
                {!probeResult.ok && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">
                      Probe failed. For S3/R2/B2 verify CORS allows the app origin. For HTTPS blob
                      verify auth + CORS preflight.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep('config')}>Back</Button>
              <Button type="button" className="flex-1" disabled={!probeResult?.ok}
                onClick={() => setStep('scope')}>Next</Button>
            </div>
          </div>
        )}

        {step === 'scope' && (
          <div role="form" className="space-y-3">
            <div className="space-y-2">
              <Label>Scope</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={scope === 'private' ? 'default' : 'outline'}
                  onClick={() => setScope('private')}>Private replica</Button>
                <Button type="button" variant={scope === 'public-pin' ? 'default' : 'outline'}
                  onClick={() => setScope('public-pin')}>Public pinning</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Public pinning re-seeds others' already-encrypted, signature-verified chunks.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Cap (GiB)</Label>
              <Input type="number" min={1} value={capGiB}
                onChange={(e) => setCapGiB(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <Button type="button" className="w-full" onClick={finish}>Link server</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}