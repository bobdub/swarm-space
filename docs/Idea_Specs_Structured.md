# Idea Specs — Structured Runtime Specification

Source basis: `docs/NetworkEntity.md` prose and intent, normalized into machine-implementable behavior.

## Schema

```yaml
entity_id: string # globally unique immutable identifier for this network entity
peer_verification:
  type: object
  properties:
    verified_peer: boolean # whether node is allowed in auto-connect trust path
    verification_method: enum["signature", "attestation", "manual_override"]
    trust_tier: enum["unknown", "trusted", "restricted", "blocked"]
    last_verified_at: string # ISO-8601 timestamp
moderation_capabilities:
  type: object
  properties:
    tos_detection: boolean # can classify TOS and ethical violations
    temporary_isolation: boolean # can quarantine harmful nodes
    isolation_ttl_seconds: integer # isolation duration before forced re-check
    requires_human_approval_for_removal: boolean
memory_policy:
  type: object
  properties:
    storage_medium: enum["swarm_coin"]
    fill_threshold_percent: integer # default 85
    export_allowed: boolean # must be false
    reward_distribution_allowed: boolean # must be false
    loop_model: string # "coin -> memory -> evolution -> coin"
learning_policy:
  type: object
  properties:
    framework: enum["UQRC", "INKS+UQRC"]
    debug_trace_required: boolean
    q_score_window_size: integer
    perturbation_replay_enabled: boolean
priority_rules:
  type: object
  properties:
    order: array<string> # ["network_question", "moderation_or_debug", "general_conversation"]
    network_question_boost: number # routing multiplier for network-relevant requests
    safety_override: boolean # safety always preempts conversational engagement
```

## Runtime Interfaces

### Inbound Mesh Event Types

```ts
type MeshInboundEvent =
  | {
      type: "mesh.message.received";
      event_id: string;
      peer_id: string;
      timestamp: string; // ISO-8601
      channel: "comment" | "post" | "direct" | "system";
      payload: { text?: string; metadata?: Record<string, unknown> };
    }
  | {
      type: "mesh.peer.status";
      event_id: string;
      peer_id: string;
      timestamp: string;
      status: "connected" | "disconnected" | "degraded";
      metrics?: { latency_ms?: number; packet_loss?: number; q_score?: number };
    }
  | {
      type: "mesh.question.network";
      event_id: string;
      peer_id: string;
      timestamp: string;
      payload: { question: string; context?: string };
      priority_hint?: "low" | "normal" | "high";
    };
```

### Moderation Event Type (TOS Violation)

```ts
type ModerationViolationEvent = {
  type: "moderation.tos.violation.detected";
  event_id: string;
  peer_id: string;
  timestamp: string;
  violation_class: "harmful_content" | "abuse" | "malware" | "illegal_content";
  confidence: number; // 0..1
  evidence_ref: string;
  recommended_action: "flag" | "temporary_isolate";
};
```

### Debug/Audit Event Type (UQRC)

```ts
type UQRCAuditEvent = {
  type: "debug.uqrc.audit";
  event_id: string;
  timestamp: string;
  scope: "api" | "db" | "cache" | "queue" | "mesh";
  curvature_norm: number;
  entropy_curvature: number;
  q_score: number;
  step_trace_ref: string;
  result: "pass" | "warn" | "fail";
};
```

## Deterministic Decision Flow

### 1) Message Triage
1. Validate envelope (`event_id`, `peer_id`, timestamp freshness, signature/attestation if available).
2. Classify message into one of: `network_question`, `moderation_candidate`, `debug_candidate`, `general`.
3. Run safety gate first; if violation confidence is above threshold, route to moderation pipeline immediately.
4. If not blocked, enqueue for priority routing with deterministic sort key:
   - `sort_key = [safety_priority DESC, network_priority DESC, received_at ASC, event_id ASC]`.

### 2) Network-Question Priority Routing
1. Detect network-question intent by schema (`mesh.question.network`) or NLP classifier fallback.
2. Apply `network_question_boost` from `priority_rules`.
3. Dispatch to answer pipeline before general conversation handlers.
4. Require response to include actionable network context (status, route, remediation, or next step).

### 3) Harmful Node Temporary Isolation + Human Approval
1. On `moderation.tos.violation.detected` with confidence >= policy threshold:
   - apply `temporary_isolate(peer_id, isolation_ttl_seconds)`.
2. Emit immutable audit entry containing evidence reference and model confidence.
3. Block permanent removal until explicit `human.approval.granted` event is received.
4. If approval is denied or expires, revert to pre-removal state and continue monitored isolation policy.

## State Machine

### States
- `Observe`: ingest mesh events and maintain ordered event queue.
- `Evaluate`: run moderation + routing + UQRC pre-checks.
- `Act`: respond, isolate, or dispatch corrections.
- `Audit`: write trace and Q_Score outcomes.
- `Learn`: update memory artifacts and policy counters.

### Core Transition Path
`Observe -> Evaluate -> Act -> Audit -> Learn -> Observe`

### Exception/Retry Transitions
- `Evaluate -> Observe` when event is invalid, duplicated, or stale.
- `Act -> Evaluate` when downstream dependency fails and retry budget remains.
- `Audit -> Act` when audit detects missing action receipt.
- `Learn -> Evaluate` when updated policy triggers immediate re-evaluation of queued events.

### Retry / Backoff Behavior
- Retryable operations use exponential backoff:
  - `delay_ms = min(base_ms * 2^attempt, max_ms) + jitter_ms`
  - defaults: `base_ms=200`, `max_ms=5000`, `max_attempts=5`.
- If retries exhausted:
  - emit `debug.uqrc.audit` with `result="fail"`,
  - move event to dead-letter queue,
  - continue processing next event to preserve liveness.

## Acceptance Criteria

1. **Deterministic triage ordering**
   - Given identical input stream, resulting processing order is identical in >= 99.99% replay runs.
2. **Q_Score stability target**
   - Healthy operating window: `Q_Score <= 0.20` for at least 95% of 10-minute windows.
   - Warning window: `0.20 < Q_Score <= 0.35`; auto-open audit trace.
   - Incident threshold: `Q_Score > 0.35` for 3 consecutive windows.
3. **Network-question latency**
   - P95 response latency for `network_question` <= 1200 ms.
   - P99 response latency for `network_question` <= 2000 ms.
4. **Moderation isolation SLA**
   - TOS violation events above threshold isolated in <= 500 ms P95.
5. **Human approval gate enforcement**
   - 100% of permanent removals require a valid human approval artifact.
6. **Memory policy compliance**
   - New coin allocation occurs only when current coin fill >= 85%.
   - 0 instances of coin export/reward transfer in compliance logs.

## Appendix A — Philosophy (Non-Executable)

The entity exists to unify learning, debugging, and care across the mesh.  
It observes flows, prioritizes network-support questions, and protects participants through temporary isolation when harm appears likely.  
UQRC and INKS remain guidance frameworks for interpretation, while this specification defines the executable contract that runtime systems must implement.
