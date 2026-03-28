

## Add "Shy Node" Toggle — Suppress Entity Comments Without Trust Penalty

A simple localStorage-persisted toggle that prevents the network entity from commenting on the local node's posts. Default: **shy (on)**. No trust score impact.

---

### How It Works

The entity voice integration already checks `shouldComment()` before generating. We add a "shy node" check at the top of that gate — if shy mode is active, the entity never comments locally. The node still participates fully in the mesh (no trust penalty, no connection changes). It simply opts out of receiving entity comments.

---

### Changes

**1. `src/lib/p2p/entityVoice.ts`**
- Add `getShyMode(): boolean` and `setShyMode(v: boolean): void` — backed by localStorage key `entity-voice-shy-node`, defaulting to `true` (shy by default)
- In `shouldComment()`, return `false` immediately if shy mode is active

**2. `src/lib/p2p/entityVoiceIntegration.ts`**
- Import and check `getShyMode()` before calling `evaluateAndComment()` as an early exit (belt-and-suspenders with the check inside `shouldComment`)

**3. `src/components/p2p/dashboard/SwarmMeshModePanel.tsx`**
- Add a "Shy Node" toggle (Switch component) under existing controls
- Label: "Shy Node" with description "Hide network entity comments on your posts"
- Reads/writes via `getShyMode()`/`setShyMode()`

**4. `src/components/p2p/dashboard/BuilderModePanel.tsx`**
- Same "Shy Node" toggle in the Builder Mode panel for consistency

---

### Key Details

- **Default is shy (true)** — new users won't see entity comments until they opt in
- **No trust impact** — the toggle only suppresses local comment generation; it doesn't change peer scoring, connection quality, or instinct hierarchy signals
- **Existing entity comments remain** — toggling shy mode doesn't delete past entity comments, it only prevents new ones

