# Imagination Network - Architecture & Design Philosophy

---

## Core Principles

### 1. **Offline-First**
The application operates fully without a network connection. All data creation, storage, and retrieval happens locally. Network features (P2P sync) are additive, not required.

### 2. **Zero-Knowledge by Design**
No central server ever sees unencrypted user data. All encryption/decryption occurs on the user's device. Keys never leave the device unless explicitly exported by the user.

### 3. **Content-Addressed Storage**
Files are chunked and addressed by cryptographic hash (SHA-256). This enables:
- Deduplication (same chunk = same hash)
- Integrity verification (recompute hash on retrieval)
- Immutable content (hash changes if content changes)
- P2P distribution (request chunk by hash)

### 4. **Composable Security**
Multiple encryption layers for different scopes:
- **User keys:** ECDH for key exchange, AES-GCM for data
- **File keys:** Unique symmetric key per file
- **Project keys:** Shared symmetric key for group content
- **Transport:** (Future) DTLS over WebRTC for peer connections

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React UI Layer                     │
│  (Pages, Components, State Management)              │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────┐
│              Application Logic Layer                 │
│  • Feed algorithms  • Post creation  • Task mgmt    │
└─────────────────────┬───────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
┌────────▼─────┐  ┌──▼──────┐  ┌─▼─────────────┐
│ Crypto Layer │  │ Storage │  │ P2P Layer     │
│ (Web Crypto) │  │(IndexDB)│  │ (WebRTC)      │
│ • Key gen    │  │ • Chunks│  │ • Signaling   │
│ • Encryption │  │ • Meta  │  │ • DataChannel │
│ • Signatures │  │ • Posts │  │ (Future)      │
└──────────────┘  └─────────┘  └───────────────┘
```

---

## Data Flow

### Creating a Post with Files

```
1. User selects file(s) in FileUpload component
   ↓
2. Generate unique file key (AES-GCM 256-bit)
   ↓
3. Read file in chunks (64KB each)
   ↓
4. For each chunk:
   a. Generate random IV (12 bytes)
   b. Encrypt chunk with file key + IV
   c. Compute SHA-256 hash of ciphertext → chunk ref
   d. Store { ref, seq, cipher, iv, meta } in IndexedDB
   ↓
5. Create manifest { fileId, chunks: [refs...], mime, size }
   ↓
6. Store manifest in IndexedDB
   ↓
7. Create post { author, content, manifestIds: [...] }
   ↓
8. Store post in IndexedDB
   ↓
9. Update UI feed (React Query invalidation)
```

### Viewing a Post with Files

```
1. Load post from IndexedDB
   ↓
2. Retrieve manifest by manifestId
   ↓
3. For preview/thumbnail:
   a. Load first chunk by ref
   b. Decrypt chunk with file key
   c. Create Blob URL for preview
   ↓
4. For full download:
   a. Load all chunks in sequence
   b. Decrypt each chunk
   c. Concatenate into single Blob
   d. Trigger browser download
```

---

## Encryption Architecture

### Identity Keys (User)
- **Algorithm:** ECDH (P-256 curve)
- **Purpose:** 
  - Public key: user ID, verification, key exchange
  - Private key: decrypt received data, sign content
- **Storage:** 
  - Public key: stored in plaintext in localStorage + IndexedDB
  - Private key: wrapped with PBKDF2-derived key (200k iterations), stored in IndexedDB

### File Encryption Keys
- **Algorithm:** AES-GCM (256-bit)
- **Lifecycle:** Generated per file, stored in manifest
- **Distribution:** 
  - Personal files: file key encrypted with user's public key
  - Project files: file key encrypted with project's shared key

### Project Keys (Group)
- **Algorithm:** AES-GCM (256-bit)
- **Purpose:** Shared encryption for all project content
- **Distribution:** 
  - Encrypted separately for each member using their public key
  - Stored in project metadata as `{ memberId: encryptedProjectKey }`
  - New member: existing member encrypts project key with new member's public key

### Passphrase Derivation
- **Algorithm:** PBKDF2-SHA256
- **Iterations:** 200,000
- **Salt:** 16 bytes random (unique per user)
- **Output:** 256-bit key for AES-GCM wrapping of private key

---

## Handle Claim Architecture

### Signed Handle Schema
Handle claims, renewals, and releases are transmitted as compact signed payloads. Every payload serializes to JSON using the follow schema:

```json
{
  "username": "<handle in normalized form>",
  "owner_public_key": "<hex-encoded public key controlling the handle>",
  "timestamp": "<milliseconds since epoch>",
  "nonce": "<monotonic per-handle integer>",
  "signature": "<base64url signature over the canonical payload>"
}
```

- **`username`**: Lowercase Unicode Normalization Form C (NFC). Multi-step validation rejects visually confusable characters during verification.
- **`owner_public_key`**: Either Ed25519 (preferred) or Secp256k1, encoded as hexadecimal. The key fingerprint matches the swarm identity used during handshakes.
- **`timestamp`**: Millisecond precision to allow tight replay windows and cross-node ordering.
- **`nonce`**: Ever-increasing integer for the specific `username`, ensuring uniqueness even when timestamps collide.
- **`signature`**: Detached signature computed with the owner's private key over the canonical JSON string prior to attaching the signature field (i.e., sign `{username, owner_public_key, timestamp, nonce}`).

### Economic Anti-Spam Options
Nodes accept a handle claim only when the signed schema is accompanied by either of the following proof-of-intent mechanisms:

- **Staking:** The claimant escrows a minimum stake amount referenced in the transaction metadata. Stake size can scale with handle length or reuse history. Nodes track escrow proofs in a sidecar ledger and refuse competing claims while the stake remains bonded.
- **Proof-of-Work:** Alternatively, the claimant submits a PoW digest whose difficulty target is dynamically tuned (e.g., require SHA3 digest with `n` leading zero bits). The PoW ties directly to `{username, owner_public_key, nonce}` to prevent precomputation and is verified alongside the signature.

Nodes may choose policy preferences, but interop requires that every validator understands both staking receipts and PoW headers so that offline peers can audit claim validity once connectivity resumes.

### Rate Limiting & Thresholds for Handle Registrations

To slow mass registrations while preserving offline-first ergonomics, validators enforce a layered throttle that can be tuned per community:

| Control Surface | Default Threshold | Adaptive Rule |
| --- | --- | --- |
| **Submission cadence** | Max 3 handle attempts per device per rolling hour. | Halve allowance for devices that fail more than 5 validations within 24 hours. |
| **Stake floor** | 5 Node Credits bonded for handles ≥8 chars, 8 Credits for 5–7 chars, 13 Credits for vanity handles <5 chars. | Community governance can raise floors by quorum vote (see _Deterministic Resolution & DAO Escalation_). |
| **Stake ageing** | Bond must remain locked for 72h before release. | Extend to 168h when the namespace backlog exceeds 60% capacity. |
| **PoW difficulty** | SHA3-256 hash with 18 leading zero bits. | Increase by 2 zero bits for every 500 failed attempts broadcast over gossip within a 10-minute window. |
| **Namespace back-pressure** | Reject new claims once a peer observes >30 pending disputes in the last hour. | Auto-clear when disputes fall below 10. |

Validators treat throttles deterministically. A request failing any threshold is rejected with a signed denial receipt so peers can replicate the decision during sync.

### Validation Pipeline & Swarm Handshake Integration
Validation occurs as part of the swarm handshake flow:

1. **Handshake Phase 1 – Identity Exchange:** Devices exchange public keys and negotiate ephemeral session secrets (see _Swarm Handshake Protocol_ in `Private-Key.md`).
2. **Phase 2 – Handle Assertion:** The claimant presents the signed payload and selected anti-spam proof. Peers first confirm the public key matches the handshake identity.
3. **Phase 3 – Signature Verification:** Validators canonicalize the payload, recompute the signature using the advertised key, and reject mismatches.
4. **Phase 4 – Replay Protection:** Peers consult local handle state. The `timestamp` must fall within an acceptable drift window (configurable, e.g., ±5 minutes), and the `nonce` must be strictly greater than the latest recorded nonce for the handle.
5. **Phase 5 – Economic Proof Validation:** Staking receipts are cross-checked against ledger records; PoW headers are recomputed to ensure the required difficulty target.
6. **Phase 6 – State Commit:** Once validated, the handle state is updated locally, and the transaction is propagated across connected swarm peers for eventual convergence.

### Lifecycle Transactions
Handle ownership evolves through three signed transaction types that reuse the core schema:

- **Claim/Issue:** Establishes ownership. The payload's contextual metadata includes the stake or PoW proof and optional profile data pointers. Nonce resets to `0` for a new claimant.
- **Renewal:** Extends ownership without changing `username`. Requires the existing owner to sign a new payload with incremented nonce. Nodes interpret renewals as keep-alive signals; missing renewals trigger expiration policies or stake slashings.
- **Release:** Allows owners to relinquish control voluntarily. The signed payload includes an explicit `action: "release"` extension and references the handle's most recent stake commitment. Upon validation, nodes mark the handle as available, release bonded stake, and broadcast the relinquishment event.

Each transaction stores ancillary metadata (e.g., `action`, staking receipts, PoW header) adjacent to the signed payload so that verifiers can reconstruct state transitions without modifying the canonical signature schema.

### Offline Claim State Caching

Handles are tracked locally inside the `handleClaims` object store (IndexedDB v6+). Each record stores:

- `username`: normalized string key.
- `status`: `"unclaimed" | "claimed" | "pending" | "conflicted" | "cooldown"`.
- `ownerPublicKey`: last accepted owner fingerprint.
- `nonce` and `timestamp`: most recent monotonic data.
- `proof`: opaque stake/PoW receipt blob for audit trails.
- `source`: `"local" | "peer" | "council"`, so the UI can badge provenance.
- `lastSeenAt`: `Date` used by the wireframe's `Last synced` indicator.

During offline usage, the composer consults this cache to surface deterministic answers immediately. The cache is hydrated whenever a peer shares `handle.snapshot` gossip or the device commits a local transaction. Stale entries age out only when conflicting receipts arrive, so a user can recover historical context during long offline windows.

### Deferred Broadcast Queue

When the device signs a handle transaction without available peers, it is written to the `p2pOutbox` store with the following shape:

```json
{
  "id": "<uuid>",
  "type": "handle.claim" | "handle.renew" | "handle.release",
  "payload": { /* signed payload as defined above */ },
  "proof": { /* stake receipt or pow digest */ },
  "nextAttempt": "<iso timestamp>",
  "retryCount": 0,
  "maxAttempts": 12,
  "createdAt": "<iso timestamp>"
}
```

A service worker alarm wakes every 15 minutes (configurable) to sweep the queue. If WebRTC sessions are unavailable, the job defers `nextAttempt` by an exponential backoff capped at four hours. Users can invoke "Force sync" from the UI, which triggers the worker via `navigator.serviceWorker.postMessage({ kind: "outbox.flush", scope: "handles" })`.

### Gossip & API Surface

Handle propagation relies on P2P gossip messages. Each payload is enveloped in CBOR for compact transmission and multiplexed over the existing WebRTC data channel namespace `handles`:

| Message | Direction | Body | Description |
| --- | --- | --- | --- |
| `handle.snapshot` | Peer → Peer | `{ handles: HandleSummary[] }` | Periodic digest advertised on connection; summaries include username, nonce, status, and optional conflict hash. |
| `handle.claim` | Peer ↔ Peer | `{ payload, proof, seenAt }` | Broadcast whenever a new claim/renew/release leaves the outbox. Receivers validate then update caches. |
| `handle.conflict` | Peer ↔ Peer | `{ username, localDigest, remoteDigest, receipts[] }` | Sent when a node detects competing claims. Enables peers to display conflict banners immediately. |
| `handle.ack` | Peer → Peer | `{ transactionId, accepted: boolean, reason? }` | Mirrors API semantics. Positive ACKs allow the sender to clear its outbox entry; negative responses capture deterministic denial receipts. |
| `handle.requestFragments` | Recovering device → Peer | `{ username, sinceNonce }` | Part of recovery flow; asks peers to stream historical receipts beyond a known nonce. |
| `handle.fragment` | Peer → Recovering device | `{ username, payload, proof, ledgerMeta }` | Streams signed receipts piecemeal so large histories can resume across intermittent links. |

If an optional council relay is configured, the same envelope maps to HTTPS endpoints under `/api/handles/*` so hybrid deployments can ship audit logs to a trusted quorum:

- `POST /api/handles/transactions` – Accepts the same `{ payload, proof }` structure as `handle.claim`. Returns a signed ACK for eventual consistency with offline devices.
- `GET /api/handles/snapshot?since=<nonce>` – Provides a paginated view of handle summaries, used during recovery when no peers are reachable.
- `POST /api/handles/conflicts` – Records disputes raised by peers and triggers governance workflows.

### Conflict Detection & Notification

Upon receiving a remote transaction, the validator compares `{ username, nonce }` with cache state. A lower or equal nonce triggers a denial receipt and a `handle.conflict` gossip message that includes both payload digests. The UI surfaces this via the "Conflict Notification" toast wired to a background sync channel: when the service worker posts a `conflict` event, the React app raises the toast and opens the resolution modal with data read from IndexedDB.

Conflicts persist until one of three deterministic outcomes is observed:

1. A higher-nonce transaction signed by the recognized owner (auto-resolves).
2. A council-signed adjudication receipt that sets the authoritative owner.
3. A timeout expires (default 72h) and quorum rules slash the stale stake, freeing the handle.

Each outcome clears the conflict flag in the cache and emits a `handle.ack` with `reason: "resolved"`.

### Device Recovery & Handle Rehydration

During device restore, the onboarding flow spins up a dedicated recovery coordinator:

1. **Bootstrap identity** – User imports encrypted private key bundle. Once decrypted, the coordinator queries IndexedDB to ensure the public key matches previously bonded handles.
2. **Discover peers** – The P2P manager requests `handle.snapshot` messages. Missing usernames trigger targeted `handle.requestFragments` calls with the last known nonce (initially `-1`).
3. **Fragment assembly** – Peers respond with ordered `handle.fragment` messages. Each fragment is validated (signature, nonce progression, stake receipts) before being written to `handleClaims` and appended to an in-memory Merkle accumulator for audit.
4. **Conflict resolution** – If fragments disagree, the coordinator flags the handle as `conflicted` and surfaces the conflict modal once the UI layer mounts. Users can compare receipts and escalate.
5. **Finalization** – After all expected fragments reconcile, the coordinator derives deterministic `claimHash` values so the UI can show inclusion heights and renewal reminders. The recovery checklist state in the wireframes marks completion only when all locally owned handles reflect the latest nonce and have at least one peer signature in their receipt set.

For air-gapped recoveries, users can import fragments via QR code bundles or USB payloads encoded with the same CBOR structures. The validator path remains identical, ensuring deterministic outcomes regardless of transport.

### Private-Key Authorization
Only the private key corresponding to `owner_public_key` can authorize any of the lifecycle transactions. Release messages, in particular, require the signer to reference the prior claim's nonce so peers can ensure the relinquishment is intentional and not replayed from an earlier state. Handles cannot be reassigned until the release transaction or stake expiration is observed and verified by a quorum of peers.

### Username Registry Ledger Module

The username registry extends the handle claim pipeline with a deterministic ledger that every peer can audit. The registry combines append-only Merkle proofs with fast lookup tables so lightweight devices can verify the global namespace without replaying every transaction.

#### Canonical Data Structures

- **Registry Log (Merkle Tree):**
  - Append-only tree where each leaf represents a normalized `username` event (claim, renewal, release) with its signed payload hash and anti-spam proof digest.
  - Internal nodes are computed with SHA3-256 over the concatenated child hashes to improve collision resistance over SHA-256 content chunks.
  - Each node stores `{hash, height, span}` metadata so peers can answer partial inclusion proofs when exchanging deltas.
  - The tree root at block height `n` becomes the canonical registry checkpoint advertised during swarm handshakes and periodic sync.
- **Availability Index (Hash Set):**
  - Maintains the current availability state keyed by normalized usernames.
  - Values store `{owner_public_key, nonce, expiry, stake_ref}`.
  - Implemented as a deterministic hash set (e.g., Robin Hood hashing) seeded from the Merkle log so the set can be reconstructed by folding all leaves up to the latest root.
  - Provides O(1) membership checks during validation while the Merkle tree supplies tamper-evident history.

#### Synchronization Cadence

- **Gossip Broadcast:**
  - Every validated registry event is broadcast over the swarm gossip channel within 2 seconds of commit.
  - Gossip payload includes the event leaf hash, compact inclusion proof against the sender's latest root, and a diff summary of impacted usernames.
  - Peers stash unseen leaves in a pending buffer and request missing ancestors before mutating local state.
- **Delta Exchange Windows:**
  - At a configurable cadence (default 5 minutes) peers execute a delta sync with directly connected neighbors.
  - Delta requests contain `{from_root, to_root}` allowing peers to stream only the Merkle path segments needed to advance the requester.
  - When the root difference exceeds 256 leaves, peers upgrade to a range sync that transfers checkpoint snapshots (batched Merkle layers plus serialized hash-set shards).
- **Checkpoint Anchoring:**
  - Every hour nodes snapshot the registry state (Merkle root + hash-set bloom filter) and sign the tuple with their device key.
  - Snapshots are exchanged opportunistically to accelerate cold-start devices and to detect inconsistent histories early.

#### Quorum & Conflict Arbitration

- **Quorum Definition:**
  - A registry state transition is considered final when observed from ≥⅔ of the trusted peer set defined by the user's contact graph or community trust list.
  - Peers maintain rolling tallies of signed checkpoint endorsements. Once a quorum endorses a root, local nodes mark earlier conflicting roots as invalid.
- **Conflict Handling:**
  - If two forks claim the same username with different payloads, peers compare the Merkle inclusion proofs. The branch anchored by the higher cumulative stake (sum of bonded stakes across the divergent leaves) is preferred.
  - When cumulative stake ties, the branch with the lexicographically smaller root hash is selected deterministically.
  - Peers unable to reach quorum fall back to read-only mode for that username, rejecting new operations until a supermajority endorsement resolves the fork.
- **Dispute Resolution Messages:**
  - Nodes detecting inconsistency emit `registry_dispute` gossip frames summarizing competing leaf hashes, associated proofs, and their observed endorsements.
  - Receivers replay the proofs against their own state; if mismatch persists, they trigger a delta sync from multiple neighbors to triangulate the authoritative branch.

#### Deterministic Resolution Order & DAO Escalation

Conflicting registry events resolve through a deterministic ladder so peers converge before invoking social governance:

1. **Protocol Validity:** Reject any event that fails signature, PoW, or staking verification. Invalid events never enter higher stages.
2. **Nonce & Timestamp Ordering:** Prefer the event with the highest nonce. If nonce matches, prefer the lower timestamp within the allowable drift window.
3. **Economic Weight:** Compare bonded stake; higher effective stake (amount × remaining lock duration) wins. If equal, compare cumulative PoW difficulty.
4. **Quorum Observation:** Accept the event whose inclusion proof has endorsements from ≥⅔ of trusted peers. Nodes cache endorsement tallies per event hash.
5. **Local Determinism:** If steps 1–4 tie, derive a hash over `{event_hash, latest_root_hash, governance_epoch}` and select the lexicographically smaller digest so every peer lands on the same tentative outcome.
6. **DAO Escalation:** Peers flag the disputed username in the governance queue and broadcast a `dao_vote_request` frame containing competing proofs and the deterministic tie-break digest. The DAO opens a 24-hour voting window where token- or reputation-weighted members ratify one event or mandate a rerun with raised thresholds. DAO decisions are signed as governance directives for replay safety.

Nodes cache DAO resolutions as signed governance directives. During sync, peers apply directives before replaying pending disputes to avoid re-litigating settled cases.

#### Monitoring & Alerting Hooks

Swarm tooling instruments dispute-handling and registration pipelines with observable signals so operators can intervene before abuse cascades:

- **Registration Flood Detection:** Emit a `registry_alert` when a device submits more than 10 failed attempts in 15 minutes or when global failure counts breach 200 per hour. Alerts recommend temporarily raising PoW difficulty.
- **Stake Abuse Watch:** Trigger `stake_anomaly` when stake releases for a handle occur within 10% of the minimum lock duration for three consecutive cycles, signalling potential stake cycling to monopolize names.
- **Consensus Drift:** Fire `quorum_stall` when a namespace stays in read-only mode longer than 6 hours. Tooling suggests initiating DAO escalation ahead of the 24-hour window.
- **DAO Vote Integrity:** Emit `dao_audit_required` if fewer than 40% of eligible governors participate in a vote or if vote receipts fail signature validation.
- **Telemetry Export:** All alerts append structured metadata `{event_hash, peer_id, timestamp, governance_epoch}` and stream to local dashboards or optional webhooks so autonomous agents can apply remediation policies.

---

## Storage Schema (IndexedDB)

### Store: `chunks`
```typescript
{
  ref: string;          // SHA-256 hash (hex) of cipher+seq
  seq: number;          // Chunk sequence number (0-indexed)
  total: number | null; // Total chunks in file
  size: number;         // Chunk size in bytes
  iv: string;           // Base64-encoded IV
  cipher: string;       // Base64-encoded ciphertext
  meta: {
    mime?: string;
    originalName?: string;
  }
}
```

### Store: `manifests`
```typescript
{
  fileId: string;       // Unique file identifier
  chunks: string[];     // Ordered array of chunk refs
  mime?: string;        // MIME type
  size?: number;        // Original file size
  createdAt: string;    // ISO 8601 timestamp
  owner?: string;       // userId
}
```

### Store: `posts`
```typescript
{
  id: string;
  author: string;       // userId
  projectId: string | null;
  type: 'text' | 'image' | 'video' | 'file' | 'link';
  content: string;
  manifestIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Store: `projects`
```typescript
{
  id: string;
  name: string;
  description: string;
  members: string[];    // Array of userIds
  feedIndex: string[];  // Array of postIds
  planner: {
    milestones: Milestone[];
  };
  tasks: { [taskId: string]: Task };
  meta: {
    createdAt: string;
    projectKey?: string; // Encrypted project key
  }
}
```

### Store: `meta`
```typescript
{
  k: string;  // Key (e.g., "wrappedKey:userId", "setting:theme")
  v: any;     // Value (arbitrary JSON)
}
```

---

## Security Threat Model

### In-Scope Threats
1. **Device theft:** Private key is encrypted with passphrase; attacker needs passphrase
2. **Browser compromise:** Malicious extension could access decrypted data in memory
3. **Network eavesdropping:** (Future P2P) All data encrypted in transit via DTLS
4. **Malicious peers:** (Future P2P) Signature verification prevents content tampering

### Out-of-Scope (Current Phase)
1. **Side-channel attacks:** Timing attacks on crypto operations
2. **Physical attacks:** Hardware keyloggers, screen capture
3. **Social engineering:** Phishing for passphrases
4. **Supply chain:** Compromised dependencies or build pipeline

### Mitigations Implemented
- ✅ Passphrase-protected private keys
- ✅ Unique IV per encryption operation
- ✅ Content-addressed storage (integrity via hash)
- ✅ Key export/import for device migration
- ✅ No plaintext storage of private keys

### Future Mitigations (Post-MVP)
- 🔄 Implement Ed25519 signatures for content provenance
- 🔄 Add HKDF for key derivation
- 🔄 Use Web Workers to isolate crypto operations
- 🔄 Implement secure key deletion (overwrite memory)
- 🔄 Add rate limiting on passphrase attempts

---

## P2P Architecture (Implemented)

### Overview
The Imagination Network uses **PeerJS** for zero-configuration peer-to-peer networking. This enables cross-device content sharing without requiring backend infrastructure or manual server deployment.

### Architecture Stack

```
┌─────────────────────────────────────┐
│         React UI Layer              │
│  (Connection Manager, P2P Status)   │
├─────────────────────────────────────┤
│         P2P Manager                 │
│    (Orchestration & Events)         │
├─────────────────────────────────────┤
│  PeerJS    │ Discovery │ Connections│
│  Adapter   │ Protocol  │ (IndexedDB)│
├────────────┴───────────┴────────────┤
│   Chunk & Post Sync Protocols       │
├─────────────────────────────────────┤
│ PeerJS Cloud │ WebRTC P2P │ IndexedDB
│  (Signaling) │(Data Chnl) │ (Storage)
└─────────────────────────────────────┘
```

### PeerJS Integration

**What is PeerJS?**
- Open-source WebRTC wrapper library
- Provides cloud-hosted signaling by default
- Simplifies peer-to-peer connections
- Handles NAT traversal automatically (STUN/TURN)

**External Dependency:**
- **Service**: PeerJS Cloud (https://peerjs.com/)
- **Purpose**: WebRTC signaling only (peer discovery & connection setup)
- **Data Flow**: Once peers connect, all data flows directly P2P
- **Privacy**: Signaling server only sees connection metadata, never content
- **Alternative**: Self-hosted PeerJS server for private deployments

**Why PeerJS?**
1. ✅ **Zero Configuration**: No .env files or server setup
2. ✅ **Cross-Device**: Works across different networks/devices
3. ✅ **Reliable**: Maintained infrastructure with NAT traversal
4. ✅ **Simple**: Abstracts WebRTC complexity
5. ✅ **Free Tier**: Sufficient for most use cases

### Peer Discovery & Connection Flow

```
1. User enables P2P in app
   ↓
2. PeerJSAdapter initializes connection to PeerJS Cloud
   ↓
3. Receives unique Peer ID (e.g., "peer-abc123")
   ↓
4. User clicks "Connections" → Browse available users
   ↓
5. Click "Connect" on another user
   ↓
6. Connection stored in IndexedDB
   ↓
7. If peer is online, PeerJS establishes WebRTC connection
   ↓
8. Direct P2P data channel created
   ↓
9. Peers announce available content (manifest hashes)
   ↓
10. Automatic content synchronization begins
```

### Connection Management

**User Connections** (`src/lib/connections.ts`)
- Bidirectional user relationships stored in IndexedDB
- Tracks connection status (pending, connected, blocked)
- Links user IDs to Peer IDs for P2P routing
- Persists across sessions

**Connection UI** (`src/components/PeerConnectionManager.tsx`)
- Browse available users
- One-click connect/disconnect
- Search users by name
- View connection status
- Navigate to user profiles

### Content Distribution

```
Alice wants a file from Bob:

1. Alice & Bob are connected (via Connection Manager)
   ↓
2. Both have P2P enabled with PeerJS
   ↓
3. PeerJS establishes WebRTC data channel
   ↓
4. Bob announces available manifests: [manifest1, manifest2]
   ↓
5. Alice sees Bob has content she needs
   ↓
6. Alice requests chunk: { type: "chunk", hash: "sha256-abc..." }
   ↓
7. Bob sends encrypted chunk via P2P data channel
   ↓
8. Alice validates: SHA256(chunk) === hash
   ↓
9. Alice stores chunk in IndexedDB
   ↓
10. Alice decrypts and reassembles file when all chunks received
```

### Post Synchronization

**Post Sync Protocol** (`src/lib/p2p/postSync.ts`)
- Broadcasts new posts to connected peers
- Requests posts from peers on connection
- Deduplicates posts by ID
- Stores synced posts in IndexedDB

**Benefits:**
- See connected users' content immediately
- No manual import/export needed
- Automatic updates when peers post
- Works offline (posts cached locally)

### Security Considerations

**Data Security:**
- ✅ All file chunks encrypted before P2P transfer (AES-GCM)
- ✅ Content-addressed storage (hash validation)
- ✅ No plaintext data ever sent over network
- ✅ Peer authentication via user IDs

**Network Security:**
- ✅ WebRTC uses DTLS encryption (built-in)
- ✅ Direct P2P connections (no relay after handshake)
- ⚠️ PeerJS Cloud sees connection metadata (Peer IDs, timestamps)
- ⚠️ No server-side content inspection possible (all encrypted)

**Privacy Implications:**
- PeerJS Cloud logs connection attempts for service operation
- Peer IDs are semi-public (shared with connected users)
- Content discovery is opt-in (enable P2P to participate)
- Users control what content they share (via connections)

### Self-Hosted PeerJS (Optional)

For full control and privacy:
1. Deploy PeerJS server: https://github.com/peers/peerjs-server
2. Configure client in `src/lib/p2p/peerjs-adapter.ts`
3. Update PeerJS initialization with custom server URL
4. All signaling routes through your infrastructure

**Benefits:**
- Complete control over signaling infrastructure
- No third-party dependency
- Custom rate limiting and access controls
- Audit logs for compliance

### Conflict Resolution (Future)
- **Strategy**: CRDT (Conflict-free Replicated Data Type)
- **For tasks/posts**: Yjs or Automerge for JSON CRDT
- **For text**: Operational transform or Yjs Text CRDT
- **Vector clocks**: Track causality for event ordering

---

## Performance Considerations

### Chunking Strategy
- **Size:** 64KB per chunk (balance between overhead and granularity)
- **Why?** 
  - Small enough to fit in WebRTC datachannel messages (max 256KB)
  - Large enough to avoid excessive IndexedDB transactions
  - Enables streaming (progressive decryption)

### Memory Management
- **Problem:** Encrypting 100MB file loads 100MB into memory
- **Solution:** Stream encryption
  ```typescript
  const reader = file.stream().getReader();
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    // Encrypt and store 'value' chunk immediately
  }
  ```

### IndexedDB Transaction Batching
- **Problem:** Creating 1000 chunks = 1000 transactions (slow)
- **Solution:** Batch writes in single transaction
  ```typescript
  const tx = db.transaction('chunks', 'readwrite');
  for (const chunk of chunks) {
    tx.objectStore('chunks').put(chunk);
  }
  await tx.complete;
  ```

### Query Optimization
- **Problem:** Scanning 10k posts to filter by projectId
- **Solution:** Add indexes to IndexedDB
  ```typescript
  db.createObjectStore('posts', { keyPath: 'id' })
    .createIndex('projectId', 'projectId', { unique: false });
  ```

---

## Design Decisions & Tradeoffs

### Why IndexedDB instead of localStorage?
- ✅ Can store binary data (Blobs)
- ✅ Much larger quota (50MB+ vs 5MB)
- ✅ Asynchronous (non-blocking)
- ✅ Supports indexes and queries
- ❌ More complex API (mitigated with wrapper)

### Why ECDH instead of RSA?
- ✅ Smaller key sizes (256-bit ECDH ≈ 3072-bit RSA)
- ✅ Faster key generation
- ✅ Better for key exchange (Diffie-Hellman property)
- ✅ Native browser support (Web Crypto API)

### Why AES-GCM instead of AES-CBC?
- ✅ Authenticated encryption (prevents tampering)
- ✅ No padding oracle attacks
- ✅ Faster in hardware
- ❌ Nonce reuse is catastrophic (mitigated with random IVs)

### Why chunk files at all?
- ✅ Enables progressive download/upload
- ✅ Simplifies P2P (request chunks independently)
- ✅ Deduplication (same chunk = same hash)
- ✅ Parallelization (download chunks from multiple peers)
- ❌ Overhead of manifest management

---

## Future Architecture Evolution

### Phase 3: Social Graph
- Store follow/follower relationships in IndexedDB
- Implement graph traversal for "friends of friends"
- Add privacy settings (public/private posts)

### Phase 5: P2P with PeerJS ✅
- ✅ PeerJS integration for zero-config signaling
- ✅ Cross-device peer discovery
- ✅ User connection management system
- ✅ Content distribution protocol
- ✅ Post synchronization
- ✅ Connection manager UI

### Phase 5.2: Social P2P (Planned)
- Add connection filtering to feed
- Implement connection requests/approvals
- Add block/unblock functionality
- Connection recommendations
- Performance optimizations

### Phase 6: Mobile & Desktop
- Port to React Native (mobile)
- Port to Tauri (desktop)
- Sync across devices via P2P or optional cloud backup
- Add push notifications via service worker

---

## References & Further Reading
- [Web Crypto API Spec](https://www.w3.org/TR/WebCryptoAPI/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [WebRTC Primer](https://webrtc.org/getting-started/overview)
- [AES-GCM Security Considerations](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Content-Addressed Storage (IPFS)](https://docs.ipfs.io/concepts/content-addressing/)
- [CRDTs for Distributed Systems](https://crdt.tech/)
