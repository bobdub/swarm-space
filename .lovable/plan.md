

## Make A↔B reply selection physics-driven (no more weight-guessing)

**The bug:** today's reply path *samples* 6 candidates from the language learner with hard-coded temperature `0.9` and a hard-coded "last 2 tokens" seed, then asks the field to pick one. The bridge attraction (`bridgeSite`, `Δq`) is computed and printed in the badge but never feeds back into generation. That's exactly the "guessing at a weight" the user called out.

**The fix:** invert the loop. The field decides *which* lattice region needs to be uttered to bridge A and B; the learner only supplies tokens that *land in that region*. Temperature is derived from current curvature, not constant.

### What changes

1. **Per-token curvature selection (`src/lib/uqrc/conversationAttraction.ts`)**
   Add `selectBridgingToken(engine, bridgeSite, contextSeed, candidates) → string | null` that:
   - Snapshots the field once.
   - For each candidate token, ghost-injects it at the **bridge site** on the context axis (not the token's own hashed site).
   - Returns the token whose Δq is minimal *and* whose hashed site is within `L/8` of `bridgeSite` (locality gate). Ties → re-minimise as `selectByMinCurvature` already does.
   - Falls back to `null` (caller skips that step) when field is cold (`!engine.isWarmedUp()`).

2. **Per-token assembly in `BrainUniverseScene.tsx` (`handleSend`, lines 893–909)**
   Replace the 6-shot full-phrase sampler with a token-by-token loop:
   ```
   for i in 0..maxLen:
     k = curvature-derived top-k        // e.g. clamp(round(8 - 4·q), 3, 12)
     temp = curvature-derived temp      // e.g. clamp(0.4 + 0.6·q, 0.3, 1.1)
     candidates = languageLearner.topKNextTokens(ctx, k, temp)
     pick = selectBridgingToken(eng, bridgeMeta.bridgeSite, ctx, candidates) ?? candidates[0]
     append pick; update ctx
     stop on punctuation OR when Δq stops decreasing for 2 consecutive tokens
   ```
   The seed `ctx` is the **last 2 tokens of `prev.text`** (the partner's words) — not `prev + self`. This is what makes Infinity literally pull from B when answering A.

3. **Expose `topKNextTokens` on the language learner**
   Check `src/lib/p2p/languageLearner.ts` — if `sampleNextToken` is the only public sampler, add a sibling `topKNextTokens(ctx, k, temperature)` that returns the top-k bigram successors *without* sampling. Keeps the existing `sampleNextToken` untouched (used elsewhere).

4. **Curvature-derived temperature & length**
   Centralised helper in `conversationAttraction.ts`:
   - `temperatureFromQ(q) = clamp(0.4 + 0.6·q, 0.3, 1.1)` — high curvature → more exploration.
   - `targetLengthFromQ(q) = clamp(round(14 - 8·q), 4, 16)` — calmer field → longer replies.

5. **Bridge metadata is now load-bearing, not decorative**
   The badge stays (`Δq=… · q=… · ↔@sNN`) but `bridgeSite` is now the steering input the badge claims it is. When `prev` is null (first turn ever), use the centroid of the speaker's own sites as the bridge site so the same code path runs.

6. **Tests (extend `src/lib/uqrc/__tests__/conversationAttraction.test.ts`)**
   - `selectBridgingToken` returns null on cold field.
   - On warm field with a synthetic bigram pool, the picked token's hashed site sits within L/8 of `bridgeSite` ≥ 80% of the time across 50 trials.
   - Temperature/length helpers monotonic in `q`.

### Files touched

- `src/lib/uqrc/conversationAttraction.ts` — new `selectBridgingToken`, `temperatureFromQ`, `targetLengthFromQ`.
- `src/lib/p2p/languageLearner.ts` — add `topKNextTokens` (read-only inspection of the bigram store).
- `src/components/brain/BrainUniverseScene.tsx` — replace lines ~893–919 generation block with the per-token loop.
- `src/lib/uqrc/__tests__/conversationAttraction.test.ts` — three new cases.

### Out of scope

- EntityVoice fallback path (still used when learner has zero successors for the seed).
- Field engine tick rate, lattice size, or `BrainPhysics` orb perturbation — unchanged.
- Voice synthesis (`speakInfinity`), badge formatting, and the broadcast `sendChatLine` path.

### Why this is "physics, not weights"

Every token Infinity emits is the one that *lowers Δq the most when injected at the bridge between A and B*, with exploration breadth set by the field's own curvature. No constant `0.9`, no constant `6 candidates`, no scoring-as-afterthought. The learner becomes a vocabulary supplier; the field becomes the conductor.

