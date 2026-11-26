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
import { DRINKS_MENU } from '@/lib/blockchain/infinity/barTab';

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

const REFRESH_EVENTS = ['blockchain-transaction', 'wallet-tip-updated', 'reward-pool-update', 'swarm-block-mined', 'peer-gift-outcome'];
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
        const { ledgerSize, tipHeight: _height, tipHash: _hash, ...board } = await loadDonorLeaderboard();
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

/** Split " · "-joined amounts into lines no wider than `maxW` at the current font. */
function wrapAmounts(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const piece of text.split(' · ')) {
    const next = line ? `${line} · ${piece}` : piece;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = piece; } else line = next;
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(ctx, l, maxW));
}

function drawBoard(canvas: HTMLCanvasElement, { board, names, status }: BoardState) {
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

  // The board is a record: every donor and exactly what they gave, top patron
  // in pride of place. Empty rows wait for the next patron.
  const footY = H - 90;
  const rowH = 76;
  const lineH = 40;
  // Room for rows above the total, keeping one place for the next patron.
  const bottom = footY - 90 - rowH;
  let y = 262;
  if (board.donors.length === 0 && status !== 'ready') {
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '38px Georgia, serif';
    ctx.fillText(status === 'loading' ? 'Reading the ledger…' : 'Could not read the ledger.', W / 2, y + 120);
    return;
  }
  const medals = ['#ffd35a', '#d9d9d9', '#d08a4a'];
  let shown = 0;
  for (const [i, d] of board.donors.entries()) {
    const top = i === 0;
    ctx.font = `${i < 3 ? 'bold ' : ''}${top ? 50 : 44}px Georgia, serif`;
    const name = fit(ctx, names[d.userId] ?? `@${d.userId.slice(0, 8)}`, 460);
    const nameW = ctx.measureText(name).width;
    // Every coin they gave is listed: shrink a little, then wrap onto more lines.
    const gave = formatDonationAmounts(d.amounts);
    const room = right - (left + 80 + nameW + 40);
    shrinkToFit(ctx, gave, room, top ? 46 : 40, 30, i < 3 ? 'bold ' : '');
    const lines = wrapAmounts(ctx, gave, room);
    const height = rowH + (lines.length - 1) * lineH;
    if (shown > 0 && y + height - rowH > bottom) break;
    const amountFont = ctx.font;
    if (top) {
      // Pride of place: a gilded band behind the top patron.
      const glow = ctx.createLinearGradient(left - 20, 0, right + 20, 0);
      glow.addColorStop(0, 'rgba(255,211,90,0)');
      glow.addColorStop(0.5, 'rgba(255,211,90,0.16)');
      glow.addColorStop(1, 'rgba(255,211,90,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(left - 20, y - rowH / 2 + 4, right - left + 40, height - 8);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = medals[i] ?? '#c9a24a';
    ctx.font = `bold ${top ? 52 : 44}px Georgia, serif`;
    ctx.fillText(top ? '♛' : `${i + 1}.`, left, y);
    ctx.fillStyle = top ? '#ffe9a8' : '#f2e6c9';
    ctx.font = `${i < 3 ? 'bold ' : ''}${top ? 50 : 44}px Georgia, serif`;
    ctx.fillText(name, left + 80, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = medals[i] ?? '#f4c46a';
    ctx.font = amountFont;
    lines.forEach((line, n) => ctx.fillText(line, right, y + n * lineH));
    y += height;
    shown++;
  }
  const maxRows = shown;
  if (board.donors.length > maxRows) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b8a888';
    ctx.font = 'italic 28px Georgia, serif';
    ctx.fillText(`…and ${board.donors.length - maxRows} more generous patrons`, W / 2, y);
  } else {
    // The next open place on the board, inviting the next patron in.
    const place = shown + 1;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(201,162,74,0.55)';
    ctx.font = `bold ${place === 1 ? 52 : 44}px Georgia, serif`;
    ctx.fillText(place === 1 ? '♛' : `${place}.`, left, y);
    ctx.font = 'italic 40px Georgia, serif';
    ctx.fillStyle = 'rgba(232,220,192,0.5)';
    ctx.fillText(place === 1 ? 'Your name here: be the first patron' : 'Your name here', left + 80, y);
    ctx.textAlign = 'right';
    ctx.font = 'italic 28px Georgia, serif';
    ctx.fillText('Donate through Support the Vault', right, y);
  }

  ctx.strokeStyle = 'rgba(201,162,74,0.5)';
  ctx.beginPath(); ctx.moveTo(left, footY - 50); ctx.lineTo(right, footY - 50); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd35a';
  const total = `Total raised: ${formatDonationAmounts(board.totals) || '0 SWARM'}`;
  shrinkToFit(ctx, total, W - 200, 54, 30, 'bold ');
  const totalLines = wrapAmounts(ctx, total, W - 200).slice(0, 2);
  totalLines.forEach((line, n) => ctx.fillText(line, W / 2, footY + 4 + (n - (totalLines.length - 1) / 2) * 38));
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

// ── Drinks menu (chalkboard on the counter) ──────────────────────────

const MENU_CANVAS_W = 768;

function drawDrinksMenu(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#1d2420';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 22;
  ctx.strokeRect(11, 11, W - 22, H - 22);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4e9c8';
  ctx.font = 'bold 56px Georgia, serif';
  ctx.fillText('Drinks', W / 2, 70);
  ctx.fillStyle = '#a8c98a';
  ctx.font = 'italic 26px Georgia, serif';
  ctx.fillText('Order at the bar · put it on the tab', W / 2, 115);
  const left = 60;
  const right = W - 60;
  const rowH = (H - 190) / DRINKS_MENU.length;
  DRINKS_MENU.forEach((d, i) => {
    const y = 160 + rowH * (i + 0.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#efe6cf';
    ctx.font = '34px Georgia, serif';
    ctx.fillText(fit(ctx, d.name, right - left - 170), left, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f4c46a';
    ctx.font = 'bold 32px Georgia, serif';
    ctx.fillText(`${d.price} SWARM`, right, y);
  });
}

/** A small chalkboard propped on the counter, listing the drinks and prices. */
export function DrinksMenuBoard({ width, height }: { width: number; height: number }) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = MENU_CANVAS_W;
    c.height = Math.round(MENU_CANVAS_W * (height / width));
    drawDrinksMenu(c);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  void canvas;
  return (
    <group>
      <mesh position={[0, 0, -0.025]} castShadow>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.03]} />
        <meshStandardMaterial color="#4a3018" roughness={0.8} />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.3} roughness={0.9} />
      </mesh>
    </group>
  );
}
