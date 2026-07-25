# Share Links: Guest Auto-Connect + Content Fallback

Goal: When someone opens a `?peerID=…-preview[&postID=…]` link they should immediately experience the network — mesh starts in the background as a **Guest**, content loads if any peer has it, and live network stats prove the mesh is alive — even before they sign up.

Today the invite page only shows the "Create Free Account" wall for unauthenticated visitors and does nothing in the background. Authenticated visitors do connect, but only to the original sharer, with no fallback.

## Flow

```text
click share link
   │
   ▼
/preview page renders invitation UI immediately
   │
   ├─► Guest mesh boot (background, no account required)
   │       └─ start P2P read-only, no identity persisted
   │
   ├─► Parse peerID + postID from URL
   │
   ├─► Attempt direct dial to original peer  ── success ──► sync post ──► render inline
   │        │ timeout ~8s
   │        ▼
   ├─► Ask public cells: "who has postID X?"
   │        └─ any peer answers ─► connect ─► sync ─► render with "Hosted by @handle"
   │
   ├─► Live stats poll (every 3s while searching)
   │       • active peers online
   │       • peers hosting this content
   │       • "Join now to help share"
   │
   └─► If still no host after 30s ─► keep searching quietly, show invite CTA
```

## Changes

### 1. Guest mesh boot

- New `src/lib/p2p/guestMode.ts`: `startGuestMesh()` — spins up the P2P layer with a throwaway peer id, `readOnly: true`, no IndexedDB writes to identity stores. `stopGuestMesh()` on unmount or on sign-up handoff.
- Wire into `Preview.tsx`: call `startGuestMesh()` inside a `useEffect` when `!user && isPreviewMode`, so the mesh starts alongside the invite UI.
- `AuthGuard.tsx` already lets `/?peerID=…-preview` through — extend the allow-list to include `/preview` explicitly.

### 2. Content lookup protocol

- New `src/lib/p2p/contentLookup.ts`:
  - `requestContentHost(postId)` → broadcasts `{type: 'content-lookup', postId}` on the shared gossip channel used by `globalCell` / room discovery.
  - Peers respond with `{type: 'content-host-ack', postId, peerId, handle, hasContent: true}` if the post is in their local store.
  - Returns the first N respondents within a 5s window.
- Existing peers add a listener that checks `store.get('posts', postId)` on incoming `content-lookup` and answers if found.

### 3. Preview page state machine

Rewrite `Preview.tsx` connection logic into an explicit state machine (still one component):

```text
guest-booting → dialing-origin → syncing-origin → rendered
                     │
                     └─ timeout → searching-peers → syncing-fallback → rendered (with host badge)
                                       │
                                       └─ no-host → invite-cta-only
```

- Remove the current "unauthenticated → hard-stop invite wall" branch. Guests see the invite CTA **and** the live preview area that fills in as content arrives.
- Add `hostPeerId` / `hostHandle` state; when content came from fallback, render a small "Hosted by @handle" badge next to the post.

### 4. Live network stats strip

- New `src/components/preview/NetworkPulse.tsx`: three chips — `● N peers online`, `● N hosting this content`, `Join now to help share`.
- Data source: `p2p.getActivePeerConnections().length` for peers online; `contentLookup` ack count for hosters; refreshes every 3s while `!user` or while still searching.
- Mount above the invitation card in `Preview.tsx`.

### 5. Sign-up handoff

- When guest clicks "Create Free Account", stash `previewSession` + any downloaded post into `sessionStorage` under `preview:handoff` (already partially handled by `previewMode.ts`).
- After auth completes in `Auth.tsx`, if `preview:handoff` exists, replay it: navigate back to `/preview?…` and reuse the cached post instead of re-fetching.

### 6. Safety rails

- Content verification: only render a post whose signature matches its claimed author key (reuse `contentSigning.ts` verify). Reject unsigned posts from fallback hosts to prevent spoofing.
- Guest mesh never writes to `posts`, `profiles`, `identity`, or `blockchain` stores — everything held in a per-tab in-memory cache under `previewCache`.
- Hard timeout: stop actively dialing after 60s to protect the browser; keep passive lookup channel open.
- Rate-limit `content-lookup` broadcasts to 1 per 2s per postId.

## Technical notes

- **Files added:** `src/lib/p2p/guestMode.ts`, `src/lib/p2p/contentLookup.ts`, `src/components/preview/NetworkPulse.tsx`, `src/lib/preview/previewCache.ts`.
- **Files edited:** `src/pages/Preview.tsx` (state machine + guest boot + host badge), `src/components/auth/AuthGuard.tsx` (allow `/preview`), `src/pages/Auth.tsx` (handoff replay), `src/lib/preview/previewMode.ts` (cache helpers), one peer-side listener registration in `src/lib/p2p/globalCell.ts` (respond to `content-lookup`).
- **No schema changes.** All new messages ride the existing gossip channel; new IndexedDB stores are not required.
- **Privacy:** guest ids are ephemeral (`guest-{random}`) and never persisted; guest mesh does not advertise itself in public cell registries.
- **Verification loop:** confirm end-to-end in the live preview — open a share link in a fresh incognito tab, watch the mesh boot, the origin dial timeout in a forced-offline test, and the fallback peer serve the post with a "Hosted by …" badge.

Trust-scoring fallback hosts:   
Guests simply connect to the cell without trust metrics or concerns, they do not have a wallet to mine or health - they simply ride the bus as a viewer of one said content share.  
  
Cross-post prefetch:   
This takes longer the post must become the fallback "Join Network to sync" badge if not connected to peer and cell connect does not sync.  
  
Paywalled/walled post handling behind guest mode:   
Pay wall simply changes "Join to earn and unlock this post"  
