Private Key Abstract

Purpose

The Private Key System provides users with a secure and decentralized method to transfer devices, restore data, and recover accounts supported by swarm nodes.
It ensures continuity of identity and data ownership without reliance on central authority or online validation.


---

Overview

The current offline-first P2P networking project builder already includes:

Public Keys for network authentication and identity.

Data Chunking for distributed storage and transmission.

P2P Connections for decentralized social and data interactions.


The Private Key extends this framework by functioning as the user’s cryptographic signature of ownership. It is the single access point that links all user-associated data and device sessions across the swarm.


Handle Authorization Schema
---------------------------

Swarm handles are bound to the private key through a reusable signed payload:

```json
{
  "username": "<handle>",
  "owner_public_key": "<hex-encoded public key>",
  "timestamp": "<ms since epoch>",
  "nonce": "<per-handle monotonic integer>",
  "signature": "<base64url signature>"
}
```

- The private key signs the canonical JSON string excluding the `signature` field.
- The same schema is used for new claims, renewals, and releases; auxiliary fields such as `action`, staking receipts, or PoW headers remain outside the signed envelope so validators can evolve policies without changing signature semantics.
- Nonces guarantee replay protection. Validators persist the highest nonce they have observed per handle and reject any payload that does not strictly increase the sequence.

During the swarm handshake, devices exchange signed handle payloads immediately after verifying each other's public keys. This lets peers synchronize handle state while still honoring the offline-first design: all fields can be verified locally and cached for later reconciliation.


---

Core Logic

1. Multi-Device Synchronization

Users authenticate across devices via their private key.

The source device encrypts user session data and sends it to the target device.

The target device decrypts and confirms identity through a handshake protocol using the shared private-public key pair.

Once verified, both devices are authorized to operate within the same swarm identity, maintaining decentralized coherence.


2. Account Recovery

If a user loses access to their primary device, the private key allows re-authentication and decryption of node-supported data.

Recovery occurs through swarm discovery: nodes storing fragments of user data respond to the verified key.

Upon decryption, the user’s account state, metadata, and personal data are reassembled via swarm consensus.



---

Security Model

The private key is never stored or transmitted in plaintext; it exists solely on the user’s device.

Responsibility Principle: The user is solely accountable for the security of their private key.

No node, swarm, or developer can recover a lost private key—this ensures absolute ownership and non-custodial control.

Cryptographic protocols prevent replay or impersonation attacks by rotating temporary session keys for every connection.



---

Technical Specification

1. Key Generation

Algorithm: Ed25519 or Secp256k1 (configurable based on platform).

Entropy Source: Local device randomness + optional user entropy (e.g., password-derived seed).

Output:

Public Key → Shared across swarm for discovery and connection.

Private Key → Stored locally, used for data encryption/decryption and authentication.



2. Encryption Schema

Symmetric Encryption: AES-256-GCM for chunk encryption during data transfer.

Asymmetric Encryption: Public/Private keypair used for handshake validation and shared secret generation.

Hashing: SHA3-512 for identity fingerprints and swarm record verification.


3. Swarm Handshake Protocol

1. Device A (authenticated) initiates connection with Device B using public key challenge.


2. Device B responds with its own signature proof.


3. Both devices compute a shared session secret using ECDH (Elliptic Curve Diffie-Hellman).


4. The session is confirmed and encrypted using the temporary symmetric key.


5. Once established, both devices maintain a mirrored state of the user identity across the swarm.



4. Recovery Protocol

Upon re-entry, a node queries the swarm with the user’s public identity hash.

Nodes respond with data fragments encrypted to that identity.

The private key decrypts and reassembles the account state, restoring the user environment seamlessly.



---
Transaction Lifecycle
---------------------

1. **Claim / Issue**
   - The owner signs a payload with `nonce = 0` (or the next available nonce when reclaiming an expired handle).
   - A staking receipt or PoW digest accompanies the payload. Nodes verify the anti-spam measure before committing the handle.

2. **Renewal**
   - The current owner signs a payload with `nonce = previous_nonce + 1`.
   - Renewals prove liveness and can refresh staking timers. Missing renewals trigger automatic expiration without requiring a release signature.

3. **Release**
   - The owner signs a payload with `nonce = previous_nonce + 1` and includes `action: "release"` in the transaction metadata.
   - Validators confirm that the payload references the most recent stake commitment, ensuring intentional relinquishment.
   - Once a quorum of peers accepts the release, the stake unlocks and the handle returns to the available pool.

All lifecycle events are logged locally so that, during recovery, a device can replay signed payloads from peers, validate signatures, confirm nonces, and rebuild the authoritative handle state without central coordination.

---

Summary

This private key framework establishes trustless recoverability and device portability within the swarm-based social network.
By merging cryptographic identity with distributed node consensus, the system ensures:

True user ownership of identity and data.

Secure multi-device continuity.

Decentralized recovery independent of any central server.


The result is a self-sovereign identity layer compatible with any P2P node or swarm cluster within the network—empowering users to own their presence, data, and continuity across all devices.
