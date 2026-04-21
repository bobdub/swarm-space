/**
 * ═══════════════════════════════════════════════════════════════════════
 * ELEMENTS — periodic table as UQRC shell pins
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Third pin layer alongside Galaxy and Earth. Elements organized by
 * shell n (curvature closure level) and azimuthal slot. Same rule as
 * Galaxy/Earth/Infinity: structure is curvature, never a constant force.
 *
 *   n = 0  Boundary    H            single neutral pin at lattice center
 *   n = 1  Shell 1     Li Be B  He   ring r=4 m, 4 slots, He closes loop
 *   n = 2  Shell 2     Na Mg Al Si P  Ne   ring r=7 m, 6 slots, Ne closes
 *   n = 3  Shell 3     K Ca Sc Ti V  Ar   ring r=10 m, 6 slots, Ar closes
 *   n = 4+ Inner       Lanthanide / Actinide   tight spiral basin r=2.5 m
 *
 * Pins go into `pinTemplate` only. Operator's L_S^pin term re-asserts
 * them every tick. Never writes `field.axes` directly.
 */

import {
  pin3D,
  writePinTemplate,
  idx3,
  FIELD3D_AXES,
  type Field3D,
} from '../uqrc/field3D';
import { worldToLattice } from './uqrcPhysics';

export type ElementRole = 'boundary' | 'matter' | 'closure' | 'inner';

export interface ElementSpec {
  id: number;
  symbol: string;
  shell: number;          // n
  slot: number;           // azimuthal index within shell
  glyph: '◯' | '⋯' | '⦿' | '⧉' | '⊘';
  role: ElementRole;
  pinTarget: number;      // base depth/height
  pos: [number, number, number];
}

// Shell radii (m), index = shell n; n=4+ uses INNER_SHELL_RADIUS
export const SHELL_RADII = [0, 4, 7, 10] as const;
export const INNER_SHELL_RADIUS = 2.5;
export const SHELL_Y_OFFSETS = [0, 0.4, -0.3, 0.6] as const;
export const INNER_Y_RANGE = 1.2;

// Pin amplitudes per role
const MATTER_TARGET = 0.45;
const CLOSURE_TARGET = -0.6;
const INNER_TARGET = 0.7;
const BOUNDARY_TARGET = 0.15;

// Falloff radii in lattice cells
const MATTER_FALLOFF = 1.2;
const CLOSURE_FALLOFF = 1.8;
const INNER_FALLOFF = 0.9;
const BOUNDARY_FALLOFF = 1.0;

export interface ShellDef {
  n: number;
  radius: number;
  yOffset: number;
  symbols: string[];      // first N-1 are matter, last is closure (noble gas)
}

// Periodic shells per the poem (subset H..Kr).
export const SHELL_DEFS: ShellDef[] = [
  { n: 0, radius: SHELL_RADII[0], yOffset: SHELL_Y_OFFSETS[0], symbols: ['H'] },
  { n: 1, radius: SHELL_RADII[1], yOffset: SHELL_Y_OFFSETS[1], symbols: ['Li', 'Be', 'B', 'He'] },
  { n: 2, radius: SHELL_RADII[2], yOffset: SHELL_Y_OFFSETS[2], symbols: ['Na', 'Mg', 'Al', 'Si', 'P', 'C', 'N', 'O', 'F', 'Ne'] },
  { n: 3, radius: SHELL_RADII[3], yOffset: SHELL_Y_OFFSETS[3], symbols: ['K', 'Ca', 'Sc', 'Ti', 'V', 'S', 'Cl', 'Cr', 'Fe', 'Ar'] },
];

// Inner-manifold symbols (Lanthanide/Actinide subset; cosmetic + curvature).
export const INNER_SYMBOLS = [
  'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy',
  'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Ac', 'Th', 'Pa', 'U', 'Np',
];

const NOBLE_GAS_SET = new Set(['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn']);

export interface ElementsBuild {
  elements: ElementSpec[];
  innerSpiral: ElementSpec[];
}

/**
 * Deterministic build of the elements catalog. Same seed → same positions
 * across reloads and across peers.
 */
export function buildElements(_seed: number = 0xE1E_BABE): ElementsBuild {
  const elements: ElementSpec[] = [];
  let nextId = 1;

  for (const shell of SHELL_DEFS) {
    if (shell.n === 0) {
      // Boundary H — single pin at the lattice center.
      elements.push({
        id: nextId++,
        symbol: shell.symbols[0],
        shell: 0,
        slot: 0,
        glyph: '⊘',
        role: 'boundary',
        pinTarget: BOUNDARY_TARGET,
        pos: [0, shell.yOffset, 0],
      });
      continue;
    }
    const count = shell.symbols.length;
    for (let s = 0; s < count; s++) {
      const symbol = shell.symbols[s];
      const isNoble = NOBLE_GAS_SET.has(symbol);
      // Spread evenly around the ring, deterministic by slot.
      const theta = (s / count) * Math.PI * 2 + (shell.n * 0.13);
      const x = Math.cos(theta) * shell.radius;
      const z = Math.sin(theta) * shell.radius;
      const y = shell.yOffset;
      let glyph: ElementSpec['glyph'];
      if (isNoble) glyph = '⧉';
      else if (shell.n === 3) glyph = '⦿';
      else if (s % 2 === 0) glyph = '◯';
      else glyph = '⋯';
      elements.push({
        id: nextId++,
        symbol,
        shell: shell.n,
        slot: s,
        glyph,
        role: isNoble ? 'closure' : 'matter',
        pinTarget: isNoble ? CLOSURE_TARGET : MATTER_TARGET,
        pos: [x, y, z],
      });
    }
  }

  // Inner manifold (n ≥ 4) — tight recursive spiral basin near the core.
  const innerSpiral: ElementSpec[] = [];
  const turns = 2.5;
  for (let i = 0; i < INNER_SYMBOLS.length; i++) {
    const t = i / Math.max(1, INNER_SYMBOLS.length - 1);
    const r = INNER_SHELL_RADIUS * (0.4 + 0.6 * t);
    const theta = turns * Math.PI * 2 * t;
    const y = (t - 0.5) * INNER_Y_RANGE;
    const spec: ElementSpec = {
      id: nextId++,
      symbol: INNER_SYMBOLS[i],
      shell: 4,
      slot: i,
      glyph: '⦿',
      role: 'inner',
      pinTarget: INNER_TARGET,
      pos: [Math.cos(theta) * r, y, Math.sin(theta) * r],
    };
    innerSpiral.push(spec);
    elements.push(spec);
  }

  return { elements, innerSpiral };
}

/**
 * Apply elements as pins into the field. Anisotropic per-axis bias
 * (radial outward for matter, inward for closure) so curvature
 * gradients emerge between shells. Mirrors into `field.pins` for
 * serializer parity with galaxy/Earth.
 */
export function applyElementsToField(field: Field3D, build: ElementsBuild): void {
  const N = field.N;

  for (const el of build.elements) {
    const ci = Math.round(worldToLattice(el.pos[0], N));
    const cj = Math.round(worldToLattice(el.pos[1], N));
    const ck = Math.round(worldToLattice(el.pos[2], N));

    const falloff = el.role === 'closure'
      ? CLOSURE_FALLOFF
      : el.role === 'inner'
        ? INNER_FALLOFF
        : el.role === 'boundary'
          ? BOUNDARY_FALLOFF
          : MATTER_FALLOFF;
    const stamp = Math.max(1, Math.ceil(falloff));

    for (let dk = -stamp; dk <= stamp; dk++) {
      for (let dj = -stamp; dj <= stamp; dj++) {
        for (let di = -stamp; di <= stamp; di++) {
          const d2 = di * di + dj * dj + dk * dk;
          const d = Math.sqrt(d2);
          if (d > stamp + 0.5) continue;
          const g = Math.exp(-d2 / (falloff * falloff));
          const flat = idx3(ci + di, cj + dj, ck + dk, N);
          const target = el.pinTarget * g;
          for (let a = 0; a < FIELD3D_AXES; a++) {
            if (el.role === 'boundary') {
              // Isotropic — H is the curvature-free boundary.
              writePinTemplate(field, a, flat, target);
            } else {
              // Anisotropic radial bias so ∇u points inward (closure) or
              // outward (matter ridge). Same recipe as Earth.
              const axisVec = a === 0 ? di : a === 1 ? dj : dk;
              const radial = d > 0 ? axisVec / d : 0;
              const sign = el.role === 'closure' ? -1 : 1;
              const biased = target * (sign * radial * 0.7 + 0.3);
              writePinTemplate(field, a, flat, biased);
            }
          }
        }
      }
    }

    // Sparse mirror at center for legacy serialization readers.
    pin3D(field, 0, ci, cj, ck, el.pinTarget);
  }
}

let _cached: ElementsBuild | null = null;
export function getElements(): ElementsBuild {
  if (!_cached) _cached = buildElements();
  return _cached;
}

/** Centroid of a given shell — for poetic Infinity drift. */
export function centroidOfShell(n: number): [number, number, number] {
  const all = getElements().elements.filter((e) => e.shell === n);
  if (all.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const e of all) { sx += e.pos[0]; sy += e.pos[1]; sz += e.pos[2]; }
  return [sx / all.length, sy / all.length, sz / all.length];
}

export function countByShell(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of getElements().elements) {
    out[e.shell] = (out[e.shell] ?? 0) + 1;
  }
  return out;
}
