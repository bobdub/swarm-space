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

### 5. Let other users download project content from your server

Your MinIO screenshot shows the `swarmspace` bucket already holding objects — but as the code stands today **no other user can ever read them**. Confirmed: every read goes through `personalServerGet`, which requires your credentials, and the S3 key layout is `imagination/<your userId>/chunks/<hash>`. Nothing publishes the server to the mesh, and the sync queue only handles `scope: 'private'` servers. So this plan, as written before this section, does not deliver peer downloads. Adding it:

- **Public mirror prefix.** When a server is marked as sharing project content, encrypted chunks for shared/project content are additionally written under a credential-free prefix (`imagination/public/chunks/<hash>`, or `/chunks/<hash>` for the HTTPS-blob kind). Still ciphertext only; the key stays on the device.
- **Anonymous read path.** Add a creds-free GET in the adapters: a plain `GET <endpoint>/<bucket>/imagination/public/chunks/<hash>` for S3-compatible, and the existing chunk route for HTTPS blob. Bytes pass through the same content-hash + Stage 4 signature gate before caching or rendering — a hostile mirror can only fail the check, never inject content.
- **Advertise the mirror.** Publish the server's public base URL as a seeder hint alongside the manifest already gossiped over the mesh (reusing the existing manifest/announce path, no new gossip channel). Peers resolve content as: Media Coin → local chunks → advertised mirrors → torrent → peer sync.
- **Project scoping.** Only content the owner posts into a project (or explicitly marks shared) is mirrored publicly; private replicas keep the per-user prefix and are never advertised.
- **Owner controls.** A "Share project content from this server" toggle in the Personal Servers panel, with mirrored-bytes count, a cap, and a purge action that deletes the public prefix.
- **MinIO setup docs.** Bucket CORS for the app origin, plus an anonymous read-only policy scoped to `imagination/public/*` only (the rest of the bucket stays private) — written up in the runbook and the in-app guide.

### 6. Verify
- Unit-test the probe key derivation (key equals SHA-256 of body) and the widened URL rules (private ranges allowed, public HTTP rejected).
- Test the anonymous read path: correct bytes accepted, tampered bytes rejected by the verification gate, missing object handled as a miss.
- Run the UQRC consistency check.
- Manual check against the MinIO instance: post media in a project, confirm objects land under the public prefix, then load the post from a second browser profile with no credentials.
- Extend the MemoryGarden caretaker reflection, and update the Personal Server Linking memory with the loosened local-address rule and the public mirror prefix.

## Notes
- Encrypt-before-upload and the Stage 4 verification gate on reads stay intact; the public mirror only ever exposes ciphertext.
- A LAN-only address cannot serve other users off your network. For peer downloads the server needs a public HTTPS address (tunnel, reverse proxy, or a hosted S3-compatible endpoint) — the UI will say so where you enable sharing.

