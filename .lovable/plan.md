# Post options: Download media

## Goal

Add a **Download** item to the post "⋯" options menu so anyone (author or viewer) can save a post's image or video attachments to their device.

## Behavior

- Menu item appears for **both** owner (alongside Edit/Delete) and non-owner (alongside Hide Post / Block User) menus.
- Only shown when the post actually has downloadable media: at least one attachment whose MIME is `image/*` or `video/*` (from `post.manifestIds` → manifest MIME hints). Audio and other file types are excluded per request.
- If media is still syncing/decrypting, the item shows "Preparing…" (disabled) or triggers decryption on click.
- On click: each image/video attachment is saved via an `<a download>` pointing at its decrypted blob URL, using the original filename (`manifest.originalName`, with a safe fallback like `swarm-image-1.png` derived from MIME when the name is missing). Multiple attachments download sequentially with a small delay so the browser doesn't drop them.
- Errors (decrypt failure, missing chunks) show a toast: "Download failed — media is still syncing, try again."

## Implementation

All changes are in `src/components/PostCard.tsx`:

1. **Handler `handleDownloadMedia`**
   - If `attachments` don't cover all `post.manifestIds` yet, `await loadFiles()` first, then read the decrypted results from `decryptedCache.current` (a ref, so it's synchronously readable after the await — no state race).
   - Filter to `mime.startsWith("image/") || mime.startsWith("video/")`, skip `decryptError` entries.
   - For each: create `<a href={attachment.url} download={originalName}>`, click, revoke nothing (URLs are owned by the existing cache/cleanup).
   - Toast on empty result or failure.

2. **Menu item** in the `DropdownMenuContent` (lines ~1000-1048), placed above the author/non-author sections so it renders for both:
   - Gated by a `hasDownloadableMedia` memo (checks `mediaHints`/`post.manifestIds` MIMEs for image/video).
   - Icon: `Download` from lucide-react (add to existing icon imports).
   - Label: `Downloading…` while `isDownloading`, else `Download Media`.
   - Follows existing rules: `onSelect` with `event.preventDefault()`, `<button type="button">` semantics preserved (DropdownMenuItem already is), no `<form>`.

3. **Trigger visibility**: the menu button is currently gated on `isAuthor || canBlockUser || canHidePost` — widen to include `hasDownloadableMedia` so the "⋯" button appears on media posts even when none of the other actions apply (e.g. own post edge cases).

## Out of scope

- YouTube-embed blogs (third-party iframe, not downloadable).
- Audio/file attachments (can be added later by widening the MIME filter).
- BlogPostCard menu (it has no options menu today).

## Verification

- `tsgo` typecheck + existing vitest suite.
- Manual: post with image → Download saves file with original name; post with video → same; text-only post → no Download item; non-author view shows Download next to Hide/Block.
