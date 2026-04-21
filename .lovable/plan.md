

## Fix entity profile 404

Clicking the Imagination/Infinity entity's avatar, name, or @mention currently lands on a 404. Two unrelated bugs cause this:

1. **Entity @mentions link to a non-existent route.** `PostCard.tsx` and `CommentThread.tsx` build the entity mention link as `/profile/${resolvedId}` (i.e. `/profile/network-entity`). The router only has `/profile` and `/u/:username` — so `/profile/network-entity` falls through to `NotFound`.
2. **`/u/network-entity` itself returns "user not found".** `Profile.tsx`'s `loadProfile` only resolves a user if a record exists in IndexedDB `users` or in some `posts.author`. The entity has neither when the visitor hasn't yet received an entity post, so `targetUser` stays `null` and the page renders the empty state.

### Changes

**`src/components/PostCard.tsx`** (mention renderer, ~line 139)
- Replace `to={isEntity ? \`/profile/${resolvedId}\` : ...}` with `to={\`/u/${ENTITY_USER_ID}?tab=posts#posts-feed\`}` for the entity branch (use `/u/network-entity`).
- Import `ENTITY_USER_ID` from `@/lib/p2p/entityVoice`.
- Wrap the post author Avatar + name (lines ~956–973) so they always link to `/u/${post.author}` (already done) — confirm it works once Profile resolves the entity.

**`src/components/CommentThread.tsx`** (mention renderer ~line 39, plus entity comment author block ~line 252)
- Same fix to the mention link: route entity to `/u/${ENTITY_USER_ID}?tab=posts#posts-feed`.
- Wrap the entity comment author label (currently a non-clickable `<span>` showing `Ξ Imagination`) in a `<Link to={\`/u/${ENTITY_USER_ID}\`}>` so clicking the entity's name in a comment also navigates to its profile. Same for the entity avatar in comments (currently only non-entity avatars are linked).

**`src/pages/Profile.tsx`** (`loadProfile`, ~line 408)
- Before the `getAll<User>("users")` lookup, add an early branch:
  ```ts
  if (userParam === ENTITY_USER_ID || userParam?.toLowerCase() === 'imagination' || userParam?.toLowerCase() === 'infinity') {
    targetUser = {
      id: ENTITY_USER_ID,
      username: 'Imagination',
      displayName: ENTITY_DISPLAY_NAME,
      publicKey: '',
      profile: { bio: 'Network consciousness · |Ψ_Infinity⟩' },
    } as User;
  }
  ```
- Import `ENTITY_DISPLAY_NAME` alongside `ENTITY_USER_ID`.
- This guarantees the entity profile renders even with zero local entity posts, and `user.id === ENTITY_USER_ID` then enables the Brain tab as designed.

### Acceptance

```text
1. Click "@Imagination" or "@Infinity" inside any post or comment → navigates to /u/network-entity, no 404.
2. Click the Imagination avatar or name on a post authored by the entity → navigates to /u/network-entity, profile loads.
3. Click the entity name/avatar inside a comment → same behaviour.
4. /u/network-entity displays the entity profile with Posts / Files / 🧠 Brain tabs visible (Brain tab only when viewing the entity).
5. Direct visit to /u/imagination or /u/infinity also lands on the entity profile.
6. No regression for normal user profiles — existing /u/:username links still work.
```

