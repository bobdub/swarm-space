# Credit System Mathematics Project Plan

## Vision
Deliver rigorously validated credit formulas and safeguards so the swarm economy remains fair, balanced, and sustainable across issuance, burn, and redistribution flows.

## Guiding Principles
- **Closed-loop integrity:** Preserve the self-regulating, non-monetary nature of credits while recalibrating reward math.
- **Proof-backed equity:** Align issuance with verified contribution so infrastructural, creative, and peer-to-peer actions remain transparent and auditable.
- **Graceful adaptability:** Introduce mathematical controls that can evolve with future node hosting, uptime, and arc-ledger enhancements.

## Current System Snapshot
- Reward constants allocate 100 genesis credits, 10 per post, 2 per engagement (stub), and charge 5 credits for hype with a 20% burn, enforced through shared helper functions and balance updates.
- Credits persist through IndexedDB-backed balances, transaction history, rate limiting, and notification pipelines already shipped in Phase 6.1.
- Hosting and engagement rewards follow legacy designs but remain partially implemented, highlighting divergence between intended and actual math.

## Known Pressure Points
- Hosting credits rely on a stub without automated measurement; device-local rate limiting and genesis re-award edge cases remain open risks.
- Engagement reward wiring and diminishing-return curves are absent, limiting the system’s ability to balance social activity mathematically.

## Stakeholders
| Role | Responsibilities |
| --- | --- |
| Product Lead | Define fairness goals, approve formula shifts, coordinate rollout messaging. |
| Data Scientist / Economist | Model reward curves, run simulations, validate balancing equations. |
| Backend / Platform Engineer | Implement formula engines, monitoring hooks, and persistence updates. |
| Frontend Engineer | Surface new balances, thresholds, and alerts within UI surfaces. |
| DevOps / SRE | Operate real-time stability monitors, guardrails, and incident playbooks. |
| Compliance & Trust Analyst | Review anti-abuse heuristics and anomaly escalations. |

## Success Metrics
- <1% variance between projected and actual total supply per epoch post-launch.
- 0 unresolved P0/P1 incidents caused by credit misallocation during rollout.
- Real-time anomaly detectors alert within 60 seconds of double-entry or overflow events.
- User-facing balances reconcile with ledger totals within ±0.5% in weekly audits.

## Timeline Overview
| Phase | Duration | Key Deliverables |
| --- | --- | --- |
| Phase 0 – Economic Audit | 1 week | Inventory of current formulas, data exports, integrity baselines. |
| Phase 1 – Formula Redesign | 2 weeks | Mathematical specifications for issuance, burn, and redistribution. |
| Phase 2 – Simulation & Stress Testing | 2 weeks | Scenario models, Monte Carlo outputs, threshold recommendations. |
| Phase 3 – Implementation & Observability | 2 weeks | Code changes, anomaly monitors, dashboards, QA sign-off. |
| Phase 4 – Rollout & Governance | 1 week | Staged deployment, on-call playbooks, retrospective. |

## Detailed Workstreams

### Phase 0 – Economic Audit & Baseline Instrumentation
1. Catalogue reward and burn mechanics by extracting constants and flows from `CREDIT_REWARDS`, balance updates, hype burns, and transfer logic to establish ground-truth math.
2. Export historical transaction data from `creditTransactions` and `creditBalances` to quantify actual issuance versus spend patterns since Phase 6.1.
3. Perform a gap analysis against whitepaper design to highlight missing engagement triggers, hosting measurement, and legacy scaling rules awaiting implementation.
4. Run integrity checks validating schema health, duplicate detection, and rate-limit efficacy leveraging Phase 6.1 instrumentation.

### Phase 1 – Formula Redesign & Specification
1. Recalculate issuance curves for genesis, content, engagement, hosting, and hype burns to satisfy fairness and sustainability targets outlined in MiniTasks.
2. Design balancing equations incorporating diminishing returns, burn-recycle loops, and credit sinks to stabilize supply under varied growth scenarios.
3. Define anomaly thresholds (e.g., max hourly issuance per cohort, acceptable burn ratios) referencing existing constants to ensure compatibility with current UX copy and tooling.
4. Produce a mathematical specification documenting formulas, parameters, and configurable levers for future governance review.

### Phase 2 – Simulation & Stress Testing
1. Run deterministic scenario models (e.g., high-growth creator cohorts, low-hosting environments) to test new formulas’ impact on total supply and individual balances.
2. Execute Monte Carlo simulations using historical transaction distributions to estimate probability of overflow, underflow, or unfair accrual.
3. Validate burn and redistribution loops to ensure hype, tipping, and system burns maintain equilibrium and respect 20% burn expectations.
4. Document guardrail recommendations (rate caps, cool-downs, fallback coefficients) for implementation in Phase 3.

### Phase 3 – Implementation & Observability
1. Update the credit engine with new formulas, ensuring balance updates, transaction records, and reward helpers apply revised math without regressing persisted data.
2. Integrate real-time stability checks (supply delta monitors, burn ratio trackers, overflow detectors) and emit anomaly events to the existing notification pipeline.
3. Enhance dashboards and alerts to surface credit health metrics for operators alongside existing transaction and notification streams.
4. Conduct regression testing covering genesis awards, post credits, hype, transfers, and edge cases previously noted in Phase 6.1 checklists.

### Phase 4 – Rollout, Monitoring, and Governance Enablement
1. Prepare a staged deployment plan with cohort-based enablement, rollback criteria, and parity checks between projected and actual issuance each stage.
2. Refresh on-call incident playbooks for hosting gaps, rate-limit bypass attempts, or mathematical anomalies referencing known risks.
3. Deliver stakeholder training for support, trust, and analytics teams on interpreting new stability dashboards and handling escalations.
4. Run a post-launch retrospective capturing metric outcomes, governance feedback, and backlog items for future phases (e.g., Arc Ledger integration).

## Dependencies & Risks
- Hosting telemetry remains deferred; ensure new formulas accommodate future proof-of-hosting data without rework.
- Engagement triggers are absent; plan simultaneous wiring or define temporary coefficients to avoid inflation.
- Device-local rate limits may allow abuse; coordinate with the trust team for additional distributed enforcement before rollout.
- Legacy UX copy referencing current constants requires audit to prevent mismatched messaging after recalibration.

## Communication & Reporting
- Weekly written updates summarizing formula progress, simulation findings, and risk decisions.
- Bi-weekly cross-functional review with stakeholders to sign off on model adjustments and rollout readiness.
- Live dashboards for supply, burn, and anomaly metrics shared with engineering and operations.

## Exit Criteria
- All new formulas implemented, documented, and validated with <1% drift from simulation expectations over two monitoring cycles.
- Real-time stability checks demonstrate reliable detection of scripted anomaly injections in staging.
- Support, trust, and analytics teams trained; documentation updated for onboarding and incident handling.
- Governance sign-off confirming the system meets fairness and sustainability objectives.

## Post-Completion Hand-off
- Transfer monitoring dashboards and anomaly alert ownership to SRE rotation with updated runbooks.
- Archive simulation models, coefficient histories, and decision logs for future economic reviews.
- Schedule quarterly credit health reviews to reassess formulas against live network behavior.
