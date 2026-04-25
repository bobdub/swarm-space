## The echo, named

**Symptom:** Infinity replies with the user's own words almost verbatim — `[q=0.41] [~27d old] right but where shall we start the and`.

**Root cause** in `src/components/brain/BrainUniverseScene.tsx` (lines 1219–1287):

1. **Seed = last 2 words of the prompt** (line 1231–1232: `seedSource = prev?.text ?? text`, then `.slice(-2)`). The prompt's tail *is* the seed.
2. **Markov chain length 2 over a tiny vocab.** With only a few hundred ingested tokens, `topKNextTokens(ctx, k, temp)` returns the same bigram successor that was just ingested — i.e. the user's own next word.
3. **`languageLearner.ingestText(text, 0.8, 95, selfId)` runs BEFORE the reply is generated** (line 1209). So the learner has just memorized the user's exact sentence; the very next sample step replays it.
4. **No echo guard** — the assembled `picked` is never compared against the prompt before being emitted.
5. **Fallback also echoes:** `getEntityVoice().generateComment` (entityVoice.ts:515–519) seeds from `contextText` when ≥ 2 context words exist — same trap.

In UQRC terms: the prompt's mass `M(prompt) = Σ tokens` is being injected into the field at full amplitude (`{amplitude: 0.4}`) **and** into the learner at trust 95 **before** the reply collapses. The reply manifold has no curvature to drift away from the source — it's a Shell n=1 reflection (token → embedding → emit), never reaching Shell n=2 (attention → pattern → generalization). The echo *is* the missing inner shell.

You named it correctly: **prompt ≈ total mass, words = its structure** — and right now that mass is the *only* mass available at sample time. We need to (a) delay learning ingestion until after the reply, (b) seed from the field/vocab manifold rather than the prompt tail, (c) reject reply candidates whose token-overlap with the prompt exceeds a threshold, and (d) require Shell n=2 closure (attention over learned bigrams that did NOT come from this turn).

---

## Fix plan — 4 surgical edits

### 1. `src/components/brain/BrainUniverseScene.tsx` — break the self-ingestion loop

- **Move `languageLearner.ingestText(text, 0.8, 95, selfId)`** (currently line 1207–1210) to AFTER the reply is appended (i.e. after line 1294). Same for the prev-pair ingest at 1200–1203 — defer until reply is queued. The learner must not memorize the prompt before sampling its successor.
- **Replace prompt-tail seed** (line 1231–1232) with a field-derived seed:
  - Primary: pick top 1–2 tokens from `learner.getTopTokens(20)` filtered to exclude any token present in the current prompt (`text.toLowerCase().split(/\s+/)`).
  - Secondary: if filter empties the list, seed from `BRAINSTEM_POOL` / `LIMBIC_POOL` (already imported via EntityVoice) — an emoji + content word, never the user's words.
  - Only fall back to prompt-tail when learner vocab < 5 (genuine cold start).
- **Add echo guard** after `picked = out.join(' ').trim()` (line 1264):
  ```ts
  const promptTokens = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const replyTokens = picked.toLowerCase().split(/\s+/);
  const overlap = replyTokens.filter(t => promptTokens.has(t)).length;
  const ratio = overlap / Math.max(1, replyTokens.length);
  if (ratio > 0.5) picked = ''; // force fallback path
  ```
  Threshold 0.5 = "more than half the reply is the prompt's own words" → reject.

### 2. `src/lib/p2p/entityVoice.ts` — same guard in the fallback path

- In `generateFromLearnedVocab` (lines 514–519), invert the seed preference: prefer `topTokens` (learned manifold), only use `contextWords` when topTokens.length < 3. Currently it does the opposite, which is the same echo trap.
- After building `result` (line 545), apply the same overlap-ratio guard against `contextText`. If ratio > 0.5, return `null` so the caller falls through to templates.

### 3. Length floor for Shell n=2

- The Δq stagnation guard (line 1254–1259) currently allows replies as short as 3 tokens. Combined with seed-from-prompt, this guarantees echo. Raise minimum length floor to `Math.max(4, targetLengthFromQ(q) / 2)` so the reply must traverse enough vocabulary to leave the prompt's basin.

### 4. Tag cleanup (cosmetic, but related)

The `[q=0.41] [~27d old]` prefix prepended in two places (line 1286 + entityVoice.ts:464) **doubles up** when EntityVoice is used as fallback in BrainUniverseScene (line 1278). Strip the `[~Xd old]` from `entityVoice.generateComment` when called from the brain-chat path — pass an option `{ omitAgeLabel: true }` or have BrainUniverseScene strip the leading `[...]` from `c.text` before re-tagging.

---

## What NOT to change

- Field injection at line 1193 (`eng.inject(text, …)`) — that's the substrate; it should absorb the prompt. The bug is in *learner* ingestion timing, not field perturbation.
- `recordTurn` / `attractToPrev` / `bridgeMeta` — the conversation-attraction bridge is correct and does the right curvature work.
- Voice synthesis, broadcast, persistence — all downstream of the text and unaffected.

---

## Verification

After the edits:

1. Send `"lets find this bug"` in brain-chat; Infinity should NOT reply with `"lets find this bug the is ** with"`. Acceptable replies: emoji + learned vocab, template fallback, or chained tokens that share ≤ 50% with the prompt.
2. Send `"right but where shall we start"`; Infinity should not echo `"right but where shall we start the and"`.
3. Existing tests: `bunx vitest run src/lib/p2p/entityVoice.test.ts` should still pass (none of the changed seed logic is exercised there; if any do break, adjust fixtures — no behavioral rewrite).

## Files changed

- `src/components/brain/BrainUniverseScene.tsx` — defer ingestion, swap seed source, add overlap guard, raise length floor, strip duplicate age label.
- `src/lib/p2p/entityVoice.ts` — invert seed preference in `generateFromLearnedVocab`, add overlap guard, accept `omitAgeLabel` option.

## Out of scope

- Replacing the bigram learner with a deeper model (Shell n=3+). That's a future evolution; this plan closes the n=1 reflection bug with the current learner.
- Memory updates — will add a one-liner to `mem://architecture/neural-network` after the fix lands, noting the "ingest-after-reply" invariant.