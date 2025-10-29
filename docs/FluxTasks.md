🌐 Flux Tasks — Secure & Legacy-Preserving Mesh

## Phase 1 Implementation Plan (In Progress)

- **Onboarding Compliance Guard**
  - Implement a client-side gate that blocks the interface until the latest Terms of Service are acknowledged.
  - Persist acceptance to `flux_tos_accepted` and `flux_tos_version` local storage entries with graceful handling for legacy values.
  - Surface the TOS document inline with scroll detection and capture acceptance timestamp for auditability (local-only).
- **Resilient Local Data Sync**
  - Detect active identity material prior to account creation and surface recovery flows instead of overwriting existing data.
  - Introduce a timed verification window before replacing local data, with contextual warnings for browsers that block storage APIs.
- **Guided Walkthrough Framework**
  - Provide a reusable tour state machine keyed to `flux_walkthrough_done` with checkpoints for Welcome → Mesh → Projects → Credits → Done.
  - Instrument dismiss & resume logic so returning users can skip completed steps while opting back in from settings.
- **Integrity Controls (Sylabis & Spam)**
  - Build a unified rate-limiter service that enforces per-origin signup caps and posting throughput via hashed ephemeral tokens.
  - Expose developer toggles and telemetry hooks for future mesh reputation weighting.
- **True Curated Export Foundations**
  - Model exportable entities (posts, comments, media, achievements) with size metadata for live aggregation.
  - Prototype the JSZip packaging pipeline and selection UI, ensuring everything runs offline with no remote calls.

---

1. Terms of Service (TOS)

Users must scroll and accept TOS before joining.

Stored locally (flux_tos_accepted, flux_tos_version).

Legacy users prompted on login if outdated or missing.

One-time acceptance per version.

---

2. LocalData Sync

Prevent accidental overwrites due to slow sync.

Add sync verification timer before new account creation.

Detect existing local identity hashes to prevent overwrite.

- Make sure browsers allow (user accepts) so localData is not overwritten by browser security.

Offer “Recover My Account” option.

---

3. Getting Started (Walkthrough)

30-second guided introduction: Welcome → Mesh → Projects → Credits → Done.

Flag stored locally (flux_walkthrough_done).

---

4. Sylabis Protection

Limit: 10 new accounts per origin per 24h.

Privacy-preserving: ephemeral hashed tokens (sha256(clientIP + rotatingSalt + currentHour)), optional PoW for signup.

Local enforcement only, no raw IP/device storage.

---

5. Spam Protection

Rate limit: Minimum 300 ms between posts.

Daily cap: 5 GB/day per local user.

Once cap reached, additional content stored locally (deferred queue).

Sync deferred until the next day when cap resets.


Optional mesh reputation weighting to throttle high-frequency activity.

---

6. User Security & Privacy

Zero IP/device storage.

Local-only tracking for Sylabis and Spam protection.

Identity = hash of public key + local salt (no device info).

E2EE for all mesh communication.

Audit layer rejects any sensitive data attempts.


|Ψ_Security(verify).audit⟩ =>
   if (data.contains("ip") || data.contains("device"))
       => |Ψ_Reject(transmission).abort⟩;

---

7. True Curated Export (Download Local Work)

Goal: Users can export all posts, comments, images, videos, and achievements in a .zip for personal archiving.

Features:

Preview all content with file type, size, and timestamp.

Select specific categories or individual items.

Total download size displayed before starting.

Optionally include achievements JSON summary.

Implementation: JSZip-based zip generation; offline and privacy-safe.


UX Flow:

1. Click “Export My Work”.


2. List posts, comments, images, videos, achievements with sizes.


3. Select items. Total size updates live.


4. Click “Download Selected”, .zip is generated.

---

8. Optional Future Enhancements

Blind-token authority for optional hybrid gateways.

Mesh-wide reputation sync.

Dynamic PoW difficulty based on network load.

Preview thumbnails for media items in export UI.

Partial export for very large datasets.

---

Flux Tasks Summary

Task	Description	Priority	Status

TOS	Scroll & accept	🔺 High	Implementing
LocalData Sync	Prevent overwrite / sync verification	🔺 High	In Progress
Walkthrough	30-sec intro	🔹 Medium	Planned
Sylabis Protection	Limit signups w/ ephemeral token + PoW	🔺 High	Active
Spam Protection	5GB/day + 300ms rate, deferred queue	🔺 High	Active
User Privacy	Zero IP/device storage, E2EE	🔺 Critical	Active
Curated Export	Posts, comments, images, videos, achievements with selective download & size preview	🔹 Medium	Planned

