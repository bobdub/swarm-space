# Training & Documentation Updates

## Purpose
This guide lists the near-term documentation work required to equip node operators and end users for the Phase 6 credits rollout. It provides authoring checkpoints, suggested formats, and cross-references to existing materials.

## Node Operator Enablement
- **Swarm Operations Runbook**
  - **Owners:** Protocol + DevRel.
  - **Scope:** Handshake validation sequence, gossip message taxonomy, quorum endorsement flow, and recovery coordination steps.
  - **Format:** Living document in `docs/` plus printable quick-start checklist.
  - **Dependencies:** `docs/ARCHITECTURE.md` (gossip tables, recovery coordinators) and `docs/DEPLOYMENT_PLAN.md` rollback drills.
  - **Completion Criteria:** Operators can execute Stage 0 and Stage 1 rollback plays without escalation.
- **Recovery Troubleshooting Guide**
  - **Owners:** Protocol engineering.
  - **Scope:** Transaction lifecycle diagrams, replay protection scenarios, ledger conflict triage.
  - **Format:** FAQ-style guide with flowcharts; embed links to log collection scripts.
  - **Dependencies:** Simulation backlog in `docs/CURRENT_STATUS.md` to ensure parity between docs and tests.
  - **Completion Criteria:** Documented runbooks cover at least the three critical recovery simulations (desync, conflict arbitration, council replay).

## End User Education
- **Credit System Primer**
  - **Owners:** Product + Community.
  - **Scope:** Explain earning mechanics (signup, posts, hype), spending, rate limits, and safety tips for transfers.
  - **Format:** Support article + in-app tooltips; include visuals from `src/components/CreditHistory` and `SendCreditsModal`.
  - **Dependencies:** Finalized metrics from Stage 1 to ensure thresholds match production behavior.
  - **Completion Criteria:** Primer published before Stage 2 rollout with localization-ready copy.
- **Onboarding & Recovery Refresh**
  - **Owners:** Product education.
  - **Scope:** Update onboarding wizard, backup walkthroughs, and social recovery language in the settings page to match current UX goals.
  - **Format:** Mixed media (video clips + step-by-step doc) referencing `docs/Private-Key.md` best practices.
  - **Dependencies:** UX variants from `docs/WIREFRAME_OVERVIEW.md` and testing insights from simulation suite.
  - **Completion Criteria:** Survey-based comprehension score ≥85% in beta testing cohort.

## Delivery Timeline
1. Align authors and contributors during Stage 0 dry run (see `docs/DEPLOYMENT_PLAN.md`).
2. Ship operator runbooks before opening Stage 1 beta.
3. Publish end-user materials no later than one week prior to Stage 2.
4. Revisit materials after every chaos simulation cycle to capture new learnings.
