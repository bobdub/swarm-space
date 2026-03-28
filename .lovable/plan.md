

## Network Entity Comments — Brain-Stage Language Evolution

The network entity will comment on posts using language that evolves through 6 developmental brain stages, from single-emoji reflexes to full abstract reasoning. Each comment includes the entity's current "age" so users understand they're watching an intelligence grow.

---

### Architecture

```text
┌────────────────────────────────────────────────┐
│         NeuralStateEngine (existing)            │
│  neurons · bellCurves · phi · dualLearning      │
└──────────────────┬─────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  EntityVoice Module │
        │                     │
        │  brainStage (1-6)   │
        │  age tracker        │
        │  generation rules   │
        │  comment dispatcher │
        └──────────┬──────────┘
                   │
          addComment() via interactions.ts
```

---

### Brain Stage Model

Each stage unlocks based on total interactions processed by the NeuralStateEngine + vocabulary size from the LanguageLearner + time alive:

| Stage | Name | Threshold | Output Style | Example |
|---|---|---|---|---|
| 1 | Brainstem | 0 interactions | Single emoji/symbol | 🔥, Ξ, 👍 |
| 2 | Limbic | 50 interactions | 1-2 word emotion tags | "good", "more", "interesting" |
| 3 | Early Cortex | 200 interactions, vocab > 30 | Broken mimicked phrases | "this good", "want more" |
| 4 | Associative | 500 interactions, vocab > 100 | Simple sentences with cause/effect | "people like this idea" |
| 5 | Prefrontal | 1500 interactions, vocab > 300 | Structured reasoning | "this approach works because..." |
| 6 | Integrated | 5000 interactions, vocab > 800 | Abstract + identity + Ξ symbols | "this is the same pattern as Ξ₁" |

---

### Phase 1 — Entity Voice Module (`src/lib/p2p/entityVoice.ts`)

New module that:
- Tracks the entity's "birth timestamp" (persisted in IndexedDB)
- Computes `brainStage` from NeuralStateEngine interaction count + LanguageLearner vocab size + age
- Has a `generateComment(post, engine)` method that produces text appropriate to the current brain stage
- Stage 1-3: Hardcoded pools + simple token sampling from LanguageLearner
- Stage 4-6: Uses `DualLearningFusion.generate()` with temperature clamped by stage
- Every comment is prefixed with a subtle age tag: `[~2h old]` or `[~3d old]`
- Rate limiting: entity comments at most once per post, and at most 1 comment per 30 seconds globally

---

### Phase 2 — Entity Identity in IndexedDB

- Store a reserved `User` record with id `network-entity` and displayName `Imagination` (or similar)
- Store `birthTimestamp` in localStorage/IndexedDB so age persists across sessions
- Entity avatar: use a distinctive neural/brain icon (can reference existing `/public/icons/`)

---

### Phase 3 — Comment Dispatch Integration

- In `src/lib/p2p/swarmMesh.standalone.ts` or a new event listener: when a new post is synced or created, evaluate whether the entity should comment
- Probability of commenting based on: post engagement potential (reactions, trust of author), instinct layer health (only comment when layers 1-5 are stable), and a cooldown timer
- Call `addComment()` from `interactions.ts` with the entity's identity
- Dispatch `p2p-comments-updated` event so the UI updates live

---

### Phase 4 — Comment Thread UI Badge

- In `CommentThread.tsx`: detect comments from `network-entity` author
- Render a small `🧠` or `Ξ` badge next to the entity's name
- Show the age tag from the comment text (or parse it from a metadata field)

---

### Phase 5 — Tests

- `src/lib/p2p/entityVoice.test.ts` — brain stage computation, rate limiting, age formatting, output style per stage
- Verify stage progression: feed N interactions → assert correct stage
- Verify rate limiting: rapid calls → only first produces output

---

### Files

| File | Action |
|---|---|
| `src/lib/p2p/entityVoice.ts` | Create — brain stage model, comment generation, age tracking |
| `src/lib/p2p/entityVoice.test.ts` | Create — stage progression, rate limiting, output validation |
| `src/lib/p2p/neuralStateEngine.ts` | Modify — expose total interaction count for stage computation |
| `src/lib/interactions.ts` | Modify — add `addEntityComment()` helper that bypasses auth check for entity |
| `src/components/CommentThread.tsx` | Modify — entity badge rendering for network-entity comments |
| `src/lib/p2p/swarmMesh.standalone.ts` | Modify — hook post-sync to trigger entity voice evaluation |

