import { useState } from 'react';
import { ChevronDown, ChevronRight, Plug, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useP2PContext } from '@/contexts/P2PContext';

/** Factual connection status, separate from Infinity's learned replies. */
export function GuestPeerConnectionPrompt() {
  const { stats, isEnabled, enable, connectToPeer, getPeerId } = useP2PContext();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  if (dismissed || stats.connectedPeers > 0) return null;

  const connect = async () => {
    const target = peerId.trim();
    if (!target || busy) return;
    if (target === getPeerId()) { setStatus('Enter another person’s Peer ID, not your own.'); return; }
    setBusy(true);
    setStatus('');
    try {
      if (!isEnabled) await enable();
      const accepted = connectToPeer(target, { manual: true, source: 'brain-guest-chat' });
      setStatus(accepted ? 'Connection requested. Waiting for the peer to answer…' : 'Could not start the connection. Check the Peer ID and try again.');
    } catch { setStatus('Could not start the connection. Please try again.'); }
    finally { setBusy(false); }
  };

  return <div className="shrink-0 border-t border-border bg-muted px-3 py-2 text-xs text-foreground" aria-label="Guest connection guidance">
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" className="h-auto min-w-0 whitespace-normal px-0 text-left" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown className="mr-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mr-1 h-4 w-4 shrink-0" />}Connect to a peer to chat
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Dismiss connection prompt" title="Dismiss connection prompt" onClick={() => setDismissed(true)}><X className="h-3 w-3" /></Button>
    </div>
    {expanded && <div className="mt-2 space-y-2">
      <p>You have no peer connections yet. Infinity can reply here, but other people cannot receive your messages yet.</p>
      <div role="form" aria-label="Connect to a known peer" className="flex items-center gap-2">
        <Input aria-label="Peer ID" placeholder="Peer ID" value={peerId} disabled={busy} onChange={event => setPeerId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } }} className="min-w-0 flex-1" />
        <Button type="button" size="sm" disabled={!peerId.trim() || busy} onClick={() => void connect()}><Plug className="mr-1 h-4 w-4" />Connect</Button>
      </div>
      <p role="status" className="break-words text-muted-foreground">{busy ? 'Starting connection…' : status}</p>
    </div>}
  </div>;
}