
# Swarm Gateway Cell — MetaMask as a Visitor, not the Wallet

## Mental model (locked in)

- The **local Swarm wallet** created at first boot stays the user's primary wallet.
- The **peer mesh** carries every block, tx, and content chunk.
- **MetaMask** is only a door to the outside — used to bring SWARM in, take it out, or touch other EVM chains.
- To let MetaMask *see* Swarm, we run a **Swarm Gateway Cell** — a peer that speaks JSON-RPC on one side and Swarm mesh messages on the other.

```text
 MetaMask  ──JSON-RPC──▶  Swarm Gateway Cell  ──mesh msg──▶  Swarm Mesh  ──▶  Swarm Blockchain
                              (translator)            (roads)          (city)
```

The gateway is not the chain. It is a translator standing at the door.

## What we build

### 1. Gateway cell inside the mesh
`src/lib/blockchain/gateway/swarmGatewayCell.ts`
- New peer role `gateway` that any node can opt into (Settings → Advanced → "Run gateway cell").
- Subscribes to the existing Swarm mesh (`swarm-mesh`, `chain-sync-*`, `tx-broadcast`).
- Exposes a small in-process API: `handleRpc(method, params) → result` implemented for the JSON-RPC methods MetaMask actually calls:
  - `eth_chainId`, `net_version`
  - `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`
  - `eth_getBalance` (maps SWARM ledger address → wei-scaled balance)
  - `eth_getTransactionByHash`, `eth_getTransactionReceipt`
  - `eth_sendRawTransaction` (validates signature, injects into mesh as a normal Swarm tx)
  - `eth_estimateGas`, `eth_gasPrice` (return chain-configured constants)
- All answers come from local mesh state — no external RPC, no server.

### 2. Address mapping
`src/lib/blockchain/gateway/addressMap.ts`
- Deterministic map `swarmAddress ↔ evmAddress` (keccak of the Swarm pubkey, take last 20 bytes).
- Stored per-user next to the existing wallet so the same identity is reachable from both sides.
- Balances are read from the existing SWARM ledger and re-expressed in 18-decimal wei for MetaMask.

### 3. Local RPC transport
`src/lib/blockchain/gateway/localRpcTransport.ts`
- A `postMessage` / `BroadcastChannel` bridge so a MetaMask-facing provider in the same browser can talk to the gateway cell without a real HTTPS server.
- For remote MetaMask (mobile app on another device) we surface a per-user **gateway URL** that points at any peer running the gateway role. Discovery uses the existing public-cell registry — pick the nearest healthy gateway peer.

### 4. EIP-1193 shim
`src/lib/blockchain/wallets/swarmProvider.ts`
- A tiny provider object that forwards `request({method, params})` into `localRpcTransport`.
- Registered as an alternate provider so the existing `useMetaMask` hook can point at "Swarm-Space (local)" without changing call sites.

### 5. Network config already exists
Keep `swarmEvmNetwork.ts` as the canonical descriptor. Update `rpcUrls` to a **gateway URL template** the user copies from Settings, e.g. `https://<peer-id>.gateway.swarm-space.lovable.app`. Until any user runs a public gateway, the "Add / switch" button also offers **"Use local in-browser gateway"** which registers the EIP-1193 shim directly — no external URL needed.

### 6. UI
- **Settings → Wallet → Gateway**
  - Toggle: "Run a Swarm Gateway Cell on this device" (default off).
  - Status row: peers served, requests/min, last error.
- **Wallet → Assets → MetaMask card**
  - "Bring SWARM in" / "Send SWARM out" now route through the gateway when MetaMask is on Swarm-Space.
  - Clear label: *"MetaMask is a visitor. Your Swarm wallet is still your primary wallet."*

## What we deliberately do NOT do

- No new blockchain, no re-implementation of consensus — the gateway only reads/writes the existing mesh.
- No hosted RPC service. Every gateway is a peer someone is running.
- No signing inside the gateway. `eth_sendRawTransaction` requires an already-signed payload.
- No change to the local Swarm wallet flow. MetaMask remains optional.

## Verification

1. Toggle "Run gateway cell" on → Settings shows it as active.
2. In MetaMask, add Swarm-Space using the in-browser gateway option → `eth_chainId` returns `0x123fb`.
3. `eth_getBalance` on the user's EVM-mapped address returns the same SWARM balance shown in the Assets tab (scaled to wei).
4. Sending SWARM out via MetaMask emits a signed tx → gateway injects it into the mesh → other peers see it in the ledger within one block.
5. Turn the gateway toggle off → MetaMask calls fail cleanly with "no gateway reachable", the local Swarm wallet keeps working untouched.

## Phasing

- **Phase A (this change):** Cell scaffold, address map, EIP-1193 shim, read-only RPC methods (`chainId`, `blockNumber`, `getBalance`, `getBlockByNumber`), Settings toggle, "Use local in-browser gateway" button.
- **Phase B:** Write path — `eth_sendRawTransaction` validated and injected into the mesh; receipts surfaced from ledger.
- **Phase C:** Remote gateway discovery via public-cell registry so a mobile MetaMask can point at a peer-hosted gateway URL.

Approve and I will build Phase A end-to-end and stop for your check before Phase B.
