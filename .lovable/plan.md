

## Unify "Enter Project Universe" and project Live Chat into one inline flow

Today the project page header has **three** stacked actions that all spin up overlapping experiences:

| Button | Modal | Result |
|---|---|---|
| `OpenVirtualHubButton` → "Enter Project Universe" | `VirtualHubModal` (avatar + mic test) | Routes to `/projects/:id/hub` (BrainUniverseScene with static `brain-project-<id>`) |
| `StartLiveRoomButton` → "Start live room" | Title/visibility dialog → `PreJoinModal` (mic test) | Creates a streaming room (UUID) + auto-publishes public ones to feed |
| (in scene) `BrainChatPanel` | — | Voice/chat/promote |

Problems this creates:
- **Two avatar/mic gates** (`VirtualHubModal` and `PreJoinModal`) ask the same questions back-to-back if a user wants to "enter the universe AND go live."
- "Enter Project Universe" lands users in a *different room id* than a Live Chat in the same project, so a member entering the hub doesn't see/hear the live host already broadcasting.
- The Promote-to-feed button only appears when an `activeRoom` is bound. A member who clicks "Enter Project Universe" never gets one even if a teammate is live.

### The inline solution: one button, context-aware

Replace the two separate buttons in `ProjectDetail.tsx` with a single **`ProjectUniverseButton`** that adapts based on whether a live room exists for the project.

#### States

```text
A) No live room in this project
   → Primary:  [ Enter Project Universe ]
   → Secondary (split): [ ▾ Go live ]
   Click primary  → unified PreSpawnModal (avatar + mic) → /projects/:id/hub
   Click "Go live"→ same PreSpawnModal + title/visibility fields
                    → creates room → enters /projects/:id/hub bound to that roomId

B) A live room exists for this project (any member, host or not)
   → Primary:  [ ● LIVE · Join "<title>" ]   (pulsing red)
   → Secondary: [ Enter quietly ]            (joins universe without auto-joining voice)
   Both paths use the SAME PreSpawnModal, then route to /projects/:id/hub
   with roomId = activeRoom.id so chat, voice, and Promote-to-feed all align.

C) The current user IS the host of the active room
   → Primary:  [ ● You're live · Return to room ]
   → Inline pill: [ Promoted ✓ ] or [ Promote to feed ] (re-uses promoteRoomToPost)
```

#### Unified pre-spawn gate

Create `src/components/brain/ProjectUniversePreSpawnModal.tsx` that merges `VirtualHubModal` + `PreJoinModal`:

- Step 1: Avatar (from `AvatarSelector`)
- Step 2: Mic/speaker check (from `DeviceCheckStep`)
- Step 3 (only when "Go live" path): title + visibility (from `StartLiveRoomButton`'s form)
- One "Enter" button at the end. Persists prefs to `swarm-virtual-hub-prefs` exactly like today.

Removes the double-modal experience and gives a single source of truth for "I'm about to step into this project's universe."

#### Live-room awareness in the project header

`ProjectDetail.tsx` already imports `useStreaming`. Use it to find the live room scoped to this project:

```ts
const { activeRoom, listActiveRooms } = useStreaming();
const projectLiveRoom = useMemo(() => {
  const rooms = listActiveRooms?.() ?? (activeRoom ? [activeRoom] : []);
  return rooms.find(r => r.projectId === project.id) ?? null;
}, [activeRoom, project.id]);
```

Pass `projectLiveRoom` into `ProjectUniverseButton` so it can render state A / B / C above.

#### Scene binding stays consistent

`VirtualHub.tsx` already prefers `activeRoom.id` when it matches the project — no change needed; the new flow guarantees the binding is correct because the launcher itself sets that room as active before navigating.

### Files touched

- **NEW** `src/components/virtualHub/ProjectUniverseButton.tsx` — single context-aware button (A/B/C states above).
- **NEW** `src/components/brain/ProjectUniversePreSpawnModal.tsx` — merged avatar + mic + (optional) go-live form.
- **EDIT** `src/pages/ProjectDetail.tsx` — replace `OpenVirtualHubButton` + `StartLiveRoomButton` pair with `ProjectUniverseButton`. Keep `StartLiveRoomButton` available elsewhere (profile page) untouched.
- **EDIT** `src/components/virtualHub/OpenVirtualHubButton.tsx` — keep export but mark legacy; profile/other surfaces still use it until migrated.
- No changes to `BrainUniverseScene`, `BrainChatPanel`, `useStreaming`, or `VirtualHub.tsx` routing logic.

### Acceptance

```text
1. Project header shows ONE primary button instead of two.
2. With no live room: button reads "Enter Project Universe"; a small split menu offers "Go live" (single combined modal).
3. When any member is live in this project: button switches to "● LIVE · Join <title>", pulsing; a secondary "Enter quietly" is offered.
4. Joining via either label routes to /projects/:id/hub bound to the live room's id, so chat history, voice peers, and Promote-to-feed align.
5. The host sees "● You're live · Return to room" plus the Promote-to-feed pill inline (no need to enter the scene to publish).
6. Members never see two stacked avatar/mic dialogs in a row — the pre-spawn modal is single-pass.
7. Public rooms still auto-publish to the feed on creation; private rooms still surface the manual Promote pill.
8. Mobile (≥360 px): primary button truncates the live title with ellipsis and fits within the existing flex-wrap header without overflow.
```

