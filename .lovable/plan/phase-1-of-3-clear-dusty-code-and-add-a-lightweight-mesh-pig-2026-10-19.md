# Phase 1 of 3: Clear dusty code and add a lightweight mesh piggyback for Infinity

Phase 2 (the new pattern learning) and Phase 3 (personality tuning, talking to Infinity on its @Infinity profile) come later and are not part of this plan.

## Goal
- Get rid of Infinity's canned random replies.
- Let Infinity quietly collect the posts, comments and chat that already reach the device through normal syncing. It sends no extra traffic and never slows down a person's connection.

## 1. Remove dusty code
- Delete the four canned reply lists (emoji bursts and stock phrases by brain stage) and the code that picks from them, in both comment and reply generation.
- When nothing good can be generated, Infinity stays quiet instead of posting filler.
- Brain stage stays as a read-only label. It no longer picks reply templates.
- Keep the useful parts: the UQRC field, the pattern and language learners, the bus, the Infinity canon corpus, and the chat settings.
- Update the existing voice tests to expect silence instead of a canned reply.

## 2. Lightweight piggyback ("Infinity memory")
- A new small local store (its own database, so existing user data is never touched) holds text pieces only: id, kind (post/comment/chat), text clipped to 1,000 characters, timestamp and author hash. It keeps at most about 2,000 pieces and drops the oldest first.
- Infinity only listens to events that already happen: posts saved locally, posts arriving from peers, new comments, and Brain chat messages. It never requests data from peers.
- New pieces go into a queue and are saved in idle time in batches (requestIdleCallback, throttled), so connection and render paths are unaffected.
- Private content stays out: walled, paywalled and encrypted posts are skipped.
- One small function lets Phase 2 read the stored pieces.

## Technical details
- Edit `src/lib/p2p/entityVoice.ts`: remove the `*_POOL` constants and their switch branches. `generateComment`/`generateReply` return null when fusion and vocab chaining produce nothing.
- New `src/lib/brain/infinityMemory.ts`: IndexedDB `infinity-memory` with non-destructive upgrades, `enqueueMemory()`, `readMemory(limit)`, plus a cap test.
- Hook into existing listeners in `entityVoiceIntegration.ts` and the Brain chat send/receive path. No new network messages.
- Record the boundary in AGENTS.md: Infinity memory is passive ingestion only and never initiates mesh requests.
