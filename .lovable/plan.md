## Goal

Let a blog's author edit or delete it, using the exact same data layer `PostCard` already uses. No new storage, no new sync path, no changes to any non-blog surface.

## Why this is safe

Blogs are ordinary posts rendered by a different card (`classifyPost` in `src/lib/blogging/awareness.ts` picks `BlogPostCard`). The mutation functions already exist and already enforce ownership server-side of the UI:

- `updatePost(postId, { content, nsfw })` — `src/lib/posts.ts:26`, throws `Cannot edit another user's post` unless `currentUser.id === post.author`.
- `deletePost(postId)` — `src/lib/posts.ts:53`, same ownership guard.

`PostCard` (`src/components/PostCard.tsx:738-793`) already calls both, shows a toast, and fires `window.dispatchEvent(new CustomEvent("p2p-posts-updated"))` so feeds refresh. The plan copies that proven flow verbatim — nothing new is invented.

## Scope

Two files only:

1. `src/pages/BlogDetail.tsx` — the primary edit/delete surface.
2. `src/components/BlogPostCard.tsx` — a small author-only menu for quick delete / "Edit" jump.

## 1. BlogDetail: full edit + delete

- Compute `const isAuthor = user?.id === post?.author;` (same expression as `PostCard.tsx:217`).
- Add local state: `isEditing`, `draft` (seeded from `post.content`), `isSaving`, `isDeleting`.
- When `isAuthor` and not walled-hidden, render an **Edit** and **Delete** button in the existing header/meta row.
- **Edit mode**: replace the rendered title+body block with a single `Textarea` bound to `draft` (the first non-empty line is the title, matching `extractBlogTitle`, so one textarea preserves the existing title convention with zero format changes) plus **Save** / **Cancel**.
  - Save: `await updatePost(post.id, { content: draft.trim() })`, set local `post` state to the returned post, `broadcastPost(updated)` (same helper `PostCard` uses via P2P context), toast, dispatch `p2p-posts-updated`, exit edit mode.
  - Guard against empty content with a destructive toast, same as `PostCard:738`.
- **Delete**: `window.confirm` → `await deletePost(post.id)` → toast → dispatch `p2p-posts-updated` → `navigate("/")`.
- Both buttons disabled while their action runs.

## 2. BlogPostCard: author-only quick actions

- Card is wrapped in a `<Link>`, so the action buttons must call `e.preventDefault(); e.stopPropagation();` — otherwise the click also navigates. This is the one real interaction hazard and it is handled explicitly.
- Render only when `user?.id === post.author`: a small icon row in the footer with **Edit** (navigates to `/blog/${post.id}?edit=1`) and **Delete** (confirm → `deletePost` → toast → dispatch `p2p-posts-updated`).
- `BlogDetail` reads `?edit=1` on mount and opens edit mode directly, so the card never needs its own editor.

## What is explicitly not touched

- No changes to `awareness.ts` classification, walled-post logic, hero-media loading, `PostCard`, feed queries, or any blockchain/vault code.
- Walled blogs: buttons render for the author only (the author always passes `canViewWalledPost`), so no unlock logic is bypassed.

## Verification

- Run the existing test suite plus a typecheck.
- Drive the live preview with Playwright: open a blog detail page as its author, edit the body, save, confirm the updated text renders and the feed card reflects it; then delete and confirm redirect and removal from the feed. Report the observed result rather than assuming it.
