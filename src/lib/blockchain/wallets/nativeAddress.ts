import { getAll, get } from "@/lib/store";
import type { User } from "@/types";
import { swarmIdToEvmAddress } from "../gateway/addressMap";

/** Native ledger identity, with a chain-qualified shareable address. */
export function nativeWalletAddress(userId: string): string {
  return `swarm:${userId}`;
}

/** Resolve aliases to the existing account; never move balances to an alias. */
export async function resolveNativeWalletRecipient(address: string): Promise<User> {
  const input = address.trim();
  const id = input.startsWith("swarm:") ? input.slice(6) : input;
  const direct = await get<User>("users", id);
  if (direct) return direct;
  if (/^0x[\da-f]{40}$/i.test(input)) {
    const users = await getAll<User>("users");
    for (const user of users) {
      if ((await swarmIdToEvmAddress(user.id)).toLowerCase() === input.toLowerCase()) return user;
    }
  }
  throw new Error("SWARM wallet recipient not found. Sync with this user first.");
}