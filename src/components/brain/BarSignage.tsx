import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import barSignUrl from '@/assets/bar/green-cat-red-dragon-sign.webp';
import { get } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import type { User } from '@/types';
import {
  formatDonationAmounts,
  formatSwarmValue,
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
const EMPTY: DonorLeaderboard = { donors: [], totals: {}, totalValue: 0, donationCount: 0 };

const NAME_TIMEOUT_MS = 3000;

async function donorName(userId: string): Promise<string> {
  const fallback = `@${userId.slice(0, 8)}`;
  const me = getCurrentUser();
  if (me?.id === userId) return me.displayName || me.username || fallback;
  // A profile lookup must never hold the board back: give up after a moment.
  const user = await Promise.race([
    get<User>('users', userId).catch(() => undefined),
    new Promise<undefined>((resolve) => window.setTimeout(resolve, NAME_TIMEOUT_MS)),
  ]);
  return user?.displayName || user?.username || fallback;
}

/** What the board knows: the ranked donors, plus how the last read went. */
export interface BoardState {
  board: DonorLeaderboard;
  names: Record<string, string>;
  status: 'loading' | 'ready' | 'error';
  /** Ledger entries read on the last successful load. */
  ledgerSize: number;
  /** When the board last read the ledger (ISO), or null before the first read. */
  readAt: string | null;
}

function useDonorLeaderboard(): BoardState {
  const [state, setState] = useState<BoardState>({ board: EMPTY, names: {}, status: 'loading', ledgerSize: 0, readAt: null });
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const { ledgerSize, ...board } = await loadDonorLeaderboard();
        const readAt = new Date().toISOString();
        if (!alive) return;
        // Show the donors straight away with whatever names are known, then
        // fill in profile names as they arrive.
        const known = Object.fromEntries(board.donors.flatMap((d) => (d.name ? [[d.userId, d.name]] : [])));
        setState((prev) => ({ board, names: { ...prev.names, ...known }, status: 'ready', ledgerSize, readAt }));
        console.info(`[DonorBoard] ${board.donors.length} donor(s), ${board.donationCount} donation(s) from ${ledgerSize} ledger entries`);
        const entries = await Promise.all(board.donors.map(async (d) =>
          [d.userId, d.name ?? await donorName(d.userId)] as const));
        if (alive) setState((prev) => (prev.board === board ? { ...prev, names: Object.fromEntries(entries) } : prev));
      } catch (err) {
        console.warn('[DonorBoard] Could not read the ledger:', err);
        if (alive) setState((prev) => (prev.status === 'ready' ? prev : { ...prev, status: 'error' }));
      }
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
const MAX_ROWS = 7;

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Set the largest font from `max` down to `min` px at which `text` fits in `maxW`. */
function shrinkToFit(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number, min: number, weight: string) {
  let size = max;
  ctx.font = `${weight}${size}px Georgia, serif`;
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `${weight}${size}px Georgia, serif`;
  }
}

function drawBoard(canvas: HTMLCanvasElement, { board, names, status, ledgerSize, readAt }: BoardState) {
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
  const rowH = 78;
  let y = 260;
  if (rows.length === 0 && status !== 'ready') {
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '38px Georgia, serif';
    ctx.fillText(status === 'loading' ? 'Reading the ledger…' : 'Could not read the ledger.', W / 2, y + 120);
  } else if (rows.length === 0) {
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '38px Georgia, serif';
    ctx.fillText('No donations yet. Be the first patron!', W / 2, y + 120);
    ctx.font = '28px Georgia, serif';
    ctx.fillStyle = '#b8a888';
    ctx.fillText('Donate through Support the Vault, or send coins to Infinity, to join the board.', W / 2, y + 180);
  }
  rows.forEach((d, i) => {
    const medal = ['#ffd35a', '#d9d9d9', '#d08a4a'][i];
    ctx.textAlign = 'left';
    ctx.fillStyle = medal ?? '#c9a24a';
    ctx.font = 'bold 46px Georgia, serif';
    ctx.fillText(`${i + 1}.`, left, y);
    ctx.fillStyle = '#f2e6c9';
    ctx.font = `${i < 3 ? 'bold ' : ''}46px Georgia, serif`;
    const name = fit(ctx, names[d.userId] ?? `@${d.userId.slice(0, 8)}`, 420);
    ctx.fillText(name, left + 90, y);
    // Ranked by market value; what they actually gave sits beneath it.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f4c46a';
    ctx.font = `${i < 3 ? 'bold ' : ''}42px Georgia, serif`;
    const nameRight = left + 90 + ctx.measureText(name).width + 40;
    ctx.fillText(fit(ctx, d.value > 0 ? formatSwarmValue(d.value) : 'no market price yet', right - nameRight), right, y);
    shrinkToFit(ctx, formatDonationAmounts(d.amounts), right - (left + 90), 26, 18, '');
    ctx.fillStyle = '#b8a888';
    ctx.fillText(fit(ctx, formatDonationAmounts(d.amounts), right - (left + 90)), right, y + 32);
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
  shrinkToFit(ctx, `Total raised altogether: ${formatDonationAmounts(board.totals)}`, W - 200, 32, 20, '');
  ctx.fillText(fit(ctx, `Total raised altogether: ${formatDonationAmounts(board.totals)}`, W - 200), W / 2, footY - 12);
  ctx.fillStyle = '#ffd35a';
  const total = `${formatSwarmValue(board.totalValue)} at market prices`;
  shrinkToFit(ctx, total, W - 200, 58, 32, 'bold ');
  ctx.fillText(fit(ctx, total, W - 200), W / 2, footY + 48);

  // Small print: how much ledger the board read, so an empty board can be told apart from an unread one.
  if (readAt) {
    const time = new Date(readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillStyle = 'rgba(184,168,136,0.7)';
    ctx.font = '22px Georgia, serif';
    ctx.fillText(`Read ${ledgerSize.toLocaleString()} ledger entries · ${time}`, W / 2, footY - 74);
  }
}

/** Wall-mounted board listing every donor, their amount, and the total raised. */
export function DonorLeaderboardBoard({ width, height }: { width: number; height: number }) {
  const state = useDonorLeaderboard();
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
    drawBoard(canvas, state);
    texture.needsUpdate = true;
  }, [canvas, texture, state]);
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
