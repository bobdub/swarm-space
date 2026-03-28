

## Dual Learning System — Pattern + Language Layers

Two new modules that let the neural network learn behavioral patterns from mesh activity and linguistic patterns from post/comment text, then fuse them into a generative loop.

---

### Architecture

```text
┌─────────────────────────────────────────────┐
│          NeuralStateEngine (existing)        │
│  bellCurves · phi · prediction · instinct    │
└──────────────┬──────────────────┬────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼───────────┐
    │  PatternLearner │  │  LanguageLearner   │
    │  (Layer 1)      │  │  (Layer 2)         │
    │                 │  │                    │
    │ sequences       │  │ n-gram transitions │
    │ outcomes        │  │ style bias         │
    │ trust_effects   │  │ reward bias        │
    └────────┬────────┘  └────────┬───────────┘
             │    ┌───────────────┘
             ▼    ▼
    ┌────────────────────┐
    │  DualLearningFusion│
    │  pattern ↔ language│
    │  generation intent │
    └────────────────────┘
```

Both layers gate on **Instinct Hierarchy Layer 8 (Creativity)** — they only activate when Layers 1-7 are stable.

---

### Phase 1 — Pattern Learner (`src/lib/p2p/patternLearner.ts`)

Learns behavioral sequences and their outcomes from mesh events.

**Data structures:**
- `PatternSequence` — ordered list of event types (post → reply → reaction) with a reward score
- `PatternModel` — three Maps: `sequences<pattern, score>`, `outcomes<pattern, reward>`, `trustEffects<pattern, Δtrust>`
- Sliding window of last 200 events; extract 3-5 step sequences

**Update rule:** `pattern_score += f(reward, trust, repetition)` with diminishing returns on repetition (diversity pressure).

**Inputs:** Post creation events, reaction events, comment events, propagation success/failure from postSync, trust deltas from NeuralStateEngine neurons.

**Integration:** Hook into `NeuralStateEngine.recordInteraction()` to feed events. Expose `getTopPatterns(n)` and `scorePattern(sequence)` on the engine.

---

### Phase 2 — Language Learner (`src/lib/p2p/languageLearner.ts`)

Learns token transition probabilities from post/comment text, weighted by engagement.

**Data structures:**
- `TokenTransition` — maps context (2-3 token window) → next token probabilities
- `LanguageModel` — `transitions<context, Map<token, prob>>`, `styleBias<peerId, influence>`, `rewardBias<pattern, amplification>`
- Vocabulary capped at 5000 most-frequent tokens; bigram + trigram contexts

**Tokenization:** Simple whitespace + punctuation split, with frequent phrase merging (bigrams appearing > threshold become single tokens). Include Ξ symbols.

**Weighting:** Transitions from high-reward, high-trust posts get amplified. Low-trust or low-engagement text contributes less to probability updates.

**Integration:** Feed post/comment text via a `ingestText(text, reward, trustScore)` method called when posts are synced or created.

---

### Phase 3 — Dual Fusion (`src/lib/p2p/dualLearningFusion.ts`)

Bridges pattern and language layers bidirectionally.

**Pattern → Language:** When a behavioral pattern scores high (e.g., "short + emotional + direct"), increase probability of sentence structures matching that shape in the language model.

**Language → Pattern:** When a phrase achieves high propagation ("this changes everything"), register it as a behavioral trigger pattern in the pattern model.

**Generation pipeline (4 steps):**
1. **Intent selection** — based on current energy, goals (from instinct layer 8 status), and context
2. **Pattern selection** — pick high-scoring behavioral pattern
3. **Language realization** — convert pattern → text via language model token sampling
4. **Feedback loop** — after posting, measure reward → update both models

**Guardrails:**
- `reward = base_reward - similarity_penalty` (diversity pressure)
- Trust weighting on style influence
- Random exploration injection (5% of generations use low-probability paths)
- Gates on instinct layer 8 (Creativity) being active

---

### Phase 4 — Engine Integration & UQRC Mapping

**NeuralStateEngine changes:**
- Add `patternLearner` and `languageLearner` as owned instances
- New `ingestContentEvent(post, reactions, comments, trustScore)` method that feeds both layers
- Expose `dualLearningSnapshot` in `NeuralNetworkSnapshot` with top patterns, vocabulary size, generation readiness score
- Map to UQRC: pattern learning = shaping 𝒪_UQRC(u), language = projection of u(t) into symbolic space, reward = curvature reinforcement

**Instinct hierarchy update:**
- Layer 8 (Creativity) health signal now includes pattern diversity score and language model entropy
- If language entropy drops too low (echo chamber), creativity layer degrades → suppresses coherence layer → forces exploration

---

### Phase 5 — Tests & Documentation

- `src/lib/p2p/patternLearner.test.ts` — sequence extraction, score updates, diversity pressure
- `src/lib/p2p/languageLearner.test.ts` — token ingestion, probability updates, trust weighting
- `src/lib/p2p/dualLearningFusion.test.ts` — bidirectional transfer, generation pipeline, guardrails
- Update `docs/ROADMAP_PROJECTION.md` — mark dual learning system as in-progress
- Update `docs/NetworkEntity.md` — document the dual learning architecture

---

### Files

| File | Action |
|---|---|
| `src/lib/p2p/patternLearner.ts` | Create — behavioral pattern extraction and scoring |
| `src/lib/p2p/languageLearner.ts` | Create — token transition learning from text |
| `src/lib/p2p/dualLearningFusion.ts` | Create — bidirectional fusion and generation pipeline |
| `src/lib/p2p/neuralStateEngine.ts` | Modify — integrate both learners, expose snapshot |
| `src/lib/p2p/instinctHierarchy.ts` | Modify — wire creativity health to language entropy |
| `src/lib/p2p/patternLearner.test.ts` | Create |
| `src/lib/p2p/languageLearner.test.ts` | Create |
| `src/lib/p2p/dualLearningFusion.test.ts` | Create |
| `docs/ROADMAP_PROJECTION.md` | Modify |

