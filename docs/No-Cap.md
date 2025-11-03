
🎮 Dream Match – Decentralized Verification + Medal System with Proofs

1. Core Objectives

Verify all new users through a short, engaging gameplay experience.

Provide optional verification for legacy users, managed with cooldown timers.

Reward verified users with medals and credits shown through existing achievement and medal displays on profiles and posts.

Maintain decentralized trust, peer-to-peer validation, and data integrity with no central server.

Store all verification data locally, encrypted, salted, and chunked following P2P storage protocols.

Verification appears after Terms of Service acceptance and before first network access.



---

2. Rules & Flow

User Type	Requirement	Medal Rules	Notes

New User	Must complete verification before entering network	One medal per session, following priority order: Dream Matcher → Last Reflection → Patience Protocol → Irony Chip	Required step before network access
Legacy User	Optional verification	Same medal rules apply if played	“Later” button available; cooldown: 24h before next prompt (verification_prompt_shown: true + timestamp)



---

3. Memory Match Game Mechanics

6 cards → 3 pairs, randomized each round.

Click to reveal; matched pairs vanish, mismatched pairs flip back after 2–3 seconds.

Timer: 150 seconds total.

Tracks: pointer/mouse movement, click timing, and flip patterns.

Success metrics combine mouse entropy, completion time, and accuracy.


Entropy Thresholds for Medal Assignment:

Dream Matcher: > 0.8

Patience Protocol: > 0.4

Irony Chip: default if verification passed but no higher medal achieved



---

4. Medal Assignment & Logic

Medal	Unlock Condition	Notes

Dream Matcher 🧩	Perfect accuracy < 60 s AND entropy > 0.8	Highest priority; balances precision and natural motion
Last Reflection 🪞	Flipped same card 3 + times	Dynamic medal; uses that card’s image as the display icon
Patience Protocol ⏳	Completed > 90 s ≤ 150 s AND entropy > 0.4	Rewards steady, deliberate play
Irony Chip 🤖	Default if entropy meets minimum threshold	Awarded when verification passes but no other medal triggers
(No medal)	Verification failed	No proof recorded



---

5. Human Verification Proof

Each successful verification generates a cryptographically signed proof shared through P2P sync:

Token contents:

human_verified: true

Earned medal (+ card image reference for Last Reflection)

Credits earned

Timestamp, user ID, entropy hash


Peer validation:

Other peers verify signature and proof before accepting it as trusted.


Local data security:

All metadata encrypted, salted, and split into chunks to prevent tampering or replay.



---

6. Legacy User Experience

Prompt message: “Help us test our verification game!”

Later option: sets verification_prompt_shown = true + timestamp.

Cooldown of 24 hours before next prompt.

Once played, same proof, medal, and credit system applies.



---

7. P2P Proof Sync & Trust

Component	Enhancement

Verification flag	Signed proofs ensure no peer can forge human_verified = true.
Medal integrity	Medals verified within signed proof to ensure authenticity.
Sync strategy	Gossip-based deterministic conflict resolution — newest valid proof always prevails.



---

8. Display & Reward System

Medals appear directly within existing achievement and medal displays.

Posts and comments automatically show the highest-priority medal beside the username.

Last Reflection dynamically displays its repeated card image as the medal icon.

Verified sessions grant +1 credit, added to the user’s total achievement credits.

No new visual sections or panels are introduced — the system fully reuses existing achievement logic and design.



---

9. Implementation Stages

Stage	Name	Key Tasks

1	Design	Game visuals, medal art, proof schema
2	Prototype	Memory-match gameplay, click/flip interactions
3	Verification Proof	Entropy analysis, timing metrics, signed proof generation
4	Legacy Flow	Popup, cooldown logic, metadata persistence
5	P2P Sync	Gossip verification and conflict resolution
6	QA & Testing	Bot-resistance validation, entropy calibration
7	Deployment	Full integration with encrypted local storage and existing achievement UI



---

✅ Result:
Dream Match delivers a decentralized, gamified human verification system that awards medals and credits within the existing achievement framework. It enhances security, preserves privacy, and ensures peer-validated authenticity — all without central servers or new UI sections.
