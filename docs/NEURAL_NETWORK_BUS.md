# Neural Network Bus for New User Integration

## Objective

Use the Global Cell bus loop as a deterministic connection coordinator so newly discovered users do not remain indefinitely in a waiting state.

## Node Conditions

Each node is always interpreted in one of two conditions:

1. **Connected (Mining)**
   - Node has at least one active peer connection.
   - Mining may proceed.

2. **Waiting (Ready)**
   - Node has no active peers yet.
   - Node remains on the bus and is eligible for immediate connection attempts during each cycle.

## Bus Integration Model

The existing Global Cell loop already traverses the full known network via beacon + prune cycles. This change adds a new deterministic stop:

- Track waiting nodes by first-seen and last-seen timestamps.
- Re-evaluate waiting nodes on every bus prune/emit cycle.
- Attempt one prioritized connection per cycle.

## Connection Resolution Logic (Per Bus Cycle)

During each cycle:

1. Build waiting candidate set from live bus peers that are not yet connected.
2. Apply deterministic priority:
   - **Primary:** strongest peer (trust score / stability)
   - **Secondary:** longest waiting time (fairness)
3. Mode behavior:
   - **Connected local node:** prefers longest-waiting nodes first (network fairness).
   - **Waiting local node:** prefers strongest available nodes first, then longest-waiting fallback.
4. Attempt the selected connection through SwarmMesh.

## Execution Constraint

- Bus manages **connection state and routing decisions only**.
- Bus does **not** execute mining.
- Mining remains blocked unless at least one peer connection exists.

## Deterministic Synapse Layer

The waiting-node ledger acts as lightweight connection memory:

- `firstSeenAt` preserves fairness ordering.
- `lastSeenAt` prunes stale entries.
- `trustScore` supports stability-prioritized selection.

This keeps pairing decisions reproducible across cycles and improves newcomer onboarding under churn.
