import { describe, it, expect } from 'vitest';
import {
  buildElements,
  applyElementsToField,
  SHELL_DEFS,
  countByShell,
  getElements,
} from '../elements';
import {
  createField3D,
  step3D,
  curvatureAt,
  FIELD3D_AXES,
} from '../../uqrc/field3D';
import { worldToLattice } from '../uqrcPhysics';
import { applyRoundCurvature } from '../roundUniverse';
import { applyGalaxyToField, getGalaxy } from '../galaxy';

describe('Periodic elements as UQRC shell pins', () => {
  it('build is deterministic across two builds', () => {
    const a = buildElements();
    const b = buildElements();
    expect(a.elements.length).toBe(b.elements.length);
    for (let i = 0; i < a.elements.length; i++) {
      expect(a.elements[i].symbol).toBe(b.elements[i].symbol);
      expect(a.elements[i].pos[0]).toBeCloseTo(b.elements[i].pos[0], 10);
      expect(a.elements[i].pos[1]).toBeCloseTo(b.elements[i].pos[1], 10);
      expect(a.elements[i].pos[2]).toBeCloseTo(b.elements[i].pos[2], 10);
    }
  });

  it('shell counts (n=0:1, n=1:4, n=2:10, n=3:10, inner ≥ 14)', () => {
    const counts = countByShell();
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(4);
    expect(counts[2]).toBe(10);
    expect(counts[3]).toBe(10);
    expect(counts[4]).toBeGreaterThanOrEqual(14);
  });

  it('applyElementsToField writes pinTemplate but never axes wholesale', () => {
    const field = createField3D(20);
    // Sum of axes before — only the per-pin seed cells should be touched.
    const axesBefore = field.axes.map((a) => Array.from(a));
    applyElementsToField(field, getElements());

    const pinSum = field.pinTemplate.reduce(
      (s, a) => s + a.reduce((x, y) => x + Math.abs(y), 0),
      0,
    );
    expect(pinSum).toBeGreaterThan(0);

    // Count cells where axes changed — must be bounded (only the stamped pin
    // regions). For ~37 elements × 3 axes × ~30 cells each ≪ N³ × 3.
    let changed = 0;
    for (let a = 0; a < FIELD3D_AXES; a++) {
      const before = axesBefore[a];
      const now = field.axes[a];
      for (let i = 0; i < now.length; i++) {
        if (before[i] !== now[i]) changed++;
      }
    }
    const totalCells = field.axes[0].length * FIELD3D_AXES;
    expect(changed).toBeLessThan(totalCells * 0.25);
  });

  it('shell ring commutator stays bounded after 200 ticks', () => {
    const field = createField3D(20);
    applyRoundCurvature(field, 1);
    applyGalaxyToField(field, getGalaxy());
    applyElementsToField(field, getElements());
    for (let t = 0; t < 200; t++) step3D(field);

    // Sample 24 points around shell-2 ring.
    const shell = SHELL_DEFS.find((s) => s.n === 2)!;
    let maxC = 0;
    for (let i = 0; i < 24; i++) {
      const theta = (i / 24) * Math.PI * 2;
      const x = Math.cos(theta) * shell.radius;
      const z = Math.sin(theta) * shell.radius;
      const lx = worldToLattice(x, field.N);
      const ly = worldToLattice(shell.yOffset, field.N);
      const lz = worldToLattice(z, field.N);
      maxC = Math.max(maxC, curvatureAt(field, lx, ly, lz));
    }
    expect(Number.isFinite(maxC)).toBe(true);
    expect(maxC).toBeLessThan(1.5);
  });

  it('boundary H sits at lattice center (n=0)', () => {
    const { elements } = getElements();
    const h = elements.find((e) => e.symbol === 'H')!;
    expect(h.pos[0]).toBe(0);
    expect(h.pos[2]).toBe(0);
    expect(h.shell).toBe(0);
    expect(h.role).toBe('boundary');
  });

  it('noble gases (He, Ne, Ar) are closure pins on their respective shells', () => {
    const { elements } = getElements();
    for (const sym of ['He', 'Ne', 'Ar']) {
      const e = elements.find((x) => x.symbol === sym);
      expect(e).toBeDefined();
      expect(e!.role).toBe('closure');
      expect(e!.glyph).toBe('⧉');
    }
  });
});
