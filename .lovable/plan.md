

## Wiring Checks + Code Cleanup

### Issues Found

**1. Dead code: `broadcastEncryptedChunks()` is a no-op in both `EncryptedPostSync` and `EncryptedCommentSync`**
Lines 107-109 in `encryptedPostSync.ts` and 98-100 in `encryptedCommentSync.ts` are empty methods — encrypted chunks are built but never actually sent to peers. The orchestrator calls `broadcastEncryptedPost()` which encrypts, chunks, then calls `this.broadcastEncryptedChunks(...)` which does nothing.

**Fix**: Wire `broadcastEncryptedChunks` to actually use the `sendMessage` function passed to the constructor, broadcasting chunks to all connected peers.

**2. `any` type proliferation across sync modules**
`sendMessage`, `handleMessage`, `storeEncryptedPost/Comment` all use `any` for message and content types. This masks bugs at compile time.

**Fix**: Replace `any` with proper typed unions (`PostSyncMessage | EncryptedPostMessage`, etc.) across `encryptedPostSync.ts`, `encryptedCommentSync.ts`, `encryptedFileSync.ts`, and `encryptedSyncOrchestrator.ts`.

**3. `peerId` lookup uses wrong localStorage key in encrypted sync**
Line 70 in `encryptedPostSync.ts` and line 65 in `encryptedCommentSync.ts` read `window.localStorage.getItem("peerId")` — but the actual peer ID is stored under `swarm-mesh-node-id` with `peer-` prefix. This yields `"unknown"` in chunk metadata.

**Fix**: Accept `peerId` as a constructor parameter (from the swarm mesh) instead of guessing from localStorage.

**4. Unused imports in `encryptedPostSync.ts`**
`encryptForBlockchain` is imported and called (line 80) but the result (`blockchainChunks`) is never used — it's computed and discarded.

**Fix**: Remove the dead `blockchainChunks` computation or wire it into the broadcast path.

**5. Mining auto-start race at boot**
In `connectSignaling()` (line 1219), mining auto-starts right after going online but before cascade connect runs — so it starts with 0 peers, hits the gate, and silently fails. When a peer later connects, nothing restarts it.

**Fix**: Add a `startMiningLoop()` call in the peer-connection handler when transitioning from 0→1 peers (complements existing gate logic).

**6. `console.log` noise — 369 log statements in swarmMesh.standalone.ts**
Production users see massive console output. Mining tick logs fire every 15s.

**Fix**: Downgrade routine tick/heartbeat logs to `console.debug`. Keep phase transitions, errors, and connection events as `console.log`.

**7. Stale TODO comments**
`CreateMilestoneModal.tsx:98`, `CreateTaskModal.tsx:101`, `InviteUsersModal.tsx:73`, `interactions.ts:344` — all contain stale `TODO`s for auth or API integration.

**Fix**: Wire `getCurrentUser()` into milestone/task creation. Add note to invite modal that it's a stub.

---

### Changes by File

| File | Change |
|------|--------|
| `src/lib/p2p/encryptedPostSync.ts` | Wire `broadcastEncryptedChunks` to send via `sendMessage`; fix peerId lookup; remove unused `blockchainChunks`; type `any` → proper types |
| `src/lib/p2p/encryptedCommentSync.ts` | Wire `broadcastEncryptedChunks`; fix peerId lookup; type cleanup |
| `src/lib/p2p/encryptedFileSync.ts` | Type cleanup (`any` → typed) |
| `src/lib/p2p/encryptedSyncOrchestrator.ts` | Type cleanup on `handleMessage` and `initialize` |
| `src/lib/p2p/swarmMesh.standalone.ts` | Add mining restart on first peer connect; downgrade routine logs to `console.debug` |
| `src/components/CreateMilestoneModal.tsx` | Replace TODO with `getCurrentUser()` |
| `src/components/CreateTaskModal.tsx` | Replace TODO with `getCurrentUser()` |
| `src/lib/interactions.ts` | Replace TODO with proper soft-delete implementation |

### Technical Detail

```text
ENCRYPTED CHUNK BROADCAST (currently broken):
  broadcastEncryptedPost() → encrypts → chunks → broadcastEncryptedChunks() → NOOP ❌
  
FIXED:
  broadcastEncryptedPost() → encrypts → chunks → sendMessage(peer, chunkMsg) ✅
  
MINING RESTART ON PEER CONNECT:
  handleConnection() → if connections 0→1 && toggles.mining → startMiningLoop()
```

