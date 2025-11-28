/**
 * Content Signing for SWARM Space
 * Provides authentication and integrity for social content
 */

import { sha256Async } from '../blockchain/crypto';

// ==================== CONTENT SIGNING ====================

export interface ContentSignature {
  signature: string; // Ed25519 signature (base64)
  publicKey: string; // Signer's public key (base64)
  contentHash: string; // SHA-256 of content
  timestamp: number;
  algorithm: 'ed25519';
}

export interface SignedContent<T> {
  content: T;
  signature: ContentSignature;
}

/**
 * Sign content with Ed25519 for authenticity
 * @param content - The content to sign (will be JSON stringified)
 * @param getSignerFn - Function to get the Ed25519 signer
 */
export async function signContent<T>(
  content: T,
  getSignerFn: () => Promise<any>
): Promise<SignedContent<T>> {
  const contentString = typeof content === 'string' 
    ? content 
    : JSON.stringify(content);
  
  const contentHash = await sha256Async(contentString);
  const signer = await getSignerFn();
  
  const payload = new TextEncoder().encode(
    JSON.stringify({
      content: contentString,
      contentHash,
      timestamp: Date.now(),
    })
  );
  
  const signatureBytes = await signer.sign(payload);
  
  // Convert to Uint8Array for base64 encoding
  const uint8Array = signatureBytes instanceof Uint8Array
    ? signatureBytes
    : new Uint8Array(signatureBytes);
  
  const signature = btoa(String.fromCharCode(...uint8Array));
  
  return {
    content,
    signature: {
      signature,
      publicKey: signer.publicKey,
      contentHash,
      timestamp: Date.now(),
      algorithm: 'ed25519',
    },
  };
}

/**
 * Verify content signature
 * @param signedContent - The signed content to verify
 * @param expectedPublicKey - Optional public key to verify against
 */
export async function verifyContentSignature<T>(
  signedContent: SignedContent<T>,
  expectedPublicKey?: string
): Promise<boolean> {
  try {
    const { content, signature } = signedContent;
    
    // Check public key if provided
    if (expectedPublicKey && signature.publicKey !== expectedPublicKey) {
      console.warn('[ContentSigning] Public key mismatch');
      return false;
    }
    
    // Verify content hash
    const contentString = typeof content === 'string' 
      ? content 
      : JSON.stringify(content);
    const computedHash = await sha256Async(contentString);
    
    if (computedHash !== signature.contentHash) {
      console.warn('[ContentSigning] Content hash mismatch');
      return false;
    }
    
    // Import public key
    const publicKeyBytes = Uint8Array.from(atob(signature.publicKey), c => c.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'Ed25519', namedCurve: 'Ed25519' } as any,
      false,
      ['verify']
    );
    
    // Verify signature
    const payload = new TextEncoder().encode(
      JSON.stringify({
        content: contentString,
        contentHash: signature.contentHash,
        timestamp: signature.timestamp,
      })
    );
    
    const signatureBytes = Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0));
    
    const valid = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signatureBytes,
      payload
    );
    
    return valid;
  } catch (error) {
    console.error('[ContentSigning] Verification failed:', error);
    return false;
  }
}

// ==================== TRANSPORT ENCRYPTION ====================

export interface TransportEncrypted {
  ciphertext: string; // base64 AES-GCM encrypted data
  iv: string; // base64 IV
  ephemeralPublicKey: string; // base64 SPKI public key
  recipientPublicKey: string; // Who this is encrypted for
}

/**
 * Encrypt data for a specific peer (transport security)
 * Uses ECDH with recipient's public key
 */
export async function encryptForPeer(
  data: string,
  recipientPublicKey: string
): Promise<TransportEncrypted> {
  // Generate ephemeral key pair
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  
  // Import recipient's public key
  const recipientKeyBytes = Uint8Array.from(atob(recipientPublicKey), c => c.charCodeAt(0));
  const recipientKey = await crypto.subtle.importKey(
    'spki',
    recipientKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedSecret,
    new TextEncoder().encode(data)
  );
  
  // Export ephemeral public key
  const ephemeralPubKey = await crypto.subtle.exportKey('spki', ephemeralKeyPair.publicKey);
  
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    ephemeralPublicKey: btoa(String.fromCharCode(...new Uint8Array(ephemeralPubKey))),
    recipientPublicKey,
  };
}

/**
 * Decrypt data from a peer (transport security)
 * Uses ECDH with our private key
 */
export async function decryptFromPeer(
  encrypted: TransportEncrypted,
  myPrivateKey: string
): Promise<string> {
  // Import our private key
  const privateKeyBytes = Uint8Array.from(atob(myPrivateKey), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
  
  // Import ephemeral public key
  const ephemeralPubKeyBytes = Uint8Array.from(atob(encrypted.ephemeralPublicKey), c => c.charCodeAt(0));
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'spki',
    ephemeralPubKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const ciphertextBytes = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    sharedSecret,
    ciphertextBytes
  );
  
  return new TextDecoder().decode(plaintext);
}

// ==================== PRIVATE CONTENT ENCRYPTION ====================

export interface PrivateEncrypted {
  encryptedContent: string; // AES-GCM encrypted content
  iv: string; // AES-GCM IV
  encryptedKeys: Record<string, string>; // Recipient pubkey -> encrypted symmetric key
  contentHash: string; // Hash of plaintext for verification
}

/**
 * Encrypt content for specific recipients (private messages)
 * Uses symmetric encryption + key wrapping
 */
export async function encryptForRecipients(
  content: string,
  recipientPublicKeys: string[]
): Promise<PrivateEncrypted> {
  // Generate symmetric key
  const symmetricKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );
  
  // Encrypt content with symmetric key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    symmetricKey,
    new TextEncoder().encode(content)
  );
  
  // Export symmetric key
  const symmetricKeyBytes = await crypto.subtle.exportKey('raw', symmetricKey);
  const symmetricKeyB64 = btoa(String.fromCharCode(...new Uint8Array(symmetricKeyBytes)));
  
  // Encrypt symmetric key for each recipient
  const encryptedKeys: Record<string, string> = {};
  for (const recipientPubKey of recipientPublicKeys) {
    const encrypted = await encryptForPeer(symmetricKeyB64, recipientPubKey);
    encryptedKeys[recipientPubKey] = JSON.stringify(encrypted);
  }
  
  const contentHash = await sha256Async(content);
  
  return {
    encryptedContent: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    encryptedKeys,
    contentHash,
  };
}

/**
 * Decrypt private content (recipient must have their private key)
 */
export async function decryptPrivateContent(
  encrypted: PrivateEncrypted,
  myPublicKey: string,
  myPrivateKey: string
): Promise<string> {
  // Find our encrypted key
  const encryptedKeyJson = encrypted.encryptedKeys[myPublicKey];
  if (!encryptedKeyJson) {
    throw new Error('Not a recipient of this content');
  }
  
  // Decrypt symmetric key
  const transportEncrypted = JSON.parse(encryptedKeyJson) as TransportEncrypted;
  const symmetricKeyB64 = await decryptFromPeer(transportEncrypted, myPrivateKey);
  const symmetricKeyBytes = Uint8Array.from(atob(symmetricKeyB64), c => c.charCodeAt(0));
  
  // Import symmetric key
  const symmetricKey = await crypto.subtle.importKey(
    'raw',
    symmetricKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Decrypt content
  const ciphertextBytes = Uint8Array.from(atob(encrypted.encryptedContent), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    symmetricKey,
    ciphertextBytes
  );
  
  const content = new TextDecoder().decode(plaintext);
  
  // Verify content hash
  const computedHash = await sha256Async(content);
  if (computedHash !== encrypted.contentHash) {
    throw new Error('Content hash verification failed');
  }
  
  return content;
}
