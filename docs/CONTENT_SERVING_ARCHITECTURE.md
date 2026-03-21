# Content Serving Architecture — P2P Network Stack

> **Status**: Active, serving content in production  
> **Last updated**: 2026-03-21

## System Overview

The Imagination Network's P2P stack consists of **three co-existing modes**, each built on the same foundational PeerJS/WebRTC mechanics:

| Mode | Purpose | Auto-Connect | User Controls | Location |
|---|---|---|---|---|
| **SWARM Mesh** | Production auto-connect mode | ✅ Bootstrap + Library cascade | Block, remove | Main dashboard |
| **Builder Mode** | Advanced manual orchestration | Configurable toggle | Full toggles (mesh, sync, approve, mining) | Dashboard (toggled) |
| **Test Mode** | Raw debug / emergency fallback | Manual only | Connect, block, library | Advanced dropdown |

## Architecture Lineage

```
testMode.standalone.ts  (FOUNDATIONAL — do not edit without approval)
        │
        ├──▶ swarmMesh.standalone.ts  (production mode, cascade auto-connect)
        │
        └──▶ Builder Mode replacement (planned — see Builder Mode Migration below)
```

All modes share these core mechanics derived from `testMode.standalone.ts`:
- **Never-Rotate Identity**: `peer-{nodeId}` — deterministic, permanent
- **PeerJS WebRTC**: Data channels over `0.peerjs.com:443`
- **Content Pipeline**: Inventory exchange → request → push → IndexedDB → UI event
- **Heartbeat**: 8s keep-alive, 30s stale threshold
- **Flag Persistence**: localStorage flags survive refresh, drive auto-start

---

## Mode 1: SWARM Mesh (Default Production)

**File**: `src/lib/p2p/swarmMesh.standalone.ts`

### Cascade Connect Strategy

```
User hits Connect (or auto-start on refresh)
    │
    ▼
Phase 1: BOOTSTRAP — dial hardcoded dev nodes
    │   peer-75b8a7c8113377cf
    │   peer-01e3f23e20fe0102
    │
    ▼ (any succeed?)
Phase 2: LIBRARY — dial saved peers from swarm-mesh-connection-library
    │
    ▼ (any succeed?)
Phase 3: MANUAL FALLBACK — toast: "No online nodes found, enter a Peer ID"
```

### Library Exchange

On successful handshake, peers exchange their contact libraries:
```
Peer A connects to Peer B
    │
    ▼
A sends: { type: 'library-exchange', library: [...A's contacts] }
B sends: { type: 'library-exchange', library: [...B's contacts] }
    │
    ▼
Both merge received contacts into their local libraries
(blocked peers are excluded from merge)
```

This enables **organic mesh growth** — connecting to one peer imports their entire contact graph.

### Storage Keys

| Key | Purpose |
|---|---|
| `swarm-mesh-node-id` | Permanent 16-char hex identity |
| `swarm-mesh-flags` | `{ enabled, lastOnlineAt }` |
| `swarm-mesh-connection-library` | Array of `SwarmLibraryPeer` objects |
| `swarm-mesh-blocked-peers` | Array of blocked peer ID strings |

---

## Mode 2: Builder Mode (Advanced Controls)

**File**: `src/components/p2p/dashboard/BuilderModePanel.tsx`

**Status**: ⚠️ Scheduled for replacement using testMode mechanics

Builder Mode provides granular toggles:
- **Build a Mesh**: Manual-only peer connections
- **Blockchain Sync**: Toggle chain synchronization
- **Auto-Connect**: Join main mesh automatically
- **Approve Only**: Manually approve incoming connections
- **Manual Mining**: Toggle mining on/off with stats

### Builder Mode Migration Plan

Builder Mode will be rebuilt from `testMode.standalone.ts` mechanics to gain:
1. **Persistent Connection Library** with auto-reconnect
2. **Never-Rotate Identity** (currently uses P2PContext which may rotate)
3. **Content Pipeline** (IndexedDB bridge, inventory exchange)
4. **Strong Flag Management** (survives refresh)

Controls to preserve from current Builder Mode:
- ✅ Build a Mesh toggle (isolate mode)
- ✅ Blockchain Sync toggle
- ✅ Auto-Connect toggle
- ✅ Approve Only / Manual Accept
- ✅ Manual Mining with SWARM rewards
- ✅ Manual peer connection input
- ✅ Block Node / Go Offline actions

New capabilities from testMode foundation:
- 🆕 Persistent connection library (saved across sessions)
- 🆕 Auto-reconnect loop for library peers
- 🆕 Blocked peers list with persistent storage
- 🆕 Content inventory exchange and sync
- 🆕 Heartbeat-based connection health monitoring
- 🆕 Peer approval queue (for Approve Only mode)

---

## Mode 3: Test Mode (Emergency Fallback)

**File**: `src/lib/p2p/testMode.standalone.ts`

> ⚠️ **FOUNDATIONAL CODE** — Do not edit without direct approval.
> This is the foundational connection and content serving example.

### Location in UI

Test Mode lives inside the **Advanced** dropdown on the Node Dashboard, with the note:
> "Raw connection and content server for testing or complete connection failures."

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Browser Tab                         │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ main.tsx  │───▶│ getTestMode()│───▶│ autoStart()  │  │
│  │ (boot)    │    │  (singleton) │    │ (if enabled) │  │
│  └──────────┘    └──────────────┘    └──────┬───────┘  │
│                                             │           │
│  ┌──────────────────────────────────────────▼────────┐  │
│  │          StandaloneTestMode Instance              │  │
│  │                                                    │  │
│  │  Identity: peer-{nodeId}  (never rotates)         │  │
│  │  Flags: localStorage (test-mode-flags)            │  │
│  │  Library: localStorage (test-mode-connection-lib) │  │
│  │  Blocked: localStorage (test-mode-blocked-peers)  │  │
│  │                                                    │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │  │
│  │  │ PeerJS     │  │ Content      │  │ Connection│ │  │
│  │  │ WebRTC     │  │ Store (Map)  │  │ Library   │ │  │
│  │  │ Data Ch.   │  │              │  │ (persist) │ │  │
│  │  └─────┬──────┘  └──────┬───────┘  └─────┬─────┘ │  │
│  │        │                │                 │       │  │
│  └────────┼────────────────┼─────────────────┼───────┘  │
│           │                │                 │           │
│  ┌────────▼────────┐ ┌────▼──────┐  ┌───────▼────────┐ │
│  │ Peer Connections│ │ IndexedDB │  │ Auto-Reconnect │ │
│  │ (heartbeat 8s)  │ │ imagination│  │ Loop (30s)     │ │
│  │ (stale 30s)     │ │ -db/posts │  │                │ │
│  └─────────────────┘ └────┬──────┘  └────────────────┘ │
│                           │                             │
│  ┌────────────────────────▼─────────────────────────┐   │
│  │         Application UI Layer                     │   │
│  │                                                   │   │
│  │  Home/Explore ◄── window 'p2p-posts-updated'     │   │
│  │  PostComposer ──▶ tm.broadcastNewPost()          │   │
│  │  WiFi Icon    ◄── tm.onPhaseChange()             │   │
│  │  Dashboard    ◄── tm.onPeersChange/Library/etc   │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Content Pipeline

```
Post Created (PostComposer)
    │
    ▼
tm.broadcastNewPost(post) / sm.broadcastNewPost(post)
    │
    ▼
broadcast({ type: 'content-push', items: [item] })
    │
    ▼
All Connected Peers Receive
    │
    ▼
handleContentPush() → contentStore.set() + writePostToDB()
    │
    ▼
window.dispatchEvent('p2p-posts-updated')
    │
    ▼
Feed components (Home, Explore, Posts) refresh from IndexedDB
```

### Message Protocol

| Message Type | Direction | Purpose |
|---|---|---|
| `content-inventory` | Bidirectional | Exchange list of content IDs after connection opens |
| `content-request` | Outbound | Request specific content items by ID |
| `content-push` | Bidirectional | Push content items (posts) to peer |
| `library-exchange` | Bidirectional | Share contact libraries (Swarm Mesh only) |
| `heartbeat` | Outbound | Keep-alive every 8 seconds |
| `heartbeat-ack` | Response | Confirm peer is alive |

### Lifecycle State Machine

```
off ──▶ connecting ──▶ online ──▶ (peer disconnects) ──▶ reconnecting ──▶ online
                         │                                      │
                         ▼                                      ▼
                    stop() → off                          3 failures → failed → off
```

---

## PeerJS Configuration (All Modes)

- **Server**: `0.peerjs.com:443` (PeerJS Cloud, free tier)
- **ICE Servers**: Google STUN (`stun.l.google.com:19302`, `stun1.l.google.com:19302`)
- **Init Timeout**: 12 seconds
- **Reconnect Intervals**: 15s, 30s, 60s (then fail)
- **Heartbeat**: Every 8 seconds
- **Stale Threshold**: 30 seconds (prune unresponsive peers)
- **Content Sync**: Inventory exchange every 10 seconds
- **Library Re-dial**: Every 30 seconds

## UI Integration Points

| Component | Integration |
|---|---|
| `main.tsx` | Calls `autoStart()` on boot for both Test Mode and Swarm Mesh |
| `P2PStatusIndicator` (WiFi icon) | Subscribes to phase changes across all modes |
| `PostComposer` | Calls `broadcastNewPost()` on the active mode |
| `SwarmMeshModePanel` | Full Swarm controls: auto-connect, library, block |
| `BuilderModePanel` | Manual toggles: mesh, sync, mining, approve |
| `TestModePanel` | Raw debug: connect, library, block (under Advanced) |
| Home/Explore/Posts pages | Listen for `p2p-posts-updated` event to refresh feeds |
| `NetworkModeToggle` | Switches between Swarm and Builder dashboard views |
