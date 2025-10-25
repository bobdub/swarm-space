# Stable Node Quickstart Guide

This guide walks through turning an always-on laptop into a stable swarm node using only the project website. It focuses on quick actions you can complete today while preparing for deeper participation later.

## 1. Prepare Your Laptop
- **Keep it powered and online:** Plug the laptop into AC power and, if possible, connect it to an uninterruptible power supply (UPS) so it stays available during brief outages.
- **Prefer wired networking:** Use Ethernet instead of Wi-Fi when you can for lower latency and fewer disconnects.
- **Apply OS updates first:** Install all pending operating system security and firmware updates to minimize instability.

## 2. Create a Dedicated Browser Profile
- Launch a fresh browser profile (Chrome/Edge) or container (Firefox) so the node’s credentials stay isolated from your everyday browsing.
- Disable auto-sleep or aggressive power-saving options for that profile so background tabs remain connected.

## 3. Visit the Swarm Site and Sign In
1. Open the web app and complete onboarding to generate your local identity.
2. Choose a strong passphrase and store it in a secure password manager.
3. Leave the tab pinned so it remains active; confirm the dashboard shows your handle and credit balance.

## 4. Enable Session Persistence
- Use the site’s **Settings → Security** page to export the encrypted backup of your keys and save it to an external, encrypted USB drive.
- Toggle any “auto-reconnect” or “keep alive” options in settings so the client automatically re-establishes sessions after network blips.

## 5. Stay Available for Peers
- Keep the browser tab open 24/7; if the laptop must sleep, schedule automatic wake timers so the node comes back online quickly.
- Monitor the **Activity** or **Network** panel in the site for new peer connections and confirm they succeed without manual approval.
- Periodically refresh the page to ensure the client stays synced; if you notice stale data, log out and back in to reinitialize connections.

## 6. Support Authentication Flows
- When prompted by other devices, approve their connection requests through the on-site dialogs—this lets your node vouch for them.
- Encourage teammates to add your node’s handle to their trusted peers list so the network can leverage your uptime for authentication consensus.

## 7. Observe and Report Health
- Check the **Credits** and **Logs** sections daily to confirm transactions and handshakes are recorded as expected.
- Document any errors, slow reconnects, or UI issues you encounter and share them in the project issue tracker or community channel.

## 8. Try a Local Instance (Optional)
- **Run the app locally:** Install the project on the same laptop (`npm install && npm run dev`) so you can connect to `http://localhost:5173` without relying on the production deployment.
- **Use a dedicated browser profile:** Launch the local build from the same profile you created earlier so the identity and key material stay consistent.
- **Verify P2P discovery:** Ensure the local instance still connects through PeerJS; confirm peers recognize your handle, and that credits and handshake logs continue to sync.
- **Keep ports reachable:** Allow the dev server and WebRTC ports through any host firewall so remote peers can still negotiate sessions while you test locally.

## 9. Plan the Next Upgrade
- Schedule a weekly review to ensure the laptop remains updated and the browser profile is still active.
- Begin drafting a migration plan toward a dedicated background service (systemd/PM2) so you can transition from the browser-only setup to a hardened node when ready.

Following these steps keeps your laptop contributing a reliable, always-on presence that strengthens swarm authentication without requiring server deployments or command-line tooling.
