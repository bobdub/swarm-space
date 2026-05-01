/**
 * ═══════════════════════════════════════════════════════════════════════
 * EARTH SHELLS — N=0..N=4..N=0 layered radial reference table
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Pure data module. Declares the radial stratigraphy of the planet so
 * sculpting tools (and NPC drives) can answer "what am I cutting through
 * right now?" without consulting the renderer or the field directly.
 *
 * The shells mirror the UQRC closure ladder used everywhere else in the
 * codebase (n = 0 boundary, 1 first resonance, 2 dual-axis, 3 triple,
 * 4 inner spiral). The planet is a *symmetric* stack — boring straight
 * down passes through n=0 → 1 → 2 → 3 → 4 (CENTER) → 3 → 2 → 1 → 0 on
 * the antipode.
 *
 * INVARIANT — this module never touches the field, the physics engine,
 * or any React tree. It is consumed by:
 *   • lavaMantle.ts   — to add per-shell secondary basin minima.
 *   • sculpting.ts    — to look up resistance per layer.
 *   • Tools / NPC AI  — to gate which actions can affect which shell.
 */

import { SHELL_DEFS, INNER_SYMBOLS } from './elements';

/** Closure-shell index from the UQRC ladder. n=4 is the singular CENTER. */
export type ShellN = 0 | 1 | 2 | 3 | 4;

export interface EarthShell {
  /** Stable id, unique across the symmetric stack. */
  id: string;
  /** Display label (e.g. "Grass", "Bedrock", "Lava"). */
  label: string;
  /** Closure shell tier this layer belongs to. */
  n: ShellN;
  /** Inner radius as fraction of EARTH_RADIUS (0..1). */
  rInnerFrac: number;
  /** Outer radius as fraction of EARTH_RADIUS (0..1). */
  rOuterFrac: number;
  /** Bulk density, g/cm³. Contributes to — does not define — resistance. */
  density: number;
  /** Minimum head-sharpness (0..1) a tool needs to make any cut here. */
  sharpnessThreshold: number;
  /** Real elements composing this layer. Validated against elements.ts. */
  elementSymbols: string[];
  /** Side of the stack — 'outer' descending toward the core, 'inner' rising
   *  back to the antipodal surface, 'center' for the singular core point. */
  side: 'outer' | 'center' | 'inner';
}

// ────────────────────────────────────────────────────────────────────────
//  Periodic-table guardrail (mirrors prefabHouseCatalog.ts validator)
// ────────────────────────────────────────────────────────────────────────

const PERIODIC_SYMBOLS: Set<string> = (() => {
  const set = new Set<string>();
  for (const shell of SHELL_DEFS) for (const s of shell.symbols) set.add(s);
  for (const s of INNER_SYMBOLS) set.add(s);
  return set;
})();

function validate(symbols: string[], where: string): void {
  for (const s of symbols) {
    if (!PERIODIC_SYMBOLS.has(s)) {
      throw new Error(
        `[earthShells] Unknown element "${s}" in shell "${where}". ` +
          `Add it to elements.ts SHELL_DEFS / INNER_SYMBOLS first.`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Radial stratigraphy (outer surface → core → antipodal surface)
// ────────────────────────────────────────────────────────────────────────
//
// Fractions chosen so the surface biosphere (n=1) is a thin skin, the
// resource shell (n=2) is the largest carve-able zone, the mantle band
// (n=3) is where heat reads, and n=4 is a singular point. Mirrored on
// the inner half so antipodal travel is seamless.

const OUTER_DESCENT: Omit<EarthShell, 'side'>[] = [
  // n=0 boundary — atmosphere is *outside* EARTH_RADIUS; this entry is
  // kept symbolic at r=1.0..1.06 so sculpting code can name "open air".
  {
    id: 'air_outer',
    label: 'Air',
    n: 0,
    rInnerFrac: 1.0,
    rOuterFrac: 1.06,
    density: 0.0012,
    sharpnessThreshold: 0.0,
    elementSymbols: ['N', 'O'],
  },
  // n=1 surface biosphere
  {
    id: 'grass',     label: 'Grass',       n: 1,
    rInnerFrac: 0.992, rOuterFrac: 1.0,
    density: 0.4,    sharpnessThreshold: 0.05,
    elementSymbols: ['C', 'H', 'O', 'N'],
  },
  {
    id: 'soil',      label: 'Soil',        n: 1,
    rInnerFrac: 0.984, rOuterFrac: 0.992,
    density: 1.3,    sharpnessThreshold: 0.05,
    elementSymbols: ['Si', 'O', 'C', 'H'],
  },
  {
    id: 'dirt',      label: 'Dirt',        n: 1,
    rInnerFrac: 0.972, rOuterFrac: 0.984,
    density: 1.6,    sharpnessThreshold: 0.10,
    elementSymbols: ['Si', 'Al', 'O', 'Fe'],
  },
  {
    id: 'mixed_earth', label: 'Mixed Earth', n: 1,
    rInnerFrac: 0.94, rOuterFrac: 0.972,
    density: 1.9,   sharpnessThreshold: 0.15,
    elementSymbols: ['Si', 'Al', 'Fe', 'Ca', 'O'],
  },
  // n=2 sub-surface resource zone
  {
    id: 'bedrock',   label: 'Bedrock',     n: 2,
    rInnerFrac: 0.85, rOuterFrac: 0.94,
    density: 2.7,   sharpnessThreshold: 0.45,
    elementSymbols: ['Si', 'O', 'Al', 'Fe'],
  },
  {
    id: 'coal',      label: 'Coal Seam',   n: 2,
    rInnerFrac: 0.80, rOuterFrac: 0.85,
    density: 1.4,   sharpnessThreshold: 0.30,
    elementSymbols: ['C', 'H', 'S'],
  },
  {
    id: 'oil',       label: 'Oil Reservoir', n: 2,
    rInnerFrac: 0.76, rOuterFrac: 0.80,
    density: 0.9,   sharpnessThreshold: 0.20,
    elementSymbols: ['C', 'H'],
  },
  {
    id: 'mixed_minerals', label: 'Mixed Minerals', n: 2,
    rInnerFrac: 0.68, rOuterFrac: 0.76,
    density: 3.4,   sharpnessThreshold: 0.55,
    // Cu is not in elements.ts yet; we stick to the symbols already
    // closed by the periodic guardrail. Add Cu later by extending
    // SHELL_DEFS rather than smuggling unknown symbols in here.
    elementSymbols: ['Fe', 'Ca', 'Si', 'O', 'S'],
  },
  {
    id: 'gold',      label: 'Gold Vein',   n: 2,
    rInnerFrac: 0.62, rOuterFrac: 0.68,
    density: 19.3,  sharpnessThreshold: 0.50,
    elementSymbols: ['Fe'], // gold not in elements.ts; use Fe placeholder
  },
  {
    id: 'platinum',  label: 'Platinum',    n: 2,
    rInnerFrac: 0.55, rOuterFrac: 0.62,
    density: 21.4,  sharpnessThreshold: 0.65,
    elementSymbols: ['Fe', 'Ti'],
  },
  // n=3 high-energy mantle transition
  {
    id: 'diamond_upper', label: 'Diamond (Upper)', n: 3,
    rInnerFrac: 0.48, rOuterFrac: 0.55,
    density: 3.5,   sharpnessThreshold: 0.95,
    elementSymbols: ['C'],
  },
  {
    id: 'aquifer',   label: 'Deep Aquifer', n: 3,
    rInnerFrac: 0.42, rOuterFrac: 0.48,
    density: 1.0,   sharpnessThreshold: 0.10,
    elementSymbols: ['H', 'O'],
  },
  {
    id: 'obsidian',  label: 'Obsidian',    n: 3,
    rInnerFrac: 0.38, rOuterFrac: 0.42,
    density: 2.6,   sharpnessThreshold: 0.70,
    elementSymbols: ['Si', 'O', 'Fe'],
  },
  {
    id: 'lava',      label: 'Lava',        n: 3,
    rInnerFrac: 0.20, rOuterFrac: 0.38,
    density: 3.1,   sharpnessThreshold: 1.0, // cannot be cut — burns the tool
    elementSymbols: ['Si', 'Fe', 'Mg', 'O'],
  },
];

const CENTER: Omit<EarthShell, 'side'> = {
  id: 'center',     label: 'CENTER',       n: 4,
  rInnerFrac: 0.0,  rOuterFrac: 0.20,
  density: 12.0,    sharpnessThreshold: 1.0,
  elementSymbols: ['Fe'],
};

function mirror(shell: Omit<EarthShell, 'side'>): Omit<EarthShell, 'side'> {
  return { ...shell, id: `${shell.id}_mirror` };
}

const INNER_RETURN: Omit<EarthShell, 'side'>[] =
  [...OUTER_DESCENT].reverse().map(mirror);

function tag(s: Omit<EarthShell, 'side'>, side: EarthShell['side']): EarthShell {
  validate(s.elementSymbols, s.id);
  return { ...s, side };
}

/** Full symmetric stack from outer atmosphere → core → antipodal atmosphere. */
export const EARTH_SHELLS: EarthShell[] = [
  ...OUTER_DESCENT.map((s) => tag(s, 'outer')),
  tag(CENTER, 'center'),
  ...INNER_RETURN.map((s) => tag(s, 'inner')),
];

/**
 * Look up the shell containing a given radial fraction (0..1, where 1 is
 * `EARTH_RADIUS`). Returns `null` outside the symbolic atmosphere band.
 * The lookup walks the *outer* half only — by convention, callers above
 * the centre use this function and mirror their own results if needed.
 */
export function sampleShellAt(rFrac: number): EarthShell | null {
  if (rFrac < 0) return null;
  for (const shell of EARTH_SHELLS) {
    if (shell.side !== 'outer' && shell.side !== 'center') continue;
    if (rFrac >= shell.rInnerFrac && rFrac < shell.rOuterFrac) return shell;
  }
  // r=0 exact match falls into CENTER.
  if (rFrac === 0) return EARTH_SHELLS.find((s) => s.side === 'center') ?? null;
  return null;
}

/** Test seam — exposes the periodic guardrail without importing privates. */
export function _periodicSymbolsForTest(): Set<string> { return PERIODIC_SYMBOLS; }