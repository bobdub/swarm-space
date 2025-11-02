# P2P Node Dashboard — Manual QA Checklist

The node dashboard surfaces real-time swarm telemetry and operator controls. Use this checklist to validate that the experience remains functional whenever networking changes land.

## 1. Loading & Access

- [ ] From the networking tab (`Settings → Networking`), click **View Node Dashboard** and confirm the dashboard loads in a new route without losing the existing controls.
- [ ] Trigger the context action (`useP2PContext().openNodeDashboard()`) from the browser console and confirm the bridge routes to `/node-dashboard`.
- [ ] With P2P disabled, load the dashboard and verify the disabled warning banner appears while panels render their empty states safely.

## 2. Mesh Controls & State

- [ ] Toggle the **Rendezvous mesh** switch and observe diagnostics updates indicating mesh enable/disable events.
- [ ] Flip each control (auto-connect, manual approval, isolate, pause, pause inbound, pause outbound) and confirm persisted state matches the legacy networking panel.
- [ ] Use **Refresh peers** and confirm new rendezvous fetches occur (diagnostics should log `rendezvous-fetch-start`).

## 3. Telemetry Panels

- [ ] Validate the **Node status** panel updates bytes uploaded/downloaded after sharing content or retrieving files.
- [ ] Confirm the **Signaling status** panel shows the active endpoint, beacon latency, and rendezvous badges updating after toggling mesh availability.
- [ ] Confirm rendezvous success rate and failure streak react to simulated beacon outages (use Miniflare or mocked diagnostics).
- [ ] Check the connection health table lists every active peer with accurate RTT and last activity timestamps.
- [ ] Ensure the peer inventory panel shows discovered peers with last-seen timestamps and pending queue counts.
- [ ] Watch the packet loss and handshake confidence meters shift when you drop packets in devtools or via throttling.

## 4. Diagnostics Expectations

- [ ] Open the diagnostics drawer and confirm the latest events stream in, capped at the most recent 25 entries.
- [ ] Trigger mesh pause/resume and verify `mesh-control` diagnostics appear in the underlying feed and the drawer.
- [ ] Disable rendezvous capability (e.g., simulate Ed25519 failure) and ensure the dashboard surfaces the failure reason badge.
- [ ] Review that clearing diagnostics from the networking tab does not break dashboard rendering.

## 5. Block List & Pending Queue Smoke Test

- [ ] Add inbound-only and outbound-only blocks from the dashboard form and ensure they persist after a reload.
- [ ] Confirm outbound blocks prevent manual connection attempts while inbound-only blocks continue to allow dialing.
- [ ] Remove entries from each blocklist column and confirm the pending queue reflects the change if applicable.
- [ ] Approve or reject a pending peer; the dashboard should drop the entry within one poll cycle (≤5s).

Document any anomalies in the stability log before release.
