/**
 * Multi-Stage Content Encryption V2
 * Implements the SWARM Space encryption protocol:
 * 
 * PUBLIC CONTENT (Posts, Comments):
 * - Stage A: Sign content (Ed25519) for authenticity
 * - Stage B: Chunk for mesh distribution
 * - Stage C: Encrypt for transport (peer-to-peer ECDH)
 * - Stage D: Store signed plaintext locally
 * 
 * PRIVATE CONTENT (DMs):
 * - Stage A: Encrypt content for recipient(s)
 * - Stage B: Sign encrypted content
 * - Stage C-D: Same as public
 */

import { sha256Async } from '../blockchain/crypto';
import { getRendezvousSigner } from '../p2p/rendezvousIdentity';
import { getSwarmChain } from '../blockchain/chain';

// ==================== UTILITY FUNCTIONS ====================

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

// ==================== STAGE A: PUBLIC KEY ENCRYPTION + SALTING ====================

export interface EncryptedContent {
  ciphertext: string; // base64
  salt: string; // base64 random salt
  iv: string; // base64 AES-GCM IV
  ephemeralPublicKey?: string; // For ECDH key exchange
  encryptionMethod: 'aes-gcm' | 'ecdh-aes';
  contentHash: string; // SHA-256 of original content
}

/**
 * Stage A: Encrypt content with creator's public key + salt
 * @param content - The raw content to encrypt
 * @param creatorPublicKey - Creator's ECDH public key (Base64 SPKI format)
 */
export async function encryptUserContent(
  content: string,
  creatorPublicKey: string
): Promise<EncryptedContent> {
  // 1. Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // 2. Calculate content hash before encryption
  const contentHash = await sha256Async(content);
  
  // 3. Combine content with salt
  const saltedContent = JSON.stringify({
    content,
    salt: arrayBufferToBase64(salt.buffer),
    timestamp: Date.now(),
    contentHash
  });
  
  // 4. Generate ephemeral key pair for ECDH
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  
  // 5. Import creator's public key
  const creatorKey = await crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(creatorPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  // 6. Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveKey(
    { name: "ECDH", public: creatorKey },
    ephemeralKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  
  // 7. Encrypt with derived key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedSecret,
    new TextEncoder().encode(saltedContent)
  );
  
  // 8. Export ephemeral public key
  const ephemeralPubKey = await crypto.subtle.exportKey(
    "spki",
    ephemeralKeyPair.publicKey
  );
  
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ephemeralPublicKey: arrayBufferToBase64(ephemeralPubKey),
    encryptionMethod: 'ecdh-aes',
    contentHash
  };
}

/**
 * Decrypt content encrypted with encryptUserContent
 * @param encrypted - The encrypted content object
 * @param privateKey - User's ECDH private key (Base64 PKCS8 format)
 */
export async function decryptUserContent(
  encrypted: EncryptedContent,
  privateKey: string
): Promise<string> {
  if (!encrypted.ephemeralPublicKey) {
    throw new Error('Missing ephemeral public key for decryption');
  }
  
  // 1. Import user's private key
  const userPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );
  
  // 2. Import ephemeral public key
  const ephemeralPubKey = await crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(encrypted.ephemeralPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  // 3. Derive shared secret
  const sharedSecret = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephemeralPubKey },
    userPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  
  // 4. Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(encrypted.iv) },
    sharedSecret,
    base64ToArrayBuffer(encrypted.ciphertext)
  );
  
  // 5. Parse salted content
  const saltedContent = JSON.parse(new TextDecoder().decode(decrypted));
  
  // 6. Verify content hash
  const verifyHash = await sha256Async(saltedContent.content);
  if (verifyHash !== saltedContent.contentHash) {
    throw new Error('Content hash verification failed - data may be corrupted');
  }
  
  return saltedContent.content;
}

// ==================== STAGE B: SECURE CHUNKING ====================

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
 * Stage B: Chunk encrypted content for mesh/blockchain sync
 * @param encryptedContent - Output from Stage A encryption
 * @param peerId - Current peer ID
 * @param contentType - Type of content being chunked
 * @param contentId - Unique identifier for the content
 * @param chunkSize - Size of each chunk in bytes (default 32KB)
 */
export async function chunkEncryptedContent(
  encryptedContent: EncryptedContent,
  peerId: string,
  contentType: 'post' | 'comment' | 'action' | 'file',
  contentId: string,
  chunkSize: number = 32 * 1024
): Promise<SecureChunk[]> {
  const data = encryptedContent.ciphertext;
  const totalChunks = Math.ceil(data.length / chunkSize);
  const chunks: SecureChunk[] = [];
  
  // Get signer for chunk signatures
  const signer = await getRendezvousSigner();
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const chunkData = data.slice(start, end);
    
    // Calculate chunk hash
    const chunkHash = await sha256Async(chunkData);
    
    // Sign chunk with peer's identity
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
        signature: encryptedContent.contentHash
      }
    });
  }
  
  return chunks;
}

/**
 * Reassemble chunks into encrypted content
 * @param chunks - Array of secure chunks in order
 */
export function reassembleChunks(chunks: SecureChunk[]): EncryptedContent {
  // Sort by chunk index
  const sorted = [...chunks].sort((a, b) => 
    a.metadata.chunkIndex - b.metadata.chunkIndex
  );
  
  // Verify chunk continuity
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].metadata.chunkIndex !== i) {
      throw new Error(`Missing chunk ${i} in sequence`);
    }
  }
  
  // Reassemble ciphertext
  const ciphertext = sorted.map(c => c.userData.encryptedPayload).join('');
  
  // Extract metadata from first chunk (assuming all chunks share same encryption params)
  // Note: In a full implementation, you'd need to store these separately
  return {
    ciphertext,
    salt: '', // Would need to be stored separately
    iv: '', // Would need to be stored separately
    ephemeralPublicKey: '', // Would need to be stored separately
    encryptionMethod: 'ecdh-aes',
    contentHash: sorted[0].chunkEnd.signature
  };
}

// ==================== STAGE C: BLOCKCHAIN ENCRYPTION ====================

export interface BlockchainEncryptedChunk {
  blockchainHash: string; // SHA-256 of entire encrypted chunk
  encryptedChunk: string; // Double-encrypted chunk data
  blockHeight: number;
  transactionId: string;
  iv: string; // IV for blockchain encryption
}

/**
 * Stage C: Encrypt chunk for blockchain storage
 * @param chunk - Secure chunk from Stage B
 * @param blockchainKey - Optional network-level key (uses latest block hash if not provided)
 */
export async function encryptForBlockchain(
  chunk: SecureChunk,
  blockchainKey?: string
): Promise<BlockchainEncryptedChunk> {
  // 1. Serialize chunk
  const chunkBytes = new TextEncoder().encode(JSON.stringify(chunk));
  
  // 2. Get blockchain state for deterministic key
  const chain = await getSwarmChain();
  const latestBlock = chain.getLatestBlock();
  const blockchainKeyMaterial = blockchainKey || latestBlock.hash;
  
  // 3. Derive encryption key from blockchain state
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
  
  // 4. Encrypt chunk with blockchain key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    chunkBytes
  );
  
  // 5. Calculate blockchain hash
  const blockchainHash = await sha256Async(
    JSON.stringify({
      cipher: arrayBufferToBase64(encrypted),
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
    transactionId: chunk.userData.contentId,
    iv: arrayBufferToBase64(iv.buffer)
  };
}

/**
 * Decrypt chunk from blockchain storage
 * @param encrypted - Blockchain encrypted chunk
 * @param blockchainKey - Network-level key (uses block hash if not provided)
 */
export async function decryptFromBlockchain(
  encrypted: BlockchainEncryptedChunk,
  blockchainKey?: string
): Promise<SecureChunk> {
  // 1. Get blockchain key material
  const chain = await getSwarmChain();
  const block = chain.getChain()[encrypted.blockHeight];
  if (!block) {
    throw new Error(`Block ${encrypted.blockHeight} not found`);
  }
  const blockchainKeyMaterial = blockchainKey || block.hash;
  
  // 2. Derive decryption key
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
    ["decrypt"]
  );
  
  // 3. Parse encrypted data
  const encData = JSON.parse(encrypted.encryptedChunk);
  
  // 4. Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(encData.iv) },
    derivedKey,
    base64ToArrayBuffer(encData.cipher)
  );
  
  // 5. Parse chunk
  return JSON.parse(new TextDecoder().decode(decrypted));
}
