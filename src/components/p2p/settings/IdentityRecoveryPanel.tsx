import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Copy, CheckCircle2, RefreshCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  generateRecoveryBundle,
  recoverSecretFromShares,
  getShareSummary,
  type IdentityRecoveryBundle
} from '@/lib/crypto/identityRecovery';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/lib/crypto';
import {
  exportRendezvousIdentity,
  restoreRendezvousIdentity
} from '@/lib/p2p/rendezvousIdentity';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeIdentitySecret(identity: {
  publicKey: string;
  privateKey: string;
  createdAt: number;
}): string {
  const payload = JSON.stringify(identity);
  const bytes = encoder.encode(payload);
  return arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function decodeIdentitySecret(secretBase64: string): { publicKey: string; privateKey: string; createdAt: number } {
  const buffer = base64ToArrayBuffer(secretBase64);
  const payload = decoder.decode(new Uint8Array(buffer));
  const parsed = JSON.parse(payload) as {
    publicKey: string;
    privateKey: string;
    createdAt?: number;
  };
  return {
    publicKey: parsed.publicKey,
    privateKey: parsed.privateKey,
    createdAt: parsed.createdAt ?? Date.now()
  };
}

export function IdentityRecoveryPanel(): JSX.Element {
  const [config, setConfig] = useState({ total: 5, threshold: 3 });
  const [bundle, setBundle] = useState<IdentityRecoveryBundle | null>(null);
  const [distributed, setDistributed] = useState<number[]>([]);
  const [copiedShare, setCopiedShare] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveredPublicKey, setRecoveredPublicKey] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [currentIdentity, setCurrentIdentity] = useState<{ publicKey: string; createdAt: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    if (typeof window === 'undefined') {
      return;
    }
    exportRendezvousIdentity()
      .then((identity) => {
        if (!mounted) return;
        setCurrentIdentity({
          publicKey: identity.publicKey,
          createdAt: new Date(identity.createdAt).toISOString()
        });
      })
      .catch((error) => {
        console.warn('[IdentityRecovery] Unable to load identity metadata', error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const sharesWithSummary = useMemo(() => {
    if (!bundle) return [] as Array<{ token: string; summary: ReturnType<typeof getShareSummary> }>;
    return bundle.shares.map((token) => ({ token, summary: getShareSummary(token) }));
  }, [bundle]);

  const hasSufficientRecoveryTokens = useMemo(() => {
    if (!bundle) return false;
    const tokens = recoveryInput
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    return tokens.length >= bundle.threshold;
  }, [bundle, recoveryInput]);

  const handleGenerateShares = async () => {
    if (isGenerating) return;
    try {
      setIsGenerating(true);
      const identity = await exportRendezvousIdentity();
      const secret = encodeIdentitySecret(identity);
      const nextBundle = await generateRecoveryBundle(secret, config);
      setBundle(nextBundle);
      setDistributed([]);
      setRecoveredPublicKey(null);
      setRecoveryError(null);
      toast.success('Generated recovery shares');
    } catch (error) {
      console.error('[IdentityRecovery] Failed to generate shares', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate shares');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleDistributed = (index: number) => {
    setDistributed((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index]
    );
  };

  const handleCopyShare = async (token: string, index: number) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedShare(index);
      toast.success(`Copied share #${index}`);
      window.setTimeout(() => {
        setCopiedShare((current) => (current === index ? null : current));
      }, 1500);
    } catch (error) {
      console.error('[IdentityRecovery] Failed to copy share', error);
      toast.error('Unable to copy share to clipboard');
    }
  };

  const handleRecoverIdentity = async () => {
    if (!bundle) return;
    const tokens = recoveryInput
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (tokens.length < bundle.threshold) {
      toast.error(`Provide at least ${bundle.threshold} share tokens`);
      return;
    }

    try {
      const secret = await recoverSecretFromShares(tokens);
      const identity = decodeIdentitySecret(secret);
      await restoreRendezvousIdentity(identity);
      setRecoveredPublicKey(identity.publicKey);
      setRecoveryError(null);
      toast.success('Identity restored. Future rendezvous sessions will use the recovered key.');
    } catch (error) {
      console.error('[IdentityRecovery] Failed to recover identity', error);
      const message = error instanceof Error ? error.message : 'Recovery failed';
      setRecoveryError(message);
      setRecoveredPublicKey(null);
      toast.error(message);
    }
  };

  return (
    <Card className="space-y-6 border-primary/30 bg-background/60 p-6 backdrop-blur">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Identity recovery</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Split your rendezvous private key into threshold-guarded shares and keep the mesh resilient to
          device loss. Shares use Ed25519 Shamir protection and must be stored with trusted stewards.
        </p>
        {currentIdentity && (
          <p className="text-xs text-muted-foreground">
            Active rendezvous key: <span className="font-mono break-all">{currentIdentity.publicKey}</span> · Issued
            {` ${new Date(currentIdentity.createdAt).toLocaleString()}`}
          </p>
        )}
      </div>

      <div className="grid gap-4 rounded-md border border-border/40 bg-background/70 p-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="share-total">Total shares</Label>
          <Input
            id="share-total"
            type="number"
            min={2}
            max={255}
            value={config.total}
            onChange={(event) =>
              setConfig((current) => ({ ...current, total: Number.parseInt(event.target.value, 10) || 0 }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="share-threshold">Threshold to recover</Label>
          <Input
            id="share-threshold"
            type="number"
            min={2}
            max={config.total}
            value={config.threshold}
            onChange={(event) =>
              setConfig((current) => ({ ...current, threshold: Number.parseInt(event.target.value, 10) || 0 }))
            }
          />
        </div>
        <div className="flex flex-col justify-end gap-2">
          <Button onClick={handleGenerateShares} disabled={isGenerating} className="w-full">
            <RefreshCcw className="mr-2 h-4 w-4" />
            Generate shares
          </Button>
          <p className="text-xs text-muted-foreground">
            Configure a quorum that matches your team&apos;s operational runbooks before creating new backups.
          </p>
        </div>
      </div>

      {sharesWithSummary.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Share ledger</h3>
            <Badge variant="secondary" className="text-xs">
              {distributed.length} of {sharesWithSummary.length} distributed
            </Badge>
          </div>
          <div className="space-y-3">
            {sharesWithSummary.map(({ token, summary }) => {
              const isDistributed = distributed.includes(summary.index);
              return (
                <div
                  key={summary.index}
                  className="flex flex-col gap-3 rounded-md border border-border/40 bg-background/70 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isDistributed ? 'default' : 'outline'} className="font-mono">
                        Share #{summary.index}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Checksum {summary.checksum}</span>
                    </div>
                    <code className="block break-all rounded bg-muted/40 p-2 text-xs text-foreground/90">
                      {token}
                    </code>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(summary.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyShare(token, summary.index)}
                      className="flex items-center gap-2"
                    >
                      {copiedShare === summary.index ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      Copy share
                    </Button>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`share-distributed-${summary.index}`}
                        checked={isDistributed}
                        onCheckedChange={() => handleToggleDistributed(summary.index)}
                        aria-label={`Mark share ${summary.index} as distributed`}
                      />
                      <Label htmlFor={`share-distributed-${summary.index}`} className="text-xs text-muted-foreground">
                        Steward has received this share
                      </Label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recover identity</h3>
          {bundle && (
            <Badge variant="outline" className="text-xs">
              Threshold {bundle.threshold} · Total {bundle.total}
            </Badge>
          )}
        </div>
        <Textarea
          value={recoveryInput}
          onChange={(event) => setRecoveryInput(event.target.value)}
          placeholder="Paste share tokens here (one per line or separated by spaces)"
          className="min-h-[120px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Combine the quorum to restore this device&apos;s rendezvous key.</span>
          {bundle && (
            <span>
              {Math.max(0, bundle.threshold - recoveryInput.split(/\s+/).filter(Boolean).length)} more shares needed
            </span>
          )}
        </div>
        <Button onClick={handleRecoverIdentity} disabled={!bundle || !hasSufficientRecoveryTokens}>
          Restore identity
        </Button>
        {recoveredPublicKey && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm text-primary">
            <p>Identity restored with public key:</p>
            <p className="mt-1 font-mono break-all">{recoveredPublicKey}</p>
          </div>
        )}
        {recoveryError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {recoveryError}
          </div>
        )}
      </div>
    </Card>
  );
}
