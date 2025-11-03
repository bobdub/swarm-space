# 🎮 Dream Match Verification System

This document captures the current implementation of the Dream Match verification flow that ships with the Swarm UI. Use it as the source of truth when making changes to the verification game, medal logic, or proof storage.

## 1. Core Objectives

- Gate or encourage user verification through the Dream Match mini-game.
- Award an entropy-based medal and +1 credit when verification succeeds.
- Persist signed proofs locally so other subsystems (achievements, P2P sync) can trust the outcome.
- Keep the experience inline with existing achievement and medal display surfaces—no bespoke UI panels are introduced.

## 2. User Flows

### New user (required mode)

- Surfaces the `<VerificationModal>` with `isNewUser=true` (skip disabled).
- The modal blocks dismissal until the Dream Match game calls `onComplete` with passing metrics.
- A failure (entropy `< 0.3`) shows a toast error and allows another attempt.

### Legacy user (optional mode)

- `<LegacyUserVerificationPrompt>` runs after authentication and checks `verificationStates` in IndexedDB.
- `canPromptVerification` prevents prompts for verified users and enforces a 24 hour cooldown (`VERIFICATION_COOLDOWN_MS`).
- When a legacy user closes the modal via “I’ll do this later,” `markPromptShown` records the timestamp so the cooldown applies.
- Completion behaves the same as new-user mode but does not block navigation.

## 3. Dream Match Game Mechanics

- 6 cards (3 icon pairs) shuffled via Fisher–Yates.
- Timer: 150 000 ms, updated every 100 ms. When the countdown hits zero, the run ends.
- Mismatch reveal delay: 2 500 ms before cards flip back.
- Tracks metrics required for entropy: mouse movement samples, click timestamps, total flips, completion time, accuracy, and per-card flip counts.
- Detects “repeat” behaviour—flipping the same card ≥ 3 times stores the card id and count for medal evaluation.

## 4. Entropy & Medal Evaluation

- `calculateOverallEntropy` combines mouse movement entropy (60 %) and click interval entropy (40 %).
- Minimum passing entropy is 0.3. Anything lower fails verification and shows an error toast.
- Medal priority (highest match wins):
  1. **Dream Matcher** – accuracy `=== 1.0`, completion `< 60 s`, entropy `> 0.8`.
  2. **Last Reflection** – same card flipped ≥ 3 times (card id recorded for downstream use).
  3. **Patience Protocol** – completion between 90 s and 150 s with entropy `> 0.4`.
  4. **Irony Chip** – fallback when entropy ≥ 0.3.

## 5. Proof Generation & Storage

- `generateVerificationProof` bundles the metrics, medal, credits earned, and public key (when available) into a deterministic payload and signs it with a SHA-256 hash of stable fields plus an entropy digest.
- Proofs and verification state persist in IndexedDB stores:
  - `verificationStates` keeps `verified`, `verifiedAt`, `medal`, prompt status, and attempt count.
  - `verificationProofs` stores the latest proof per `userId` and exposes an index on `timestamp`.
- `markVerified` updates both stores atomically and increments the attempt counter.
- `evaluateAchievementEvent` emits a `credits:earned` event granting +1 credit so the existing achievement/credit system can sync and display the reward.

## 6. Display & Feedback

- Success toast: `${icon} ${title} Unlocked! • +1 credit` using `getMedalInfo` metadata.
- Failure toast on storage/proof errors: “Failed to save verification. Please try again.”
- Loading overlay (“Verifying…”) covers the modal while proofs are generated and persisted.
- Medal presentation downstream relies on existing achievement surfaces; no custom rendering lives in the verification components today.

## 7. Implementation Touchpoints

- `src/components/verification/DreamMatchGame.tsx`
- `src/components/verification/VerificationModal.tsx`
- `src/components/verification/LegacyUserVerificationPrompt.tsx`
- `src/lib/verification/{entropy,medals,proof,storage,types}.ts`
- `src/lib/store.ts` (IndexedDB setup)

## 8. Known Gaps & Action Plan

- **Intermittent proof validation failures.** Improve mouse movement sampling to avoid zero-length vectors, clamp jittery click intervals, and surface a blocking retry overlay when a signature mismatch occurs. Track retries via `verificationStates.attemptCount` so repeated failures can be escalated to telemetry.
- **Timer responsiveness.** Move countdown updates to `requestAnimationFrame` backed scheduling and cache DOM references so the 100 ms cadence stays under budget. Confirm drift is < 250 ms across the full 150 s window before shipping.
- **Medal visibility downstream.** Extend `ProfileAchievementsPanel` to query `verificationStates.medal` and render Dream Match medals with existing badge components. Add a fallback state clarifying when verification is pending.
- **Safe replay / sandbox mode.** Introduce a Settings → “Practice Dream Match” entry that sets `sandbox=true` on the modal. In sandbox mode, skip credit mutation, proof persistence, and medal writes so players can practice without wiping production progress.

## 9. QA & Telemetry Coverage

- Add unit coverage for entropy combinators (`calculateOverallEntropy`, `calculateMovementEntropy`, `calculateClickEntropy`) ensuring boundary thresholds (0.3, 0.4, 0.8) round-trip accurately with recorded metrics.
- Record `verification:attempt` analytics events (fields: `userId`, `mode`, `entropy`, `medal`, `sandbox`) so the product team can audit adoption and failure rates.
- Smoke-test the modal across desktop and touch layouts before each release: verify countdown fluidity, success/failure toasts, and IndexedDB persistence after reload.
