## Username-Anchored Recall for Private Cells

You spotted the open loop: in a User Cell, the owner is dialed by a **frozen peer-id snapshot** (the cellId suffix → padded to a 16-hex peer-id). When the owner's peer-id rotates — new tab, identity recovery, browser restart, mode flip — the dial target is a ghost address. The cell looks alive but can't be re-called.

The fix is what you proposed, and the substrate already exists: `accountSkin.ts` already maintains a live `userId ↔ peerId` directory across the mesh (`account-bind`, `account-query`, `account-resolve` messages). Today, only the SwarmMesh consumes it. User Cells don't. We bind cells to the invariant (`u/username` → `userId`) and resolve to the current `peerId` at dial-time instead of at create-time.

### The invariant chain

```
u/username  →  userId (sha256 of pubkey, never rotates)  →  peerId (rotates freely)
                              ▲                                     ▲
                       the anchor                          the boundary token
                       (stored in cell)                    (resolved on every dial)
```

`userId` is already the never-rotate handle (`src/lib/auth.ts` line 104, computed from the public key). `username` is the user-facing alias that maps to it. `peerId` becomes a cache, not a contract.

### Changes

**1. `src/lib/p2p/userCell.ts` — anchor on userId, not peerId**

- Extend `UserCell` interface with `ownerUserId: string` and `ownerUsername: string`. Keep `ownerPeerId` as a **last-known cache** field (for fast first-dial and offline display), not the source of truth.
- `createUserCell()`: read the local account from `getCurrentAccount()` (auth.ts) and stamp `ownerUserId` + `ownerUsername` onto the cell. `cellId` becomes `u/{username}/{shortHash}` so the share token itself carries the anchor (e.g. `u/alice/a3f2`).
- `joinUserCellById()`: parse the new format. If it starts with `u/`, extract username, look up via `accountSkin.queryAccount(userId)` (or a new `queryByUsername` helper), then dial the resolved live peerId. Fall back to legacy 8hex-4hex format for old shares.
- New helper `dialCellOwner(cell)`: always asks accountSkin for the **current** binding before dialing. If stale, fires `queryAccount` and dials when the resolve event arrives. Updates `cell.ownerPeerId` cache.

**2. `src/lib/p2p/accountSkin.ts` — username index**

- Add `bindAccount` to also accept an optional `username` field on the binding (the protocol message already round-trips arbitrary payloads — small additive change).
- Add `resolveByUsername(username): AccountBinding | null` and `queryByUsername(username): void` that broadcasts an `account-query` with a `queryUsername` field. Existing peers respond if they hold a matching binding.
- Keep userId as the canonical key in the directory Map; username is a secondary index (Map<string, string> username → userId).

**3. `src/lib/auth.ts` — publish username on the binding**

- When the local account is loaded, ensure the SwarmMesh wiring that calls `accountSkin.bindAccount(localUserId, peerId)` also passes `username`. This is a one-line addition at the existing call site (search for `bindAccount(this.localUserId`).

**4. UI surface — observable per SoT §1.1**

- In the cell card / share modal, show `u/username` as the primary handle and the short userId as the technical anchor. Peer-id is hidden by default (it's a cache, not an identity).
- When dial is in flight waiting for a Skin resolve, show a small "locating @username…" badge so the decision is visible in pixels (no silent waiting).

### Backward compatibility

- Legacy cellIds (`8hex-4hex`) still parse and dial the cached peerId path — they just won't survive owner rotation. New shares use `u/username/...`.
- The `accountSkin` protocol additions are additive optional fields; older peers ignore the new `queryUsername` field and only respond to `queryUserId`. New peers respond to both.

### Files touched

- `src/lib/p2p/userCell.ts` — anchor cells on userId+username, resolve peerId at dial-time
- `src/lib/p2p/accountSkin.ts` — add username index + `queryByUsername`/`resolveByUsername`
- `src/lib/auth.ts` — pass username into the existing bindAccount call
- `src/components/p2p/...` (cell card / join modal) — show `u/username`, surface "locating…" state

### Why this closes the loop

Per SoT §0, identity is supposed to be observable, not a hidden snapshot. Today the cellId quietly encodes a peer-id that lies as soon as the owner rotates. After this pass, the cell stores the **invariant** (userId, anchored by the human-readable username), and dial becomes a live UQRC selection over the accountSkin directory — exactly the geodesic the SoT calls for. The username is the boundary surface; the peerId rotation becomes invisible to the caller.