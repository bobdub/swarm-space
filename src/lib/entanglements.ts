// Entanglement (follow) management utilities
import { getAllByIndex, put, remove } from "./store";

export interface Entanglement {
  id: string;
  userId: string;
  targetUserId: string;
  targetUserName?: string;
  createdAt: string;
  userTargetKey: string;
}

function dispatchEntanglementEvent(userId: string, targetUserId: string) {
  if (typeof window === "undefined") return;
  const detail = { userId, targetUserId };
  window.dispatchEvent(new CustomEvent("entanglements-updated", { detail }));
}

function buildUserTargetKey(userId: string, targetUserId: string): string {
  return `${userId}:${targetUserId}`;
}

export async function entangle(
  userId: string,
  targetUserId: string,
  targetUserName?: string
): Promise<Entanglement> {
  if (userId === targetUserId) {
    throw new Error("You cannot entangle with yourself");
  }

  const existing = await getEntanglement(userId, targetUserId);
  if (existing) {
    return existing;
  }

  const entanglement: Entanglement = {
    id: `entangle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    userId,
    targetUserId,
    targetUserName,
    createdAt: new Date().toISOString(),
    userTargetKey: buildUserTargetKey(userId, targetUserId),
  };

  await put("entanglements", entanglement);
  dispatchEntanglementEvent(userId, targetUserId);
  return entanglement;
}

export async function detangle(
  userId: string,
  targetUserId: string
): Promise<void> {
  const existing = await getEntanglement(userId, targetUserId);
  if (!existing) {
    return;
  }

  await remove("entanglements", existing.id);
  dispatchEntanglementEvent(userId, targetUserId);
}

export async function isEntangled(
  userId: string,
  targetUserId: string
): Promise<boolean> {
  const entanglement = await getEntanglement(userId, targetUserId);
  return Boolean(entanglement);
}

export async function getEntangledUserIds(userId: string): Promise<string[]> {
  const results = await getAllByIndex<Entanglement>(
    "entanglements",
    "userId",
    userId
  );
  return results.map((item) => item.targetUserId);
}

export async function getFollowerIds(targetUserId: string): Promise<string[]> {
  const results = await getAllByIndex<Entanglement>(
    "entanglements",
    "targetUserId",
    targetUserId
  );
  return results.map((item) => item.userId);
}

export async function getEntanglement(userId: string, targetUserId: string) {
  const matches = await getAllByIndex<Entanglement>(
    "entanglements",
    "userTargetKey",
    buildUserTargetKey(userId, targetUserId)
  );
  return matches[0] ?? null;
}
