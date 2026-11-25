/** Ethereum ERC-20 imports (for example MTCG) follow the MintMe token flow on chain 1. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({
  ledger: [] as SwarmTransaction[], held: 5n * 10n ** 18n, decimals: 18, ethChainId: 1n,
  reads: [] as string[], sent: [] as { units: bigint; to: string; network?: string }[],
}));
const wallet = new Wallet(`0x${"02".repeat(32)}`);
const address = wallet.address.toLowerCase();
// The same address deployed on both chains must never mix balances.
const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
const ref = `eth:${contract}`;

vi.mock("ethers", async importOriginal => {
  const actual = await importOriginal<typeof import("ethers")>();
  return { ...actual, Contract: class {
    decimals = async () => state.decimals;
    balanceOf = async () => state.held;
  } };
});
const provider = (name: string, chainId: () => bigint) => ({
  getNetwork: async () => { state.reads.push(name); return { chainId: chainId() }; },
  getBlockNumber: async () => 1000, getTransactionReceipt: async () => null, getTransaction: async () => null, destroy: vi.fn(),
});
vi.mock("../wallets/nativeMintmeCustody", () => ({ mintMeReadProvider: () => provider("mintme", () => 24734n) }));
vi.mock("../wallets/ethereumRpc", () => ({ ethereumFallbackProvider: () => provider("ethereum", () => state.ethChainId) }));
vi.mock("../wallets/walletLink", () => ({ _allTransactionsForExternalLedger: () => state.ledger }));
vi.mock("../wallets/coldKey", () => ({
  getColdKeyReceivingAddress: async () => address,
  deriveColdKey: async () => ({ address, wallet: { signMessage: (m: string) => wallet.signMessage(m) } }),
  getColdKeyAuthority: async () => ({ kind: "vault" }),
  sendColdKeyTokenTransfer: async (p: { units: bigint; to: string; network?: string }) => { state.sent.push(p); return `0x${"cd".repeat(32)}`; },
}));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({ broadcast: vi.fn() }) }));
vi.mock("./depositSync", () => ({ isDepositSynced: () => true, connectedPeerCount: async () => 1, markDepositsSynced: async () => true }));
vi.mock("../../store", () => ({ get: async () => undefined, put: async () => {} }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {},
  acceptCustomTokenDeposit: async (tx: SwarmTransaction) => {
    const { verifyCustomTokenSync } = await import("./customTokenCustody");
    if (!await verifyCustomTokenSync(tx, state.ledger, true)) return false;
    state.ledger.push(tx); return true;
  },
  addTransaction: (tx: SwarmTransaction) => { state.ledger.push(tx); },
}) }));

import { addCustomToken, customTokenRef, getRecordedTokenBalance, listCustomTokens, removeCustomToken, syncCustomTokenDeposits, withdrawCustomToken } from "./customTokens";
import { syncRecordRef, verifyCustomTokenSync } from "./customTokenCustody";
import { customTipRef, customTipAssetId, provenTokenDecimals } from "./customTokenTips";
import { importCustomTokenFromMintMe, readTokenMetadataPublic } from "./nativeTokenImport";

beforeEach(() => {
  localStorage.clear(); state.ledger = []; state.held = 5n * 10n ** 18n; state.decimals = 18;
  state.ethChainId = 1n; state.reads = []; state.sent = [];
});

describe("Ethereum token import", () => {
  it("keeps an Ethereum token and a MintMe token with the same contract as two wallet entries", () => {
    addCustomToken("member", { address: contract, symbol: "Dreams", decimals: 12 });
    importCustomTokenFromMintMe("member", { address: contract, symbol: "MTCG", decimals: 18, network: "ethereum" });
    const tokens = listCustomTokens("member");
    expect(tokens.map(customTokenRef).sort()).toEqual([contract, ref]);
    removeCustomToken("member", ref);
    expect(listCustomTokens("member").map(customTokenRef)).toEqual([contract]);
  });
  it("reads metadata through the network it was asked for", async () => {
    const calls: string[] = [];
    const meta = await readTokenMetadataPublic(contract, async (_to, data) => { calls.push(data);
      return data.startsWith("0x313ce567") ? `0x${"0".repeat(62)}12` : "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("MTCG").toString("hex").padEnd(64, "0"); }, "ethereum");
    expect(meta).toEqual({ symbol: "MTCG", decimals: 18 });
    expect(calls).toHaveLength(2);
  });
});

describe("Ethereum token deposits", () => {
  beforeEach(() => { addCustomToken("member", { address: contract, symbol: "MTCG", decimals: 18, network: "ethereum" }); });

  it("credits a confirmed Ethereum deposit under its own chain-keyed currency", async () => {
    expect(await syncCustomTokenDeposits("member", ref)).toBe(5);
    expect(state.reads.every(r => r === "ethereum")).toBe(true);
    const [tx] = state.ledger;
    expect(tx.id).toBe(`token-sync:${ref}:${address}:${5n * 10n ** 18n}`);
    expect(tx.meta).toMatchObject({ currency: `ETHEREUM:${contract}`, network: "ethereum", contract, decimals: 18 });
    expect(syncRecordRef(tx)).toBe(ref);
    expect(getRecordedTokenBalance("member", ref)).toBe(5);
    expect(getRecordedTokenBalance("member", contract)).toBe(0);
    expect(await syncCustomTokenDeposits("member", ref)).toBe(0);
  });

  it("refuses a node that answers for another chain", async () => {
    state.ethChainId = 24734n;
    await expect(syncCustomTokenDeposits("member", ref)).rejects.toThrow("Ethereum");
    expect(state.ledger).toHaveLength(0);
  });

  it("rejects an Ethereum receipt relabelled as a MintMe deposit", async () => {
    await syncCustomTokenDeposits("member", ref);
    const [tx] = state.ledger;
    const { network: _network, ...mintmeMeta } = tx.meta ?? {};
    expect(await verifyCustomTokenSync({ ...tx, meta: { ...mintmeMeta, currency: `MINTME:${contract}` } }, [], false)).toBe(false);
    expect(await verifyCustomTokenSync({ ...tx, meta: { ...tx.meta, network: "polygon" } }, [], false)).toBe(false);
    expect(await verifyCustomTokenSync(tx, [], false)).toBe(true);
  });

  it("withdraws on Ethereum and records the chain on the withdrawal", async () => {
    await syncCustomTokenDeposits("member", ref);
    const token = listCustomTokens("member").find(t => customTokenRef(t) === ref)!;
    const dest = `0x${"ab".repeat(20)}`;
    await withdrawCustomToken({ swarmId: "member", token, amount: 2, to: dest });
    expect(state.sent[0]).toMatchObject({ network: "ethereum", to: dest, units: 2n * 10n ** 18n });
    expect(state.ledger[1].meta).toMatchObject({ currency: `ETHEREUM:${contract}`, network: "ethereum" });
    expect(getRecordedTokenBalance("member", ref)).toBe(3);
  });

  it("proves decimals for Ethereum tips from Ethereum records only", async () => {
    await syncCustomTokenDeposits("member", ref);
    expect(provenTokenDecimals(state.ledger, ref)).toBe(18);
    expect(provenTokenDecimals(state.ledger, contract)).toBeNull();
    const tip = { type: "wallet_tip", amount: 1,
      meta: { assetId: customTipAssetId(ref), currency: `ETHEREUM:${contract}`, decimals: 18, amountUnits: (10n ** 18n).toString() } } as unknown as SwarmTransaction;
    expect(customTipRef(tip)).toBe(ref);
    expect(customTipRef({ ...tip, meta: { ...tip.meta, currency: `MINTME:${contract}` } })).toBeNull();
  });
});
