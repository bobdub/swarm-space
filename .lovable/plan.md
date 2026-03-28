

## Two Hardening Fixes — In-Memory Encryption + Signaling Envelope Encryption

### Problem 1: Browser extensions can read decrypted in-memory data

Currently, sensitive data (private keys, decrypted content) lives as plain JavaScript strings/objects in memory. Any extension with page access can scrape `window`, DOM, or JS heap.

**Fix**: Encrypt sensitive in-memory values at rest using a session-ephemeral AES key that lives only inside a non-exportable `CryptoKey` object (Web Crypto API). Extensions cannot extract `CryptoKey` internals — they'd get an opaque handle. Data is decrypted only at the moment of use, then immediately re-encrypted or zeroed.

### Problem 2: PeerJS Cloud sees signaling metadata in plaintext

WebRTC offers/answers and ICE candidates pass through PeerJS Cloud unencrypted. The relay can see who is connecting to whom and inspect SDP contents (IP addresses, fingerprints).

**Fix**: Encrypt all signaling payloads (offer, answer, ICE) with a shared secret derived from a pre-exchanged ECDH key pair before sending through PeerJS. The relay sees only opaque ciphertext. Peers exchange ephemeral public keys via the first `announce` message (which is inherently visible, but contains no sensitive content).

---

### Changes

**1. `src/lib/crypto/memoryVault.ts`** — Create

- `MemoryVault` class that holds a non-exportable AES-256-GCM `CryptoKey` generated per session
- `vault.seal(plaintext)` → returns `{ciphertext, iv}` stored in place of raw strings
- `vault.unseal(sealed)` → returns plaintext, caller must zero after use
- Singleton instance created at app boot; keys never leave Web Crypto
- Extensions see opaque `CryptoKey` objects — cannot extract raw key bytes

**2. `src/lib/auth.ts`** — Modify

- After login/signup, wrap private key material through `vault.seal()` before storing in module-level variables
- `getPrivateKey()` calls `vault.unseal()` on demand, returns result
- Existing callers unchanged (same API surface)

**3. `src/lib/p2p/signaling.ts`** — Modify  

- On `announce`: include an ephemeral ECDH public key in the payload (non-sensitive)
- Derive a shared secret per peer pair using ECDH + HKDF
- Before sending `offer`, `answer`, `ice` messages: encrypt the `payload` field with the derived shared AES key
- On receive: decrypt payload before processing
- Falls back to plaintext if peer doesn't include a public key (backward compat with older clients)

**4. `src/lib/p2p/peerjs-adapter.ts`** — Modify

- Pass encrypted signaling payloads through existing send/receive paths
- No structural changes — encryption happens at the `SignalingChannel` layer

**5. `src/pages/Privacy.tsx`** — Modify

- Update "Staying Safe Online" section: note that in-memory sensitive data is vault-encrypted and signaling metadata is end-to-end encrypted
- Keep human-readable tone

**6. `docs/SECURITY_MODEL.md`** — Modify

- Add "Layer 3: In-Memory Vault" section documenting the ephemeral CryptoKey approach
- Add "Layer 4: Signaling Encryption" section documenting ECDH envelope encryption

---

### Technical Detail

```text
IN-MEMORY VAULT:
  Boot → generate non-exportable AES-256-GCM CryptoKey
  seal(data) → AES-GCM encrypt → store {ciphertext, iv}
  unseal({ciphertext, iv}) → decrypt → return plaintext
  Extension sees: CryptoKey{extractable: false} + ciphertext blobs

SIGNALING ENCRYPTION:
  Peer A announce → includes ephemeralPubKey (ECDH P-256)
  Peer B announce → includes ephemeralPubKey
  Both derive: sharedSecret = ECDH(myPriv, theirPub) → HKDF → AES key
  offer/answer/ice payloads encrypted with shared AES key
  PeerJS relay sees: {type:"offer", payload:"<base64 ciphertext>"}
```

