import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import barSignUrl from '@/assets/bar/green-cat-red-dragon-sign.webp';
import { get } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import type { User } from '@/types';
import {
  formatDonationAmounts,
  loadDonorLeaderboard,
  type DonorLeaderboard,
} from '@/lib/blockchain/infinity/donorLeaderboard';

/**
 * Signage for the bar: "The Green Cat & Red Dragon" sign art (outside by
 * the door and over the counter) and the donor leaderboard board inside.
 * Both are plain planes facing local +Z; the caller rotates them to face
 * out of their wall.
 */

/** Sign art aspect (1536 × 1024 source). */
export const BAR_SIGN_ASPECT = 1.5;

let signTexture: THREE.Texture | null = null;
function getSignTexture(): THREE.Texture {
  if (!signTexture) {
    signTexture = new THREE.TextureLoader().load(barSignUrl);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    signTexture.anisotropy = 4;
  }
  return signTexture;
}

/** The carved sign. `glow` adds a little self-light so it reads at night. */
export function BarSignArt({ width, glow = 0.25 }: { width: number; glow?: number }) {
  const map = useMemo(getSignTexture, []);
  return (
    <mesh castShadow>
      <planeGeometry args={[width, width / BAR_SIGN_ASPECT]} />
      <meshStandardMaterial
        map={map}
        emissiveMap={map}
        emissive="#ffffff"
        emissiveIntensity={glow}
        alphaTest={0.5}
        roughness={0.75}
      />
    </mesh>
  );
}

// ── Donor leaderboard ────────────────────────────────────────────────

const REFRESH_EVENTS = ['blockchain-transaction', 'wallet-tip-updated', 'reward-pool-update', 'swarm-block-mined'];
const EMPTY: DonorLeaderboard = { donors: [], totals: {}, donationCount: 0 };

async function donorName(userId: string): Promise<string> {
  const me = getCurrentUser();
  if (me?.id === userId) return me.displayName || me.username || userId.slice(0, 8);
  const user = await get<User>('users', userId).catch(() => undefined);
  if (user) return user.displayName || user.username;
  return `@${userId.slice(0, 8)}`;
}

function useDonorLeaderboard(): { board: DonorLeaderboard; names: Record<string, string> } {
  const [state, setState] = useState<{ board: DonorLeaderboard; names: Record<string, string> }>({ board: EMPTY, names: {} });
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const board = await loadDonorLeaderboard();
        const entries = await Promise.all(board.donors.map(async (d) => [d.userId, await donorName(d.userId)] as const));
        if (alive) setState({ board, names: Object.fromEntries(entries) });
      } catch { /* keep the last board */ }
    };
    void refresh();
    const onUpdate = () => void refresh();
    REFRESH_EVENTS.forEach((e) => window.addEventListener(e, onUpdate));
    const timer = window.setInterval(onUpdate, 60_000);
    return () => {
      alive = false;
      REFRESH_EVENTS.forEach((e) => window.removeEventListener(e, onUpdate));
      window.clearInterval(timer);
    };
  }, []);
  return state;
}

const CANVAS_W = 1280;
const MAX_ROWS = 10;

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function drawBoard(canvas: HTMLCanvasElement, board: DonorLeaderboard, names: Record<string, string>) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  // Dark stained wood with a gilt frame, to sit beside the carved sign.
  const wood = ctx.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#2b1a10');
  wood.addColorStop(1, '#1a0f08');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = '#7a1f1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4c46a';
  ctx.font = 'bold 84px Georgia, "Times New Roman", serif';
  ctx.fillText('Donor Leaderboard', W / 2, 105);
  ctx.fillStyle = '#7fae5a';
  ctx.font = 'italic 38px Georgia, serif';
  ctx.fillText('Patrons of The Green Cat & Red Dragon', W / 2, 170);

  const left = 90;
  const right = W - 90;
  ctx.strokeStyle = 'rgba(201,162,74,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, 210); ctx.lineTo(right, 210); ctx.stroke();

  const rows = board.donors.slice(0, MAX_ROWS);
  const rowH = 62;
  let y = 260;
  if (rows.length === 0) {
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '38px Georgia, serif';
    ctx.fillText('No donations yet. Be the first patron!', W / 2, y + 120);
    ctx.font = '28px Georgia, serif';
    ctx.fillStyle = '#b8a888';
    ctx.fillText('Send coins to Infinity from your wallet to join the board.', W / 2, y + 180);
  }
  rows.forEach((d, i) => {
    const medal = ['#ffd35a', '#d9d9d9', '#d08a4a'][i];
    ctx.textAlign = 'left';
    ctx.fillStyle = medal ?? '#c9a24a';
    ctx.font = 'bold 46px Georgia, serif';
    ctx.fillText(`${i + 1}.`, left, y);
    ctx.fillStyle = '#f2e6c9';
    ctx.font = `${i < 3 ? 'bold ' : ''}46px Georgia, serif`;
    ctx.fillText(fit(ctx, names[d.userId] ?? `@${d.userId.slice(0, 8)}`, 420), left + 90, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f4c46a';
    ctx.font = '42px Georgia, serif';
    ctx.fillText(fit(ctx, formatDonationAmounts(d.amounts), 600), right, y);
    y += rowH;
  });
  if (board.donors.length > MAX_ROWS) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b8a888';
    ctx.font = 'italic 28px Georgia, serif';
    ctx.fillText(`…and ${board.donors.length - MAX_ROWS} more generous souls`, W / 2, y);
  }

  const footY = H - 115;
  ctx.strokeStyle = 'rgba(201,162,74,0.5)';
  ctx.beginPath(); ctx.moveTo(left, footY - 50); ctx.lineTo(right, footY - 50); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = '38px Georgia, serif';
  ctx.fillText('Total raised altogether', W / 2, footY - 12);
  ctx.fillStyle = '#ffd35a';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.fillText(fit(ctx, formatDonationAmounts(board.totals), W - 200), W / 2, footY + 48);
}

/** Wall-mounted board listing every donor, their amount, and the total raised. */
export function DonorLeaderboardBoard({ width, height }: { width: number; height: number }) {
  const { board, names } = useDonorLeaderboard();
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = Math.round(CANVAS_W * (height / width));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    drawBoard(canvas, board, names);
    texture.needsUpdate = true;
  }, [canvas, texture, board, names]);
  return (
    <group>
      {/* Backing plank so the board has depth against the stone. */}
      <mesh position={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[width + 0.12, height + 0.12, 0.06]} />
        <meshStandardMaterial color="#3a2414" roughness={0.8} />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.7} />
      </mesh>
    </group>
  );
}
