# P2P Node Dashboard – Manual QA Checklist (Draft)

> **Status:** Draft checklist created to support Phase 0 sprint 0A. Expand with detailed steps as the dashboard surfaces ship.

## Smoke Verification

1. **Dashboard entry point loads**
   - Precondition: caretaker account with P2P feature flag enabled.
   - Steps:
     1. Navigate to the networking tab and click **View Node Dashboard**.
     2. Confirm routing to `/node-dashboard` (or equivalent) completes without console errors.
   - Expected: Layout renders with placeholder panels for signaling, mesh state, connection health, and peer list.

2. **Mesh toggle controls remain accessible**
   - Steps:
     1. From the dashboard, trigger the mesh enable/disable control.
     2. Observe updates in the diagnostics/log feed and the mesh status panel.
   - Expected: Control changes reflect within 5 seconds; diagnostics show `mesh:paused` or `mesh:resumed` events.

3. **Block list interactions**
   - Steps:
     1. Add a peer ID to the block list from the dashboard UI.
     2. Reload the page.
   - Expected: Blocked peer persists and appears under the dedicated list with timestamp metadata.

## Regression Guardrails

- [ ] Disconnect flow leaves no orphaned peer connections (verify via `ConnectedPeersPanel`).
- [ ] Signaling endpoint swaps continue to function from existing settings surfaces.
- [ ] Diagnostics feed continues streaming beacon latency events while dashboard is open.

## Open Questions

- What heuristics should surface "degraded" vs. "warning" labels on the connection health card?
- Should dashboard actions require the same confirmation dialogs present in the legacy networking tab, or can we streamline for caretakers?

_Update this checklist as implementation proceeds to capture new scenarios, negative tests, and rollback validation._
