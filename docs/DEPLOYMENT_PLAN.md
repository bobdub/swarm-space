# Swarm Credits Deployment Plan

## Overview
This playbook orchestrates a safe rollout of the Phase 6 credits stack across progressively larger cohorts. Each stage lists prerequisites, success metrics, guardrails, and rollback procedures to keep the network stable as new capabilities land.

## Stage 0 – Internal Swarm Dry Run
- **Scope:** Core team validators on an isolated mesh mirroring production topology.
- **Objectives:**
  - Exercise scripted simulations for signup rewards, hype burns, peer-to-peer transfers, and ledger replay.
  - Close outstanding credit concurrency, ledger accuracy, and rate limiting items from `docs/CURRENT_STATUS.md`.
- **Success Metrics:**
  - 0 failed reconciliation events across ≥100 scripted retries per scenario.
  - Deterministic nonce advancement through the validation pipeline with no dropped fragments.
  - IndexedDB recovery drills restore balances to the latest signed checkpoint on every node.
- **Rollback Play:**
  - Reset local IndexedDB stores.
  - Replay signed payload logs captured during the run.
  - Re-issue the last stable checkpoint bundle and validate hash parity.

## Stage 1 – Limited Beta (Trusted Node Operators)
- **Scope:** Quorum-sized peer list of vetted operators with production-like connectivity.
- **Objectives:**
  - Validate gossip checkpoints, conflict arbitration, and recovery fragment exchange on live networks.
  - Confirm UI notifications for handle conflicts and credit receipts stay within response budgets.
- **Success Metrics:**
  - ≥90% of delta syncs complete within the configured cadence.
  - No unresolved conflicts older than 72 hours.
  - Onboarding flows complete in under 2 minutes with UI response <100 ms at P95.
- **Rollback Play:**
  - Suspend new claims by revoking council endorsements and broadcasting `handle.conflict` rejections.
  - Shift nodes into read-only mode while the previous checkpoint is reinstated.
  - Provide operators with the Stage 0 recovery drill procedure for local state resets.

## Stage 2 – Broad Rollout
- **Scope:** General availability with optional relays/TURN and community node participation.
- **Objectives:**
  - Monitor peer discovery and bandwidth optimization checkpoints introduced in Phase 5.2.
  - Track adoption, usage, and retention targets alongside credits telemetry.
- **Success Metrics:**
  - ≥⅔ quorum endorsements per registry checkpoint.
  - ≥60% monthly active retention rate over rolling 30-day windows.
  - Credits velocity aligns with roadmap growth targets (baseline defined during Stage 1).
- **Rollback Play:**
  - If quorum metrics drop or conflicting roots emerge, revert to the last signed checkpoint bundle.
  - Require operators to resync from anchored snapshots and confirm gossip hashes before rejoining.
  - Issue community-wide guidance referencing `docs/TRAINING_UPDATES.md` to ensure consistent recovery actions.

## Stage N – Continuous Hardening
- **Scope:** Iterative releases after broad rollout.
- **Objectives:**
  - Feed metrics into ongoing chaos simulations (see `docs/CURRENT_STATUS.md` Simulation & Integration Coverage).
  - Automate rollback verification in CI pipelines.
- **Success Metrics:**
  - Every release candidate passes automated chaos suites and recovery drills.
  - Mean time to detect (MTTD) and mean time to recover (MTTR) trends downward over successive releases.
- **Rollback Play:**
  - Maintain signed snapshot catalog with diffable manifests.
  - Automate peer quiescence via council broadcast before applying reversions.
