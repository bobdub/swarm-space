/**
 * VaultMediaViewerDialog — view the real bytes of a media file engraved onto a
 * sealed / wrapped media coin. Reads through the authoritative content
 * resolver (media coin -> local chunks), never over the network.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Download, FileQuestion } from 'lucide-react';
import { resolveContent } from '@/lib/blockchain/contentResolver';
import type { VaultIndexEntry } from '@/lib/blockchain/syncVault';

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function VaultMediaViewerDialog({
  open,
  onOpenChange,
  hash,
  entry,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hash: string;
  entry: VaultIndexEntry;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mime, setMime] = useState<string>(entry.mime || 'application/octet-stream');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState('loading');
    setUrl(null);
    setText(null);

    (async () => {
      try {
        const res = await resolveContent(hash, { mime: entry.mime, ref: entry.ref });
        if (cancelled) return;
        if (!res.bytes || res.bytes.byteLength === 0) { setState('missing'); return; }
        const type = res.mime || entry.mime || 'application/octet-stream';
        setMime(type);
        if (type.startsWith('text/') || type.includes('json') || type.includes('markdown')) {
          setText(new TextDecoder().decode(res.bytes));
        }
        const bytes = res.bytes;
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objectUrl = URL.createObjectURL(new Blob([copy], { type }));
        setUrl(objectUrl);
        setState('ready');
      } catch {
        if (!cancelled) setState('missing');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, hash, entry.mime, entry.ref]);

  const name = entry.name || entry.ref || hash.slice(0, 24);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{name}</DialogTitle>
          <DialogDescription className="text-xs">
            {mime} · {formatBytes(entry.length || 0)} · coin {entry.coinId.slice(0, 14)}…
          </DialogDescription>
        </DialogHeader>

        {state === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading from media coin…
          </div>
        )}

        {state === 'missing' && (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
            <FileQuestion className="h-8 w-8 opacity-40" />
            This file's bytes are not stored locally yet.
          </div>
        )}

        {state === 'ready' && url && (
          <div className="space-y-3">
            {mime.startsWith('image/') && (
              <img src={url} alt={name} className="max-h-[60vh] w-full rounded-md object-contain" />
            )}
            {mime.startsWith('video/') && (
              <video src={url} controls className="max-h-[60vh] w-full rounded-md" />
            )}
            {mime.startsWith('audio/') && <audio src={url} controls className="w-full" />}
            {text !== null && (
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                {text}
              </pre>
            )}
            {!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/') && text === null && (
              <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                Preview not available for this file type.
              </div>
            )}
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href={url} download={name}>
                  <Download className="mr-2 h-4 w-4" /> Download
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}