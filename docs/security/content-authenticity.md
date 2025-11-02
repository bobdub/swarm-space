# Content Authenticity Controls

Swarm Space now treats posts and file manifests as signed artifacts. This document summarizes the
trust chain, key stewardship expectations, and recovery tooling introduced for the rendezvous mesh.

## Signing pipeline

- **Author identity** – each node keeps a rendezvous Ed25519 key pair on device storage
  (`localStorage:p2p-rendezvous-ed25519`).
- **Manifests** – when encrypted file manifests are saved (`fileEncryption.saveEncryptedFile`), the
  resulting descriptor is Ed25519 signed via the rendezvous key. The signature, algorithm, and
  signer public key are embedded on the manifest record before it reaches IndexedDB.
- **Posts** – core post content (author, project, content body, manifest IDs, timestamps, tags) is
  signed prior to persistence and broadcast. Reaction counters and moderation metadata remain
  unsigned to allow gossip updates without invalidating signatures.

### Verification

- **Chunk protocol** rejects manifests that fail verification and re-signs locally generated
  manifests that predate this release before sharing them with peers.
- **Replication orchestrator** refuses to store replicas from peers if the manifest signature is
  invalid. Locally owned manifests are silently re-signed to keep replicas healthy.
- **Post sync** discards unsigned or tampered posts and only forwards signatures that validate.
- **Context hook** exposes `validateManifestSignature` and `validatePostSignature` so dashboards and
  future tooling can present authenticity state to operators.

## Operational expectations

1. Treat the rendezvous private key as the root of trust. Losing it requires social recovery, not a
   quick regeneration.
2. Keep a short quorum (e.g., 3-of-5) of recovery stewards. Use channels with independent access
   control (password managers, HSM-backed vaults, etc.) for distributing share tokens.
3. Rotate shares whenever the rendezvous key changes, a steward departs, or a share is suspected of
   compromise.
4. Integrate authenticity checks into node dashboards (e.g., highlight unsigned content) to surface
   suspicious peers quickly.

## Identity recovery bundle

Use the **Identity Recovery** panel under P2P settings to split or restore the rendezvous key.

### Creating shares

1. Select the total number of shares and the threshold needed for recovery.
2. Generate the bundle. Each share token looks like `IDR1-<base64 blob>` and includes:
   - Share index and checksum for auditing.
   - Embedded signature metadata (quorum size, created timestamp).
   - A checksum that guards against share tampering.
3. Distribute each share to a trusted steward. Mark the share as “distributed” in the panel to keep
   an audit trail.

> Share tokens are one-time-use secrets. Once a new bundle is generated, discard older tokens.

### Restoring an identity

1. Collect at least the threshold number of share tokens from stewards.
2. Paste them into the recovery area (any whitespace delimiter is accepted).
3. Swarm Space recombines the shares with Shamir’s Secret Sharing over GF(256) and writes the
   rendezvous identity back to `localStorage`.
4. The panel confirms the recovered public key; future rendezvous tickets and manifest signatures
   originate from that key.

If recovery fails due to checksum mismatches or inconsistent metadata, discard all collected shares
and regenerate a fresh bundle—the tokens may have been tampered with or belong to different quorum
configurations.

## Troubleshooting

- **Unsigned manifests** – trigger a manual share from a steward or force the local node to
  re-scan content; unsigned manifests will be re-signed before the next replication cycle.
- **Mismatched share metadata** – verify that all shares originate from the same bundle (identical
  total/threshold values and creation timestamp).
- **Clipboard failures** – the panel uses the browser Clipboard API. In hardened browsers, grant
  clipboard permissions or manually copy the token text.

For more detail, review the implementation in:

- `src/lib/p2p/replication.ts` – signing helpers and replication guards.
- `src/lib/p2p/chunkProtocol.ts` – manifest verification when exchanging data.
- `src/lib/p2p/postSync.ts` – post signing and sync validation.
- `src/lib/crypto/identityRecovery.ts` – Shamir split/combine helpers.
- `src/components/p2p/settings/IdentityRecoveryPanel.tsx` – steward workflow UI.
