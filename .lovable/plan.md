## Goal

When a blog's content contains a YouTube link, the blog banner shows a **playable embedded video** instead of a plain link chip. Applies to both the blog detail page and the blog card in feeds.

## Current state (verified by reading the code)

- `src/components/PostCard.tsx:50-97` already has a working `extractYoutubeVideoIds()` (handles `youtu.be`, `/watch?v=`, `/embed/`, `/shorts/`, `/live/`, `/v/`) and renders `<iframe src="https://www.youtube.com/embed/${id}">` at line 1264-1280. It is **local to PostCard** — not exported, not used by blogs.
- `src/pages/BlogDetail.tsx:257-284` renders the hero as either a decrypted image (`heroUrl`) or the quill fallback. No URL/video path at all.
- `src/components/BlogPostCard.tsx` uses `extractFirstUrl` and renders a static `ExternalLink` chip with the URL text (`HeroSection`, lines 326-338) — this is exactly the "only showing the link" symptom.

## Changes

### 1. New shared module `src/lib/blogging/youtube.ts`
- Move (copy verbatim) the URL regex + `extractYoutubeVideoIds` logic from `PostCard.tsx` into this file and export it, plus `firstYoutubeVideoId(content): string | null` and `youtubeEmbedUrl(id)`.
- `PostCard.tsx` imports it and deletes its private copy — behaviour there is unchanged (same function body).

### 2. New component `src/components/blogging/BlogVideoHero.tsx`
- Props: `videoId`, optional `title`.
- Renders a 16:9 responsive container with an `<iframe>` (`allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"`, `allowFullScreen`, `loading="lazy"`, `title` for a11y). No autoplay.
- Uses the same rounded/bordered shell classes already used by the image hero so the visual language is unchanged.

### 3. `src/pages/BlogDetail.tsx`
- Compute `const youtubeId = useMemo(() => firstYoutubeVideoId(post?.content ?? ""), [post?.content])`.
- Hero priority: decrypted image `heroUrl` → **YouTube embed** → quill fallback. (Image keeps priority since it is author-uploaded media.)
- Walled/hidden blogs: only render the embed when the existing view gate already allows content — no change to the walled logic.

### 4. `src/components/BlogPostCard.tsx` (`HeroSection`)
- When there is no decrypted image and a YouTube ID exists, render the playable embed in the hero slot instead of the `ExternalLink` chip.
- The card is wrapped in a `<Link>`, so the embed wrapper gets `onClick={e => e.stopPropagation()}` (and `preventDefault`) so pressing play doesn't navigate away. Non-YouTube URLs keep the existing chip.

## Verification (must all pass before reporting success)

1. **Unit test** `src/lib/blogging/__tests__/youtube.test.ts` — asserts ID extraction for `youtu.be/ID`, `watch?v=ID`, `/shorts/ID`, `/embed/ID`, ignores non-YouTube URLs and malformed text. Run with `bunx vitest run`.
2. **Typecheck** with `tsgo`.
3. **Live-preview Playwright run** (the real proof):
   - Sign in using the injected sandbox session if available; otherwise report explicitly that the authored path could not be driven.
   - Create/open a blog whose content contains a YouTube URL, navigate to `/blog/:id`.
   - Assert an `iframe[src*="youtube.com/embed/"]` exists in the hero, is visible, and has non-zero bounding box; screenshot the hero element.
   - Load the feed containing the blog card and assert the same iframe renders there, and that clicking inside the player does **not** navigate away from the feed (URL unchanged).
   - Check the console log for errors introduced by the embed.
4. Report the observed result — including a "not verified" statement for any step that could not be driven. No success claim without the screenshot + assertions above.

## Not touched

`awareness.ts` classification, walled/paywall logic, hero image decryption (`heroMedia.ts`), edit/delete tooling, feed queries, blockchain/vault code.
