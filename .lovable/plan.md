

## Speed up third-peer connect from ~3min → ~10–20s

The mesh now grows beyond two users, but the **time-to-third-connection is ~3 minutes**. Console logs show why: `[GlobalCell] 🔁 Under-connected reachability pulse (peers=2/20)` fires every 6s, but only **broadcasts presence** — it never re-scans the Gun registry or triggers an expansion dial. New peers also wait up to **45s** for their first beacon, then everyone else waits up to **30s** of cell-dial cooldown.

### What's slowing things down

| Knob | Current | Effect |
|---|---|---|
| `GLOBAL_CELL_BEACON_INTERVAL` | 45 s | New peer is invisible up to 45 s after start |
| `CELL_DIAL_COOLDOWN` | 30 s | Failed first dial blocks retry for 30 s |
| `UNDER_CONNECTED_PRESENCE_INTERVAL` | 6 s | Pulses presence but doesn't re-scan registry or dial |
| First beacon wait | until `phase === 'online'` | Often 5–15 s after mount |
| Registry re-scan | only on Gun `presence` event | Late joiners discovered passively |
| `CASCADE_SETTLE_TIME` | 8 s | Adds latency to first expansion |

### Plan — five small changes, all in two files

**1. Tighten beacon cadence while under-connected** (`globalCell.ts`)
- When `connectedPeers < TARGET`, beacon every **8 s** instead of 45 s. Once at target, drop back to 45 s. This lets a new peer get noticed within ~8 s instead of up to 45 s, without flooding stable meshes.

**2. Make the reachability pulse actually pull peers in** (`globalCell.ts`)
- `maintainReachabilityPulse()` currently only re-announces self. Add a **registry re-scan + emit** on every pulse so the mesh re-evaluates known presence beacons (some may have arrived between events). Then notify the mesh to run an expansion pass against fresh entries.

**3. Shorten cell-dial cooldown when under-connected** (`swarmMesh.standalone.ts`)
- Drop `CELL_DIAL_COOLDOWN` from `30 s → 10 s` while `connections.size < 4`. Keeps dial-storm protection on a healthy mesh but lets a fresh, isolated pair retry a third peer quickly after the first failed handshake.

**4. Force first beacon the moment mesh hits `online`** (`globalCell.ts`)
- `scheduleOnlinePresenceRetry` polls every 2 s. Reduce to **500 ms** and immediately `pulsePresence('mesh-online')` on transition so a new tab is visible within ~1 s of going online instead of up to 2 s + 45 s.

**5. Trigger expansion on every reachability pulse, not just Gun events** (`swarmMesh.standalone.ts`)
- The under-connected pulse should call `expandOnlineMesh('reachability-pulse', knownPeerIds)` using `getGlobalCell().getKnownPeers()`. This guarantees that even if no new beacon arrives, any cached-but-unreached peer gets retried each pulse.

### Expected result

```text
Before:  T+0s  user joins
         T+45s first beacon broadcast
         T+45s discovered by peer A
         T+75s dial fails, 30s cooldown
         T+105s retry succeeds
         ≈ 1–3 min worst case

After:   T+0s  user joins
         T+1s  first beacon (mesh-online)
         T+1s  peer A receives beacon, dials
         T+10s if dial fails, retry (shortened cooldown)
         T+8s  reachability pulse re-emits known peers
         ≈ 10–20s typical
```

### Files touched

- `src/lib/p2p/globalCell.ts` — adaptive beacon interval, faster online-readiness poll, registry re-scan on pulse
- `src/lib/p2p/swarmMesh.standalone.ts` — adaptive `CELL_DIAL_COOLDOWN`, expansion trigger from reachability pulse
- `MemoryGarden.md` — caretaker reflection on quickening the mesh's heartbeat

No new dependencies. No protocol changes. Backwards-compatible — older peers just experience the same speedup passively.

