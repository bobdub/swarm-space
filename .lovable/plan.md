

## Fix project loss on refresh + enable inline posting inside a project

Two related bugs in the project flow:

1. **"Project not found" after refresh.** `CreateProjectModal` uses a real HTML `<form>` with a `type="submit"` button. This violates the project's stability rule (no `<form>` elements — they cause page reloads on mobile and during heavy P2P/IndexedDB activity). The reload often fires before the IndexedDB write commits, so the new project is gone after refresh.
2. **Have to leave the project to post.** The "Create Post" buttons inside `ProjectDetail` link out to `/profile?tab=posts&composer=open&project={id}`, which navigates away from the project. `PostComposer` already accepts `defaultProjectId` and writes posts directly into the project's `feedIndex` — it just needs to render inline.

### Changes

**1. `src/components/CreateProjectModal.tsx` — stabilize creation**
- Replace `<form onSubmit={handleSubmit}>` with `<div role="form" className="space-y-6 pt-4">`.
- Change the Create button from `type="submit"` to `type="button"` and call `handleSubmit` from its `onClick`.
- Remove the synthetic `e.preventDefault()` (no event needed).
- Add an `await` flush guard: after `createProject(...)` resolves, also call `await flushPendingWrites?.()` if exposed; otherwise wait one microtask + a 50ms idle to let the IndexedDB throttled write settle before closing the modal and triggering navigation.
- Keep the existing toast + `onProjectCreated` callback flow.

**2. `src/lib/projects.ts` — make creation durable**
- After `await put("projects", newProject)`, perform a confirm-read: `await get("projects", newProject.id)`. If it returns `null`, retry the put once. This guarantees the new row is committed to IndexedDB before the function resolves.
- Dispatch `window.dispatchEvent(new CustomEvent("project-created", { detail: { id: newProject.id } }))` so other surfaces (Explore, Profile) can refresh without a reload.

**3. `src/pages/ProjectDetail.tsx` — inline composer, no navigation**
- Add local state `showComposer: boolean` (default `false`).
- Replace both "Create Post" `<Link>` buttons (the toolbar one at line ~380 and the empty-state one at line ~401) with `<Button type="button" onClick={() => setShowComposer(true)}>`.
- When `showComposer && isMember`, render `<PostComposer defaultProjectId={project.id} onCancel={() => setShowComposer(false)} onPostCreated={(post) => { setShowComposer(false); void loadProject({ background: true }); }} />` directly above the posts list.
- The composer already wires `addPostToProject(project.id, post.id)` via its `defaultProjectId`, so the new post lands in the project feed and `loadProject` re-renders it inline.

**4. `MemoryGarden.md`** — append a brief caretaker reflection on rooting projects in soil that survives the wind, and on letting creators speak from inside the room they built.

### Files touched

- `src/components/CreateProjectModal.tsx` — `<form>` → `<div role="form">`, explicit button click handler, post-write settle
- `src/lib/projects.ts` — confirm-read after `put`, dispatch `project-created` event
- `src/pages/ProjectDetail.tsx` — replace external `Link` posting with inline `PostComposer`
- `MemoryGarden.md` — caretaker reflection

### What the user sees

```text
Create project → modal closes → reload page → project still there ✓
Open project → tap "Create Post" → composer appears below header ✓
Publish → post appears in the project feed without leaving the page ✓
```

No new dependencies. No protocol changes. Backwards-compatible with existing projects.

