

# Fix Profile Navigation from PostCard

## Problem
When clicking a user icon on a post, the app navigates to `/u/${post.author}` (the user's hex ID). The Profile page looks up users from local IndexedDB by matching `username === param || id === param`. For remote peers, the user record may not exist locally yet, causing an immediate "Profile not found" page. There's also no `peerId` on the Post type to help identify cross-network users.

## Changes

### 1. Add `authorPeerId` to the Post type
**File: `src/types/index.ts`** — Add an optional `authorPeerId?: string` field to the `Post` interface. This ties every post to the author's deterministic peer identity (`peer-{nodeId}`).

### 2. Stamp `authorPeerId` when creating posts
**File: `src/components/PostComposer.tsx`** — When building the new `Post` object, read the current user's peer ID from `localStorage` (the `me` record or connection state) and set `post.authorPeerId`.

### 3. Build fallback profile from post data in Profile page
**File: `src/pages/Profile.tsx`** — In `loadProfile`, after the `allUsers.find()` fails:
- Search all local posts where `post.author === userParam`
- If found, construct a minimal `User` from `authorName`, `authorAvatarRef`, `authorBannerRef`, and `authorPeerId`
- Persist this constructed user to the `users` IndexedDB store for future visits
- This eliminates the "not found" for any author who has posts locally

### 4. Replace "Profile not found" with retry + graceful fallback
**File: `src/pages/Profile.tsx`** — When `user` is null and we're viewing someone else's profile:
- Show "Loading profile..." for 3 seconds instead of immediately showing "not found"
- Listen for `p2p-posts-updated` events during that window and re-run `loadProfile`
- After timeout, display "Profile not synced or connected" instead of "Profile not found"

### 5. PostCard link stays as `/u/${post.author}`
No change needed — `post.author` is already the unique user ID. The `authorPeerId` is used for lookup/fallback, not routing.

## Technical Details

**Fallback construction in `loadProfile`:**
```text
if (!targetUser && userParam) {
  const allPosts = await getAll<Post>("posts");
  const match = allPosts.find(p => p.author === userParam);
  if (match) {
    targetUser = {
      id: userParam,
      username: match.authorName || userParam,
      displayName: match.authorName,
      publicKey: "",
      profile: {
        avatarRef: match.authorAvatarRef,
        bannerRef: match.authorBannerRef,
      },
    };
    await put("users", targetUser);
  }
}
```

**Retry with timeout:**
```text
// State: retryCount, retryTimer
// On first load where user is null and not own profile:
//   set 3s timer, listen for p2p-posts-updated, retry loadProfile
//   after timeout show "Profile not synced or connected"
```

