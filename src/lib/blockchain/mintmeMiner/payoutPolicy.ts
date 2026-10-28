/** Pure payout planning, not authorization or settlement. Supply confirmed, available
 * community earnings and an authoritative network-wide recipient snapshot.
 * Local mesh neighbours and unsigned share receipts cannot establish eligibility.
 */
export const MINTME_DECIMALS = 18;
export const MINTME_UNIT = 10n ** BigInt(MINTME_DECIMALS);
export const MINTME_PAYOUT_THRESHOLD = 25;
export const MINTME_PAYOUT_THRESHOLD_UNITS = 25n * MINTME_UNIT;
export const MINTME_PAYOUT_PERCENT = { community: 5, peers: 95 } as const;

export interface MintMePayoutPlan {
  status: "below-threshold" | "no-recipients" | "ready";
  recipients: string[];
  communityUnits: bigint;
  perPeerUnits: bigint;
  peersTotalUnits: bigint;
  remainingPoolUnits: bigint;
}

export function planMintMePayout(availableUnits: bigint, connectedRecipientIds: readonly string[]): MintMePayoutPlan {
  if (availableUnits < 0n) throw new RangeError("Available community earnings cannot be negative.");
  const recipients = [...new Set(connectedRecipientIds.map(id => id.trim()).filter(Boolean))].sort();
  const pending = {
    recipients, communityUnits: 0n, perPeerUnits: 0n, peersTotalUnits: 0n,
    remainingPoolUnits: availableUnits,
  };
  if (availableUnits < MINTME_PAYOUT_THRESHOLD_UNITS) return { ...pending, status: "below-threshold" };
  if (!recipients.length) return { ...pending, status: "no-recipients" };

  const communityUnits = availableUnits * BigInt(MINTME_PAYOUT_PERCENT.community) / 100n;
  const distributableUnits = availableUnits - communityUnits;
  const perPeerUnits = distributableUnits / BigInt(recipients.length);
  const peersTotalUnits = perPeerUnits * BigInt(recipients.length);
  // Indivisible atomic-unit dust stays pending so every recipient gets exactly the same amount.
  return {
    status: "ready", recipients, communityUnits, perPeerUnits, peersTotalUnits,
    remainingPoolUnits: distributableUnits - peersTotalUnits,
  };
}