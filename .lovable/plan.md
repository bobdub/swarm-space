## Root cause

Infinity's reply pipeline is generating **prompt-bound, manifold-blind text**, not a projection of the network's full state. Two concrete defects in the generator:

### Bug 1 — "Small prompts from large mass"

In `src/lib/p2p/dualLearningFusion.ts`:

- `MAX_GENERATION_TOKENS = 30` (hard ceiling, never scales with mass)
- `MIN_OUTPUT_TOKENS_BASE = 5`
- `MAX_GENERATION_TOKENS = 30`
- 2-token seed only

In `src/lib/p2p/entityVoice.ts` `generateComment` / `generateReply`:

- `const maxLen = stage <= 3 ? 60 : stage === 4 ? 100 : stage === 5 ? 160 : 250;`

So even when `vocabSize`, `patternLearner.size`, `basinDepth`, and `fusionStrength` are all large, output is clamped to 30 tokens / 250 chars. Mass is ignored.

### Bug 2 — "No personality or heartbeat"

`GenerationContext` only carries `recentPosts`, `currentEnergy`, `creativityActive`, `explorationForced`, `temperatureModifier`. The generator:

- Seeds from `context.recentPosts[0]` (the user's words).
- Never reads `getInfinityProjection(engine)` → `{ awareness, empathy, coherence, intent, phase }`.
- Never reads `getLastInfinitySnapshot()` → `{ qScore, commutatorNorm, entropyNorm, gradientMag, basinDepth, position }` (the **heartbeat**).
- Never reads `INFINITY_CANON` signature tokens (`|Ψ_Infinity⟩`, `ℓ_min`, `𝒪_UQRC`, `Q_Score`, `Ember`, …) as priority seeds.
- Never reads `deriveUqrcPersonalityState` (intent / engagement / cooperation / stability scores).

Net effect: the prompt the Markov chain actually walks does not stress the full manifold — it stresses a 2-token slice of the user's last message.

---

## Fix

Three coordinated changes — minimal surface, no new physics.

### A. Extend `GenerationContext` with personality + heartbeat (`dualLearningFusion.ts`)

Add optional fields:

```ts
interface GenerationContext {
  // ...existing...
  personality?: {
    awareness: number;   // 0..1
    empathy: number;
    coherence: number;
    intent: number;      // creativity layer
    phase: string;       // e.g. 'integrated'
  };
  heartbeat?: {
    qScore: number;
    basinDepth: number;
    gradientMag: number;
    commutatorNorm: number;
    entropyNorm: number;
  };
  /** Canon signature tokens to bias seed selection toward Infinity's voice. */
  signatureTokens?: string[];
  /** Mass score 0..1 — drives token budget. */
  massScore?: number;
}
```

### B. Make output budget scale with manifold mass (`dualLearningFusion.ts`)

Replace the hard 30-token cap with a mass-scaled budget:

```ts
const baseMax = 30;
const massBoost = Math.round(baseMax * 4 * (context.massScore ?? 0)); // up to +120
const maxTokens = Math.min(180, baseMax + massBoost);
```

Where `massScore` is computed once in `generate()` from already-available signals:

```
massScore = 0.25 * tanh(vocabSize / 400)
          + 0.25 * tanh(patternLearner.size / 60)
          + 0.20 * fusionStrength
          + 0.15 * clamp(basinDepth / 1.5)
          + 0.15 * (1 - clamp(qScore))
```

Mirror the change in `entityVoice.generateComment` / `generateReply`:

```ts
// stage cap × mass multiplier (1.0 .. 4.0)
const stageCap = stage <= 3 ? 60 : stage === 4 ? 100 : stage === 5 ? 160 : 250;
const massMult = 1 + 3 * massScore;
const maxLen = Math.round(stageCap * massMult); // up to ~1000 chars when mass is full
```

### C. Inject personality + heartbeat into seed and temperature

In `generateText`:

1. **Seed enrichment** — prepend up to 2 `signatureTokens` (filtered to those actually in vocabulary via `getTopTokens`) before the prompt-derived seed. This stresses the canon basin every reply.
2. **Phase / intent → exploration** — if `personality.intent > 0.6` or `personality.phase === 'integrated'`, add `+0.05` to exploration rate.
3. **Heartbeat → temperature** — multiply temperature by `(1 + 0.4 * (1 - clampedQScore))` so a calm field produces longer, more flowing chains and a turbulent one tightens.
4. **Personality → length floor** — `minTokens = max(minTokens, round(8 * awareness + 4 * coherence))` so a high-awareness Infinity never emits a 5-token shrug.

In `entityVoice.generateComment` and `generateReply`, build the personality + heartbeat blocks once and pass them in:

```ts
const projection = getInfinityProjection(engine);     // already exists
const heart = getLastInfinitySnapshot();              // already exists
const signatureTokens = ['|Ψ_Infinity⟩','ℓ_min','𝒪_UQRC','F_μν','Q_Score','Ember'];

const generated = fusion.generate({
  recentPosts: [post.content ?? ''],
  currentEnergy: snap.averageEnergy / Math.max(1, snap.totalNeurons),
  creativityActive: projection.intent,                // already 0..1
  explorationForced: Math.random() < 0.3,
  temperatureModifier: phiTemp,
  personality: projection,
  heartbeat: heart ?? undefined,
  signatureTokens,
});
```

### D. Tests

Extend `src/lib/p2p/dualLearningFusion.test.ts` with two cases:

1. With `massScore = 1`, `generate()` returns text whose token count exceeds the legacy 30-token ceiling.
2. With `signatureTokens = ['|Ψ_Infinity⟩']` present in vocab, the generated text contains at least one signature token at least 30 % of the time over 50 trials.

Run `bunx vitest run src/lib/p2p/dualLearningFusion.test.ts src/lib/p2p/entityVoice.test.ts` plus the brain suite to confirm no regression.

---

## Files touched

- `src/lib/p2p/dualLearningFusion.ts` — new context fields, mass-scaled `MAX_GENERATION_TOKENS`, signature-token seeding, heartbeat-modulated temperature, awareness-floored `minTokens`, `massScore` helper.
- `src/lib/p2p/entityVoice.ts` — pass `personality` (`getInfinityProjection`), `heartbeat` (`getLastInfinitySnapshot`), `signatureTokens`, and a `massScore` into `fusion.generate()`; replace the hard `maxLen` with the mass-scaled cap.
- `src/lib/p2p/dualLearningFusion.test.ts` — two new tests (mass scaling + signature seeding).

No physics changes, no new operators, no neural-engine changes. The field, canon, and projection APIs already exist; we only stop ignoring them.