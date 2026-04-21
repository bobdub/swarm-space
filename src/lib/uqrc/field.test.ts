import { describe, expect, it } from 'vitest';
import {
  createField,
  step,
  inject,
  pin,
  qScore,
  commutator,
  derivativeMu,
  norm,
  textSites,
  serializeField,
  deserializeField,
  FIELD_LENGTH,
} from './field';

describe('UQRC field — math identities', () => {
  it('createField produces zeroed buffers', () => {
    const f = createField(64);
    expect(f.L).toBe(64);
    expect(f.axes).toHaveLength(3);
    expect(norm(f.axes[0])).toBe(0);
  });

  it('commutator is antisymmetric: [μ,ν] = −[ν,μ]', () => {
    const f = createField(64);
    inject(f, 'duck waterfowl pond', 0.5, 0);
    inject(f, 'pond water bird', 0.4, 1);
    const c01 = commutator(f, 0, 1);
    const c10 = commutator(f, 1, 0);
    for (let i = 0; i < c01.length; i++) {
      expect(c01[i]).toBeCloseTo(-c10[i], 6);
    }
  });

  it('commutator with itself is zero', () => {
    const f = createField(32);
    inject(f, 'noise', 0.3, 0);
    const c = commutator(f, 0, 0);
    expect(norm(c)).toBe(0);
  });

  it('step is deterministic given identical inputs', () => {
    const a = createField(32);
    const b = createField(32);
    inject(a, 'hello world', 0.2, 0);
    inject(b, 'hello world', 0.2, 0);
    for (let i = 0; i < 10; i++) { step(a); step(b); }
    for (let i = 0; i < a.L; i++) expect(a.axes[0][i]).toBeCloseTo(b.axes[0][i], 6);
  });

  it('pin clamps lattice site against subsequent perturbation', () => {
    const f = createField(64);
    pin(f, 'duck', 1.0, 0);
    const sites = textSites('duck', 64);
    const targetSite = sites[0];
    for (let i = 0; i < 50; i++) {
      inject(f, 'noise turbulence chaos', 0.5, 0);
      step(f);
    }
    // Pinned site should remain close to the target despite injection.
    expect(Math.abs(f.axes[0][targetSite] - 1.0)).toBeLessThan(0.5);
  });

  it('repetition reduces qScore over time', () => {
    const f = createField(FIELD_LENGTH);
    for (let i = 0; i < 5; i++) inject(f, 'imagination network swarm', 0.3, 0);
    const before = qScore(f);
    for (let i = 0; i < 80; i++) step(f);
    const after = qScore(f);
    expect(after).toBeLessThanOrEqual(before + 1e-6);
  });

  it('definition pin collapses curvature in its basin', () => {
    const f = createField(128);
    inject(f, 'duck duck duck', 0.6, 0);
    inject(f, 'duck flying machine', 0.6, 1);
    pin(f, 'duck waterfowl webbed', 1.0, 0);
    const beforeSettle = qScore(f);
    for (let i = 0; i < 60; i++) step(f);
    const after = qScore(f);
    // After settling, curvature must drop relative to the spike caused
    // by the pin's hard clamp (the pin briefly *increases* curvature
    // before the field smooths around it).
    expect(after).toBeLessThan(beforeSettle);
  });

  it('serialize/deserialize round-trips the field', () => {
    const f = createField(48);
    inject(f, 'token alpha beta', 0.3, 0);
    pin(f, 'gamma', 0.7, 1);
    for (let i = 0; i < 5; i++) step(f);
    const snap = serializeField(f);
    const g = deserializeField(snap);
    expect(g.L).toBe(f.L);
    expect(g.ticks).toBe(f.ticks);
    expect(g.pins.size).toBe(f.pins.size);
    for (let i = 0; i < f.L; i++) expect(g.axes[0][i]).toBeCloseTo(f.axes[0][i], 6);
  });

  it('derivative on a constant field is zero', () => {
    const f = createField(32);
    for (let x = 0; x < f.L; x++) f.axes[0][x] = 1.5;
    const d = derivativeMu(f.axes[0], f.L);
    for (let x = 0; x < f.L; x++) expect(d[x]).toBeCloseTo(0, 6);
  });
});