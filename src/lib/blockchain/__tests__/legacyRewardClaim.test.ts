import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {}, resolveFork: () => "keep" }));
const clock = vi.hoisted(() => ({ now: Date.parse("2026-11-26T08:00:00Z") }));
vi.mock("@/lib/time/networkClock", () => ({ networkNow: () => clock.now }));
const session = vi.hoisted(() => ({ user: null as null | { id: string; publicKey: string }, privateKey: null as null | string }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => session.user, getCachedPrivateKey: async () => session.privateKey }));

const { SwarmChain } = await import("../chain");
const { claimLegacyRewards } = await import("../legacyRewardClaim");
const { signWalletTip } = await import("../wallets/tipSignature");
const { LEGACY_CLAIM_MAX } = await import("../issuance");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signerFromKeys } = await import("../blockHeader");

async function member() {
  const keys = await genIdentityKeyPair();
  const id = await computeUserId(keys.publicKey);
  session.user = { id, publicKey: keys.publicKey };
  session.privateKey = keys.privateKey;
  return { id, ...keys };
}

const legacyMint = (id: string, to: string, amount: number) => ({
  id, type: "token_mint", from: "system", to, amount, fee: 0, nonce: 0, publicKey: "system", signature: "",
  timestamp: "2026-11-10T00:00:00.000Z", meta: { reason: "CREATOR round" },
});

async function deviceWithLegacy(to: string, amounts: number[]) {
  const chain = new SwarmChain();
  await chain.whenReady();
  amounts.forEach((a, i) => chain.addTransaction(legacyMint(`old-${i}`, to, a) as never));
  return chain;
}

describe("legacy reward hard fork", () => {
  it("moves device-only rewards into one signed claim that a peer accepts and credits", async () => {
    const me = await member();
    const device = await deviceWithLegacy(me.id, [30, 12.5]);
    expect(device.getSpendableBalance(me.id)).toBe(0);
    const claim = (await claimLegacyRewards(device))!;
    expect(claim.amount).toBe(42.5);
    // Replaced, not added: the balance doesn't double.
    expect(device.getBalance(me.id)).toBe(42.5);
    expect(device.getSpendableBalance(me.id)).toBe(42.5);
    expect(device.getDeviceOnlyBalance(me.id)).toBe(0);

    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.acceptLegacyRewardClaim(claim)).toBe(true);
    expect(peer.getSpendableBalance(me.id)).toBe(42.5);

    // Mined into a block, it stays valid for every peer.
    const block = (await device.minePendingTransactions(me.id, undefined, { signer: signerFromKeys(me.id, me.publicKey, me.privateKey) }))!;
    expect(block.transactions.some((tx) => tx.id === claim.id)).toBe(true);
    const other = new SwarmChain();
    await other.whenReady();
    expect(await other.appendPeerBlock(block)).toBe(true);
    // The claim is spendable at once; the block reward itself still matures.
    expect(other.getConfirmedBalance(me.id)).toBe(42.5);
  }, 60_000);

  it("allows one claim per member", async () => {
    const me = await member();
    const device = await deviceWithLegacy(me.id, [5]);
    const first = (await claimLegacyRewards(device))!;
    const second = await signWalletTip({ ...first, id: "legacy-claim-again", signature: "" }, me.privateKey);
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.acceptLegacyRewardClaim(first)).toBe(true);
    expect(await peer.acceptLegacyRewardClaim(second)).toBe(false);
    expect(await claimLegacyRewards(device)).toBeNull();
  });

  it("refuses unsigned, forged, oversized and late claims", async () => {
    const me = await member();
    const device = await deviceWithLegacy(me.id, [5]);
    const claim = (await claimLegacyRewards(device))!;
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.acceptLegacyRewardClaim({ ...claim, signature: "" })).toBe(false);
    expect(await peer.acceptLegacyRewardClaim({ ...claim, amount: 500 })).toBe(false);
    const other = await member();
    expect(await peer.acceptLegacyRewardClaim({ ...claim, to: other.id })).toBe(false);
    const huge = await signWalletTip({ ...claim, id: "huge", amount: LEGACY_CLAIM_MAX + 1, signature: "" }, me.privateKey);
    expect(await peer.acceptLegacyRewardClaim(huge)).toBe(false);
    clock.now = Date.parse("2027-01-02T00:00:00Z");
    try {
      expect(await peer.acceptLegacyRewardClaim(claim)).toBe(false);
    } finally { clock.now = Date.parse("2026-11-26T08:00:00Z"); }
  });

  it("does nothing while the wallet is locked", async () => {
    const me = await member();
    const device = await deviceWithLegacy(me.id, [5]);
    session.privateKey = null;
    expect(await claimLegacyRewards(device)).toBeNull();
    expect(device.getDeviceOnlyBalance(me.id)).toBe(5);
  });
});
