/**
 * Cold-Wallet Key — the signing authority for moving bridged tokens back
 * out of the native SWARM wallet to MetaMask.
 *
 * Key authority comes from real custody, never from thin air:
 *  - A user with a Creator Coin Vault already has an engraved container —
 *    that vault acts as their key signer at no extra cost.
 *  - A user without one engraves a dedicated key container by locking
 *    1 mined SWARM (`vault-coin:coldkey:{userId}`). The SWARM is not
 *    burned — it is locked in the container's custody address, the same
 *    physical-custody rule as every other vault coin.
 *
 * The key itself is derived deterministically from the user's own identity
 * private key (never displayed, never stored raw — the identity key lives
 * in the session memory vault). Because it is derived, the same cold-key
 * address can always be recovered by its owner and by no one else.
 *
 * Withdrawals are signed by this key and broadcast to the MintMe network
 * directly. MetaMask never holds this key, so it cannot confirm the token
 * move itself; its role is funding the key's small MINTME gas reserve and
 * displaying the arriving tokens.
 */

import { Contract, FallbackProvider, Interface, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { get, put } from "../../store";
import type { SwarmCoin } from "../types";
import { COIN_MAX_WEIGHT } from "../types";
import { MINTME_NETWORK } from "./mintmeNetwork";

/** Mined SWARM locked to engrave a standalone cold-key container. */
export const COLD_KEY_ENGRAVING_SWARM = 1;

export function coldKeyVaultAddress(userId: string): string {
  return `vault:coldkey:${userId}`;
}
function coldKeyCoinId(userId: string): string {
  return `vault-coin:coldkey:${userId}`;
}

export type ColdKeyAuthority = { kind: "vault" } | { kind: "engraved" };

/**
 * Does this user hold key authority? A Creator Coin Vault counts; otherwise
 * the engraved 1-SWARM key container must exist.
 */
export async function getColdKeyAuthority(userId: string): Promise<ColdKeyAuthority | null> {
  if (!userId) return null;
  const { getVaultForUser } = await import("../creatorVault");
  if (await getVaultForUser(userId)) return { kind: "vault" };
  const coin = await get<SwarmCoin>("swarmCoins", coldKeyCoinId(userId));
  return coin ? { kind: "engraved" } : null;
}

/**
 * Engrave the standalone key container: locks 1 mined SWARM from the user
 * into the container's custody address and seals the engraving plate coin.
 * Idempotent. Throws on insufficient balance — nothing is minted or burned.
 */
export async function engraveColdKey(userId: string): Promise<SwarmCoin> {
  const existing = await get<SwarmCoin>("swarmCoins", coldKeyCoinId(userId));
  if (existing) return existing;
  const { getColdKeyAuthority: check } = await import("./coldKey");
  if (await check(userId)) {
    // A Creator Vault appeared meanwhile — no separate container needed.
    throw new Error("Your Creator Coin Vault already acts as your cold-wallet key");
  }
  const { transferSwarm } = await import("../token");
  await transferSwarm({
    from: userId,
    to: coldKeyVaultAddress(userId),
    amount: COLD_KEY_ENGRAVING_SWARM,
    meta: { vaultCustody: true, direction: "lock", reason: "Cold-wallet key engraving" },
  });
  const at = new Date().toISOString();
  const coin: SwarmCoin = {
    coinId: coldKeyCoinId(userId),
    weight: 0,
    maxWeight: COIN_MAX_WEIGHT,
    wrappedTokens: [],
    ownerId: coldKeyVaultAddress(userId),
    status: "vaulted",
    checkedForWrap: false,
    minedAt: at,
    fillState: "sealed",
    sealedAt: at,
    kind: "fungible",
    vaultAddress: coldKeyVaultAddress(userId),
    locked: true,
    custodyChain: [
      { at, from: userId, to: coldKeyVaultAddress(userId), reason: "Cold-wallet key engraved — 1 mined SWARM locked as signing authority" },
    ],
  };
  await put("swarmCoins", coin);
  return coin;
}

export interface DerivedColdKey {
  /** The EVM address this key controls — the native wallet's cold-wallet face. */
  address: string;
  wallet: Wallet;
}

/**
 * Derive the user's cold-wallet key from their identity private key.
 * Requires the unlocked session (passphrase) — the raw key never leaves
 * the wallet object and is never displayed.
 */
export async function deriveColdKey(_userId: string): Promise<DerivedColdKey> {
  const { getCachedPrivateKey } = await import("../../auth");
  const identityKey = await getCachedPrivateKey();
  if (!identityKey) {
    throw new Error("Your signing vault is locked. Sign in again to unlock it; no tokens have moved.");
  }
  const seed = keccak256(toUtf8Bytes(`swarm-coldkey:${identityKey.trim().toLowerCase()}`));
  const wallet = new Wallet(seed);
  return { address: wallet.address, wallet };
}

const ERC20 = new Interface(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);

function mintMeProvider(): FallbackProvider {
  return new FallbackProvider(
    MINTME_NETWORK.rpcUrls.map((url) => ({ provider: new JsonRpcProvider(url), priority: 1, stallTimeout: 1500 })),
    1,
  );
}

/**
 * Move bridged tokens out of cold-wallet custody on the MintMe chain.
 * Verifies on-chain that the key actually holds the tokens and enough
 * MINTME gas before signing — a refusal here means the SWARM ledger is
 * never touched, so the native balance stays intact.
 */
export async function sendColdKeyTokenTransfer(p: {
  wallet: Wallet;
  tokenAddress: string;
  symbol: string;
  to: string;
  units: bigint;
}): Promise<string> {
  const provider = mintMeProvider();
  const wallet = p.wallet.connect(provider);
  const token = new Contract(p.tokenAddress, ERC20.fragments, wallet);
  let held: bigint;
  let gas: bigint;
  try {
    [held, gas] = await Promise.all([
      token.balanceOf(wallet.address) as Promise<bigint>,
      provider.getBalance(wallet.address),
    ]);
  } catch {
    throw new Error("Could not reach the MintMe network to verify the cold-wallet key. Check your connection and try again.");
  }
  if (held < p.units) {
    throw new Error(
      `The cold-wallet key holds less ${p.symbol} on MintMe than your native balance records. ` +
        `Tokens deposited before the cold-wallet key existed sit at an older address this key cannot move.`,
    );
  }
  if (gas <= 0n) {
    throw new Error(
      `Your cold-wallet key address (${wallet.address}) holds the tokens but has no MINTME for gas. ` +
        `Send a small amount of MINTME to it from MetaMask — MetaMask will confirm and charge the fee there — then retry.`,
    );
  }
  const tx = (await token.transfer(p.to, p.units)) as { hash: string };
  return String(tx.hash);
}
