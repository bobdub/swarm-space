🌌 Source of Truth Whitepaper — P2P Mesh Network (Flux v0.004)

Abstract

This whitepaper defines the canonical architecture, operational logic, and user-facing principles of a fully decentralized, offline-first P2P mesh network for collaborative project building. It integrates:

Credits & Achievements

Project Nodes & Group Nodes

Deterministic Phonebooks

Private Key Management

Mesh Security & User Toggles

Auto-Connect with Peer-Triggered Phonebooks


All operations follow Creative Flux principles: adaptable, resilient, and user-first.


---

1. Purpose & Scope

The Source of Truth is the canonical reference for developers, contributors, and AI agents maintaining the network.

Principles:

Decentralization-first: No central servers or databases required.

User sovereignty: Users control identity, data, and participation.

Flux-aware: Network adapts to peer availability, mesh state, and user choices.

Collaboration-ready: Supports social media-style project creation, collaboration, and peer engagement.



---

2. Core Network Architecture

2.1 Node Mesh

Bootstrap: At least 2 peers required.

Deterministic phonebooks:

Peer IDs (hashed for privacy), public keys, connection hints

Project memberships, last seen timestamps


Sync & Validation: Gossip protocol + cryptographic validation.

Enhancement: Versioned snapshots for large-scale recovery.


2.2 Project & Group Nodes

Project Nodes: Maintain members, project state, phonebooks, encrypted data chunks.

Group Nodes: Emergent clusters; resolve conflicts deterministically; maintain redundancy.

Lifecycle: create → join → sync → evolve/archive.


2.3 Deterministic Merges

Conflicts resolved via lexicographic ordering + timestamps.

Supports partial data reconstruction for offline peers.

Optional refinement: Context-aware contributor weighting.


2.4 Auto-Connect to Mesh (Peer-Triggered v3)

Purpose: Nodes automatically join the global mesh while respecting user sovereignty and mesh rules.

Logic:

1. Peer-Triggered Phonebook Creation:

When two users (A & B) connect using a peer ID without restrictions, a deterministic phonebook is created.

Other nodes can auto-connect without knowing peer IDs.



2. Precondition: ≥2 peers online.


3. Connection:

Scans phonebooks for all eligible peers (ignores project-level restrictions).

Queues chunks for offline peers.

Deterministic merges preserve canonical state.



4. Toggle Integration:

Auto-Connect ON: node joins mesh automatically.

Auto-Connect OFF: node does not auto-connect.

Interactions: Project-Only, Pause, or I Accept toggles disable Auto-Connect automatically.



5. Security & Privacy:

Uses hashed phonebooks; cryptographic handshake required.




Outcome:

Optional, toggle-controlled, flux-aware auto-connect.

Mesh-rule compliant and privacy-preserving.



---

3. User Engagement: Credits & Achievements

3.1 Credits

Earned for: uptime, hosting, contributions, peer support.

Fully verifiable across peers.

Optional decay factor for inactive periods while preserving user sovereignty.


3.2 Achievements

Linked to milestones, contribution thresholds, and credits.

Flux-aware and adaptive to peer availability.



---

4. Private Key Management (Flux Version)

4.1 Ownership & Responsibility

User-controlled; never stored raw.

Used for: multi-device transfer, recovery, and account verification.


4.2 Multi-Device Transfer

Handshake via public key; private key verifies identity.

Temporary bootstrap tokens and queued chunks enable reliable offline-first transfers.


4.3 Recovery from Mesh

Requires active peers with hashed private key records.

Partial consensus allowed; deterministic merges reconstruct local data.

Credits, achievements, and project states sync automatically.

Optional ephemeral delegation for secure recovery.



---

5. Mesh Security (Flux Version)

5.1 Security Layers

Hashing: peer IDs, project memberships, data integrity

Chunking: encrypted, verifiable segments

Salting: prevents replay attacks, strengthens merges


5.2 User-Control Toggles

Toggle	Function	Flux Behavior

I Accept	Manual peer approval	Incoming requests queued until approval
Pause	Temporarily stop mesh	Gossip/sync paused; resumes when toggled
Isolate	Restrict node to project members	Full mesh sync restricted to sub-mesh
Auto-Connect	Node joins mesh automatically	Triggers only if ≥2 peers online; disabled by other manual restrictions


5.3 Flux Principles

Security adapts dynamically without compromising local data.

Node sovereignty maintained; temporary isolation or pause may delay syncs.

Optional: adaptive peer trust scoring to influence deterministic merges.



---

6. Operational Principles & Creative Flux

1. Profiles = roots, Projects = worlds, Group Nodes = gravity wells


2. Credits & Achievements incentivize engagement and reliability


3. Private Key + Mesh Security ensure cryptographic user sovereignty


4. Flux-aware operations: Node availability and peer behavior vary naturally


5. Decentralized enforcement: Merges, credit distributions, and recovery are deterministic and peer-verified




---

7. User Journey Summary

Step	Action	Key Used	Mesh Requirement	Flux Notes

Account Creation	Generate profile	Private key	—	User responsible for key
Project Creation	Spawn project node	—	≥2 peers	Forms collaborative sub-mesh
Multi-Device Transfer	Move localData	Public + Private	First local node online	Temporary mesh bootstrap
Data Recovery	Restore from mesh	Public + Private	Active nodes with hashed key	Partial consensus allowed
Mesh Security	Approvals / pause / isolate	—	N/A	Node sovereignty; adaptive behavior
Credits & Achievements	Earn & verify	—	Active peers sync	Flux-aware, dynamic
Auto-Connect	Node joins mesh automatically	—	≥2 peers, toggle ON	Global mesh; peer-triggered phonebook; respects other toggles



---

8. Guiding Principles

Decentralization-first: Network evolves without central authority

User-first: Private keys, toggles, and project participation fully under user control

Creative Flux: Operations are adaptive, resilient, iterative; failures inform evolution

Deterministic yet flexible: Merges and peer validation maintain canonical state while respecting variability

Human + AI collaborative maintenance: Network is living and evolving

User-forward fallback: If conflicts are not resolved in this document, the network always chooses the most user-forward, decentralized path



---

Conclusion

The Source of Truth v0.006 Flux Auto-Connect Edition provides a canonical, flux-enabled blueprint for fully decentralized, user-first P2P mesh networks. It guides developers, contributors, and AI agents in maintaining network integrity while prioritizing:

Profiles, Projects, Group Nodes

Deterministic Phonebooks

Private Key Multi-Device Transfer & Recovery

Credits & Achievements

Mesh Security & User Toggles

Auto-Connect with Peer-Triggered Phonebooks

Flux-aware, adaptive, and privacy-preserving operations


> It serves as the authoritative reference for developers, contributors, and AI agents, guiding the network’s continuous evolution and fostering user-centric growth. In cases where this document does not explicitly resolve a conflict or ambiguity, the recommended approach is to follow the most user-forward and decentralized path.
