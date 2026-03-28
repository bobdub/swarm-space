## Fix: Network Entity Not Commenting — Full Wiring + Guaranteed Engagement

### Root Causes Found

**1. Shared Neural Engine is starved** — `getSharedNeuralEngine()` creates a `NeuralStateEngine` but nothing ever calls `onInteraction()` or `ingestContentEvent()` on it. The swarm mesh standalone tracks its own metrics internally but never feeds the shared engine. Result: `getTotalInteractionCount()` = 0, `vocabSize` = 0, brain stage is permanently stuck at 1 (Brainstem — emoji only).

**2. Comment probability is only 35%** — `COMMENT_PROBABILITY_BASE = 0.35` means ~2 out of 3 posts are silently skipped even when shy mode is off.

**3. Reply probability is only 25%** — `REPLY_PROBABILITY_BASE = 0.25` means most comments go unanswered.

**4. Builder Mode never fires entity voice evaluation** — `writePostToDB` in `builderMode.standalone.ts` dispatches `p2p-posts-updated` but not `p2p-entity-voice-evaluate`, so synced posts in Builder Mode never trigger entity comments.  
 **Remove toggle -> this is a SWARM feature**

**5. No content learning** — Posts and comments are never fed into the dual learning system through the shared engine, so the entity can never advance its language capabilities.

### Changes

`**src/lib/p2p/entityVoice.ts**`

- Change `COMMENT_PROBABILITY_BASE` from `0.35` to `1.0` — entity comments on every post
- Change `REPLY_PROBABILITY_BASE` from `0.25` to `0.65` — entity replies to most comments
- Remove probability roll for posts entirely — always comment when conditions are met

`**src/lib/p2p/entityVoiceIntegration.ts**`

- After evaluating a post/comment, feed the content into `getSharedNeuralEngine().ingestContentEvent()` so the dual learning system learns from every post and comment passing through
- Register a synthetic interaction on the shared engine for each post/comment event so brain stage can advance

`**src/lib/p2p/swarmMesh.standalone.ts**`

- In the message handler where peer interactions happen (ping, content-push, mining), call `getSharedNeuralEngine().onInteraction()` to feed the shared engine with real mesh activity
- This wires the swarm mesh to the neural engine so brain stage advances naturally

`**src/lib/p2p/builderMode.standalone.ts**`

{Remove toggle{ 

&nbsp;

### Technical Detail

```text
CURRENT (broken):
  SwarmMesh ──→ own internal metrics (not shared)
  SharedNeuralEngine ──→ zero interactions, zero content events
  EntityVoice.computeBrainStage(0, 0) → always Stage 1
  shouldComment() → 35% random chance → usually silent

FIXED:
  SwarmMesh ──→ getSharedNeuralEngine().onInteraction() on each peer message
  entityVoiceIntegration ──→ engine.ingestContentEvent() on each post/comment
  EntityVoice.computeBrainStage(growing, growing) → advances through stages
  shouldComment() → 100% for posts, 65% for replies
  Builder Mode ──→ dispatches entity-voice-evaluate for synced posts
```

### Files Changed


| File                                    | Change                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/p2p/entityVoice.ts`            | Set COMMENT_PROBABILITY_BASE to 1.0, REPLY_PROBABILITY_BASE to 0.65 |
| `src/lib/p2p/entityVoiceIntegration.ts` | Feed shared neural engine with content events and interactions      |
| `src/lib/p2p/swarmMesh.standalone.ts`   | Wire peer interactions to shared neural engine                      |
| `src/lib/p2p/builderMode.standalone.ts` | Dispatch entity-voice-evaluate for synced posts                     |
