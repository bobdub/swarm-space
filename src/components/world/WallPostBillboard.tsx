/**
 * WallPostBillboard — renders a placed wall's decoration (a Post) as a
 * textured plane glued to the wall's front face (+z in the block's local
 * frame). The plane is sized in world units to fill the wall, so the
 * post always reads as a poster on the wall regardless of camera
 * distance — no drei <Html> scale guesswork.
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { get, getAll } from '@/lib/store';
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

export function WallPostBillboard({ postId, placementId, width, height, depth }: WallPostBillboardProps) {
  const [post, setPost] = useState<Post | null>(null);
  const [thumbImg, setThumbImg] = useState<HTMLImageElement | null>(null);

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

  const thumbSrc =
    (post as unknown as { mediaThumbnail?: string })?.mediaThumbnail ||
    (post as unknown as { thumbnailUrl?: string })?.thumbnailUrl ||
    null;

  // Pre-load the thumbnail so the canvas can draw it (and re-bake the
  // texture when it finishes loading).
  useEffect(() => {
    if (!thumbSrc) { setThumbImg(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setThumbImg(img);
    img.onerror = () => setThumbImg(null);
    img.src = thumbSrc;
  }, [thumbSrc]);

  // Bake the post into a CanvasTexture sized to the wall's aspect ratio.
  const texture = useMemo(() => {
    if (!post) return null;
    const aspect = Math.max(0.2, height / Math.max(0.01, width));
    const W = 1024;
    const H = Math.max(256, Math.round(W * aspect));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Background + frame
    ctx.fillStyle = '#0f0a1f';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, W - 12, H - 12);

    const pad = 36;
    let cursorY = pad;

    // Header row
    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    const author = post.authorName || post.author?.slice(0, 18) || 'anon';
    ctx.fillText(author, pad, cursorY + 32);
    ctx.fillStyle = '#a78bfa';
    ctx.font = '28px system-ui, sans-serif';
    const t = relTime(post.createdAt);
    if (t) {
      const tw = ctx.measureText(t).width;
      ctx.fillText(t, W - pad - tw, cursorY + 32);
    }
    cursorY += 60;

    // Thumbnail (if any) — half the remaining height, cover-fit
    if (thumbImg) {
      const imgH = Math.round((H - cursorY - pad) * 0.55);
      const imgW = W - pad * 2;
      const srcAspect = thumbImg.width / Math.max(1, thumbImg.height);
      const dstAspect = imgW / imgH;
      let sx = 0, sy = 0, sw = thumbImg.width, sh = thumbImg.height;
      if (srcAspect > dstAspect) {
        sw = thumbImg.height * dstAspect;
        sx = (thumbImg.width - sw) / 2;
      } else {
        sh = thumbImg.width / dstAspect;
        sy = (thumbImg.height - sh) / 2;
      }
      ctx.drawImage(thumbImg, sx, sy, sw, sh, pad, cursorY, imgW, imgH);
      cursorY += imgH + 24;
    }

    // Body text — word-wrap into remaining height
    ctx.fillStyle = '#f5f3ff';
    ctx.font = '30px system-ui, sans-serif';
    const content = (post.content || '(no content)').slice(0, 600);
    const maxWidth = W - pad * 2;
    const words = content.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    const lineH = 38;
    const maxLines = Math.max(1, Math.floor((H - cursorY - pad) / lineH));
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      let l = lines[i];
      if (i === maxLines - 1 && lines.length > maxLines) l = l.replace(/.{0,3}$/, '…');
      ctx.fillText(l, pad, cursorY + lineH * (i + 1));
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [post, thumbImg, width, height]);

  if (!post || !texture) return null;

  // Plane sized in world units to fill (most of) the wall face.
  const planeW = width * 0.94;
  const planeH = height * 0.94;
  return (
    <mesh position={[0, height / 2, depth / 2 + 0.02]}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}