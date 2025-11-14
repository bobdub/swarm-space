# Imagination Network – Security Model

_Version 2.0 | Last Updated: 2025-11-14_

## Security Principles

1. **Zero-Knowledge Architecture**: No server ever sees plaintext user data
2. **Client-Side Encryption**: All encryption/decryption happens on user device
3. **Key Sovereignty**: Private keys never leave device unless explicitly exported
4. **Content Authenticity**: Ed25519 signatures prove content origin
5. **Defense in Depth**: Multiple encryption layers for different scopes

---

## Threat Model

### Assets
- **User Identity**: Ed25519 private keys, ECDH keypairs
- **Content**: Posts, files, projects, tasks
- **Social Graph**: Peer connections, follow relationships
- **Credits**: Internal economy tokens

### Adversaries
1. **Passive Observer**: Network-level eavesdropper (ISP, VPN, etc.)
2. **Active Manipulator**: Malicious peer attempting to inject/modify content
3. **Compromised Infrastructure**: Malicious rendezvous beacon or signaling server
4. **Malicious Client**: Rogue peer attempting to disrupt mesh or spam

### Attack Surfaces
- **Network Transport**: WebRTC data channels, signaling messages
- **Storage**: IndexedDB, localStorage
- **Identity**: Key generation, storage, backup/recovery
- **P2P Mesh**: Peer discovery, gossip protocol, chunk exchange

---

## Encryption Architecture

### Layer 1: Identity Keys (User)

**Algorithm**: ECDH (P-256) + AES-256-GCM

**Purpose**: Wrap user's long-term private keys

**Flow**:
1. User creates account with password
2. Derive wrapping key from password using PBKDF2 (100K iterations)
3. Generate ECDH keypair (P-256)
4. Encrypt private key with wrapping key
5. Store encrypted private key + salt in IndexedDB

**Threats Mitigated**:
- ✅ Storage compromise: Private key is encrypted at rest
- ✅ Network interception: Keys never transmitted
- ❌ Weak password: User responsibility (future: entropy check)
- ❌ Device theft: Encrypted, but vulnerable to keylogger/memory dump

**Implementation**: `src/lib/auth.ts`, `src/lib/crypto.ts`

---

### Layer 2: Rendezvous Identity (Ed25519)

**Algorithm**: Ed25519 signing

**Purpose**: Sign presence tickets, posts, and manifests for authenticity

**Flow**:
1. Generate Ed25519 keypair on first boot
2. Store in localStorage (`p2p-rendezvous-ed25519`)
3. Use private key to sign:
   - Presence tickets (P2P discovery)
   - Post content (author verification)
   - File manifests (integrity)
4. Peers verify signatures using public key

**Threats Mitigated**:
- ✅ Content tampering: Signature mismatch detected
- ✅ Impersonation: Attacker cannot forge signature without private key
- ✅ Replay attacks: Nonces + timestamps in signed payloads
- ❌ Key loss: Requires social recovery (Shamir's Secret Sharing)

**Implementation**: `src/lib/p2p/rendezvousIdentity.ts`, `src/lib/p2p/presenceTicket.ts`

---

### Layer 3: File Encryption

**Algorithm**: AES-256-GCM per-file, SHA-256 content addressing

**Purpose**: Encrypt files before storage and P2P sharing

**Flow**:
1. Generate random 256-bit AES key per file
2. Chunk file into 64KB blocks
3. For each chunk:
   - Generate random 12-byte IV
   - Encrypt chunk with AES-256-GCM (key + IV)
   - Hash ciphertext with SHA-256 → chunk reference
   - Store `{ ref, ciphertext, IV, seq }` in IndexedDB
4. Create manifest: `{ fileId, chunkRefs[], mimeType, size }`
5. Sign manifest with Ed25519 rendezvous key
6. Store manifest in IndexedDB

**Threats Mitigated**:
- ✅ Eavesdropping: Ciphertext unreadable without key
- ✅ Tampering: SHA-256 mismatch if chunk modified
- ✅ Replay: Chunk refs are deterministic from ciphertext
- ✅ Deduplication: Same content → same hash
- ❌ Metadata leakage: File size, chunk count visible to observers

**Implementation**: `src/lib/fileEncryption.ts`

---

### Layer 4: Project Keys (Shared Encryption)

**Status**: 🔐 Planned (Phase 4)

**Algorithm**: AES-256-GCM project key + per-member wrapping

**Purpose**: Encrypt shared project content (posts, files, tasks)

**Planned Flow**:
1. Project creator generates random 256-bit project key
2. For each member:
   - Derive shared secret using ECDH (creator ↔ member)
   - Wrap project key with shared secret (AES-GCM)
   - Store wrapped key in project metadata
3. Project content encrypted with project key
4. Key rotation on member join/leave

**Threats Mitigated**:
- ✅ Unauthorized access: Non-members cannot decrypt
- ✅ Member removal: Key rotation invalidates old keys
- ❌ Insider threat: Members see all project content
- ❌ Key distribution: Requires online coordination

---

## Content Authenticity

### Signing Pipeline

#### Posts
**Signed Fields**:
```json
{
  "author": "<user-id>",
  "content": "<post-text>",
  "manifestIds": ["<file-manifest-id>"],
  "projectId": "<project-id-optional>",
  "createdAt": "<timestamp>",
  "tags": ["<tag>"]
}
```

**Signature**: Ed25519 over canonical JSON (excluding signature field)

**Verification**:
- P2P post sync rejects unsigned posts
- Replication orchestrator refuses tampered posts
- UI can display authenticity badge

#### Manifests
**Signed Fields**:
```json
{
  "fileId": "<uuid>",
  "chunkRefs": ["<sha256-hash>"],
  "mimeType": "image/png",
  "totalSize": 123456,
  "createdAt": "<timestamp>"
}
```

**Signature**: Ed25519 over canonical JSON

**Verification**:
- Chunk protocol rejects invalid manifests
- Replication refuses unsigned manifests
- UI shows file authenticity status

---

## Identity Recovery

### Shamir's Secret Sharing

**Algorithm**: Shamir's Secret Sharing over GF(256)

**Purpose**: Recover Ed25519 rendezvous identity if device is lost

**Flow**:
1. User splits Ed25519 private key into N shares
2. Set threshold T (e.g., 3-of-5)
3. Each share looks like: `IDR1-<base64-blob>`
4. Distribute shares to trusted stewards (friends, family, secure storage)
5. On recovery:
   - Collect T shares
   - Recombine to reconstruct private key
   - Import identity into new device

**Threats Mitigated**:
- ✅ Device loss: Identity recoverable with T shares
- ✅ Single point of failure: No single share can recover identity
- ✅ Steward compromise: Attacker needs T shares
- ❌ Share tampering: Checksum validation catches corruption

**Implementation**: `src/lib/crypto/identityRecovery.ts`, `src/components/p2p/settings/IdentityRecoveryPanel.tsx`

---

## P2P Security

### Connection Security

**Transport**: WebRTC data channels with DTLS encryption

**Threat**: Man-in-the-middle during signaling

**Mitigation**:
- DTLS provides end-to-end encryption over WebRTC
- Presence tickets signed with Ed25519 (identity binding)
- Peer fingerprint verification (future: manual verification flow)

---

### Gossip Protocol Security

**Threat**: Malicious peer injects false messages

**Mitigation**:
- All posts signed with Ed25519
- Signature verification before accepting message
- Nonces prevent replay attacks
- TTL limits message propagation

**Threat**: Flood attack (spam mesh with messages)

**Mitigation**:
- Rate limiting (planned)
- Peer reputation system (planned)
- Block/ignore peer functionality

---

### Chunk Exchange Security

**Threat**: Attacker serves corrupted chunks

**Mitigation**:
- SHA-256 content addressing
- Hash mismatch → chunk rejected
- Request retried from different peer

**Threat**: Chunk request tracking (privacy leak)

**Mitigation**:
- No correlation between chunk requests
- Encrypted transport (WebRTC DTLS)
- Future: PIR (Private Information Retrieval)

---

## Alternate Transports Threat Model

### WebTorrent DHT
**Attack Surface**: BroadcastChannel metadata exposure

**Mitigation**:
- Mandatory signature checks on all messages
- Telemetry alerts on verification failures
- Rate limiting per peer

### GUN.js Overlay
**Attack Surface**: Gossip message authenticity

**Mitigation**:
- Optional message signing (planned)
- Timestamp freshness checks
- Peer reputation tracking

---

## Storage Security

### IndexedDB
**Threat**: Local storage compromise (malware, physical access)

**Mitigation**:
- Private keys encrypted with user password (PBKDF2)
- File chunks encrypted with per-file keys
- Ed25519 rendezvous key in localStorage (encrypted future)

**Threat**: Storage quota exhaustion (DoS)

**Mitigation**:
- Quota monitoring (planned)
- User warnings at 80% capacity
- Chunk garbage collection

---

## Authentication & Authorization

### Handle System
**Claim Schema**:
```json
{
  "username": "<handle>",
  "owner_public_key": "<ed25519-pubkey>",
  "timestamp": "<ms-since-epoch>",
  "nonce": "<monotonic-integer>",
  "signature": "<base64url-signature>"
}
```

**Security Properties**:
- **Replay Protection**: Nonces must strictly increase
- **Uniqueness**: Public key binding prevents impersonation
- **Portability**: Handle moves with private key

**Threat**: Nonce desync across peers

**Mitigation**:
- Validators persist highest observed nonce per handle
- Reject lower nonces
- Gossip nonce updates

---

## Network Security

### Signaling Server
**Trust Model**: Semi-trusted (metadata only)

**What Signaling Sees**:
- Peer IDs (ephemeral)
- Connection timing
- Approximate peer count

**What Signaling Does NOT See**:
- Post content (encrypted in WebRTC)
- File chunks (end-to-end encrypted)
- Identity keys (never transmitted)

**Mitigation for Malicious Signaling**:
- DTLS over WebRTC prevents signaling MITM
- Presence tickets signed (identity binding)
- Self-hostable signaling servers

---

### Rendezvous Beacons
**Trust Model**: Untrusted (can be malicious)

**What Beacons See**:
- Public keys in presence tickets
- Approximate peer locations
- Connection timing

**What Beacons Do NOT See**:
- Post content
- File chunks
- Private keys

**Mitigation**:
- Presence tickets signed (authenticity)
- Multiple beacons for redundancy
- Self-hostable beacons

---

## Streaming Security

### WebRTC Media Streams
**Encryption**: DTLS-SRTP (WebRTC default)

**Threat**: Eavesdropping on media

**Mitigation**:
- End-to-end DTLS encryption
- No server-side decryption (pure P2P mesh)
- TURN relays only see encrypted packets

**Threat**: Unauthorized room access

**Mitigation**:
- Invitation tokens (short-lived)
- Host approval for private rooms
- Ban/unban controls

---

## Monitoring & Alerts

### Security Events (Logged)
- Failed signature verifications
- Chunk hash mismatches
- Invalid presence tickets
- Peer connection failures
- Storage quota warnings

### Future: Automated Alerts
- Webhook notifications for anomalies
- Dashboard for security events
- Rate limit violations

---

## Compliance & Privacy

### GDPR
- **Right to Access**: Export account functionality
- **Right to Erasure**: Local deletion of all user data
- **Data Portability**: JSON export of all content
- **Consent**: Explicit P2P opt-in

### Zero-Knowledge Compliance
- No server sees plaintext (GDPR "processing")
- User controls all keys (Data Controller)
- Optional relay services are end-to-end encrypted

---

## Security Roadmap

### Immediate (Phase 5)
- ✅ Ed25519 signatures on posts/manifests
- ✅ Shamir's Secret Sharing recovery
- 🚧 Connection approval flow
- 🚧 Peer blocklist persistence

### Near-Term (Phase 6)
- Rate limiting + reputation system
- Peer fingerprint verification UI
- Storage quota monitoring
- Backup reminders

### Long-Term
- Post-quantum cryptography migration
- PIR for chunk requests
- HSM support for key storage
- Formal security audit

---

## Security Best Practices (Users)

1. **Strong Password**: Use 16+ character passphrase for account encryption
2. **Backup Identity**: Export account backup and store securely
3. **Shamir Recovery**: Split rendezvous key into 3-of-5 shares, distribute to trusted stewards
4. **Verify Peers**: Manually verify fingerprints for high-trust connections (future)
5. **Update Regularly**: Keep browser/app updated for security patches

---

## Security Contact

**Vulnerability Disclosure**: If you discover a security issue, please report it responsibly:
- Open a GitHub issue (if not critical)
- Email: [security contact needed]
- PGP key: [to be added]

Do not publicly disclose critical vulnerabilities before coordinated disclosure.

---

## Related Documentation
- [PROJECT_SPEC.md](./PROJECT_SPEC.md) - Technical specifications
- [GOALS_VISION.md](./GOALS_VISION.md) - Project goals
- [ROADMAP_PROJECTION.md](./ROADMAP_PROJECTION.md) - Development roadmap
- [security/content-authenticity.md](./security/content-authenticity.md) - Detailed signing guide
- [security/alternate-transports-threat-model.md](./security/alternate-transports-threat-model.md) - Transport security
