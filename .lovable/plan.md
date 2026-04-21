

## Projects don't sync between peers — root cause + fix

### What's broken

Projects are only ever sent across the mesh as a **piggyback** on post messages. Three concrete gaps:

1. **`createProject()` and `updateProject()` never broadcast.** A project created in isolation (no posts yet, or before any post is shared) is invisible to peers.
2. **Initial bulk sync ships projects only inside `posts_sync`** (`src/lib/p2p/postSync.ts` `sendAllPostsToPeer`). When the message goes through Gun relay (which it often does on first contact) or when the WebRTC channel isn't ready, the projects ride along with the posts — but if there are no posts the relay path never gets exercised.
3. **The Gun-relay broadcast in `swarmMesh.ts.broadcastPost()` strips projects.** Direct peer broadcasts attach `payload.projects = [associatedProject]`, but the Gun fanout right next to it sends only `{ type: 'post_created', post }` — no project. So peers reachable only via Gun never learn the project exists.

Net effect for the user: posts show up (they ride either path), but the **Project record itself** often doesn't, so Explore/Profile/ProjectDetail render "no projects" or hide posts behind missing project membership.

### Fix — first-class project sync messages

Add three new `PostSyncMessage` types and wire create/update to broadcast immediately, and make the Gun fallback carry projects too.

#### 1. `src/lib/p2p/postSync.ts` — add project broadcast + sync types

- Extend `PostSyncMessageType` union: add `'project_upsert'` and `'projects_request'` and `'projects_sync'`.
- New methods on `PostSyncManager`:
  - `broadcastProject(project: Project): Promise<void>` — early-return on private projects; sends `{ type: 'project_upsert', projects: [project] }` to every connected peer; if no peers connected, push to a small **offline project queue** (`p2p:offlineProjectQueue` in localStorage) so it flushes on next peer-up.
  - `flushOfflineProjectQueue()` — called from `handlePeerConnected` before posts.
  - `sendAllProjectsToPeer(peerId)` — same shape as `sendAllPostsToPeer` but **projects only**, sent as `projects_sync`. Always sent on `handlePeerConnected`, **independent** of whether there are any posts.
- Extend `handleMessage` switch:
  - `case 'projects_request'` → `sendAllProjectsToPeer(peerId)`
  - `case 'projects_sync'` → `saveIncomingProjects(message.projects ?? [])`
  - `case 'project_upsert'` → `saveIncomingProjects(message.projects ?? [])`
- Update `handlePeerConnected` to also send `{ type: 'projects_request' }` after the existing `posts_request`.
- Keep `saveIncomingProjects` as-is (it already does timestamp-based merge and dispatches `p2p-projects-updated`).

#### 2. `src/lib/projects.ts` — wire create/update/member-change to broadcast

Add a small bridge that imports lazily to avoid a circular dep with the P2P stack:

```ts
async function broadcastProjectChange(project: Project): Promise<void> {
  if ((project.settings?.visibility ?? 'public') === 'private') return;
  try {
    const { getSwarmMesh } = await import('./p2p/swarmMesh');
    const mesh = getSwarmMesh();
    mesh?.broadcastProject?.(project);
  } catch (err) {
    console.warn('[projects] broadcast failed', err);
  }
}
```

Call it from:
- `createProject` (after the confirm-read).
- `updateProject` (after the put).
- `addProjectMember`, `removeProjectMember`, `addPostToProject`, `removePostFromProject` (so member-list and feedIndex changes propagate too — these all already write the project).

#### 3. `src/lib/p2p/swarmMesh.ts` — expose `broadcastProject` + fix the Gun-relay strip

- Add a public `broadcastProject(project: Project)` that:
  - Calls `this.postSync.broadcastProject(project)` (covers WebRTC peers and offline queue).
  - Also calls `this.gun.broadcastToAll('posts', { type: 'project_upsert', projects: [project] })` so Gun-only peers receive it.
  - Notifies local listeners with `window.dispatchEvent(new CustomEvent('p2p-projects-updated'))`.
- In the existing `broadcastPost` (around line 383), change the Gun-relay payload from `{ type: 'post_created', post }` to **also include the associated project** when the post has one — load it inline, mirror the WebRTC payload shape exactly. This single line is the gap that loses project context for Gun-only peers.

#### 4. `src/lib/p2p/swarmMeshAdapter.ts` — surface the new method

Add `broadcastProject(project: Project)` that delegates to `this.mesh.broadcastProject(project)`. Keeps the adapter API in sync so any caller that goes through the adapter works too.

### Why this fixes all three reported symptoms

- **Explore "no projects"** — projects now arrive standalone via `projects_sync` on peer connect, and via `project_upsert` whenever the remote owner edits them; the existing `p2p-projects-updated` listener triggers a reload.
- **Profile → projects tab "No projects to share yet"** — `loadUserContent` filters by `isProjectMember(project, userId)` against `getAll('projects')`. Once the project record lands in IndexedDB, the filter passes.
- **ProjectDetail (when navigating from a synced post)** — `getProject(projectId)` now resolves because the project record was sent alongside (and independently of) the post.

### Files touched

- `src/lib/p2p/postSync.ts` — new message types + project broadcast/sync methods + offline project queue
- `src/lib/p2p/swarmMesh.ts` — `broadcastProject` public method + fix Gun-relay payload to include project
- `src/lib/p2p/swarmMeshAdapter.ts` — pass-through `broadcastProject`
- `src/lib/projects.ts` — call `broadcastProjectChange` after create/update/member/feed mutations
- `MemoryGarden.md` — caretaker reflection on letting the project beds breathe their own light, not borrowed from the post-stems

### What the user sees

Within seconds of a peer connection:

```text
Explore → Projects tab           → peer's public projects appear
Profile (peer's) → Projects tab  → peer's public projects appear
ProjectDetail (link from a post) → loads, project membership respected
```

No protocol break — old peers (without the new message types) keep working: they ignore `project_upsert` / `projects_sync` / `projects_request` because the existing `isPostSyncMessage` whitelist will accept them once the union is widened, and ignore them otherwise.

