/**
 * personalitySeed — pure helpers for generating and comparing the
 * five-trait NPC personality vector.
 *
 * Determinism: a given input string always produces the same seed.
 * Smoothness: components are drawn from a 4-sample averaged uniform,
 * which gives a low-noise bell over [-1, 1] — no spikes, matches the
 * project's "smooth original personality" requirement.
 */
import type { PersonalitySeed } from './npcTypes';

function hash32(s: string, salt = 0): number {
  let h = (5381 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic, fast, tiny. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/** 4-sample averaged uniform → smoothed bell in [-1, 1]. */
function smoothedBell(rng: () => number): number {
  const u = (rng() + rng() + rng() + rng()) / 4;
  return u * 2 - 1;
}

/** Build a deterministic, low-noise PersonalitySeed from a string. */
export function seedFromString(s: string): PersonalitySeed {
  const rng = mulberry32(hash32(s, 0xA17EC));
  return {
    curiosity: smoothedBell(rng),
    empathy: smoothedBell(rng),
    riskTolerance: smoothedBell(rng),
    inventiveHarmony: smoothedBell(rng),
    relationalWarmth: smoothedBell(rng),
  };
}

/** Component-wise mean of two seeds + small Gaussian-ish drift. */
export function mergeSeeds(a: PersonalitySeed, b: PersonalitySeed, driftSeed: string): PersonalitySeed {
  const rng = mulberry32(hash32(driftSeed, 0xD81F7));
  const drift = () => smoothedBell(rng) * 0.08; // gentle inheritance
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  return {
    curiosity: clamp((a.curiosity + b.curiosity) / 2 + drift()),
    empathy: clamp((a.empathy + b.empathy) / 2 + drift()),
    riskTolerance: clamp((a.riskTolerance + b.riskTolerance) / 2 + drift()),
    inventiveHarmony: clamp((a.inventiveHarmony + b.inventiveHarmony) / 2 + drift()),
    relationalWarmth: clamp((a.relationalWarmth + b.relationalWarmth) / 2 + drift()),
  };
}

/** Euclidean distance between two seeds (for uniqueness checks). */
export function vectorDistance(a: PersonalitySeed, b: PersonalitySeed): number {
  const d0 = a.curiosity - b.curiosity;
  const d1 = a.empathy - b.empathy;
  const d2 = a.riskTolerance - b.riskTolerance;
  const d3 = a.inventiveHarmony - b.inventiveHarmony;
  const d4 = a.relationalWarmth - b.relationalWarmth;
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4);
}

/** Re-roll a seed deterministically until it satisfies a uniqueness predicate. */
export function reseedUntilUnique(
  baseString: string,
  isUnique: (seed: PersonalitySeed) => boolean,
  maxAttempts = 64,
): PersonalitySeed {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = seedFromString(`${baseString}#${i}`);
    if (isUnique(candidate)) return candidate;
  }
  // Cap reached — return the last attempt; registry will still cap population.
  return seedFromString(`${baseString}#${maxAttempts - 1}`);
}