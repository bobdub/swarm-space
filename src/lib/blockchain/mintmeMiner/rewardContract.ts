/**
 * MintMe Reward Contract — client-side spec and request builders.
 *
 * The pool's payout address is this contract (no private-key wallet). Each
 * settled community round is attested by connected peers: every attester signs
 * (contract, chainId, round, recipient, amount) with its own cold key, and the
 * contract checks the signatures with ecrecover before crediting `claim`.
 * Source and deployment live outside this client-only repo; until an address is
 * configured, on-chain release is "coming soon" and requests stay queued.
 *
 * Solidity interface (reference):
 *   function claim(uint256 round, uint256 amount, bytes[] calldata attestations) external;
 *   function withdraw(address to, uint256 amount) external;
 *   function claimed(uint256 round, address recipient) external view returns (bool);
 *   function credited(address recipient) external view returns (uint256);
 *   event Claimed(uint256 indexed round, address indexed recipient, uint256 amount);
 *   event Released(address indexed from, address indexed to, uint256 amount);
 *   event Reversed(address indexed recipient, uint256 amount, bytes32 reason);
 * Rules: msg.sender must equal the attested recipient; (round, recipient) can be
 * claimed once; distinct recovered attesters must reach the round's quorum
 * (strict majority, minimum two) from the attester registry.
 */
import { AbiCoder, Interface, getAddress, isAddress, keccak256, solidityPackedKeccak256, verifyMessage, getBytes } from "ethers";

export const MINTME_CHAIN_ID = 24734;

export const REWARD_CONTRACT_ABI = [
  "function claim(uint256 round, uint256 amount, bytes[] attestations)",
  "function withdraw(address to, uint256 amount)",
  "function claimed(uint256 round, address recipient) view returns (bool)",
  "function credited(address recipient) view returns (uint256)",
  "event Claimed(uint256 indexed round, address indexed recipient, uint256 amount)",
  "event Released(address indexed from, address indexed to, uint256 amount)",
  "event Reversed(address indexed recipient, uint256 amount, bytes32 reason)",
] as const;

export const rewardContractInterface = new Interface(REWARD_CONTRACT_ABI as unknown as string[]);

/** Deployed contract address, or null while on-chain release is not live. */
export function getMintMeRewardContract(): string | null {
  const raw = String(import.meta.env?.VITE_MINTME_REWARD_CONTRACT ?? "").trim();
  return isAddress(raw) ? getAddress(raw) : null;
}

export interface RewardAttestation {
  round: number;
  recipient: string;
  amountUnits: string;
  attester: string;
  signature: string;
}

/** The 32-byte digest each attester signs (EIP-191 personal_sign over it). */
export function attestationDigest(contract: string, round: number, recipient: string, amountUnits: bigint, chainId = MINTME_CHAIN_ID): string {
  return solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256", "address", "uint256"],
    ["SWARM-MINTME-REWARD-v1", chainId, getAddress(contract), round, getAddress(recipient), amountUnits],
  );
}

export async function signRewardAttestation(
  wallet: { address: string; signMessage(m: Uint8Array): Promise<string> },
  contract: string, round: number, recipient: string, amountUnits: bigint,
): Promise<RewardAttestation> {
  const signature = await wallet.signMessage(getBytes(attestationDigest(contract, round, recipient, amountUnits)));
  return { round, recipient: getAddress(recipient), amountUnits: amountUnits.toString(), attester: getAddress(wallet.address), signature };
}

/** Mirrors the contract check: distinct valid attesters for exactly this claim. */
export function validAttesters(contract: string, round: number, recipient: string, amountUnits: bigint, list: readonly RewardAttestation[]): string[] {
  const digest = getBytes(attestationDigest(contract, round, recipient, amountUnits));
  const out = new Set<string>();
  for (const a of list) {
    try {
      if (a.round !== round || a.amountUnits !== amountUnits.toString() || getAddress(a.recipient) !== getAddress(recipient)) continue;
      const who = getAddress(verifyMessage(digest, a.signature));
      if (who === getAddress(a.attester)) out.add(who);
    } catch { /* invalid signature */ }
  }
  return [...out];
}

/** Calldata for claim(); only includes signatures from distinct valid attesters. */
export function buildClaimCalldata(contract: string, round: number, recipient: string, amountUnits: bigint, list: readonly RewardAttestation[], quorum: number): string | null {
  const valid = new Set(validAttesters(contract, round, recipient, amountUnits, list));
  if (valid.size < Math.max(2, quorum)) return null;
  const seen = new Set<string>();
  const sigs = list.filter(a => { const w = getAddress(a.attester); if (!valid.has(w) || seen.has(w)) return false; seen.add(w); return true; }).map(a => a.signature);
  return rewardContractInterface.encodeFunctionData("claim", [round, amountUnits, sigs]);
}

export function buildWithdrawCalldata(to: string, amountUnits: bigint): string {
  if (!isAddress(to)) throw new Error("Enter a valid MintMe address (0x…).");
  return rewardContractInterface.encodeFunctionData("withdraw", [getAddress(to), amountUnits]);
}

/** Stable id for an attestation set, for dedup across the mesh. */
export const attestationKey = (round: number, recipient: string) => keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [round, getAddress(recipient)]));
