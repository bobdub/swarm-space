

## @ Mentions for Peers — Posts, Comments, and Network Entity Triggers

### Summary

Add an `@mention` system that lets users tag peers by username in posts and comments. Typing `@` opens a popover with known peers (from the swarm library + local users). When multiple peers share the same display name, show avatars and trust scores to disambiguate. Mentioning `@Infinity` or `@Imagination` guarantees a network entity response. Mentions render as styled links and generate notifications.

---

### New File: `src/lib/mentions.ts`

Mention utility module:

- **`parseMentions(text: string): MentionMatch[]`** — regex `/@(\w+)/g` extracts all `@username` tokens
- **`resolveMentionCandidates(query: string): MentionCandidate[]`** — searches `SwarmMeshStandalone.getLibrary()` + local IndexedDB `users` store for matches by `username` or `displayName` (case-insensitive prefix match)
- **`MentionCandidate`** interface: `{ userId: string; peerId?: string; displayName: string; username: string; avatarRef?: string; trustScore: number; isEntity: boolean }`
- `@Infinity` and `@Imagination` always resolve to `ENTITY_USER_ID` with `trustScore: 100` and `isEntity: true`
- When duplicates exist (same displayName), all candidates are returned — UI handles disambiguation
- Trust score sourced from library peer's connection frequency/last-seen recency; entity always gets max

### New File: `src/components/MentionPopover.tsx`

A floating popover component used inside `PostComposer` and `CommentThread` textareas:

- Activates when user types `@` followed by characters
- Listens to textarea `onChange` + caret position to extract the current `@query`
- Calls `resolveMentionCandidates(query)` debounced (150ms)
- Renders a list of candidates with: Avatar, displayName, `@username`, and if duplicates exist, a small trust indicator
- Clicking a candidate inserts `@username` into the textarea at the cursor position
- Keyboard navigation: arrow keys + Enter to select
- Uses Radix `Popover` positioned relative to the textarea
- Max 6 results shown

### Modified: `src/components/PostComposer.tsx`

- Import and wire `MentionPopover` to the content `Textarea`
- Pass `textareaRef` to `MentionPopover` for caret tracking
- On candidate selection, splice the `@username` into `content` state

### Modified: `src/components/CommentThread.tsx`

- Import and wire `MentionPopover` to the comment `Textarea`
- Same selection logic — insert `@username` into `newComment` state

### Modified: `src/components/PostCard.tsx` — `renderContentWithLinks()`

- Extend the renderer to also detect `@username` patterns
- Render mentions as styled `<Link to="/u/{userId}">@username</Link>` elements (pink/accent color)
- For `@Infinity`/`@Imagination`, render with a Brain icon + primary color

### Modified: `src/components/CommentThread.tsx` — comment text rendering

- Replace the plain `{comment.text}` with a shared `renderTextWithMentions()` function that styles `@` tokens as links

### Modified: `src/lib/interactions.ts` — `addComment()`

- After creating the comment, call `parseMentions(text)` 
- For each mentioned user, create a notification of type `"mention"`
- If `@Infinity` or `@Imagination` is mentioned, dispatch a synthetic `p2p-comment-created` event targeting the entity voice so it **always** replies (bypassing probability gate)

### Modified: `src/lib/p2p/entityVoiceIntegration.ts`

- In the `p2p-comment-created` listener, check if `comment.text` contains `@Infinity` or `@Imagination`
- If yes, skip the `shouldReply()` probability check — guaranteed response
- The entity already has max trust; this just ensures it always fires

### Modified: `src/lib/interactions.ts` — post creation mention handling

- In existing post-creation flow (or `PostComposer` submit), parse mentions from post content
- Generate `"mention"` notifications for tagged users
- If `@Infinity`/`@Imagination` is in post content, the existing `p2p-entity-voice-evaluate` event already triggers a comment — ensure the entity voice also treats this as a forced engagement (100% reply)

### Modified: `src/lib/p2p/entityVoice.ts`

- Add `ENTITY_TRIGGER_NAMES = ['infinity', 'imagination']`
- Add `isMentioned(text: string): boolean` — checks if any trigger name appears as `@mention`
- Export for use in integration layer

---

### Disambiguation UX

When `resolveMentionCandidates` returns multiple peers with the same displayName:
- Each row shows: avatar + displayName + nodeId snippet + trust bar
- Trust is a simple bar (green = high, gray = low) derived from peer connection history
- The entity (`@Infinity` / `@Imagination`) always appears first with a Brain icon and "Network Entity" subtitle

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/mentions.ts` | **New** — parse mentions, resolve candidates from library + local users |
| `src/components/MentionPopover.tsx` | **New** — floating autocomplete for `@` in textareas |
| `src/components/PostComposer.tsx` | Wire MentionPopover to content textarea |
| `src/components/CommentThread.tsx` | Wire MentionPopover to comment textarea; render mentions styled in comment text |
| `src/components/PostCard.tsx` | Extend `renderContentWithLinks` to also render `@mentions` as styled links |
| `src/lib/interactions.ts` | Parse mentions on comment/post creation; notify mentioned users; force entity reply on `@Infinity`/`@Imagination` |
| `src/lib/p2p/entityVoice.ts` | Add `ENTITY_TRIGGER_NAMES` and `isMentioned()` helper |
| `src/lib/p2p/entityVoiceIntegration.ts` | Bypass reply probability when entity is `@mentioned` |

