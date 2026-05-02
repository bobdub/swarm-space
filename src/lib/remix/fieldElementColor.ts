/**
 * fieldElementColor — derive an element's render color from its base CPK
 * tone modulated by UQRC field dynamics, instead of pinning every element
 * to a static hex.
 *
 * SCAFFOLD STAGE — pure function. Real call-sites (ElementChip,
 * ElementsVisual) opt-in by replacing `entry.color` with
 * `fieldColor(symbol, q)` once the field tick is wired.
 *
 * Mapping:
 *   • Hue       — base CPK hue.
 *   • Saturation — boosted by shell index (deeper shells = denser color).
 *   • Value     — modulated by the local Q-score so high-curvature
 *                 regions glow and quiescent regions desaturate.
 */
import { ELEMENT_COLORS } from '@/lib/virtualHub/compoundCatalog';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)      { r = c; g = x; }
  else if (h < 120){ r = x; g = c; }
  else if (h < 180){ g = c; b = x; }
  else if (h < 240){ g = x; b = c; }
  else if (h < 300){ r = x; b = c; }
  else             { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Field-modulated color for `symbol`.
 * @param symbol  Periodic-table symbol.
 * @param shell   Resonance shell n=0..4.
 * @param q       Local Q-score (curvature + soil mass) in 0..1.
 */
export function fieldColor(symbol: string, shell: number, q: number): string {
  const base = ELEMENT_COLORS[symbol] ?? '#888888';
  const [r, g, b] = hexToRgb(base);
  const [h, s, v] = rgbToHsv(r, g, b);
  // Shell adds saturation depth; q lifts value so high-stress regions glow.
  const sNext = Math.max(0, Math.min(1, s * (0.85 + 0.06 * shell)));
  const vNext = Math.max(0, Math.min(1, v * (0.75 + 0.45 * Math.min(1, q))));
  return hsvToHex(h, sNext, vNext);
}