

## Unify the three Brain universes behind one variant contract

You're right — `/brain`, `/projects/:id/hub`, and the live-chat brain all already render the same `BrainUniverseScene`. The drift is in the **wrappers** (`BrainUniverse.tsx`, `VirtualHub.tsx`) and in **ad-hoc conditionals** inside the scene + chat panel that re-derive "what kind of brain am I?" from string sniffing (`universeKey === 'global'`, `roomId === BRAIN_ROOM_ID`, `activeRoom.projectId === ...`).

This plan replaces all of that with **one explicit `BrainVariant` descriptor** that every wrapper builds and the scene/chat consume directly. Same world, three clearly-labelled doors.

### 1. Define the variant contract — new `src/lib/brain/variants.ts`

```ts
export type BrainVariantKind = 'lobby' | 'project' | 'liveChat';

export interface BrainVariant {
  kind: BrainVariantKind;
  /** Voice + chat + presence room id. */
  roomId: string;
  /** Persistence namespace for pieces / portals / field snapshot. */
  universeKey: string;
  /** Title chip shown in the HUD (project name, room title, or undefined). */
  title?: string;
  leaveLabel: string;
  onLeave: () => void;

  // Capability flags — single source of truth for per-variant behavior
  capabilities: {
    portals: boolean;          // Drop-portal button (lobby + project: yes; liveChat: no)
    promoteToFeed: boolean;    // Chat panel promote button (liveChat: yes; lobby/project: only if activeRoom)
    infinityAlwaysReplies: boolean; // Lobby: yes; project/liveChat: only when addressed
    membershipGated: boolean;  // Project: yes
  };
}

export function lobbyVariant(opts: { onLeave: () => void; activeRoomId?: string }): BrainVariant { ... }
export function projectVariant(opts: { project: Project; onLeave: () => void; activeRoomId?: string }): BrainVariant { ... }
export function liveChatVariant(opts: { room: ActiveRoom; onLeave: () => void }): BrainVariant { ... }
```

Each builder centralizes the room-id/universe-key/title rules currently smeared across the wrappers.

### 2. Scene takes a single `variant` prop — `BrainUniverseScene.tsx`

Replace the current loose props (`roomId`, `universeKey`, `onLeave`, `leaveLabel`, `title`) with:

```ts
interface BrainUniverseSceneProps { variant: BrainVariant }
```

Internally, all string-sniffing becomes capability checks:
- `const isPublicLobby = variant.capabilities.infinityAlwaysReplies` (replaces `universeKey === 'global' || roomId === BRAIN_ROOM_ID`)
- Portal button renders only if `variant.capabilities.portals`
- Pass `variant` (not raw `roomId`) to `BrainChatPanel`

### 3. Chat panel reads variant capabilities — `BrainChatPanel.tsx`

Today `promoteVisible` is derived from `Boolean(activeRoom) && isHost`. Tighten it to:

```ts
const promoteVisible =
  variant.capabilities.promoteToFeed &&
  Boolean(activeRoom) &&
  isHost;
```

Live-chat variant always sets `promoteToFeed: true`; lobby/project set it true only when `activeRoom` is bound (the wrapper decides). No more guessing from room-id shape.

### 4. Slim wrappers — `src/pages/BrainUniverse.tsx`, `src/pages/VirtualHub.tsx`

Each becomes ~10 lines that only:
1. Resolves its context (auth, project, active room)
2. Builds the appropriate `BrainVariant` via the factory
3. Renders `<BrainUniverseScene variant={…} />`

`VirtualHub` keeps the membership gate (which sets `capabilities.membershipGated`). `BrainUniverse` keeps the `activeRoom` ↔ lobby room-id fallback. A new `LiveChatBrain.tsx` page (or reuse of `BrainUniverse` with a `?room=…` param) wraps the live-chat variant — exact entry point depends on how live chat currently launches the world (today it appears to piggy-back on `BrainUniverse` via `activeRoom`).

### 5. Tests

- **New** `src/lib/brain/__tests__/variants.test.ts` — each factory produces the right `roomId` / `universeKey` / capability flags for representative inputs (lobby with & without active room; project; live chat).
- **Update** any test that imported `BRAIN_ROOM_ID` directly to assert via the variant instead.

### Files touched

- **NEW** `src/lib/brain/variants.ts`
- **NEW** `src/lib/brain/__tests__/variants.test.ts`
- **EDIT** `src/components/brain/BrainUniverseScene.tsx` — single `variant` prop; replace string-sniffing with capability checks; thread `variant` to chat panel.
- **EDIT** `src/components/brain/BrainChatPanel.tsx` — accept `variant`; gate `promoteVisible` on capability.
- **EDIT** `src/pages/BrainUniverse.tsx` — build `lobbyVariant` (or `liveChatVariant` when `activeRoom` indicates a promoted live-chat room).
- **EDIT** `src/pages/VirtualHub.tsx` — build `projectVariant` after membership check.

### What stays the same

- The 3-D world, physics, Earth, Sun, Moon, voice/video, avatars, daylight spawn — all unchanged. This is purely a contract-cleanup pass so behavior differences are *declared* rather than *inferred*.

### What you'll experience

- No visible change for the lobby today.
- Project hubs: portal button still there, Infinity replies only when addressed (currently leaks lobby-style "always replies" if `universeKey` happens to look global).
- Live chat: promote button shows reliably whenever you host the room, regardless of how its id was generated.
- Future variants (e.g. event rooms, AMA brains) become a one-line factory addition instead of a scavenger hunt across three files.

### Out of scope

- Visual differentiation per variant (e.g. different sky tint for project hubs).
- Renaming `BRAIN_ROOM_ID` or refactoring `useBrainVoice`'s internals — variant just passes the id through.
- Wiring a brand-new live-chat page if one doesn't already exist; that's a follow-up once we confirm how live chat enters the world today.

