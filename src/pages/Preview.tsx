/**
 * Preview Page
 * 
 * Sandboxed view for shared posts/profiles in preview mode.
 * Works for both authenticated and unauthenticated users.
 * Acts as an invitation page for new users.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreview } from '@/contexts/PreviewContext';
import { useP2PContext } from '@/contexts/P2PContext';
import { useNavigate } from 'react-router-dom';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { PostCard } from '@/components/PostCard';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserPlus, ArrowLeft, Loader2, Wifi, Gift, Shield, Sparkles, Radio } from 'lucide-react';
import { type Post } from '@/types';
import { get } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { ensureGuestIdentity, isGuestActive, stopGuestMode } from '@/lib/preview/guestMode';
import { requestContentHost, startContentLookupResponder } from '@/lib/p2p/contentLookup';
import { cachePreviewPost, getCachedPreviewPost } from '@/lib/preview/previewCache';
import { NetworkPulse } from '@/components/preview/NetworkPulse';

type PreviewPhase =
  | 'guest-booting'
  | 'dialing-origin'
  | 'searching-peers'
  | 'rendered'
  | 'no-host';

export default function Preview() {
  const { isPreviewMode, previewSession } = usePreview();
  const { user } = useAuth();
  const p2p = useP2PContext();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [phase, setPhase] = useState<PreviewPhase>('guest-booting');
  const [hostHandle, setHostHandle] = useState<string | null>(null);
  const startedRef = useRef(false);
  const isGuest = isGuestActive() || (user as unknown as { _guest?: boolean } | null)?._guest === true;
  const isRealUser = !!user && !isGuest;

  // ── Boot: provision guest identity (if needed) + start responder ──
  useEffect(() => {
    if (!isPreviewMode || !previewSession) return;
    if (startedRef.current) return;
    startedRef.current = true;

    startContentLookupResponder();

    (async () => {
      if (!isRealUser) {
        await ensureGuestIdentity();
      }
      // Kick the mesh — for guests the freshly-minted `me` will satisfy
      // the auth gate in useP2P; for authed users this is a no-op if
      // already enabled.
      try { await p2p.enable(); } catch { /* ignore */ }
      setPhase('dialing-origin');
    })();
  }, [isPreviewMode, previewSession, user, p2p]);

  // ── Dial origin → fallback to peer search → render ──
  useEffect(() => {
    if (!isPreviewMode || !previewSession) return;
    if (phase !== 'dialing-origin') return;

    let cancelled = false;
    const postId = previewSession.postId;

    // If we already cached the content in this session, render instantly.
    if (postId) {
      const cached = getCachedPreviewPost(postId);
      if (cached) {
        setPost(cached.post);
        setHostHandle(cached.hostHandle ?? null);
        setPhase('rendered');
        return;
      }
    }

    // Attempt direct dial to the original peer.
    try {
      p2p.connectToPeer(previewSession.creatorPeerId, {
        manual: true,
        source: 'preview-mode-dial',
      });
    } catch { /* ignore */ }

    const tryLocalStore = async (): Promise<boolean> => {
      if (!postId) return false;
      const local = await get<Post>('posts', postId);
      if (local && !cancelled) {
        setPost(local);
        cachePreviewPost(local);
        setPhase('rendered');
        return true;
      }
      return false;
    };

    // Poll local store — post-sync writes here once a peer delivers it.
    const pollHandle = window.setInterval(() => { void tryLocalStore(); }, 1000);

    // After 8s, fall back to broader peer search.
    const fallbackHandle = window.setTimeout(async () => {
      if (cancelled) return;
      if (await tryLocalStore()) return;
      setPhase('searching-peers');
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(pollHandle);
      clearTimeout(fallbackHandle);
    };
  }, [phase, isPreviewMode, previewSession, p2p]);

  // ── Searching phase: ask same-origin tabs/peers who has the content ──
  useEffect(() => {
    if (phase !== 'searching-peers') return;
    const postId = previewSession?.postId;
    if (!postId) {
      setPhase('no-host');
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const search = async () => {
      attempts += 1;
      const acks = await requestContentHost(postId, { timeoutMs: 4000 });
      if (cancelled) return;
      const winner = acks[0];
      if (winner) {
        setPost(winner.post);
        setHostHandle(winner.handle);
        cachePreviewPost(winner.post, { peerId: winner.peerId ?? undefined, handle: winner.handle ?? undefined });
        setPhase('rendered');
        return;
      }
      // Also check local store — a background peer sync may have landed
      // it while we were waiting.
      const local = await get<Post>('posts', postId);
      if (local && !cancelled) {
        setPost(local);
        cachePreviewPost(local);
        setPhase('rendered');
        return;
      }
      if (attempts >= 5) {
        setPhase('no-host');
      }
    };

    void search();
    const interval = window.setInterval(() => { void search(); }, 6000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [phase, previewSession]);

  // ── Profile-feed rendering (post-less share links) ──
  useEffect(() => {
    if (phase !== 'rendered' || post || !previewSession?.isProfileFeed) return;
    (async () => {
      const { getAll } = await import('@/lib/store');
      const allPosts = await getAll<Post>('posts');
      setPosts(allPosts.slice(0, 10));
    })();
  }, [phase, post, previewSession]);

  // Redirect if not in preview mode (must run regardless of phase).
  useEffect(() => {
    if (!isPreviewMode) navigate('/');
  }, [isPreviewMode, navigate]);

  const handleJoinNetwork = () => {
    // Drop the guest identity before real signup so keys/username collide.
    stopGuestMode();
    navigate('/auth?mode=signup');
  };

  const handleRetry = () => {
    if (!previewSession) return;
    setPhase('dialing-origin');
    try {
      p2p.connectToPeer(previewSession.creatorPeerId, { manual: true, source: 'preview-mode-retry' });
    } catch { /* ignore */ }
  };

  const statusLabel = useMemo(() => {
    switch (phase) {
      case 'guest-booting': return 'Starting mesh…';
      case 'dialing-origin': return "Connecting to sharer's node…";
      case 'searching-peers': return 'Searching the swarm for a host…';
      case 'rendered': return hostHandle ? `Hosted by @${hostHandle}` : 'Live from the swarm';
      case 'no-host': return 'No active host yet — still searching quietly';
    }
  }, [phase, hostHandle]);

  if (!isPreviewMode) return null;

  const showInvite = !isRealUser; // guests always see the CTA — content fills in alongside

  return (
    <div className="min-h-screen pb-20 bg-gradient-to-b from-background via-primary/5 to-background">
      <PreviewBanner />
      <TopNavigationBar />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 mt-16 space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Button>

        {/* Header */}
        <div className="bg-card/70 backdrop-blur rounded-xl border p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">
                {previewSession?.isProfileFeed ? 'Shared Profile' : 'Shared Post'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isGuest ? 'Viewing as a guest — no account needed to look around.' : "You're viewing shared content from a peer on the swarm."}
              </p>
            </div>
            <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground gap-1">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10">
                <Shield className="h-3 w-3" /> Sandboxed
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/10">
                <Radio className="h-3 w-3" /> {statusLabel}
              </span>
            </div>
          </div>
          <NetworkPulse postId={previewSession?.postId} onJoin={showInvite ? handleJoinNetwork : undefined} />
        </div>

        {/* Content */}
        {phase !== 'rendered' && !post ? (
          <div className="text-center py-16 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">{statusLabel}</p>
            {phase === 'no-host' && (
              <Button variant="outline" onClick={handleRetry}>Try again</Button>
            )}
          </div>
        ) : previewSession?.postId && post ? (
          <div className="space-y-3">
            {hostHandle && (
              <p className="text-xs text-muted-foreground text-center">
                Delivered by <span className="font-medium text-foreground">@{hostHandle}</span> — the original sharer wasn't reachable, so the swarm served a copy.
              </p>
            )}
            <PostCard post={post} />
          </div>
        ) : previewSession?.isProfileFeed && posts.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Recent posts</h2>
            {posts.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">Content not available yet.</div>
        )}

        {/* Invitation card — always visible for guests, sits alongside the preview */}
        {showInvite && (
          <Card className="border-primary/20 bg-card/60 backdrop-blur">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Gift className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Join the swarm</CardTitle>
                  <CardDescription>Create a free identity — no server, no email, keys stay on your device.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <Shield className="h-4 w-4 text-primary mt-0.5" />
                  <span><span className="font-medium">Privacy first.</span> Content lives on peers, not servers.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Radio className="h-4 w-4 text-primary mt-0.5" />
                  <span><span className="font-medium">Help share.</span> Your device becomes another host.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5" />
                  <span><span className="font-medium">Earn.</span> Post, engage, mine SWARM.</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <Button onClick={handleJoinNetwork} className="gap-2 bg-gradient-to-r from-primary to-secondary">
                  <UserPlus className="h-4 w-4" /> Create free account
                </Button>
                <Button variant="link" className="p-0 h-auto text-primary" onClick={() => { stopGuestMode(); navigate('/auth?tab=recover'); }}>
                  Recover an existing one
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
