

## Clickable @Mentions, Mention Alerts via Swarm, and Entanglement Notifications

### Problem

1. **@mentions are not clickable** — Both `PostCard.tsx` and `CommentThread.tsx` render mentions as plain `<span>` elements instead of `<Link>` to the profile page. Need to resolve the username to a userId for routing.

2. **Mention notifications are broken** — `PostComposer.tsx` line 346 uses `mention.username` as the `userId` (wrong — it's a display name, not a hex ID). Also uses `type: 'reaction'` instead of `'mention'`. No offline relay exists — if the tagged peer is offline, the notification is lost.

3. **No entanglement content alerts** — When a user is entangled (following) a peer, they receive no notification when that peer publishes a blog or video.

---

### Changes

**`src/lib/mentions.ts`** — Add `resolveUsernameToId(username)`
- New async function that searches swarm library + local IndexedDB for a userId matching the username
- Returns `{ userId: string; displayName: string } | null`
- Entity trigger names resolve to `ENTITY_USER_ID`

**`src/components/PostCard.tsx`** — Make @mentions clickable Links
- Replace the `<span>` for mentions with `<Link to={/profile/${userId}}>` 
- On render, call a lightweight sync lookup (cached map of username→userId built from swarm library) to resolve the route
- If userId can't be resolved, fall back to a non-linked styled span

**`src/components/CommentThread.tsx`** — Same clickable Link treatment
- Replace `renderTextWithMentions` spans with `<Link>` elements using the same resolution logic

**`src/components/PostComposer.tsx`** — Fix mention notification creation
- Use `resolveUsernameToId()` to get the actual userId before calling `createNotification`
- Change `type: 'reaction'` to `type: 'mention'`
- Skip if userId can't be resolved

**`src/pages/Notifications.tsx`** — Add mention notification display
- Add `case "mention"` to `getNotificationIcon` (use `@` or AtSign icon)
- Add `case "mention"` to `getNotificationMessage` — "{name} mentioned you in a post"

**`src/lib/p2p/swarmMesh.standalone.ts`** — Relay mention alerts via swarm
- Add a new message type `mention-alert` to the data channel handler
- When a mention notification is created and the peer is not locally known (offline), queue a `mention-alert` payload `{ targetUserId, postId, triggeredBy, triggeredByName, content }` into the swarm broadcast
- On receiving a `mention-alert`, check if the `targetUserId` matches the local node — if yes, create a local notification via `createNotification`
- Alerts are held in a small relay buffer (max 50) and forwarded during library exchange so offline peers receive them on reconnection

**`src/lib/p2p/entityVoiceIntegration.ts`** — Entanglement blog/video notifications
- After a synced post is evaluated, check if it qualifies as a blog (>=1000 chars + signals) or has video content (manifestIds with video MIME or YouTube links)
- If so, look up all local entanglements where the current user follows the post's author using `isEntangled()`
- If entangled, create a notification: "{author} published a new blog/video" with type `"mention"` (or extend type to `"entanglement"`)
- This runs on both local post creation and inbound p2p post sync

**`src/types/index.ts`** — Extend Notification type
- Add `"entanglement"` to the type union: `"reaction" | "comment" | "mention" | "follow" | "entanglement"`

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/mentions.ts` | Add `resolveUsernameToId()` for username→userId lookup |
| `src/components/PostCard.tsx` | Replace mention `<span>` with clickable `<Link to="/profile/{userId}">` |
| `src/components/CommentThread.tsx` | Same — clickable mention links in comments |
| `src/components/PostComposer.tsx` | Fix notification: resolve userId, use `type: 'mention'` |
| `src/pages/Notifications.tsx` | Add mention + entanglement notification display cases |
| `src/types/index.ts` | Add `"entanglement"` to Notification type union |
| `src/lib/p2p/swarmMesh.standalone.ts` | Add `mention-alert` relay + buffer for offline peers |
| `src/lib/p2p/entityVoiceIntegration.ts` | Create entanglement notifications for blog/video posts from followed peers |

