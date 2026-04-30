/**
 * npcTypes — shared types and constants for the World Brain NPC layer.
 *
 * SCAFFOLD STAGE — pure types. No I/O, no Field access, no scheduler.
 * The whole NPC subsystem is built so that the only world-mutating
 * call site is `BuilderBlockEngine.placeBlock / upgradeBlock /
 * removeBlock`, mirroring the discipline used by builderBlockEngine
 * itself (only writer of pin templates / addBody / removeBody for
 * builder content). This file therefore exports only data shapes.
 *
 * Source-of-truth contract:
 *   - NPCs are biology, not animation. Each is a persistent u(t)
 *     configuration whose body is a graph of compound-validated blocks.
 *   - No two NPCs may share a personality vector within
 *     PERSONALITY_UNIQUENESS_EPS (enforced by npcRegistry).
 *   - Population cap: NPC_CAP. Seed: 5 females + 3 males.
 *   - Default lifespan: NPC_LIFESPAN_YEARS brain-years.
 */
import type { CompoundConstituent } from '@/lib/virtualHub/compoundCatalog';

// ── Population & lifecycle constants ──────────────────────────────────
/** Hard population cap for the World Brain society. */
export const NPC_CAP = 25;
/** Default lifespan in brain-years. */
export const NPC_LIFESPAN_YEARS = 30;
/** Initial seed population — 5 females, 3 males. */
export const INITIAL_FEMALES = 5;
export const INITIAL_MALES = 3;

// ── Personality uniqueness ────────────────────────────────────────────
/** Min Euclidean distance between any two PersonalitySeed vectors. */
export const PERSONALITY_UNIQUENESS_EPS = 0.18;

// ── Smooth-relations reproduction gates ──────────────────────────────
/** Max sustained pairwise commutator norm to count as "harmonic". */
export const HARMONY_EPS = 0.05;
/** Brain-seconds the harmony band must hold before reproduction is allowed. */
export const HARMONY_WINDOW_SECONDS = 600;
/** Per-parent minimum reserve of H₂O + carbon-rich blocks before gestation. */
export const GESTATION_RESERVE = 8;

// ── Identity ──────────────────────────────────────────────────────────
export type NpcSex = 'female' | 'male';

/** Low-noise five-trait personality vector. Components in [-1, 1]. */
export interface PersonalitySeed {
  curiosity: number;
  empathy: number;
  riskTolerance: number;
  inventiveHarmony: number;
  relationalWarmth: number;
}

/** Body slot — one builder block per organ. */
export type NpcSlotKind = 'core' | 'head' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';

export interface NpcBodySlot {
  kind: NpcSlotKind;
  /** Compound-name from compoundCatalog or a real-element-only ad-hoc mix. */
  compoundName: string;
  constituents: CompoundConstituent[];
  mass: number;
  basin: number;
  /** Tangent-plane offset from the NPC anchor (metres). */
  rightOffset: number;
  forwardOffset: number;
  yaw: number;
}

/** Drives — each tick one is selected from gradient utilities. */
export type NpcDrive =
  | 'drink'
  | 'eat'
  | 'hunt'
  | 'fish'
  | 'gather'
  | 'grow'
  | 'craft'
  | 'socialise'
  | 'rest';

/** Skill memory key — `${activity}` or `${activity}:${target}`. */
export type SkillKey = string;

export interface RelationalEdge {
  /** Stable pair id — `min(idA,idB)::max(idA,idB)`. */
  pairId: string;
  /** Welford-smoothed alignment in [0, 1]. */
  alignment: number;
  /** Brain-seconds the pair has stayed inside HARMONY_EPS contiguously. */
  harmonyStreakSeconds: number;
  /** Last update timestamp (epoch ms). */
  updatedAt: number;
}

export interface Npc {
  id: string;
  /** Display name — derived from seed string, never edited. */
  name: string;
  sex: NpcSex;
  seed: PersonalitySeed;
  /** Earth-local anchor where the body-graph is glued. */
  anchorPeerId: string;
  /** Body slots — placed via BuilderBlockEngine. */
  body: NpcBodySlot[];
  /** Skill memory snapshot (sparse). */
  skills: Record<SkillKey, number>;
  /** Brain-years lived so far. */
  ageYears: number;
  /** ISO timestamp of birth. */
  bornAt: string;
  /** Currently-selected drive (UI / inspector hint; engine recomputes). */
  currentDrive?: NpcDrive;
}

/** Read-only event fan-out for renderers / HUDs. */
export type NpcEvent =
  | { type: 'spawn'; npc: Npc }
  | { type: 'despawn'; id: string }
  | { type: 'drive'; id: string; drive: NpcDrive }
  | { type: 'skill'; id: string; key: SkillKey; value: number }
  | { type: 'relation'; pairId: string; alignment: number };