/**
 * Legacy-reward hard fork, claimant side. SWARM rewards a device issued to
 * its own member before rewards moved into blocks sit in that device's
 * pending list, where no peer can see them. While the wallet is unlocked,
 * fold them into one claim signed by the member's identity key; peers accept
 * it once per member (see verifyLegacyRewardClaim and SwarmChain).
 */
import type { SwarmTransaction } from "./types";
import { LEGACY_CLAIM_MAX, LEGACY_REWARD_CLAIM, blockForbidsLegacyClaims, isSelfIssuedSwarmMint } from "./issuance";
import { networkNow } from "@/lib/time/networkClock";

interface ClaimChain {
  getPendingTransactions(): SwarmTransaction[];
  hasLegacyRewardClaim(member: string): boolean;
  adoptOwnLegacyRewardClaim(claim: SwarmTransaction): Promise<boolean>;
}

/** The device-only mints `member` holds, oldest first. */
export function legacyMintsFor(chain: Pick<ClaimChain, "getPendingTransactions">, member: string): SwarmTransaction[] {
  return chain.getPendingTransactions()
    .filter((tx) => isSelfIssuedSwarmMint(tx) && tx.to === member && Number(tx.amount) > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/**
 * Sign and queue the current member's claim. Returns it, or null when there
 * is nothing to claim, a claim already exists, the window closed, or the
 * wallet is locked (it never prompts for a passphrase).
 */
export async function claimLegacyRewards(chain: ClaimChain): Promise<SwarmTransaction | null> {
  if (blockForbidsLegacyClaims({ timestamp: new Date(networkNow()).toISOString() })) return null;
  const [{ getCurrentUser, getCachedPrivateKey }, { signWalletTip }] = await Promise.all([
    import("@/lib/auth"),
    import("./wallets/tipSignature"),
  ]);
  const me = getCurrentUser();
  if (!me?.id || !me.publicKey || chain.hasLegacyRewardClaim(me.id)) return null;
  const mints = legacyMintsFor(chain, me.id);
  if (mints.length === 0) return null;
  const privateKey = await getCachedPrivateKey();
  if (!privateKey) return null;
  // Fill up to the cap; whatever is left over stays device-only.
  const taken: SwarmTransaction[] = [];
  let amount = 0;
  for (const tx of mints) {
    if (amount + Number(tx.amount) > LEGACY_CLAIM_MAX + 1e-9) break;
    taken.push(tx);
    amount += Number(tx.amount);
  }
  if (taken.length === 0) return null;
  const claim = await signWalletTip({
    id: `legacy-claim-${me.id}`,
    type: LEGACY_REWARD_CLAIM as SwarmTransaction["type"],
    from: me.id, to: me.id, amount: Math.round(amount * 1e8) / 1e8,
    timestamp: new Date(networkNow()).toISOString(), signature: "", publicKey: me.publicKey,
    nonce: Date.now(), fee: 0, chainId: "SWARM",
    meta: { mintIds: taken.map((tx) => tx.id), issuedFrom: taken[0].timestamp, issuedTo: taken[taken.length - 1].timestamp },
  }, privateKey);
  return await chain.adoptOwnLegacyRewardClaim(claim) ? claim : null;
}
