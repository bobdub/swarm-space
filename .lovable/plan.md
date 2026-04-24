## Goal

Validate the recent WebRTC negotiation changes through the existing physics/logic test suites, exercise theoretical-loop edge cases, and remove dead code introduced or orphaned during the past few iterations.

## Steps

### 1. Run focused test suites
- `bunx vitest run src/lib/brain/__tests__/lightspeed.test.ts` — confirm 𝒞_light closure, refractive index, ray tracing, and speed-limit guards still pass.
- `bunx vitest run src/lib/uqrc/conscious.test.ts src/lib/uqrc/state.test.ts src/lib/uqrc/field.test.ts src/lib/uqrc/fieldProjection.test.ts src/lib/uqrc/__tests__/healthBridge.test.ts src/lib/uqrc/__tests__/conversationAttraction.test.ts src/lib/uqrc/__tests__/appHealth.test.ts` — personal knowledge / logic-chain tracking.
- Capture any failures and fix in-place (numeric tolerances or stale fixtures only — no behavioral rewrites without re-planning).

### 2. Theoretical loop + edge case verification (WebRTC negotiation)
Add a small unit test `src/lib/webrtc/__tests__/negotiationLoop.test.ts` that fakes an `RTCPeerConnection` and asserts:
- When `signalingState !== 'stable'`, `createOfferForPeer` sets `negotiationNeeded=true` and does not throw.
- The `finally` block reschedules exactly one retry per pending flag (no runaway loop within a single tick).
- Glare path: impolite peer rejects collision, schedules a follow-up offer, flag clears after success.
- Disconnect path: `negotiationNeeded` entry is cleared on peer removal and on `clear()`.

Also add a guard in `createOfferForPeer`: cap consecutive retries per peer (e.g. 5) and on overflow call existing `attemptRecovery` instead of looping forever. Reset the counter when an offer succeeds. This closes the only unbounded loop identified in the previous discussion.

### 3. Dead code cleanup
Sweep recently-touched files and remove unreferenced symbols:
- `src/lib/webrtc/manager.ts` — drop any leftover `negotiationQueue` references, unused imports, commented blocks from prior iteration.
- `src/lib/p2p/manager.ts`, `src/lib/p2p/userCell.ts`, `src/lib/p2p/accountSkin.ts`, `src/components/p2p/dashboard/UserCellsPanel.tsx`, `src/hooks/useP2P.ts` — run `rg` to find exports/locals with no references and remove.
- Use `bunx tsc --noEmit` after cleanup to confirm nothing breaks.

### 4. Verification
- Re-run the test suites from step 1 plus the new negotiation test.
- Report pass/fail counts and what was pruned.

## Files expected to change
- `src/lib/webrtc/manager.ts` (retry cap + cleanup)
- `src/lib/webrtc/__tests__/negotiationLoop.test.ts` (new)
- Touched p2p/webrtc files only where unused symbols are found

## Out of scope
- Behavioral redesign of negotiation
- Test infrastructure changes
- UI changes
