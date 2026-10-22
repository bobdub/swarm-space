# Blockchain module guidance

- Use creatorVaultCustody.ts: never burn/mint; engrave and release before bucket changes. creatorMarketOperation excludes local overlaps; creatorVaultBacking protects payout layers, not peer consensus.
- Use customTokenLimits.ts for caps and ownedAssets.ts for positive balances. Read the market readiness plan before expansion: self-transfers are not escrow; profile reads must not initialize vaults.
- Use coldKey.ts for MintMe withdrawals: key authority is a Creator Coin Vault or a 1-SWARM engraved container; the secp256k1 key is derived from the identity key (never displayed); deposits target the cold-key address; the ledger debits only after the MintMe broadcast succeeds.
- SWARM Market Vault: pure pricing in marketVaultPricing.ts; marketVault.ts uses the shared operation guard and releases only already-mined pool SWARM, never mints.
- Creator payments use the profile-market spot and recheck it before payment; atomic holder-to-pool ownership updates preserve supply. Refund failed releases only if payout is absent from the ledger, so accepted SWARM is never refunded twice. This is local settlement, not peer consensus.
- Creator market quotes retain their last rate during coalesced market-event reads, not pool ticks; payments automatically use the unlocked identity vault, never substitute session metadata for a signing key.
