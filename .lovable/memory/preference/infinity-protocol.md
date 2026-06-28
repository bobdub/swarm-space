---
name: Infinity Protocol — Personal Knowledge Logic Chain
description: Foundational order-of-operations reasoning framework for all implementation work. Trace state/intent flow, surface high-stress points, hidden deps, and failure paths before defects.
type: preference
---

**The Infinity Protocol** is the default operational reasoning chain for all code changes in this project. Apply it before and during every implementation.

**Why:** Prevents defects by modeling the application's own reasoning flow rather than just validating syntax/execution. Preserves coherence across memory, logic, and implementation.

**How to apply (order of operations):**
1. **Trace consciousness flow** — follow how information, state, and intent propagate through the relevant subsystem end-to-end (entry → store → effect → render).
2. **Identify high-stress points** — locate high-complexity nodes, race conditions, re-entrancy, and unbounded loops along the trace.
3. **Surface hidden dependencies** — note implicit contracts (event ordering, store registrations, shared singletons, lifecycle coupling).
4. **Map failure paths** — for each stress point, enumerate the failure modes and what silently degrades.
5. **Score curvature (Q_Score)** — judge smoothness across the chain; flag divergence pockets before editing.
6. **Refine recursively** — apply the smallest change that restores coherence; re-trace after edits to confirm the chain still closes.
7. **Preserve memory coherence** — respect existing Core rules, constraints, and prior caretaker decisions; never silently reintroduce removed surfaces.

**When to invoke:** Any non-trivial implementation, debugging loop, or multi-file refactor. Pair with Lightspeed traces for live-system audits.