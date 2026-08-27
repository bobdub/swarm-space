# Fix: linking a personal server running on a desktop

## What I confirmed in the code

Three concrete blockers stop a desktop-hosted server from linking, all verified by reading the current code:

1. **The connection test always fails against a correct server.** `probePersonalServer` uploads a 1 KiB random payload under the key `probe-<uuid>`. The documented server contract (`docs/runbooks/personal-server-reference.md`) tells servers to reject any `PUT` whose body hash does not match the hash in the URL, and the reference Deno server returns `400 hash mismatch`. So anyone who follows our own guide gets "write failed: 400 hash mismatch" and can never finish the wizard.

2. **Only `localhost` / `127.0.0.1` are accepted over plain HTTP.** `isUrlAcceptable` rejects every other `http://` address, so a server on the desktop reachable at a LAN address (`http://192.168.1.20:7777`, `http://my-desktop.local:7777`) is refused before any request is made.

3. **The guide is missing the browser's local-network permission header.** Chrome/Edge send a Private Network Access preflight when an HTTPS page calls a local address; without `Access-Control-Allow-Private-Network: true` on the `OPTIONS` response the request dies as an opaque "Browser could not reach …" error, which is exactly the symptom.

## Changes

### 1. Make the probe use a real content hash
- Compute the SHA-256 of the probe payload and use that hex digest as the object key, so a spec-conformant server accepts the write.
- Keep the write → read → delete sequence and the per-step error reporting as-is.

### 2. Accept desktop/LAN endpoints deliberately
- Extend `isUrlAcceptable` to allow plain HTTP for loopback, `*.local`, and private IPv4 ranges (10.x, 172.16–31.x, 192.168.x), which is where a desktop server actually lives.
- Everything public still requires HTTPS; the reason string states this plainly.
- Show an inline note in the wizard when a local address is entered: it works from this device/network only, and other devices will not reach it.

### 3. Better failure messages for local servers
- In the shared fetch wrapper, when the target host is a local/private address, add the specific hints: server not running, wrong port, and the missing `Access-Control-Allow-Private-Network: true` header on the preflight.
- Surface the resolved host and the exact failing step in the wizard's probe result (the step list already exists; it just needs the host echoed).

### 4. Update the reference server docs
- Add the PNA header and an explicit `OPTIONS` handler to the CORS section and the Deno sample.
- Add a short "running it on your desktop" section: pick a port, allow it through the OS firewall, use `http://localhost:<port>` on the same machine or a LAN IP from another device, and note that HTTPS via a tunnel is still the recommended path for access away from home.
- Mirror the same guidance in the in-app guide page (`src/pages/PersonalServerGuide.tsx`).

### 5. Verify
- Unit-test the probe key derivation (key equals SHA-256 of body) and the widened URL rules (private ranges allowed, public HTTP rejected).
- Run the UQRC consistency check.
- Extend the MemoryGarden caretaker reflection, and update the Personal Server Linking memory to record the loosened local-address rule.

## Notes
- Encrypt-before-upload, the Stage 4 verification gate on reads, and the device-key credential storage are untouched.
- No new network path is added; only the probe key, the URL gate, error text, and docs change.
