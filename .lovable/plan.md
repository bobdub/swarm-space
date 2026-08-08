# Wall posts should land in Profile + Explore

## What I verified

- Wall posting goes through one path only: `UserPlacementsLayer` "Decorate" -> `WallDecorateComposer` -> the standard `PostComposer`.
- `PostComposer` already saves the post to the `posts` store, broadcasts it to peers, and dispatches `p2p-posts-updated`.
- Explore (`src/pages/Explore.tsx`) and Profile (`src/pages/Profile.tsx`) both read every row of the `posts` store and both listen for `p2p-posts-updated`, so nothing filters a wall post out on its own.
- One thing is different about the wall path: after `PostComposer` has already signed, stored and broadcast the post, `WallDecorateComposer` re-writes the same row with an extra `wallPlacementId` field. Peers therefore receive a copy without the wall link, and the local row is mutated after signing.

So the "wall posts are invisible in the feeds" symptom is **not fully explained by a read of the code**. The most likely remaining causes are (a) the wall composer being used inside a project world, which correctly scopes the post to project members only, or (b) the post-signing / re-write ordering above. I will not guess — step 1 confirms which.

## Step 1 — Confirm the actual behaviour

Drive the live preview: sign in, enter the Brain lobby, place a wall, decorate it with a short text post, then check Explore -> Most Recent and the author's Profile. Capture whether the post row exists in the store and whether it carries a `projectId`. The result decides which of the fixes below is needed; nothing else ships until this is observed.

## Step 2 — Make the wall link part of the post before it is signed

Instead of patching the post after the fact, pass the wall placement into `PostComposer` so `wallPlacementId` is set on the post object before signing, storage and broadcast.

- `PostComposer` gains an optional `wallPlacementId` prop, written into the post literal alongside `projectId`.
- `WallDecorateComposer` passes it and drops its post-hoc `put(...)`, keeping only `decorateWall(placementId, post.id)` plus the existing `p2p-posts-updated` dispatch.

Result: peers receive the wall link with the post, the signed bytes match what is stored, and the post is an ordinary feed post from the moment it is created.

## Step 3 — Correct scoping in the main lobby

In the main Brain lobby the composer must post with no project, so it reaches Explore and the author's profile for everyone. In a project world it must keep the current behaviour (project-scoped, members only). `WallDecorateComposer` already receives `projectId`; confirm in the walkthrough that it is `null` in the lobby and leave project worlds untouched.

## Step 4 — Verify end to end

Repeat the walkthrough from step 1 and confirm the same post appears on the wall, in Explore -> Most Recent, and on the author's Profile posts tab. Report the evidence. No success claim without it.

## Technical notes

- Files touched: `src/components/PostComposer.tsx` (new optional prop only), `src/components/world/WallDecorateComposer.tsx`.
- No change to `wallDecorations.ts`, `worldPlacementsStore.ts`, feed filters, project membership filtering, or the P2P placement bridge.