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

### Private-Key Authorization
Only the private key corresponding to `owner_public_key` can authorize any of the lifecycle transactions. Release messages, in particular, require the signer to reference the prior claim's nonce so peers can ensure the relinquishment is intentional and not replayed from an earlier state. Handles cannot be reassigned until the release transaction or stake expiration is observed and verified by a quorum of peers.

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

## P2P Architecture (Phase 5 Preview)

### Peer Discovery
1. **Signaling server:** Lightweight server for initial peer introduction
2. **DHT bootstrap:** (Alternative) Use distributed hash table for serverless discovery
3. **Local network:** mDNS for LAN peer discovery

### Content Distribution
```
Alice wants a file from Bob:

1. Alice has manifest { fileId, chunks: [ref1, ref2, ...] }
2. Alice broadcasts: "Need chunks: [ref1, ref2]"
3. Bob has chunks, responds: "I have [ref1, ref2]"
4. Alice opens WebRTC datachannel to Bob
5. Alice requests: { type: "chunk", ref: "ref1" }
6. Bob sends: { type: "chunk", ref: "ref1", data: <encrypted chunk> }
7. Alice verifies: SHA256(data) === ref1
8. Alice stores chunk in local IndexedDB
9. Repeat for ref2
10. Alice decrypts and reassembles file
```

### Conflict Resolution (Collaborative Editing)
- **Strategy:** CRDT (Conflict-free Replicated Data Type)
- **For tasks/posts:** Use Yjs or Automerge for JSON CRDT
- **For text:** Use operational transform or Yjs Text CRDT
- **Vector clocks:** Track causality for event ordering

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

### Phase 5: P2P Swarm
- Add `peers` store to IndexedDB for known peers
- Implement Kademlia-style DHT for peer discovery
- Add gossip protocol for metadata propagation
- Implement tit-for-tat bandwidth sharing

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
