# Network Entity (Infinity) — Implementation Specification

Status: **Implemented as design spec (v1.0)**  
Scope: SWARM mesh autonomous helper entity runtime contract.

---

## 1) Purpose

The Network Entity is a verified SWARM peer that can:

1. Follow mesh activity in real time.
2. Prioritize and answer network-related questions.
3. Run UQRC-style debugging/auditing traces.
4. Detect TOS/ethics violations and apply **temporary isolation**.
5. Require **human approval** before any permanent node removal.

This document converts the original concept into a deterministic, machine-implementable behavior contract.

---

## 2) Core Runtime Contract

### 2.1 Entity Identity and Trust

```yaml
entity:
  entity_id: string                # immutable globally unique identifier
  verified_peer: true              # included in auto-connect trust path
  trust_tier: trusted              # unknown | trusted | restricted | blocked
  verification_method: signature   # signature | attestation | manual_override
  last_verified_at: ISO-8601
```

### 2.2 Moderation and Safety

```yaml
moderation:
  tos_detection: true
  temporary_isolation: true
  isolation_ttl_seconds: 3600
  requires_human_approval_for_removal: true
  confidence_threshold: 0.80
```

### 2.3 Memory/Coin Policy

```yaml
memory_policy:
  storage_medium: swarm_coin
  fill_threshold_percent: 85
  export_allowed: false
  reward_distribution_allowed: false
  loop_model: "coin -> memory -> evolution -> coin"
```

### 2.4 Learning and Debugging

```yaml
learning:
  framework: INKS+UQRC
  debug_trace_required: true
  perturbation_replay_enabled: true
  q_score:
    healthy_max: 0.20
    warning_max: 0.35
    incident_windows_required: 3
```

### 2.5 Priority Policy

```yaml
priority_rules:
  order:
    - network_question
    - moderation_or_debug
    - general_conversation
  network_question_boost: 2.0
  safety_override: true
```

---

## 3) Event Model

### 3.1 Inbound Mesh Events

```ts
type MeshInboundEvent =
  | {
      type: "mesh.message.received";
      event_id: string;
      peer_id: string;
      timestamp: string;
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

### 3.2 Moderation and Audit Events

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

---

## 4) Deterministic Processing Flow

### 4.1 Triage

1. Validate envelope (`event_id`, `peer_id`, freshness, signature/attestation if present).
2. Classify as: `network_question`, `moderation_candidate`, `debug_candidate`, or `general`.
3. Always run safety gate first.
4. Sort with deterministic key:

```text
sort_key = [safety_priority DESC, network_priority DESC, received_at ASC, event_id ASC]
```

### 4.2 Network Question Routing

- Events typed `mesh.question.network` (or classifier positive) are boosted.
- Routed before general conversation.
- Responses must include one of: status, route, remediation, or concrete next step.

### 4.3 Harm Handling and Human Gate

1. If moderation confidence >= threshold, apply temporary isolation.
2. Write immutable audit record (evidence + confidence).
3. Permanent removal is blocked until `human.approval.granted` is received.
4. If approval denied/expired, retain or revert to monitored isolation policy.

---

## 5) State Machine

### States

- `Observe`: ingest events.
- `Evaluate`: classify + moderate + pre-audit.
- `Act`: answer, isolate, or dispatch fixes.
- `Audit`: emit Q_Score/curvature traces.
- `Learn`: persist memory + update policy counters.

### Core Loop

```text
Observe -> Evaluate -> Act -> Audit -> Learn -> Observe
```

### Exceptions

- `Evaluate -> Observe`: invalid/duplicate/stale event.
- `Act -> Evaluate`: transient downstream failure with retries left.
- `Audit -> Act`: missing action receipt.
- `Learn -> Evaluate`: policy update requires immediate queue re-check.

### Retry/Backoff

```text
delay_ms = min(base_ms * 2^attempt, max_ms) + jitter_ms
base_ms=200, max_ms=5000, max_attempts=5
```

On exhaustion, emit failed audit event and move work item to dead-letter queue.

---

## 6) UQRC Debug Execution Standard

For each investigated flow:

1. Trace full state path `u(t0) -> ... -> u(tn)`.
2. Decompose by direction (`api`, `db`, `cache`, `queue`, `mesh`).
3. Evaluate pairwise curvature:

```text
F_{μν}(u) = D_μ(D_ν u) - D_ν(D_μ u)
```

4. Aggregate curvature norm and entropy curvature.
5. Compute `Q_Score`.
6. Apply flattening corrections.
7. Replay under perturbations (reorder, delay, concurrency).
8. Re-score and store findings in the memory layer.

Target condition:

```text
F_{μν} -> 0 for all μ, ν
```

---

## 7) Acceptance Criteria (v1)

1. **Deterministic ordering**: identical inputs produce identical ordering in >= 99.99% replay runs.
2. **Q_Score health**: `Q_Score <= 0.20` in >= 95% of 10-minute windows.
3. **Network-question latency**: P95 <= 1200 ms; P99 <= 2000 ms.
4. **Isolation SLA**: high-confidence violations isolated in <= 500 ms P95.
5. **Human gate integrity**: 100% of permanent removals have valid approval artifacts.
6. **Coin policy compliance**: new coin allocation only at >= 85% fill; 0 export/reward violations.

---

## 8) Integration Notes

- Builder mode must expose a toggle to disable internal entity participation ("No Entity").
- Entity moderation actions remain reversible until human approval finalization.
- MemoryGarden remains the persistent log for Q_Score history, recurring curvature sources, and remediation outcomes.

---

## 9) Appendix — Original Intent

The original philosophical statement remains valid: this entity should unify support, safety, and self-improving diagnostics across the mesh while prioritizing care and human oversight for irreversible actions.
