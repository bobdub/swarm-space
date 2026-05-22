/**
 * WallPostBillboard — renders a placed wall's decoration (a Post) as a
 * face-on panel on the wall's front face (+z in the block's local frame).
 *
 * Read-only: loads the post once from the local store and re-renders when
 * `posts-updated` fires. Author info / thumbnail / content collapse into a
 * compact billboard sized to the wall.
 */
import { useEffect, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { get } from '@/lib/store';
import type { Post } from '@/types';

interface WallPostBillboardProps {
  postId: string;
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

export function WallPostBillboard({ postId, width, height, depth }: WallPostBillboardProps) {
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const p = await get<Post>('posts', postId);
        if (!cancelled) setPost(p ?? null);
      } catch { /* noop */ }
    };
    void load();
    const onUpdate = () => { void load(); };
    window.addEventListener('p2p-posts-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('p2p-posts-updated', onUpdate);
    };
  }, [postId]);

  // Pixel-density: pick an Html distanceFactor so the panel covers most of
  // the wall face. drei's `transform` mode puts the DOM panel in world space.
  const panelStyle = useMemo<React.CSSProperties>(() => ({
    width: `${Math.max(160, Math.round(width * 120))}px`,
    maxHeight: `${Math.max(120, Math.round(height * 110))}px`,
    overflow: 'hidden',
    background: 'hsl(245 70% 8% / 0.94)',
    color: 'hsl(0 0% 95%)',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid hsl(174 59% 56% / 0.45)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 10,
    lineHeight: 1.4,
    boxSizing: 'border-box',
  }), [width, height]);

  if (!post) return null;
  const thumb =
    (post as unknown as { mediaThumbnail?: string }).mediaThumbnail ||
    (post as unknown as { thumbnailUrl?: string }).thumbnailUrl ||
    null;
  const content = post.content || '(no content)';

  return (
    <Html
      position={[0, height / 2, depth / 2 + 0.005]}
      transform
      occlude
      distanceFactor={1.4}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div style={panelStyle}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 600,
          opacity: 0.75,
          marginBottom: 4,
          gap: 6,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.authorName || post.author?.slice(0, 16) || 'anon'}
          </span>
          <span style={{ opacity: 0.6 }}>{relTime(post.createdAt)}</span>
        </div>
        {thumb && (
          <img
            src={thumb}
            alt=""
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{
              width: '100%',
              maxHeight: Math.max(60, Math.round(height * 50)),
              objectFit: 'cover',
              borderRadius: 4,
              marginBottom: 4,
            }}
          />
        )}
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
      </div>
    </Html>
  );
}