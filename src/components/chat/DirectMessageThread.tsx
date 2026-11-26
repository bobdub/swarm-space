import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Check, CheckCheck, Clock, Lock, Send, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/components/Avatar';
import { SwarmLink } from '@/components/routing/SwarmLink';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { entangle } from '@/lib/entanglements';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/chat/chatLimits';
import { armChatChirpAudio, chirpForRemoteLine } from '@/lib/brain/chatChirp';
import {
  conversationIdFor,
  type DirectMessageRecord,
  type DirectMessenger,
  type DirectPeerSession,
} from '@/lib/chat/directMessages';
import type { ConnectedChatPeer } from '@/hooks/useGlobalChat';

const MARKDOWN_COMPONENTS = { a: SwarmLink };
const TYPING_SEND_EVERY_MS = 3_000;
const TYPING_SHOW_FOR_MS = 5_000;

function formatChatMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n\n');
}

function StatusIcon({ status }: { status: DirectMessageRecord['status'] }): JSX.Element {
  switch (status) {
    case 'sending':
      return <Clock className="h-3 w-3" aria-label="Sending" />;
    case 'sent':
      return <Check className="h-3 w-3" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-primary" aria-label="Read" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-destructive" aria-label="Not sent" />;
  }
}

/**
 * An end-to-end encrypted conversation with one connected peer. Opening it
 * runs the entanglement handshake on the `direct-message` channel and
 * records the social-graph entanglement.
 */
export function DirectMessageThread({
  peer,
  messenger,
}: {
  peer: ConnectedChatPeer;
  messenger: DirectMessenger | null;
}): JSX.Element {
  const { user } = useAuth();
  const [session, setSession] = useState<DirectPeerSession | null>(() => messenger?.getSession(peer.peerId) ?? null);
  const [handshake, setHandshake] = useState<'pending' | 'ready' | 'failed'>(session ? 'ready' : 'pending');
  const [records, setRecords] = useState<DirectMessageRecord[]>([]);
  const [text, setText] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversationId =
    session?.conversationId ?? (user && peer.userId ? conversationIdFor(user.id, peer.userId) : null);

  // Entanglement handshake.
  const runHandshake = useCallback(async () => {
    if (!messenger) return;
    setHandshake('pending');
    setRejected(null);
    const s = await messenger.connect(peer.peerId);
    setSession(s);
    setHandshake(s ? 'ready' : 'failed');
    if (s && user) {
      entangle(user.id, s.userId, s.displayName).catch(() => undefined);
    }
  }, [messenger, peer.peerId, user]);

  useEffect(() => {
    void runHandshake();
  }, [runHandshake]);

  // History: instant from the local store.
  useEffect(() => {
    if (!messenger || !conversationId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    messenger.history(conversationId).then((rows) => { if (!cancelled) setRecords(rows); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [messenger, conversationId]);

  // Live lines, receipts and typing.
  useEffect(() => {
    if (!messenger) return;
    armChatChirpAudio();
    return messenger.subscribe((e) => {
      if (e.type === 'session' && e.session.peerId === peer.peerId) {
        setSession(e.session);
        setHandshake('ready');
        setRejected(null);
        return;
      }
      if (e.type === 'rejected' && e.peerId === peer.peerId) {
        setSession(null);
        setHandshake('failed');
        setRejected(e.reason);
        return;
      }
      if (e.type === 'typing') {
        if (e.peerId !== peer.peerId) return;
        setPeerTyping(e.typing);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        if (e.typing) typingTimerRef.current = setTimeout(() => setPeerTyping(false), TYPING_SHOW_FOR_MS);
        return;
      }
      if (e.type !== 'message' && e.type !== 'status') return;
      if (e.record.conversationId !== conversationId) return;
      if (e.type === 'message' && e.record.senderId !== user?.id) {
        setPeerTyping(false);
        chirpForRemoteLine({ id: e.record.id, peerId: e.record.peerId, authorId: e.record.senderId });
      }
      setRecords((prev) => {
        const i = prev.findIndex((r) => r.id === e.record.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = e.record;
          return next;
        }
        return [...prev, e.record].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
      });
    });
  }, [messenger, peer.peerId, conversationId, user?.id]);

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

  // Reading the open thread marks it read (and tells the sender).
  useEffect(() => {
    if (!messenger || !conversationId) return;
    if (records.some((r) => r.senderId !== user?.id && !r.read)) {
      void messenger.markRead(conversationId);
    }
  }, [messenger, conversationId, records, user?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [records.length, peerTyping]);

  const handleChange = (value: string) => {
    setText(value);
    if (!messenger || handshake !== 'ready') return;
    const now = Date.now();
    if (value.trim() && now - lastTypingSentRef.current > TYPING_SEND_EVERY_MS) {
      lastTypingSentRef.current = now;
      void messenger.setTyping(peer.peerId, true);
    }
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body || !messenger) return;
    setText('');
    lastTypingSentRef.current = 0;
    const record = await messenger.send(peer.peerId, body);
    if (!record) {
      setText(body);
      setHandshake('failed');
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-[hsla(180,80%,60%,0.18)] bg-[hsla(265,70%,8%,0.55)]">
      <div className="flex items-center gap-2 border-b border-[hsla(180,80%,60%,0.18)] px-3 py-2">
        <Avatar avatarRef={peer.avatarRef} username={peer.displayName} displayName={peer.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground" data-testid="dm-header">
            Messaging Entangled Peer <span className="font-semibold">{peer.displayName}</span>,{' '}
            {session?.verified && session.discriminator ? `#${session.discriminator}` : peer.namespace}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-foreground/60">
            {handshake === 'ready' && session ? (
              <>
                <Lock className="h-3 w-3" /> End-to-end encrypted · key {session.fingerprint}
                {session.verified ? (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 text-primary"
                    title="They signed this session with their account identity key and the wallet that anchors their namespace"
                  >
                    <ShieldCheck className="h-3 w-3" /> namespace verified
                  </span>
                ) : (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 text-amber-400"
                    title="Their account is locked or on an older build, so they could not sign this session. Anyone could claim this name."
                  >
                    <ShieldAlert className="h-3 w-3" /> unverified
                  </span>
                )}
              </>
            ) : handshake === 'pending' ? (
              'Entangling…'
            ) : rejected ? (
              <span className="inline-flex items-center gap-1 text-destructive" data-testid="dm-rejected">
                <ShieldX className="h-3 w-3" /> Blocked: this link claims to be {peer.displayName} but could not prove their namespace.
              </span>
            ) : (
              <>
                They did not answer the handshake.
                <button type="button" className="underline" onClick={() => void runHandshake()}>
                  Try again
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {records.length === 0 && (
          <p className="pt-6 text-center text-xs text-foreground/50">
            No messages yet. Lines you send here go only to {peer.displayName}, sealed end to end.
          </p>
        )}
        {records.map((r) => {
          const mine = r.senderId === user?.id;
          return (
            <div key={r.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                  mine ? 'bg-primary/20 text-foreground' : 'bg-foreground/10 text-foreground',
                )}
              >
                {r.locked ? (
                  <p className="flex items-center gap-1 text-xs italic text-foreground/60">
                    <Lock className="h-3 w-3" /> Sealed. Unlock your account to read it.
                  </p>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none break-words [&_p]:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {formatChatMarkdown(r.text)}
                    </ReactMarkdown>
                  </div>
                )}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-foreground/50">
                  {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {mine && r.status === 'failed' ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-destructive underline"
                      onClick={() => void messenger?.retry(r.id)}
                      aria-label="Not sent, tap to retry"
                    >
                      <StatusIcon status={r.status} /> Retry
                    </button>
                  ) : mine ? (
                    <StatusIcon status={r.status} />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {peerTyping && <p className="text-xs italic text-foreground/60">{peer.displayName} is typing…</p>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-[hsla(180,80%,60%,0.18)] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          rows={1}
          placeholder={handshake === 'ready' ? `Message ${peer.displayName}` : 'Waiting for the handshake…'}
          disabled={!messenger || handshake === 'pending'}
          className="min-h-[2.25rem] resize-none text-sm"
          aria-label={`Message ${peer.displayName}`}
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!text.trim() || handshake !== 'ready'} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
