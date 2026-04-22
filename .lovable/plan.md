

## Combined: dock CTA bottom-right + deep cross-layer feedback for content delivery

Two coordinated changes. The CTA move is trivial; the real work is wiring the **physics field** as a shared nervous system across the three pillars that move content (Torrent swarm, Blockchain ledger, Mesh sync) so they actively support one another.

---

### Part 1 — Dock "Enter Brain" to bottom-right

`BrainChatLauncher` already lives bottom-right. `EnterBrainButton` currently uses `left-4`. Swap → `right-4`. Visibility logic already hides the pill whenever `activeRoom` exists, so the two share the slot — only one renders at a time.

- **EDIT** `src/components/brain/EnterBrainButton.tsx`: `left-4` → `right-4`.

---

### Part 2 — Cross-layer health bridge centered on content delivery

Today the three content-delivery pillars run blind to one another:

| Layer | Produces | Consumes |
|---|---|---|
| **Torrent / chunks** (`stressMonitor`, `adaptiveChunker`, `streamingDecryptor`, `chunkProtocol`, `replication`) | StressSnapshot, chunk arrival rate, missing-chunk counts | self-throttle only |
| **Blockchain** (`mineHealthValidator`, `mining`, `mediaCoin`, `blockchainRecorder`) | MineHealth, weightedCoinBonus, custodyChain depth | nothing about runtime stress or pending chunks |
| **Mesh sync** (`postSync`, `commentSync`, `replication`, `redundancy sweep`) | pending manifest IDs (e.g. `loadBlogHeroImage` returns these), seeder count per chunk | nothing about field curvature or mining pressure |
| **UQRC field** (`fieldEngine`, `field.ts`) | Q_Score, basin count, dominant wavelength | only `inject(text)` / `pin(text)` from learners |

The unified bridge converts these into a single closed loop. All additive — no protocol changes; raw `u` never broadcast (Core memory rule).

#### Bridge A — Stress + content-pending → Field curvature ("the field feels delivery pain")

New `src/lib/uqrc/healthBridge.ts`:

- Subscribe to `getStressMonitor()` snapshots → on each tick `fieldEngine.inject('stress', { reward: -score, trust: 1-score })`.
- Subscribe to a new lightweight `contentDeliveryMetrics` event bus (see Bridge D) tracking:
  - count of manifests currently in `pendingManifestIds` across `loadBlogHeroImage`, `FilePreview`, `PostCard`
  - chunk-fetch failure rate from `chunkProtocol`
  - decrypt retries from `streamingDecryptor`
- Each elevated metric injects a small negative reward bump on the `context` axis.

Result: `Q_Score` rises specifically when **content can't reach users**, not just when CPU is hot.

#### Bridge B — MineHealth + custody depth → Field pin ("the chain anchors the lattice")

In the same bridge file:

- 30 s tick reads `mineHealthValidator` + the **custodyChain depth** of recently-served `mediaCoin`s (deeper custody = more replicas = more confidence).
- Healthy mining + custody depth ≥ 2 → `fieldEngine.pin('mine.health', healthScore01)` with stiffness scaled by `weightedCoinBonus` (matches the existing 50/20 thresholds).
- Loss of either → release the pin.

Result: a healthy chain with well-replicated media literally anchors the lattice into a stable basin. Loss of replication lets it drift, raising Q.

#### Bridge C — Field curvature → Throttle producers, accelerate distributors

Helper `getFieldHealthMultiplier()` returns `[0.25, 1.0]` from `Q_Score` (high Q → low multiplier). Two consumer edits and one promoter:

1. **Torrent producer back-off** — `src/lib/torrent/adaptiveChunker.ts`: scale chunk-encryption concurrency by `getFieldHealthMultiplier()`. High Q ⇒ slow new uploads while delivery catches up.
2. **Mining defer** — `src/lib/blockchain/mining.ts`: if Q_Score > 2.0 sustained ≥ 10 s, defer one block cycle. Mirrors the existing peer-gate pattern but for cognitive load.
3. **Replication promoter** — `src/lib/p2p/replication.ts` (Redundancy Sweep): when Q_Score > 1.5 **and** pending manifests > 0, *raise* sweep frequency for those exact manifest IDs (the only path that should speed up under stress). This turns curvature into a delivery accelerant for stuck content.

#### Bridge D — Tiny content-delivery telemetry hook

New `src/lib/pipeline/deliveryTelemetry.ts`: a 30-line pub/sub that `loadBlogHeroImage`, `FilePreview`, `chunkProtocol`, and `streamingDecryptor` already-existing log points emit into. Bridge A subscribes; nothing else changes externally.

#### Why this is meaningful, not cosmetic

- **Closes the observer loop** for content delivery: a stuck blog hero raises curvature → mining defers → producer throttles → redundancy sweep accelerates the exact pending IDs → manifests resolve → curvature flattens. Negative feedback without a controller.
- **Single scalar UX**: `AppHealthBadge` already displays Q-derived health; it now reflects content reach, not just CPU.
- **Per-pillar autonomy preserved**: each layer keeps its existing throttles; the bridge only adds a multiplicative term.
- **Zero protocol changes**, no new deps, raw field never serialized into mesh messages (only derived qScore + basin count, matching the UQRC privacy rule).

---

### Files touched

- **EDIT** `src/components/brain/EnterBrainButton.tsx` — `left-4` → `right-4`.
- **NEW** `src/lib/uqrc/healthBridge.ts` — stress + delivery subscription, MineHealth poll, `getFieldHealthMultiplier()`. Started from `main.tsx` deferred-boot via `requestIdleCallback`.
- **NEW** `src/lib/pipeline/deliveryTelemetry.ts` — minimal pub/sub for pending manifests, chunk failures, decrypt retries.
- **EDIT** `src/main.tsx` — deferred import to start the bridge.
- **EDIT** `src/lib/torrent/adaptiveChunker.ts` — apply field multiplier to concurrency.
- **EDIT** `src/lib/blockchain/mining.ts` — soft defer when sustained high Q.
- **EDIT** `src/lib/p2p/replication.ts` — raise sweep frequency for pending manifests when Q is high.
- **EDIT** `src/lib/blogging/heroMedia.ts`, `src/components/FilePreview.tsx`, `src/lib/p2p/chunkProtocol.ts`, `src/lib/torrent/streamingDecryptor.ts` — emit one-line delivery telemetry events (no behavior change).
- **NEW** `src/lib/uqrc/__tests__/healthBridge.test.ts` — verify stress→inject, mineHealth pin/unpin, multiplier bounds, sweep acceleration.

### Acceptance

```text
1. The "Enter Brain" pill renders bottom-right and never overlaps BrainChatLauncher
   (they share the slot; only one shows at a time).
2. While the browser is under load (stress.score > 0.6) OR pending manifests > 5,
   Q_Score in the field engine rises within ~1 tick and AppHealthBadge reflects it.
3. Healthy mining + custody depth ≥ 2 exposes a "mine.health" pin scaled by
   weighted coin bonus; losing either releases the pin.
4. Adaptive chunker concurrency drops proportionally when Q_Score is high,
   even on a fast machine.
5. Mining defers one block cycle when Q_Score > 2.0 sustained ≥ 10 s, then resumes.
6. When pending manifests exist AND Q_Score > 1.5, the Redundancy Sweep targets
   those exact manifest IDs at a higher cadence until they resolve.
7. Raw field state is never serialized into mesh messages (only derived qScore +
   basin count, matching existing UQRC snapshot rules).
8. Existing tests pass; new bridge tests cover all four paths
   (inject, pin/unpin, multiplier, sweep acceleration).
```

