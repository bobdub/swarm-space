# Fix: Rename Builder Mode → Offline Mode in signup

## Intent
Keep the two-choice Network step in signup. Swarm Mesh stays as-is (auto-connect, recommended). The second option is rebranded from **Builder Mode** to **Offline Mode**: the user starts fully offline, explores locally, no P2P dialing, and can later create a custom User Cell from the Node Dashboard on demand.

Builder Mode itself isn't deleted — it remains the engine behind User Cells (per `mem://p2p/builder-mode-standalone` + `mem://features/user-cells`). We're only changing what the *signup choice* means and how it's labeled.

## Stress points
1. `SignupWizard.tsx` step 2 labels the second option "Builder Mode" with copy about "manual peer control / approval queue" — that's User-Cell language, not a starting mode.
2. `createLocalAccount` writes `enabled: true` for both modes, so picking "Builder" still auto-dials. Offline must mean truly offline.

## Plan

### 1. Relabel the second card in `src/components/onboarding/SignupWizard.tsx`
Step 2 layout stays (two cards). Only the second card changes:
- Title: **"Offline Mode"**
- Icon: swap `Settings2` → `WifiOff` (already in lucide-react).
- Color accent: keep current pink `hsl(326,71%,62%)` styling — it visually distinguishes from Swarm teal.
- Copy: *"Start offline and explore locally. No automatic peer connections. You can create a custom User Cell anytime from the Node Dashboard."*
- Internal `NetworkMode` type stays `"swarm" | "builder"` (no churn through the auth layer); only the user-facing strings change. Variable rename optional — leave as `networkMode` to keep the diff small.
- Doc-block at top: update Step 2 description to "Swarm Mesh vs Offline Mode".

### 2. Make Offline actually offline in `src/lib/auth.ts` (`createLocalAccount`, ~line 131)
Replace the unconditional `updateConnectionState({ enabled: true, … })` with mode-aware behavior:
```ts
const startOffline = networkMode === 'builder'; // signup's "Offline Mode"
updateConnectionState({
  enabled: !startOffline,                     // Swarm = on, Offline = off
  mode: 'swarm',                              // mode stays swarm; cells are on-demand
  lastConnectedAt: startOffline ? null : Date.now(),
});
setFeatureFlag('swarmMeshMode', true);        // runtime ready either way
```
Rationale: we don't want to persist `mode: 'builder'` because Builder is the User-Cell engine, not a boot mode. Picking "Offline" simply means "don't auto-enable swarm". The user enables swarm later from the wifi chip, or opens a User Cell from the Node Dashboard — both unchanged.

### 3. Memory update
Append to `mem://architecture/network-mode-persistence`:
> Signup offers two starting modes: **Swarm Mesh** (auto-connect) and **Offline Mode** (boots with `enabled: false`, no auto-dial). Builder Mode is no longer a user-facing starting choice — it remains the engine for on-demand User Cells reached from the Node Dashboard.

## What the user will see
- Signup step 2 still has two cards: **Swarm Mesh** (teal, recommended) and **Offline Mode** (pink, WifiOff icon).
- Picking Offline lands them on `/brain` with the network chip in the off state. No peer dialing happens until they tap to enable Swarm or spawn a User Cell.
- Picking Swarm behaves exactly as today.

## Out of scope
- No changes to `useP2P`, `connectionState` schema, swarmMesh standalone, builder standalone, or User Cells UI.
- No migration for existing accounts.
