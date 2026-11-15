import { getAll, get, put } from "@/lib/store";
import type { User } from "@/types";
import type { Connection } from "@/lib/connections";
import { swarmIdToEvmAddress } from "../gateway/addressMap";

/** Stable 20-byte receiving alias; not an externally controlled EVM account. */
export function nativeWalletAddress(userId: string): Promise<string> {
  return swarmIdToEvmAddress(userId);
}

/** Remote contact metadata is not key authority; never overwrite an existing account. */
export async function hydrateNativeWalletPeer(peer: {
  userId: string; username?: string; displayName?: string; avatarRef?: string;
}): Promise<User> {
  const existing = await get<User>("users", peer.userId);
  if (existing) return existing;
  const user: User = {
    id: peer.userId,
    username: peer.username || peer.displayName || `user ${peer.userId.slice(0, 8)}`,
    displayName: peer.displayName,
    profile: peer.avatarRef ? { avatarRef: peer.avatarRef } : undefined,
    publicKey: "",
  };
  await put("users", user);
  return user;
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
  const matches = async (userId: string) => userId === id ||
    (/^0x[\da-f]{40}$/i.test(input) && (await swarmIdToEvmAddress(userId)).toLowerCase() === input.toLowerCase());
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  const { getStandaloneBuilderMode } = await import("@/lib/p2p/builderMode.standalone-archived");
  for (const peer of [...getSwarmMeshStandalone().getLibrary(), ...getStandaloneBuilderMode().getLibrary()]) {
    if (peer.userId && await matches(peer.userId)) return hydrateNativeWalletPeer({ ...peer, userId: peer.userId });
  }
  let localUserId: string | undefined;
  try { localUserId = JSON.parse(localStorage.getItem("me") || "null")?.id; } catch { /* no local identity */ }
  if (localUserId) {
    const connections = await getAll<Connection>("connections");
    for (const connection of connections) {
      if (connection.status !== "connected" || connection.userId !== localUserId) continue;
      if (await matches(connection.connectedUserId)) return hydrateNativeWalletPeer({
        userId: connection.connectedUserId, displayName: connection.connectedUserName,
      });
    }
  }
  throw new Error("SWARM wallet recipient not found. Sync with this user first.");
}