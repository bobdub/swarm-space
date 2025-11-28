# Local Data & Encryption Protocol Audit
**Date:** 2025-11-28  
**Focus:** LocalData Schema, Multi-Stage Encryption, Persistence Architecture

---

## Executive Summary

This audit examines the local data storage and encryption architecture for Swarm Space, identifying critical gaps in the multi-stage encryption protocol for user-generated content (posts, comments, actions) and proposing a comprehensive implementation plan.

### Critical Findings

🔴 **CRITICAL:** User content (posts, comments) is NOT encrypted with creator's public key  
🔴 **CRITICAL:** No salting mechanism for content before encryption  
🔴 **CRITICAL:** File keys stored in plaintext in manifests  
🔴 **CRITICAL:** Blockchain chunks transmitted unencrypted  
⚠️ **MEDIUM:** IndexedDB data is editable via browser dev tools  

---

## Current Encryption Architecture

### Layer 1: File Encryption ✅ (Partial)
**Location:** `src/lib/fileEncryption.ts`

**Current Implementation:**
```typescript
// AES-256-GCM per-file encryption
const fileKey = await genFileKey(); // Random AES-256-GCM key
const iv = crypto.getRandomValues(new Uint8Array(12));
const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, fileKey, data);
```

**Issues:**
- ❌ File key stored in plaintext in manifest (`manifest.fileKey`)
- ❌ No public key encryption wrapper
- ❌ No content salting before encryption

### Layer 2: Content Signatures ✅ (Working)
**Location:** `src/lib/p2p/replication.ts`

**Current Implementation:**
```typescript
// Ed25519 signatures for posts and manifests
const payload = canonicalJsonBytes(postSigningPayload(post));
const signature = await signer.sign(payload);
```

**Status:** ✅ Working correctly - provides authenticity but NOT confidentiality

### Layer 3: Chunk Protocol ⚠️ (No Encryption)
**Location:** `src/lib/p2p/chunkProtocol.ts`

**Current Implementation:**
```typescript
// Chunks transmitted with cipher text but no additional encryption
{
  ref: string;
  cipher: string; // base64 encrypted data
  iv: string;
  meta: ChunkMetadata;
}
```

**Issues:**
- ❌ Chunks transmitted without blockchain-level encryption
- ❌ No PeerID wrapping
- ❌ Metadata transmitted in plaintext

### Layer 4: Blockchain Sync ❌ (No Encryption)
**Location:** `src/lib/blockchain/p2pSync.ts`

**Current Implementation:**
```typescript
// Blockchain data synced in plaintext
{
  type: "blockchain_sync",
  action: "new_block",
  data: { block }, // UNENCRYPTED
  timestamp: Date.now()
}
```

**Issues:**
- ❌ Transactions transmitted in plaintext over P2P
- ❌ No chunk encryption at blockchain layer

---

## Required Multi-Stage Encryption Protocol

### Stage A: Public Key Encryption + Salting

**Requirement:** When receiving raw data (post, comment, action), encrypt using creator's public key and add salt.

**Implementation Plan:**

```typescript
// New: src/lib/encryption/contentEncryption.ts

export interface EncryptedContent {
  ciphertext: string; // base64
  salt: string; // base64 random salt
  iv: string; // base64 AES-GCM IV
  ephemeralPublicKey?: string; // For ECDH key exchange
  encryptionMethod: 'aes-gcm' | 'ecdh-aes';
}

/**
 * Stage A: Encrypt content with creator's public key + salt
 */
export async function encryptUserContent(
  content: string,
  creatorPublicKey: string // Base64 SPKI format
): Promise<EncryptedContent> {
  // 1. Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // 2. Combine content with salt
  const saltedContent = JSON.stringify({
    content,
    salt: arrayBufferToBase64(salt.buffer),
    timestamp: Date.now()
  });
  
  // 3. Derive shared secret using ECDH
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  
  const creatorKey = await crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(creatorPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  const sharedSecret = await crypto.subtle.deriveKey(
    { name: "ECDH", public: creatorKey },
    ephemeralKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  
  // 4. Encrypt with derived key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedSecret,
    new TextEncoder().encode(saltedContent)
  );
  
  const ephemeralPubKey = await crypto.subtle.exportKey(
    "spki",
    ephemeralKeyPair.publicKey
  );
  
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ephemeralPublicKey: arrayBufferToBase64(ephemeralPubKey),
    encryptionMethod: 'ecdh-aes'
  };
}
```

### Stage B: Chunking for Mesh/Blockchain

**Requirement:** Chunk encrypted data for P2P mesh and blockchain sync.

**Implementation Plan:**

```typescript
// New chunk structure: [PeerID] - [User Data] - [Meta Data] - [CHUNK End]

export interface SecureChunk {
  // Connection/Handshake layer
  peerId: string;
  peerSignature: string; // Ed25519 signature of chunk by peer
  
  // User data layer (encrypted)
  userData: {
    encryptedPayload: string; // From Stage A
    contentType: 'post' | 'comment' | 'action' | 'file';
    contentId: string;
  };
  
  // Metadata layer
  metadata: {
    chunkIndex: number;
    totalChunks: number;
    chunkHash: string; // SHA-256 of encrypted payload
    timestamp: number;
  };
  
  // Chunk end marker
  chunkEnd: {
    merkleProof?: string[]; // For blockchain inclusion
    signature: string; // Content signature
  };
}

/**
 * Stage B: Chunk encrypted data for mesh sync
 */
export async function chunkEncryptedContent(
  encryptedContent: EncryptedContent,
  peerId: string,
  contentType: 'post' | 'comment' | 'action',
  contentId: string,
  chunkSize: number = 32 * 1024
): Promise<SecureChunk[]> {
  const data = encryptedContent.ciphertext;
  const totalChunks = Math.ceil(data.length / chunkSize);
  const chunks: SecureChunk[] = [];
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const chunkData = data.slice(start, end);
    
    // Calculate chunk hash
    const chunkHash = await sha256Async(chunkData);
    
    // Sign chunk
    const signer = await getRendezvousSigner();
    const chunkPayload = JSON.stringify({
      peerId,
      chunkIndex: i,
      chunkData,
      timestamp: Date.now()
    });
    const signature = await signer.sign(new TextEncoder().encode(chunkPayload));
    
    chunks.push({
      peerId,
      peerSignature: arrayBufferToBase64(signature as ArrayBuffer),
      userData: {
        encryptedPayload: chunkData,
        contentType,
        contentId
      },
      metadata: {
        chunkIndex: i,
        totalChunks,
        chunkHash,
        timestamp: Date.now()
      },
      chunkEnd: {
        signature: encryptedContent.salt // Temporary
      }
    });
  }
  
  return chunks;
}
```

### Stage C: Blockchain-Level Encryption

**Requirement:** Encrypt chunks using blockchain mechanics before sync.

**Implementation Plan:**

```typescript
// New: src/lib/blockchain/chunkEncryption.ts

export interface BlockchainEncryptedChunk {
  blockchainHash: string; // SHA-256 of entire chunk
  encryptedChunk: string; // Double-encrypted chunk
  blockHeight: number;
  transactionId: string;
}

/**
 * Stage C: Encrypt chunk for blockchain storage
 */
export async function encryptForBlockchain(
  chunk: SecureChunk,
  blockchainKey?: string // Optional network-level key
): Promise<BlockchainEncryptedChunk> {
  // 1. Serialize chunk
  const chunkBytes = new TextEncoder().encode(JSON.stringify(chunk));
  
  // 2. Generate deterministic key from blockchain state
  const chain = await getSwarmChain();
  const latestBlock = chain.getLatestBlock();
  const blockchainKeyMaterial = blockchainKey || latestBlock.hash;
  
  // 3. Derive encryption key
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(blockchainKeyMaterial),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("swarm-blockchain-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  
  // 4. Encrypt chunk
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    chunkBytes
  );
  
  // 5. Calculate blockchain hash
  const blockchainHash = await sha256Async(
    JSON.stringify({
      chunk: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.buffer),
      blockHeight: latestBlock.index
    })
  );
  
  return {
    blockchainHash,
    encryptedChunk: JSON.stringify({
      cipher: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.buffer)
    }),
    blockHeight: latestBlock.index,
    transactionId: chunk.userData.contentId
  };
}
```

---

## Local Data Read-Only Protection

### Issue: IndexedDB is Editable

IndexedDB can be modified via browser DevTools, allowing users to tamper with local data.

### Solution: Encryption + Integrity Checking

```typescript
// New: src/lib/storage/protectedStorage.ts

export interface ProtectedRecord<T> {
  id: string;
  encryptedData: string;
  hmac: string; // HMAC for integrity
  version: number;
  timestamp: number;
}

/**
 * Store data in read-only encrypted format
 */
export async function putProtected<T>(
  storeName: string,
  id: string,
  data: T,
  userPrivateKey: string
): Promise<void> {
  // 1. Derive storage key from user's private key
  const storageKey = await deriveStorageKey(userPrivateKey);
  
  // 2. Encrypt data
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    storageKey,
    new TextEncoder().encode(JSON.stringify(data))
  );
  
  // 3. Calculate HMAC for integrity
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("swarm-hmac-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(userPrivateKey),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const hmac = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encrypted
  );
  
  // 4. Store protected record
  const record: ProtectedRecord<T> = {
    id,
    encryptedData: JSON.stringify({
      cipher: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.buffer)
    }),
    hmac: arrayBufferToBase64(hmac),
    version: 1,
    timestamp: Date.now()
  };
  
  await put(storeName, record);
}

/**
 * Read and verify protected data
 */
export async function getProtected<T>(
  storeName: string,
  id: string,
  userPrivateKey: string
): Promise<T | null> {
  const record = await get<ProtectedRecord<T>>(storeName, id);
  if (!record) return null;
  
  // 1. Verify HMAC
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("swarm-hmac-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(userPrivateKey),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  
  const encData = JSON.parse(record.encryptedData);
  const valid = await crypto.subtle.verify(
    "HMAC",
    hmacKey,
    base64ToArrayBuffer(record.hmac),
    base64ToArrayBuffer(encData.cipher)
  );
  
  if (!valid) {
    console.error("[Protected Storage] HMAC verification failed - data may be tampered");
    return null;
  }
  
  // 2. Decrypt
  const storageKey = await deriveStorageKey(userPrivateKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(encData.iv) },
    storageKey,
    base64ToArrayBuffer(encData.cipher)
  );
  
  return JSON.parse(new TextDecoder().decode(decrypted));
}
```

---

## Implementation Roadmap

### Phase 1: Core Encryption Infrastructure (Priority: CRITICAL)
- [ ] Create `src/lib/encryption/contentEncryption.ts`
- [ ] Implement Stage A: Public key encryption + salting
- [ ] Implement Stage B: Secure chunk structure
- [ ] Implement Stage C: Blockchain-level encryption

### Phase 2: Storage Protection (Priority: HIGH)
- [ ] Create `src/lib/storage/protectedStorage.ts`
- [ ] Implement HMAC-protected storage
- [ ] Migrate critical stores (posts, comments, blockchain) to protected storage

### Phase 3: Integration (Priority: HIGH)
- [ ] Update `src/lib/posts.ts` to use encrypted content
- [ ] Update `src/lib/interactions.ts` for encrypted comments
- [ ] Update `src/lib/blockchain/blockchainRecorder.ts` for encrypted actions
- [ ] Update chunk protocol to use `SecureChunk` structure

### Phase 4: P2P Sync Updates (Priority: MEDIUM)
- [ ] Update `src/lib/p2p/postSync.ts` to handle encrypted content
- [ ] Update `src/lib/p2p/chunkProtocol.ts` for blockchain-encrypted chunks
- [ ] Update `src/lib/blockchain/p2pSync.ts` for secure blockchain sync

### Phase 5: Testing & Validation (Priority: HIGH)
- [ ] Test encryption/decryption roundtrip
- [ ] Test P2P sync with encrypted chunks
- [ ] Test blockchain sync with encrypted transactions
- [ ] Verify HMAC integrity checks work
- [ ] Test data recovery scenarios

---

## Security Considerations

### Threat Model

**Attacker Capabilities:**
1. Full access to user's IndexedDB via DevTools
2. Man-in-the-middle on P2P connections (mitigated by WebRTC encryption)
3. Malicious peer attempting to inject invalid data

**Mitigations:**
1. Multi-layer encryption prevents plaintext exposure
2. HMAC prevents data tampering
3. Ed25519 signatures prevent content forgery
4. Public key encryption ensures only creator can decrypt

### Performance Impact

**Estimated Overhead:**
- Stage A encryption: ~5ms per post/comment
- Stage B chunking: ~10ms per 100KB
- Stage C blockchain encryption: ~15ms per chunk
- Protected storage: ~3ms per read, ~5ms per write

**Total:** ~40ms overhead for typical post creation and sync

### Key Management

**Critical Dependencies:**
- User's ECDH private key (stored encrypted with passphrase)
- Rendezvous Ed25519 key (for signatures)
- Blockchain state (for deterministic keys)

**Key Rotation:** Not implemented - future enhancement

---

## Conclusion

The current system has strong signature-based authenticity but lacks confidentiality for user content. The proposed multi-stage encryption protocol provides:

✅ Public key encryption for content confidentiality  
✅ Salting to prevent pattern analysis  
✅ Blockchain-level encryption for mesh sync  
✅ HMAC-protected local storage against tampering  
✅ Structured chunk format for mesh/blockchain integration  

**Status:** 🔴 CRITICAL - Implementation required for production deployment

**Next Steps:** Begin Phase 1 implementation immediately
