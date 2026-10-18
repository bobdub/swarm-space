# SWARM public RPC boundary

## Verified findings — October 18, 2026

- `https://rpc.swarm-space.lovable.app` did not complete TLS negotiation from the sandbox; no `eth_chainId` result was received. This is not proof of global unavailability.
- POST to `https://swarm-space.lovable.app` returned the app HTML, not JSON-RPC.
- `swarmGatewayCell.ts` and `remoteGatewayClient.ts` serve browser mesh messages, not public HTTP requests.
- No externally hosted mesh gateway or its deployment configuration was found.

## Missing deployment

For a **public** HTTPS endpoint, an operator would need a mesh-connected host outside this client-only repository. This is not required for the user's local companion path. Static Vite hosting cannot accept JSON-RPC POSTs; a fixed chain-ID reply is not a gateway.

The host must terminate HTTPS with a valid public certificate, accept unauthenticated MetaMask JSON-RPC POSTs, support CORS/OPTIONS for the app, and enforce body/batch limits, method allowlists, request deadlines and rate limits. Never expose storage credentials or browser wallet keys.

Use a synchronized, validated ledger and a documented chain-selection policy. Reject requests while not ready; do not return fabricated balances, blocks or successful transaction receipts. Do not expose local identity linking or `eth_requestAccounts` as remote account authorization. Read-only support must not imply transfer support.

Before enabling transfers, review raw-transaction signature/chain-ID checks, authorization, replay/nonce handling, address mapping, durable transaction lookup, and mesh settlement. The existing EVM-shaped browser adapter is not evidence of full EVM compatibility.

## Acceptance checks

1. From outside the host network, POST `{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}` and require HTTP success and JSON-RPC result `0x123fb` (74747).
2. Verify block height, block data and balances against the synchronized mesh; test node restart and loss of peers.
3. Confirm unsupported methods return JSON-RPC errors, oversized input is rejected, and unready mesh state fails closed.
4. Confirm actual MetaMask installation and read-only wallet behavior. A chain-ID preflight alone does not certify EVM compatibility or transfer settlement.
5. Only then replace the advertised RPC URL with the deployed endpoint. App installation functions revalidate HTTPS `eth_chainId` before calling external MetaMask; they never use the browser provider as fallback.

Blocked: no public mesh-host deployment, hosting credentials, or authoritative upstream is available in this project.

## Local companion — no public host

Node > MetaMask Swarm Cell now detects the fixed `http://127.0.0.1:8545/health` endpoint. Windows x64 and Linux x64 standalone downloads are in `public/downloads/`; the downloadable source archive includes Go source, four security/relay tests, and build instructions. No helper server runs within this website repository or its hosting.

Launch the unsigned executable (Linux: extract first; execution permission may be required), keep its console open, and paste its random startup pairing code into Node. Sign-in, verified MetaMask connection and an online SWARM mesh peer are required for UI pairing. Pairing lives only while the Node page is mounted and the mesh remains connected. The code is held in memory, not browser storage; restart creates a new code.

The standalone helper binds only IPv4 loopback, validates Host and explicit SWARM browser origins, requires bearer authentication for its browser relay, limits bodies/concurrency/rates, and expires unpaired RPC within five seconds. Public read requests never see the pairing code. A 500ms authenticated poll takes JSON-RPC jobs into the browser's existing gateway and returns its actual ledger results. A fresh `eth_chainId` result of `0x123fb` is required before showing installation and again before contacting the external MetaMask provider. Public HTTPS validation is unchanged.

Read-only allowlist: `eth_chainId`, `net_version`, `web3_clientVersion`, `eth_blockNumber`, `eth_getBalance`, `eth_getBlockByNumber`, `eth_getBlockByHash`. No signing, account methods, gas/nonce placeholders, or transaction submissions are exposed. This is not a complete EVM execution engine; it must not be represented as working external settlement. Local ledger freshness and the existing gateway's address/block adapters still limit what MetaMask can accurately display.

Verified: 15 website tests, four companion Go tests, Windows PE build, Linux executable launch, both UI downloads plus source download, real authenticated browser gateway chain/height relay, write rejection and expiry after browser relay stops. The browser test used a disposable real local account and actual local chain, but invoked pairing directly for the relay check because no real external extension or connected peer was available. Full UI pairing with a live mesh, Windows execution, Linux desktop launch behavior, HTTPS preview local-network permissions and actual MetaMask custom-network acceptance remain unverified. Mobile MetaMask cannot reach a desktop loopback endpoint. Operating-system approval cannot be safely bypassed or promised as one-click deployment.