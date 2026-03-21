# Content Serving Architecture — Standalone Test Mode

> **Status**: Active, serving content in production  
> **Last updated**: 2026-03-21

## Overview

The Imagination Network's current content-serving pipeline is powered by a **standalone P2P module** (`src/lib/p2p/testMode.standalone.ts`) that operates independently of all other P2P subsystems (SWARM Mesh, Builder Mode). It is the **single source of truth** for real-time peer-to-peer content exchange.

## Architecture Diagram

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

## Key Components

### 1. Identity (Never Rotates)

- **Node ID**: 16-char hex, generated once, stored in `localStorage` key `test-mode-node-id`
- **Peer ID**: `peer-{nodeId}` — deterministic, never changes across sessions
- **Conflict resolution**: If PeerJS says "ID taken", exponential backoff retries with same ID (no rotation)

### 2. Flags (Single Source of Truth)

- Stored in `localStorage` key `test-mode-flags`
- Schema: `{ enabled: boolean, lastOnlineAt: number | null }`
- On page load, `main.tsx` calls `getTestMode().autoStart()` which checks `enabled` flag
- If `enabled === true`, the system auto-connects to PeerJS signaling without user action
- Reconnect cycle: **15s → 30s → 60s → fail** (sets `enabled = false`)

### 3. Connection Library (Persistent)

- Stored in `localStorage` key `test-mode-connection-library`
- Every successful peer connection is saved as a `LibraryPeer` entry
- On reaching `online` phase, all library peers with `autoConnect: true` are dialed
- Background loop every **30 seconds** re-dials disconnected library peers
- Users can **remove** peers from library or **block** them entirely

### 4. Content Pipeline

```
Post Created (PostComposer)
    │
    ▼
tm.broadcastNewPost(post)
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

### 5. Message Protocol

| Message Type | Direction | Purpose |
|---|---|---|
| `content-inventory` | Bidirectional | Exchange list of content IDs after connection opens |
| `content-request` | Outbound | Request specific content items by ID |
| `content-push` | Bidirectional | Push content items (posts) to peer |
| `heartbeat` | Outbound | Keep-alive every 8 seconds |
| `heartbeat-ack` | Response | Confirm peer is alive |

### 6. Lifecycle State Machine

```
off ──▶ connecting ──▶ online ──▶ (peer disconnects) ──▶ reconnecting ──▶ online
                         │                                      │
                         ▼                                      ▼
                    stop() → off                          3 failures → failed → off
```

### 7. UI Integration Points

| Component | Integration |
|---|---|
| `main.tsx` | Calls `autoStart()` on boot |
| `P2PStatusIndicator` (WiFi icon) | Subscribes to phase changes, toggles start/stop |
| `PostComposer` | Calls `broadcastNewPost()` on new post |
| `TestModePanel` (Dashboard) | Full control: start/stop, connect, library, block/unblock |
| Home/Explore/Posts pages | Listen for `p2p-posts-updated` event to refresh feeds |

### 8. Blocked Peers

- Stored in `localStorage` key `test-mode-blocked-peers`
- Incoming connections from blocked peers are immediately rejected
- Blocking removes peer from library and disconnects active connection
- Unblocking allows future connections but doesn't auto-reconnect

## Design Principles

1. **Zero imports** from other project modules — fully self-contained
2. **Singleton pattern** — one instance shared across all UI components
3. **No abort controllers** — clean lifecycle with promise races
4. **Identity is sacred** — same Peer ID across all sessions, all tabs
5. **Flags survive refresh** — `enabled: true` means auto-start on next page load
6. **Library survives refresh** — saved peers are auto-dialed on reconnection
7. **Content persists** — received posts written to IndexedDB for offline access

## Storage Keys Reference

| Key | Purpose |
|---|---|
| `test-mode-node-id` | Permanent 16-char hex node identity |
| `test-mode-flags` | `{ enabled, lastOnlineAt }` |
| `test-mode-connection-library` | Array of `LibraryPeer` objects |
| `test-mode-blocked-peers` | Array of blocked peer ID strings |

## PeerJS Configuration

- **Server**: `0.peerjs.com:443` (PeerJS Cloud, free tier)
- **ICE Servers**: Google STUN (`stun.l.google.com:19302`, `stun1.l.google.com:19302`)
- **Init Timeout**: 12 seconds
- **Reconnect Intervals**: 15s, 30s, 60s (then fail)
- **Heartbeat**: Every 8 seconds
- **Stale Threshold**: 30 seconds (prune unresponsive peers)
- **Content Sync**: Inventory exchange every 10 seconds
- **Library Re-dial**: Every 30 seconds
