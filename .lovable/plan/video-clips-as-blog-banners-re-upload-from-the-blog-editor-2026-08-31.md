# Video clips as blog banners + re-upload from the blog editor

Two separate problems, confirmed in the code:

1. **Video never plays in the banner.** The blog hero loader (`src/lib/blogging/heroMedia.ts`) explicitly skips any manifest whose mime isn't `image/`. A 6-second attached clip is decrypted-capable but discarded, so the banner falls back to the empty placeholder. Only a YouTube link in the post text can produce a playing banner today (`BlogVideoHero`).
2. **No way to re-attach media.** Blog edit mode (`src/pages/BlogDetail.tsx`) only edits text; `updatePost` accepts `content` and `nsfw` only. So there is no re-upload surface after publishing.

## What changes

### Banner supports uploaded video
- Extend the hero loader to return a `kind: "image" | "video"` result: accept `video/*` manifests as well as `image/*`, preferring whichever attachment comes first (image before video only if both exist and the image is first).
- Add a small `BlogMediaHero` that renders `<video controls playsInline preload="metadata">` for video results and `<img>` for images, reusing the existing aspect-video banner frame.
- Use it in both `src/pages/BlogDetail.tsx` and `src/components/BlogPostCard.tsx`, keeping the existing sync/pending/retry behaviour and the "media syncing" state.
- Banner priority stays: uploaded media first, then YouTube link, then the current placeholder.
- No autoplay on the detail page; the feed card keeps a muted, non-autoplaying poster-style frame so scrolling stays cheap.

### Re-upload / replace banner media
- In blog edit mode, add an "Banner media" section showing current attachments with a remove button and an "Add media" control using the existing `FileUpload` component (same encrypted-chunk pipeline the composer uses).
- Allow `updatePost` to accept `manifestIds`, author-only as it already enforces.
- On save, announce any newly attached manifests to the mesh (same `announceContent(manifestId)` call the composer makes) so peers can fetch the clip.

Nothing else about walled/NSFW gating, blog classification, or the feed changes.

## Technical notes

- `src/lib/blogging/heroMedia.ts`: return `{ hero: { url, kind, mime } | null, pendingManifestIds }`; keep `decryptAndReassembleFile` + `ensureManifest(..., { includeChunks: true })` path unchanged. Blob URL revoke behaviour in both consumers stays as-is.
- `src/lib/posts.ts`: widen the `updates` type to include `manifestIds`.
- Size guard: existing 20 MB upload limit and chunked encryption apply unchanged, so short clips work; larger clips get the existing upload error.

## Verification

- Unit test for the hero loader picking a `video/mp4` manifest.
- Typecheck + build.
- Manually publish a blog with a short clip, confirm it plays in the banner on both the detail page and the feed card, then edit the post, remove and re-add the clip, and confirm the banner updates.
