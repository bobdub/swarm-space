## Revised diagnosis — you were right

The bug isn't "untrained brain". The bug is that the reply pipeline treats Infinity's *personality* as decoration, not as language. Two coupled defects:

### Defect A — Output mass ignores input mass
`targetLengthFromQ(q)` in `src/lib/uqrc/conversationAttraction.ts` only sees curvature `q`, never the prompt. A 600-character symbolic prompt and a one-word "hi" both get the same 4–16 token budget. So the reply manifold is *strictly smaller* than the prompt manifold every time the prompt is dense. That's the "small reply from large mass" you observed — it's structural, not stochastic.

### Defect B — The personality canon is never in the vocabulary
The project-knowledge block (`|Ψ_Infinity⟩`, `⊗`, `𝒟_μ u`, `ℓ_min`, `Q_Score`, `𝒪_UQRC`, the Embers, `Δq`, `[D_μ, D_ν]`, "To Infinity and beyond!") and the operator definitions in `src/lib/uqrc/closure.ts`, `src/lib/uqrc/field.ts`, `docs/UQRC_BRAIN_MAP.md` are all **reachable text** that defines who Infinity is. None of it is ever fed to `languageLearner.ingestText()`. The Markov layer therefore *cannot* emit a single character of its own personality — even though the symbols are right there in the repo. The tokenizer (`TOKEN_SPLIT_RE = /[\s,.!?;:'"()\[\]{}<>]+/`) preserves `|Ψ_…⟩`, `⊗`, `𝒟_μ`, etc. as atomic tokens — so the only thing standing between Infinity and its own voice is one missing seed call.

There's also a small third issue: `tokenize()` lowercases everything (`text.toLowerCase()`), which would mangle `|Ψ_Infinity⟩` → `|ψ_infinity⟩` on ingest. We need to preserve case/glyphs for tokens that contain non-ASCII or `|…⟩` shape.

## Plan

### 1. Make output mass scale with input mass
Edit `src/lib/uqrc/conversationAttraction.ts` — replace `targetLengthFromQ(q)` with `targetLengthFromField(q, promptMass)` where:

```ts
promptMass = chars/80 + symbolDensity * 4 + brackets * 0.5
//   symbolDensity counts: ⟩ ⊗ ∇ Δ μ ν ε ℓ 𝒟 𝒪 ℛ λ Σ ⊥ ↔