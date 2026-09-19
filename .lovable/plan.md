# Peer to MetaMask — real MintMe deposits onto the SWARM wallet

Today MintMe sits in a side ledger in the browser ("MetaMask vault") that the SWARM
blockchain never sees. MetaMask is already paired with the user and can sign, so the
deposit path can be done peer-to-peer with no server: MetaMask is the custody device,
the SWARM chain is the record.

## How a deposit will work

```text
1. Prove      MetaMask signs a short ownership message  -> address bound to the SWARM wallet
2. Deposit    MetaMask signs a MintMe transfer to the    -> real tx hash returned by MetaMask
              user's own bound deposit address
3. Record     A signed deposit entry (address, amount,   -> written onto the SWARM chain,
              tx hash, MetaMask-reported balance)           broadcast to peers
4. Reconcile  MetaMask is re-read on each wallet visit   -> balance on SWARM stays truthful
```

The coins never leave the user's control — exactly like a cold wallet. What changes is
that the SWARM blockchain now carries a signed, peer-visible record of the holding
instead of an invisible local number.

## Stages

### 1. Bind MetaMask to the SWARM wallet
- "Link this wallet" action in the wallet: MetaMask signs a message containing the
  SWARM user id, the address, and a timestamp.
- The signature is written to the SWARM chain as a `wallet_link` entry and shared over
  the mesh, so any peer can check the address really belongs to that Swarm identity.
- Unlink writes a matching revoke entry.

### 2. Deposit MintMe
- Deposit panel: enter an amount, MetaMask prompts, transfer is signed on the MintMe
  network to the user's own bound address.
- On the returned tx hash, a `deposit` entry is written to the SWARM chain crediting
  MINTME to that user's SWARM wallet, carrying the hash and a MetaMask signature over
  the deposit claim.
- Deposits are rejected unless the address is bound (stage 1) and MetaMask is on the
  MintMe network.

### 3. Balance shown from the chain, reconciled with MetaMask
- The wallet's MINTME figure comes from the SWARM chain record, with a live MetaMask
  reading shown next to it and a "last checked" time.
- If MetaMask reports less than the chain record (the user spent elsewhere), the wallet
  shows a clear "backing reduced" state and writes a reconcile entry rather than
  silently changing the number.
- Not-linked and wrong-network states are shown plainly with one button to fix each.

### 4. Retire the side ledger
- The local MetaMask-vault numbers for MINTME are migrated once into chain entries
  where a bound address exists, then that path stops being written to.
- ETH and BTC keep their current "peer sales only" wording — untouched by this work.

## What is honest about the limits

Without a node of our own, MetaMask's own connection is the only witness to a MintMe
transfer. So a deposit record proves: this address signed this claim, MetaMask reported
this hash and this balance. Peers can see and keep the signed record, and can later
re-check it once a MintMe node is reachable. The wallet text will say this rather than
implying independent verification.

## Technical notes

- New `src/lib/blockchain/wallets/walletLink.ts`: `personal_sign` binding, signature
  verification via `ethers.verifyMessage`, link/revoke chain entries.
- New `src/lib/blockchain/deposits/mintmeDeposit.ts`: builds the deposit claim, signs it,
  writes the chain entry, exposes `getChainMintmeBalance(userId)`.
- Deposit and link entries go through the existing chain transaction path
  (`src/lib/blockchain/token.ts` / `chain.ts`) with a new `meta.kind`, so they propagate
  on the mesh like every other transaction — no new transport.
- `sendMintMe` in `mintmeBridge.ts` is reused for the transfer; `readMintMeBalance` is
  reused for reconciliation.
- `AssetsTab.tsx` and `BridgePanel.tsx` read the chain-backed MINTME figure instead of
  `appWallet`; `appWallet` keeps ETH/BTC only.
- No new dependency: `ethers` is already used by the gateway cell.
