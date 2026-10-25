import { useState, useSyncExternalStore } from 'react';
import { Copy, Link, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useP2PContext } from '@/contexts/P2PContext';
import { brainInviteUrl, getBrainInviteState, subscribeBrainInvite, retryBrainInvite } from '@/lib/p2p/brainInvite';

export function BrainInviteControl() {
  const { getPeerId } = useP2PContext();
  const [open, setOpen] = useState(false);
  const peerId = getPeerId();
  const url = peerId ? brainInviteUrl(window.location.origin, peerId) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success('Brain invite copied'); }
    catch { toast.error('Could not copy. Select the link to copy it.'); }
  };
  return <div className="px-1 py-1">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-start gap-1.5 px-1 text-xs" aria-label="Brain join link">
          <Link className="h-3.5 w-3.5 shrink-0" />Invite link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] space-y-2">
        <p className="text-sm font-medium">Brain join link</p>
        {url ? <div className="flex min-w-0 gap-2">
          <Input aria-label="Brain invite URL" readOnly value={url} onFocus={event => event.target.select()} className="min-w-0 text-xs" />
          <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Copy Brain invite" title="Copy Brain invite" onClick={() => void copy()}><Copy className="h-4 w-4" /></Button>
        </div> : <p role="status" className="text-xs text-muted-foreground">Waiting for your Peer ID…</p>}
      </PopoverContent>
    </Popover>
  </div>;
}

export function BrainInviteStatus() {
  const state = useSyncExternalStore(subscribeBrainInvite, getBrainInviteState);
  if (state.phase === 'idle') return null;
  const pending = state.phase === 'starting' || state.phase === 'connecting';
  return <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs text-foreground">
    {pending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
    <span className="min-w-0 flex-1 break-words">{pending ? 'Connecting to host peer…' : state.phase === 'connected' ? 'Connected to host peer' : state.phase === 'invalid' ? 'This invite is invalid, your own, or blocked.' : 'Host has not connected. Other peer connections remain available.'}</span>
    {state.phase === 'unavailable' && <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={retryBrainInvite}>Retry</Button>}
  </div>;
}