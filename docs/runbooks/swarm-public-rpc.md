# SWARM public RPC boundary

## Verified findings — October 18, 2026

- `https://rpc.swarm-space.lovable.app` did not complete TLS negotiation from the sandbox; no `eth_chainId` result was received. This is not proof of global unavailability.
- POST to `https://swarm-space.lovable.app` returned the app HTML, not JSON-RPC.
- `swarmGatewayCell.ts` and `remoteGatewayClient.ts` serve browser mesh messages, not public HTTP requests.
- No externally hosted mesh gateway or its deployment configuration was found.

## Missing deployment

An operator must provide an always-on mesh-connected host outside this client-only repository. Static Vite hosting cannot accept JSON-RPC POSTs. A short-lived function returning a fixed chain ID, or proxying without a real upstream, would not fix the missing gateway.

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