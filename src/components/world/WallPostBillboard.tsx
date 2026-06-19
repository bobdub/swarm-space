/**
 * WallPostBillboard — renders the FULL post (header + body text +
 * live media) as a composite poster glued to the wall's front face
 * (+z in the block's local frame). Uses a backing mesh for opacity
 * plus a drei <Html transform> layer for real DOM so video/audio
 * actually play. Layout adapts to the wall's aspect ratio:
 *   - text only        → header + body fills
 *   - media only       → header + media fills
 *   - media + caption  → header + media (~65%) + caption (clamped)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { get, getAll } from '@/lib/store';
import { importFileKey, decryptAndReassembleFile, type Manifest } from '@/lib/fileEncryption';
import { progressiveDecryptToBlob } from '@/lib/torrent/streamingDecryptor';
import type { Post } from '@/types';

interface WallPostBillboardProps {
  postId: string;
  placementId?: string | null;
  width: number;
  height: number;
  depth: number;
}

function relTime(ts?: string): string {
  if (!ts) return '';
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type MediaState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'locked'; reason: 'walled' | 'nsfw' }
  | { kind: 'error'; name?: string }
  | { kind: 'image' | 'video' | 'audio' | 'file'; url: string; mime: string; name?: string };

// Extract a YouTube video id from common URL shapes (watch, youtu.be, shorts, embed).
function extractYouTubeId(text: string): string | null {
  if (!text) return null;
  const re = /(?:youtube\.com\/(?:watch\?(?:[^"\s]*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
  const m = text.match(re);
  return m ? m[1] : null;
}

function extractVimeoId(text: string): string | null {
  if (!text) return null;
  const m = text.match(/vimeo\.com\/(?:video\/)?(\d{6,})/i);
  return m ? m[1] : null;
}

export function WallPostBillboard({ postId, placementId, width, height, depth }: WallPostBillboardProps) {
  const [post, setPost] = useState<Post | null>(null);
  const [media, setMedia] = useState<MediaState>({ kind: 'none' });
  const [extraCount, setExtraCount] = useState(0);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const p = await get<Post>('posts', postId);
        if (p) {
          if (!cancelled) setPost(p);
          return;
        }
        if (placementId) {
          const posts = await getAll<Post>('posts');
          const fallback = posts
            .filter((entry) => entry.wallPlacementId === placementId)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
          if (!cancelled) setPost(fallback);
          return;
        }
        if (!cancelled) setPost(null);
      } catch { /* noop */ }
    };
    void load();
    const onUpdate = () => { void load(); };
    window.addEventListener('p2p-posts-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('p2p-posts-updated', onUpdate);
    };
  }, [postId, placementId]);

  // Resolve the post's primary attachment into a playable object URL.
  useEffect(() => {
    let cancelled = false;
    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    if (!post) { setMedia({ kind: 'none' }); setExtraCount(0); revoke(); return; }
    const ids = post.manifestIds ?? [];
    setExtraCount(Math.max(0, ids.length - 1));
    if (ids.length === 0) { setMedia({ kind: 'none' }); revoke(); return; }
    // Lock-out states keep header+body but block media.
    const unlocked = (post.unlockedBy ?? []).length > 0 || post.walledCommunityUnlocked;
    if (post.walled && !unlocked) { setMedia({ kind: 'locked', reason: 'walled' }); revoke(); return; }
    if (post.nsfw) { setMedia({ kind: 'locked', reason: 'nsfw' }); revoke(); return; }

    setMedia({ kind: 'pending' });
    const fileId = ids[0];
    const load = async () => {
      try {
        const manifest = (await get('manifests', fileId)) as Manifest | undefined;
        if (!manifest || !manifest.chunks?.length || !manifest.fileKey) {
          if (!cancelled) setMedia({ kind: 'pending' });
          return;
        }
        const fileKey = await importFileKey(manifest);
        const blob = manifest.chunks.length > 100
          ? await progressiveDecryptToBlob(manifest)
          : await decryptAndReassembleFile(manifest, fileKey);
        if (cancelled) return;
        revoke();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const mime = blob.type || manifest.mime || 'application/octet-stream';
        const kind: MediaState['kind'] = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
          ? 'audio'
          : 'file';
        setMedia({ kind, url, mime, name: manifest.originalName });
      } catch (err) {
        console.debug('[WallPostBillboard] decrypt pending', err);
        if (!cancelled) setMedia({ kind: 'pending' });
      }
    };
    void load();
    const onUpdate = () => { void load(); };
    window.addEventListener('p2p-posts-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('p2p-posts-updated', onUpdate);
    };
  }, [post]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // World-space plane dims for the poster.
  const planeW = width * 0.96;
  const planeH = height * 0.96;

  // Map world-units → CSS pixels for the <Html transform> layer at a fixed
  // density so type stays sharp regardless of wall size. Drei's transformed
  // Html uses a 40px-per-world-unit baseline, so include that baseline when
  // scaling the DOM poster back onto the physical wall plane.
  const PX_PER_M = 256;
  const HTML_TRANSFORM_BASELINE = 40;
  const cssW = Math.max(160, Math.round(planeW * PX_PER_M));
  const cssH = Math.max(120, Math.round(planeH * PX_PER_M));
  const htmlScale = (planeW * HTML_TRANSFORM_BASELINE) / cssW;

  const hasBody = !!(post?.content && post.content.trim().length > 0);
  const ytId = useMemo(() => extractYouTubeId(post?.content ?? ''), [post?.content]);
  const vimeoId = useMemo(() => extractVimeoId(post?.content ?? ''), [post?.content]);
  const hasEmbed = (!!ytId || !!vimeoId) && media.kind === 'none';
  const hasMedia = media.kind !== 'none' || hasEmbed;
  const mediaShare = hasBody && hasMedia ? 0.65 : hasMedia ? 0.86 : 0;
  const bodyShare = hasBody ? (hasMedia ? 0.27 : 0.86) : 0;

  const renderMedia = useMemo(() => {
    if (media.kind === 'none' && ytId) {
      return (
        <iframe
          src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0, borderRadius: 6, background: '#000' }}
        />
      );
    }
    if (media.kind === 'none' && vimeoId) {
      return (
        <iframe
          src={`https://player.vimeo.com/video/${vimeoId}`}
          title="Vimeo video"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0, borderRadius: 6, background: '#000' }}
        />
      );
    }
    switch (media.kind) {
      case 'image':
        return (
          <img
            src={media.url}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }}
          />
        );
      case 'video':
        return (
          <video
            src={media.url}
            controls
            playsInline
            muted
            loop
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, background: '#000' }}
          />
        );
      case 'audio':
        return (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: 12, background: '#0b0820', borderRadius: 6,
          }}>
            <audio src={media.url} controls style={{ width: '100%' }} />
          </div>
        );
      case 'file':
        return (
          <a href={media.url} download={media.name ?? 'attachment'} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
            background: '#0b0820', borderRadius: 6, color: '#e9d5ff', textDecoration: 'none',
            fontSize: 14, padding: 12, textAlign: 'center',
          }}>📎 {media.name ?? 'Attachment'}</a>
        );
      case 'locked':
        return (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: '#1a0b2e', borderRadius: 6,
            color: '#fbcfe8', fontSize: 14, padding: 12, textAlign: 'center',
          }}>
            {media.reason === 'walled' ? '🔒 Walled post — unlock in feed' : '⚠ NSFW — view in feed'}
          </div>
        );
      case 'pending':
        return (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: '#0b0820', borderRadius: 6,
            color: '#a78bfa', fontSize: 13,
          }}>media syncing…</div>
        );
      case 'error':
        return (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: '#0b0820', borderRadius: 6,
            color: '#fca5a5', fontSize: 13,
          }}>media unavailable</div>
        );
      default:
        return null;
    }
  }, [media, ytId, vimeoId]);

  if (!post) return null;

  const author = post.authorName || post.author?.slice(0, 18) || 'anon';

  return (
    <group position={[0, height / 2, depth / 2 + 0.02]}>
      {/* Backing mesh — opaque so the poster reads on glass/window walls. */}
      <mesh>
        <planeGeometry args={[planeW, planeH]} />
        <meshStandardMaterial color="#0f0a1f" roughness={0.7} />
      </mesh>
      {/* Frame trim */}
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[planeW * 0.995, planeH * 0.995]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.18} />
      </mesh>
      <Html
        transform
        position={[0, 0, 0.01]}
        scale={htmlScale}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'auto' }}
      >
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: cssW,
            height: cssH,
            boxSizing: 'border-box',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'hsl(245 70% 8% / 0.96)',
            color: 'hsl(0 0% 95%)',
            border: '1px solid hsl(265 80% 70% / 0.35)',
            borderRadius: 10,
            fontFamily: 'system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 8,
            fontSize: 13, lineHeight: 1.2,
          }}>
            <span style={{
              fontWeight: 600, color: '#e9d5ff', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{author}</span>
            <span style={{ color: '#a78bfa', opacity: 0.85 }}>{relTime(post.createdAt)}</span>
          </div>

          {/* Media */}
          {hasMedia && (
            <div style={{
              flex: `${Math.round(mediaShare * 100)} 1 0`,
              minHeight: 0,
              position: 'relative',
            }}>
              {renderMedia}
              {extraCount > 0 && (
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,0.6)', color: '#fff',
                  fontSize: 11, padding: '2px 6px', borderRadius: 999,
                }}>+{extraCount}</div>
              )}
            </div>
          )}

          {/* Body */}
          {hasBody && (
            <div style={{
              flex: `${Math.round(bodyShare * 100)} 1 0`,
              minHeight: 0,
              overflow: 'hidden',
              color: '#f5f3ff',
              fontSize: 14,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical' as const,
              WebkitLineClamp: hasMedia ? 4 : 12,
            }}>
              {post.content}
            </div>
          )}

          {!hasBody && !hasMedia && (
            <div style={{ color: '#a78bfa', fontSize: 13, opacity: 0.7 }}>(empty post)</div>
          )}
        </div>
      </Html>
    </group>
  );
}