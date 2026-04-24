---
name: Memory Coin Exploration Only
description: Memory coin for learned patterns / self-maps is hypothetical, back-burner, must never interfere with current syncs (gossip, chunk, manifest). Gate behind ?explore=memorycoin.
type: constraint
---

Memory coins for storing **learned patterns, bell-curve snapshots, or
neural self-maps** are exploratory only. Treat as "back burner" until
explicitly green-lit by the user.

**Hard constraints:**
- MUST NOT touch existing chunk, manifest, or gossip sync paths.
- MUST NOT register a new gossip topic or pubsub channel.
- MUST be opt-in behind a `?explore=memorycoin` URL flag.
- MUST default to **disabled**; no auto-enable on any code path.
- Any interference risk → abandon the experiment, do not ship.

**Why:** the user flagged memory coin as highly hypothetical and asked
that it not interfere with current syncs. Existing sync stability
(chunks, manifests, gossip) is a higher priority than persistence of
learned patterns.

**How to apply:** when planning Tier-3 neural work, leave memory coin
items labelled `(EXPLORATION ONLY — back burner)` and never list them
under "Acceptance" criteria. Existing media-coin architecture for *user
content* is unaffected — this constraint only covers learned-pattern /
self-map persistence.
