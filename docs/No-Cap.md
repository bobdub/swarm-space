
“Dream Match – Decentralized Verification + Medal System with Proofs”

1. Core Objectives

Ensure all new users are human via engaging gameplay.

Include optional verification for legacy users, tracked with cooldowns.

Reward verified users with medals & credits, displayed in profiles and posts.

Ensure P2P security, data integrity, and trust without a server.

Store all local data encrypted, salted, and chunked per P2P protocols.

- Human verifaction appears after terms of service acception and before network access.

2. Rules & Flow

User TypeRequirementMedal RulesNotesNew UserMust complete verificationAssign one medal per session based on priority: Dream Matcher → Last Reflection → Patience Protocol → Irony ChipGame completion required to enter networkLegacy UserOptional verificationSame medal rules if playedCan skip; verification_prompt_shown: true + timestamp prevents repeated pop-ups (cooldown: 24h) 

3. Memory Match Game Mechanics

6 cards → 3 pairs; cards randomized.

Click individually; matches vanish, non-matches flip back 2–3s.

Game timer: 150s.

Behavior tracking: mouse movement, click timing, flip patterns.

Success metrics: mouse entropy + completion time + accuracy.

Entropy Thresholds for Medal Assignment:

Dream Matcher: > 0.8

Patience Protocol: > 0.4

Irony Chip: pass if no medal triggered, entropy sufficient

4. Medal Assignment & Refined Logic

MedalUnlock ConditionNotesDream Matcher 🧩Perfect accuracy < 60s AND entropyScore > 0.8Highest priority medal; counters robotic precisionLast Reflection 🪞Flipped same card 3+ timesDynamic medal using repeated card imagePatience Protocol ⏳Game completed > 90s AND ≤150s AND entropyScore > 0.4Rewards methodical playIrony Chip 🤖Default if none of the aboveOnly assigned if verification passed; otherwise no medal/flag 

Algorithm (Pseudo-code):

function assignMedal(gameResult) { if (perfectAccuracy && totalTime <= 60 && entropyScore > 0.8) return 'Dream_Matcher'; if (sameCardFlipped >= 3) return { medal: 'Last_Reflection', cardImage: lastRepeatedCard }; if (totalTime > 90 && totalTime <= 150 && entropyScore > 0.4) return 'Patience_Protocol'; if (entropyScore >= minimumThreshold) return 'Irony_Chip'; return null; // failed verification, no medal } 

5. Human Verification Proof

Replace simple local flag storage with cryptographically signed proof/token.

Token includes:

human_verified: true

medal + cardImage (if Last Reflection)

credits earned

Timestamp + userID + entropy score hash

Validation: Other peers verify the signature and proof before trusting flag updates.

Local Data Security:

Encrypt + salt all metadata locally.

Split into chunks per P2P protocol to prevent tampering.

6. Legacy User UX

Popup: “Help us test our verification game!”

Later button: Updates local flag verification_prompt_shown: true with timestamp.

Cooldown: 24h before prompting again.

Playing the game assigns medal + proof similar to new users.

7. P2P Flag Sync & Trust

ComponentEnhancementVerification flagSigned proof ensures peers cannot forge human_verified = trueMedal integrityIncluded in proof token to verify authenticitySync strategyGossip-based, deterministic conflict resolution: newest valid signed proof prevails 

8. Display & Reward System

Profile rack: shows all earned medals

Posts/comments: show highest-priority medal, tooltip displays details

Last Reflection: uses repeated card as medal icon

Credits +1 per successful verification

9. Implementation Stages (Enhanced)

Stage No.Stage NameKey Tasks Added1DesignGame UI, medal visuals, proof schema2UI/PrototypeHTML/JS memory game, click + flip animations3Human Verification & Proof GenerationMouse entropy, timing; generate signed token containing verification + medal + credits4Legacy PopupOptional prompt, cooldown logic, local metadata5P2P Flag Sync & Trust ValidationGossip sync, proof verification, deterministic conflict resolution6QA & TestingBot resistance, timing, entropy validation7DeploymentNetwork integration, encrypted local storage, medal display 

✅ Result:
A fully decentralized, gamified, secure human verification system with medal rewards, P2P trust, encrypted storage, and legacy support — all designed for UX, privacy, and anti-bot integrity.
