# Network Entity Live Scaffold

## Purpose

This document translates `docs/NetworkEntity.md` from concept into executable scaffolding.
The scaffold is intentionally **non-autonomous** for high-impact actions: moderation output is advisory and always requires human approval.

## Implementation Surface

- Runtime module: `src/lib/networkEntity/liveScaffold.ts`
- Contracts and schema: `src/lib/networkEntity/types.ts`
- Public exports: `src/lib/networkEntity/index.ts`

## Core Capabilities (Scaffold Level)

1. **Live mesh event intake**
   - `ingestEvent(event)` stores real-time event envelopes in a bounded backlog.
   - Backlog trimming is deterministic via `maxEventBacklog`.

2. **Conversation routing**
   - `draftReply(event)` assigns event priority classes:
     - `network` for mesh/sync/node questions
     - `safety` for abuse or policy related prompts
     - `general` fallback for everything else

3. **Moderation proposal staging**
   - `evaluateModeration(event)` produces a `NetworkEntityModerationProposal` only when keyword thresholds are matched.
   - Output includes `requiresHumanApproval: true` to enforce a human-in-the-loop path.

4. **Memory coin rotation policy**
   - `memoryCheckpoint(coin)` computes fill ratio and rotation at `>= 85%` by default.
   - Aligns with the idea requirement that a new coin is selected after high utilization.

5. **UQRC-aligned debug report generation**
   - `buildUqrcDebugReport(...)` computes curvature norm and Q-score from directional and pairwise curvature data.
   - `converged` flag uses the archive threshold (`< 0.0005`) as baseline pass criteria.

## Schema Overview

### Event envelope

```ts
interface NetworkEntityMeshEvent {
  id: string;
  type: "comment" | "post" | "moderation_signal" | "peer_status" | "system_alert";
  roomId?: string;
  authorPeerId: string;
  payload: string;
  createdAt: string;
}
```

### Moderation proposal

```ts
interface NetworkEntityModerationProposal {
  eventId: string;
  peerId: string;
  reason: string;
  confidence: number;
  action: "isolate_temporarily" | "escalate_for_review";
  requiresHumanApproval: true;
  createdAt: string;
}
```

### Memory checkpoint

```ts
interface NetworkEntityMemoryCheckpoint {
  coinId: string;
  fillRatio: number;
  shouldRotateCoin: boolean;
  reason: string;
  createdAt: string;
}
```

## Coding Framework Guidance

### 1) Deterministic first

- Keep scaffold functions pure where possible.
- For mutable state (like backlog), enforce explicit bounds and no hidden side effects.

### 2) Human-approval boundaries

- Any isolation/removal action must remain proposal-only in this layer.
- Execution should occur in separate orchestration code with auditable approval logs.

### 3) Transport-agnostic contracts

- Do not bind schema types to PeerJS/GUN/WebTorrent internals.
- Adapter code should map transport payloads into `NetworkEntityMeshEvent`.

### 4) Extending INKS knowledge routing

- Replace keyword heuristics in `draftReply` with retrieval orchestration later.
- Preserve the same `NetworkEntityReplyDraft` output shape for compatibility.

### 5) UQRC report consistency

- Preserve report fields (`curvatureNorm`, `qScore`, `converged`) for dashboards/tests.
- If formula changes, version the report payload to avoid downstream ambiguity.

## Recommended Next Steps

1. Add a transport adapter that feeds incoming mesh comments/posts into `ingestEvent`.
2. Add persistence for moderation proposals and approval state transitions.
3. Add unit tests for threshold behaviors:
   - backlog truncation
   - moderation confidence bands
   - 85% memory rotation edge cases
   - curvature convergence threshold
4. Add an operator panel in Node Dashboard to review and approve entity proposals.
