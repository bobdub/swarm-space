# SWARM Space Encryption Architecture V2
**Date:** 2025-11-28  
**Status:** Active Design  

---

## Critical Issue with V1

**Problem:** Content was encrypted with creator's public key using ECDH, meaning only the creator (with their private key) could decrypt it. Other peers couldn't read posts/comments even though they should be able to.

**Root Cause:** Confusion between:
- **Authentication** (proving who created content) ✅ Already working
- **Confidentiality** (controlling who can read content) ❌ Was broken

---

## Encryption Levels

### Level 1: Public Social Content (Posts, Comments)
**Goal:** Everyone in the mesh can read, but content is authenticated and secured in transit/storage

**Flow:**
```
Creator → [Sign with Ed25519] → [Chunk] → [Encrypt for Transport] → Mesh Peers
Mesh Peers → [Decrypt Transport] → [Verify Signature] → [Display]
```

**Stages:**
1. **Stage A: Content Signing**
   - Creator signs content with their Ed25519 private key
   - Signature embedded in post/comment metadata
   - Peers verify signature using creator's public key

2. **Stage B: Chunking**
   - Content split into chunks: `[PeerID][UserData][MetaData][ChunkEnd]`
   - Each chunk signed by transmitting peer

3. **Stage C: Transport Encryption**
   - Encrypt chunks for P2P transmission using **recipient's public key** (ECDH)
   - Each peer decrypts with their own private key
   - Prevents network eavesdropping

4. **Stage D: Local Storage**
   - Store **signed plaintext** locally (or encrypted with user's own key)
   - Fast access, no decryption needed for display
   - HMAC protection prevents tampering

**Key Insight:** Content is **signed** (not encrypted) for social sharing. Transport is encrypted for security.

---

### Level 2: Private Content (DMs, Private Groups)
**Goal:** Only specific recipients can read content

**Flow:**
```
Creator → [Encrypt with Recipient PubKey] → [Sign] → [Chunk] → [Encrypt for Transport] → Recipient
Recipient → [Decrypt Transport] → [Verify Signature] → [Decrypt Content] → [Display]
```

**Stages:**
1. **Stage A: Content Encryption**
   - Encrypt with recipient's public key (ECDH)
   - Only recipient can decrypt with their private key

2. **Stage B: Content Signing**
   - Sign encrypted payload to prove creator identity

3. **Stage C+D:** Same as Level 1

---

### Level 3: Files (Attachments, Media)
**Goal:** Efficient storage/distribution, authenticated, optionally private

**Flow:**
```
Creator → [Hash File] → [Encrypt (optional)] → [Chunk] → [Sign Manifest] → Store/Distribute
Peers → [Fetch Chunks] → [Verify Manifest] → [Reassemble] → [Decrypt (if private)] → [Display]
```

**Stages:**
1. **Stage A: File Processing**
   - Hash file for integrity (SHA-256)
   - Optionally encrypt file with symmetric key
   - Symmetric key encrypted with recipient public keys (for private files)

2. **Stage B: Manifest Creation**
   - Manifest lists all chunks with hashes
   - Creator signs manifest with Ed25519

3. **Stage C: Chunk Distribution**
   - Chunks stored in DHT/mesh
   - Peers fetch and verify against manifest

---

## Revised Encryption Primitives

### For Public Content
```typescript
// Sign content for authenticity
export async function signContent(
  content: string,
  signerPrivateKey: string
): Promise<ContentSignature> {
  // Ed25519 signature
  // Returns { signature, publicKey, contentHash }
}

// Verify content signature
export async function verifyContentSignature(
  content: string,
  signature: ContentSignature
): Promise<boolean> {
  // Verify Ed25519 signature
  // Check contentHash matches
}
```

### For Transport Security
```typescript
// Encrypt chunk for specific peer
export async function encryptForPeer(
  chunk: SecureChunk,
  recipientPublicKey: string
): Promise<EncryptedChunk> {
  // ECDH with recipient's public key
  // Recipient decrypts with their private key
}

// Decrypt chunk from peer
export async function decryptFromPeer(
  encryptedChunk: EncryptedChunk,
  myPrivateKey: string
): Promise<SecureChunk> {
  // ECDH decryption
}
```

### For Private Content
```typescript
// Encrypt content for specific recipients
export async function encryptForRecipients(
  content: string,
  recipientPublicKeys: string[]
): Promise<EncryptedPrivateContent> {
  // Generate symmetric key
  // Encrypt content with symmetric key
  // Encrypt symmetric key for each recipient
}
```

---

## Implementation Strategy

### Phase 1: Public Content (Immediate)
1. ✅ Content signing already exists (Ed25519 in replication.ts)
2. 🔄 Remove content-level encryption for public posts
3. 🔄 Keep transport encryption (peer-to-peer)
4. 🔄 Store signed plaintext locally with HMAC protection

### Phase 2: Private Content (Future)
1. Add recipient-based encryption for DMs
2. Implement group keys for private groups
3. Key rotation mechanisms

### Phase 3: Advanced Features (Future)
1. End-to-end encrypted reactions
2. Encrypted search indexes
3. Forward secrecy for messages

---

## Security Properties

### Public Posts
- ✅ **Authenticity:** Ed25519 signatures prove creator
- ✅ **Integrity:** Content hash prevents tampering
- ✅ **Transport Security:** ECDH encryption in transit
- ✅ **Storage Security:** HMAC protection at rest
- ❌ **Confidentiality:** Content is readable by all peers (intended)

### Private Messages
- ✅ **Authenticity:** Ed25519 signatures
- ✅ **Integrity:** Content hash
- ✅ **Transport Security:** ECDH encryption
- ✅ **Storage Security:** HMAC protection
- ✅ **Confidentiality:** Only recipients can decrypt

### Files
- ✅ **Authenticity:** Manifest signatures
- ✅ **Integrity:** Per-chunk hashes in manifest
- ✅ **Transport Security:** Encrypted chunks
- ✅ **Deduplication:** Content-addressed storage
- ⚠️ **Confidentiality:** Optional encryption for private files

---

## Migration from V1

1. **Existing encrypted posts:** Attempt V1 decryption, re-save as signed plaintext
2. **New posts:** Sign only (no content encryption)
3. **Backward compatibility:** Support both formats during transition
4. **Clear user education:** Explain that public posts are signed, not encrypted

---

## Conclusion

The V2 architecture correctly separates:
- **Authentication** (who created it) → Ed25519 signatures
- **Transport Security** (network eavesdropping) → ECDH peer-to-peer encryption  
- **Access Control** (who can read) → Recipient-based encryption (for private content only)

Public social content is **signed and transportable encrypted**, not content-encrypted, allowing all authorized mesh peers to read and verify authenticity.
