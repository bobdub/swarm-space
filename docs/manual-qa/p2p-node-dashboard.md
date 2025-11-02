# P2P Node Dashboard — Manual QA Checklist

The node dashboard surfaces real-time swarm telemetry and operator controls. Use this checklist to validate that the experience remains functional whenever networking changes land.

## 1. Loading & Access

- [ ] From the networking tab (`Settings → Networking`), click **View Node Dashboard** and confirm the dashboard loads in a new route without losing the existing controls.
- [ ] Trigger the context action (`useP2PContext().openNodeDashboard()`) from the browser console and confirm the bridge routes to `/node-dashboard`.
- [ ] With P2P disabled, load the dashboard and verify the disabled warning banner appears while panels render their empty states safely.

## 2. Mesh Controls & State

- [ ] Toggle the **Rendezvous mesh** switch and observe diagnostics updates indicating mesh enable/disable events.
- [ ] Flip each control (auto-connect, manual approval, isolate, pause) and confirm persisted state matches the legacy networking panel.
- [ ] Use **Refresh peers** and confirm new rendezvous fetches occur (diagnostics should log `rendezvous-fetch-start`).

## 3. Telemetry Panels

- [ ] Validate the **Node status** panel updates bytes uploaded/downloaded after sharing content or retrieving files.
- [ ] Confirm rendezvous success rate and failure streak react to simulated beacon outages (use Miniflare or mocked diagnostics).
- [ ] Check the connection health table lists every active peer with accurate RTT and last activity timestamps.
- [ ] Ensure the peer inventory panel shows discovered peers with last-seen timestamps and pending queue counts.

## 4. Diagnostics Expectations

- [ ] Trigger mesh pause/resume and verify `mesh-control` diagnostics appear in the underlying feed.
- [ ] Disable rendezvous capability (e.g., simulate Ed25519 failure) and ensure the dashboard surfaces the failure reason badge.
- [ ] Review that clearing diagnostics from the networking tab does not break dashboard rendering.

## 5. Block List & Pending Queue Smoke Test

- [ ] Block a peer from the original networking tab and confirm the blocked count updates in the dashboard inventory.
- [ ] Approve or reject a pending peer; the dashboard should drop the entry within one poll cycle (≤5s).

Document any anomalies in the stability log before release.
