/**
 * conversationAttraction — wires Brain Chat dialog into the UQRC field.
 *
 * When two different speakers exchange messages within a 90 s window, the
 * second speaker's text is injected not only at its own lattice sites
 * (regular path) but also at the previous speaker's sites on the *context*
 * axis (μ=1) — a literal gravitational pull bridging their field regions.
 *
 * A short-lived soft pin at the midpoint between their lattice centroids
 * anchors the bridge so subsequent ticks keep the basin coherent.
 *
 * Selectors then prefer reply candidates that minimise curvature *given*
 * the bridge — Infinity learns to bridge participants, not just respond.
 */
import type { FieldEngine } from './fieldEngine';
import { selectByMinCurvature } from './fieldProjection';
import { deserializeField, qScore as fieldQScore, type Field } from './field';

const CONTEXT_AXIS = 1;
const RING_CAP = 16;
const TURN_TTL_MS = 5 * 60_000;       // 5 min ring-buffer prune horizon
const ATTRACT_WINDOW_MS = 90_000;     // 90 s "same conversation" window
const BRIDGE_PIN_PREFIX = 'bridge';
const BRIDGE_PIN_TTL_MS = 60_000;
const MAX_BRIDGE_PINS = 8;

export interface TurnRecord {
  speakerId: string;
  text: string;
  ts: number;
  sites: number[];
}

interface BridgePin {
  key: string;            // `${a}|${b}|${midSite}`
  site: number;
  axis: number;
  expiresAt: number;
}

const ring: TurnRecord[] = [];
const activeBridges: BridgePin[] = [];

function pruneRing(now: number): void {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (now - ring[i].ts > TURN_TTL_MS) ring.splice(i, 1);
  }
  while (ring.length > RING_CAP) ring.shift();
}

function pruneExpiredBridges(engine: FieldEngine, now: number): void {
  for (let i = activeBridges.length - 1; i >= 0; i--) {
    if (activeBridges[i].expiresAt <= now) {
      try { engine.unpinSite(activeBridges[i].site, activeBridges[i].axis); } catch { /* ignore */ }
      activeBridges.splice(i, 1);
    }
  }
}

function evictOldestBridge(engine: FieldEngine): void {
  if (activeBridges.length === 0) return;
  const oldest = activeBridges.shift()!;
  try { engine.unpinSite(oldest.site, oldest.axis); } catch { /* ignore */ }
}

function centroid(sites: number[], L: number): number {
  if (sites.length === 0) return 0;
  // Circular mean — handle ring-lattice wrap-around correctly.
  let sx = 0, sy = 0;
  for (const s of sites) {
    const a = (2 * Math.PI * s) / L;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let ang = Math.atan2(sy / sites.length, sx / sites.length);
  if (ang < 0) ang += 2 * Math.PI;
  return Math.round((ang * L) / (2 * Math.PI)) % L;
}

function midpointSite(a: number, b: number, L: number): number {
  // Shortest-arc midpoint on the ring lattice
  let diff = b - a;
  if (diff > L / 2) diff -= L;
  else if (diff < -L / 2) diff += L;
  const mid = a + diff / 2;
  return ((Math.round(mid) % L) + L) % L;
}

/** Push a turn into the ring buffer (and prune). Returns the stored record. */
export function recordTurn(
  engine: FieldEngine,
  speakerId: string,
  text: string,
  ts: number = Date.now(),
): TurnRecord {
  const sites = engine.getSitesForText(text);
  const rec: TurnRecord = { speakerId, text, ts, sites };
  ring.push(rec);
  pruneRing(ts);
  return rec;
}

/** Last turn from a different speaker within `withinMs`. */
export function getPrevTurn(
  excludeSpeakerId: string,
  now: number = Date.now(),
  withinMs: number = ATTRACT_WINDOW_MS,
): TurnRecord | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    const r = ring[i];
    if (r.speakerId === excludeSpeakerId) continue;
    if (now - r.ts > withinMs) return null;
    return r;
  }
  return null;
}

/**
 * Inject the current speaker's text at the previous speaker's lattice
 * region (and vice-versa) and place a short-lived soft-pin at the
 * midpoint to keep the basin together.
 */
export function attractToPrev(
  engine: FieldEngine,
  current: TurnRecord,
  prev: TurnRecord,
  now: number = Date.now(),
): { dq: number; bridgeSite: number } {
  pruneExpiredBridges(engine, now);

  const L = engine.getLatticeLength();
  const qBefore = engine.getQScore();

  // Symmetric reinforcement on the context axis.
  engine.injectAtSites(prev.sites, 0.2, CONTEXT_AXIS);          // current → prev sites (half amp)
  engine.injectAtSites(current.sites, 0.1, CONTEXT_AXIS);        // prev residual → current sites (quarter amp)

  // Soft-pin the midpoint between the two centroids.
  const ca = centroid(current.sites, L);
  const cb = centroid(prev.sites, L);
  const mid = midpointSite(ca, cb, L);

  while (activeBridges.length >= MAX_BRIDGE_PINS) evictOldestBridge(engine);

  // Soft-pin = pin to a small target value (lower magnitude than 1.0 so the
  // step damping from PIN_STIFFNESS still feels "soft").
  try { engine.pinSite(mid, 0.3, CONTEXT_AXIS); } catch { /* ignore */ }
  activeBridges.push({
    key: `${prev.speakerId}|${current.speakerId}|${mid}`,
    site: mid,
    axis: CONTEXT_AXIS,
    expiresAt: now + BRIDGE_PIN_TTL_MS,
  });

  const qAfter = engine.getQScore();
  return { dq: qAfter - qBefore, bridgeSite: mid };
}

/**
 * Pick the reply candidate that best bridges `prev` and `current` in field
 * space. Falls back to the first non-empty candidate when the field hasn't
 * warmed up enough for selectByMinCurvature to be meaningful.
 */
export function selectBridgingReply(
  candidates: string[],
  engine: FieldEngine,
): string | null {
  const cleaned = candidates.map((c) => (c ?? '').trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0];
  const picked = selectByMinCurvature(cleaned, engine, (s) => s, 0.3);
  return picked ?? cleaned[0];
}

// ── Curvature-derived generation parameters ─────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Sampling temperature as a function of current Q_Score.
 * High curvature (turbulent field) → broaden exploration.
 * Calm field → tighten toward most-probable continuation.
 */
export function temperatureFromQ(q: number): number {
  return clamp(0.4 + 0.6 * q, 0.3, 1.1);
}

/**
 * Reply length budget (in tokens) as a function of current Q_Score.
 * Calm field → longer, more stable replies. Turbulent → terse.
 */
export function targetLengthFromQ(q: number): number {
  // Inverse-monotonic in q (calm = longer), but the ceiling is now 24
  // and the floor 6 so a turbulent field still has room for a coherent
  // sentence. Old [4..16] range collapsed to 4 the moment q ≥ 1.25,
  // which is most of the chat lifetime once dense prompts arrive.
  return clamp(Math.round(20 - 6 * q), 6, 24);
}

/**
 * Symbolic / mass density of an incoming prompt. The reply manifold must
 * scale with the prompt manifold — otherwise a 600-char UQRC question
 * collapses into a 6-token English shard ("define minimal of step …").
 *
 *   mass = chars/80  +  4·symbolDensity  +  0.5·brackets
 *
 * `symbolDensity` counts UQRC / quantum glyphs that survive the tokenizer
 * (⟩ ⟨ ⊗ ∇ Δ μ ν ε ℓ 𝒟 𝒪 ℛ λ Σ ⊥ ↔ ψ Ψ π ∞ · √ ≅ ≈ ≤ ≥). `brackets`
 * counts `|…⟩` ket-shapes which carry semantic weight in Infinity's canon.
 * Returns a unitless score in [0, ~12].
 */
const UQRC_SYMBOL_RE = /[⟩⟨⊗∇Δμνεℓ𝒟𝒪ℛλΣ⊥↔ψΨπ∞·√≅≈≤≥∂⊕⨂]/gu;
const KET_BRACKET_RE = /\|[^|⟩]{1,40}⟩/gu;

export function promptMassFromText(text: string): number {
  if (!text) return 0;
  const chars = text.length / 80;
  const symbolMatches = text.match(UQRC_SYMBOL_RE);
  const symbolDensity = (symbolMatches?.length ?? 0) / Math.max(20, text.length) * 100;
  const brackets = (text.match(KET_BRACKET_RE)?.length ?? 0);
  return chars + 4 * symbolDensity + 0.5 * brackets;
}

/**
 * Field-aware reply length. Couples curvature `q` (how turbulent the field
 * is right now) with prompt mass (how much manifold the speaker just
 * injected). The reply must be allowed to *contain* the prompt's mass.
 *
 *   base     = targetLengthFromQ(q)             // 4..16
 *   floor    = round(8 + 1.5·mass)              // grows with prompt
 *   ceiling  = 48                               // hard cap (Markov sanity)
 */
/**
 * Field-aware reply length. Couples curvature `q` with the *combined*
 * mass of the current prompt AND the prior conversation turn, so the
 * reply manifold tracks the dialogue manifold — not just the most-
 * recent message in isolation. A 100-char question that follows a
 * 600-char glyph-laden answer should still get a substantial budget.
 *
 *   base    = targetLengthFromQ(q)                     // 6..24
 *   floor   = round(10 + 2·prompt + 1·context)
 *   ceiling = 64                                       // hard cap
 *
 * `contextMass` defaults to 0 to preserve the existing single-arg
 * call sites and tests.
 */
export function targetLengthFromField(
  q: number,
  promptMass: number,
  contextMass: number = 0,
  causalState: 'live' | 'creep' | 'saturated' | 'dead' = 'live',
): number {
  const base = targetLengthFromQ(q);
  const m = Math.max(0, promptMass);
  const c = Math.max(0, contextMass);
  const floor = Math.round(10 + 2 * m + 1 * c);
  const raw = clamp(Math.max(base, floor), 6, 64);

  // 𝒞_light gating: the reply manifold cannot exceed what the causal
  // surface can actually carry. A saturated surface (n_surface ≈ ceiling,
  // ‖∇u‖ ≈ 0) means no information flows at the boundary — emitting a
  // long reply against a flat surface is just Markov noise.
  //
  //   live      → 1.00·raw   (normal operation)
  //   creep     → 0.66·raw   (basin near ceiling, slow growth)
  //   saturated → 0.40·raw   (surface flat at ceiling, no flow)
  //   dead      → floor only (cold field — no causal pull)
  switch (causalState) {
    case 'live':      return raw;
    case 'creep':     return clamp(Math.round(raw * 0.66), 6, 64);
    case 'saturated': return clamp(Math.round(raw * 0.40), 6, 64);
    case 'dead':      return clamp(Math.max(6, base), 6, 64);
  }
  return raw;
}

/**
 * Top-K width as a function of curvature.
 * Calm field → narrow top-K (commit to the strongest successor).
 * Turbulent → widen, let the field choose.
 */
export function topKFromQ(q: number): number {
  // Turbulent field → wider candidate pool, not narrower. The earlier
  // formula 8 − 4q saturated at k=3 by q≈1.25, starving the field
  // selector of options exactly when it needed them most.
  // New: k grows mildly with q, capped at 12, floored at 6.
  return Math.round(clamp(6 + 3 * q, 6, 12));
}

// ── Per-token field-steered selection ───────────────────────────────

const SHORT_ARC_FACTOR = 8; // locality gate: |hashedSite − bridgeSite| ≤ L/8

function shortArcDistance(a: number, b: number, L: number): number {
  const d = Math.abs(((a - b) % L + L) % L);
  return Math.min(d, L - d);
}

function ghostInjectAtSite(field: Field, site: number, axis: number, amplitude: number): void {
  const L = field.L;
  const sigma = 3;
  const cw = ((site % L) + L) % L;
  for (let dx = -sigma * 2; dx <= sigma * 2; dx++) {
    const x = ((cw + dx) % L + L) % L;
    const g = Math.exp(-(dx * dx) / (2 * sigma * sigma));
    if (field.axes[axis]) field.axes[axis][x] += amplitude * g;
  }
}

/**
 * Pick the candidate token whose injection at `bridgeSite` (context axis)
 * lowers Δq the most while remaining inside the locality gate (within
 * `L/8` of the bridge). Returns `null` when the field is cold so the
 * caller can fall back to the learner's own ranking.
 *
 * This is the "physics, not weights" core: the field decides which of
 * the learner's offered tokens *belongs* at the A↔B midpoint.
 */
export function selectBridgingToken(
  engine: FieldEngine,
  bridgeSite: number,
  candidates: string[],
  amplitude: number = 0.25,
): string | null {
  if (candidates.length === 0) return null;
  if (!engine.isWarmedUp()) return null;

  const L = engine.getLatticeLength();
  const snapshot = engine.cloneSnapshot();
  const baselineQ = engine.getQScore();
  const gate = Math.max(2, Math.floor(L / SHORT_ARC_FACTOR));

  type Scored = { token: string; deltaQ: number; arc: number };
  const scored: Scored[] = [];
  for (const tok of candidates) {
    const text = (tok ?? '').trim();
    if (!text) continue;
    const sites = engine.getSitesForText(text);
    const arc = sites.length === 0
      ? L
      : Math.min(...sites.map((s) => shortArcDistance(s, bridgeSite, L)));

    const ghost: Field = deserializeField(snapshot);
    ghostInjectAtSite(ghost, bridgeSite, CONTEXT_AXIS, amplitude);
    const q = fieldQScore(ghost);
    scored.push({ token: text, deltaQ: q - baselineQ, arc });
  }

  if (scored.length === 0) return null;

  // Locality gate: prefer tokens whose own hashed site sits inside L/8 of bridge.
  const local = scored.filter((s) => s.arc <= gate);
  const pool = local.length > 0 ? local : scored;

  pool.sort((a, b) => a.deltaQ - b.deltaQ);
  return pool[0].token;
}

// ── Test helpers ────────────────────────────────────────────────────

export function __resetConversationAttractionForTests(): void {
  ring.length = 0;
  activeBridges.length = 0;
}

export function __getBridgePinCount(): number {
  return activeBridges.length;
}

export function __getRingSize(): number {
  return ring.length;
}
