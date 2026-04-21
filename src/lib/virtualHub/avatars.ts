/**
 * Virtual Hub avatar registry.
 * Add a new avatar by appending an AvatarDefinition to AVATAR_REGISTRY.
 */
import type { JSX } from "react";
import { rabbitAvatar } from "./avatars/rabbit";

export interface AvatarRenderProps {
  scale?: number;
  color?: string;
}

export interface AvatarDefinition {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  render: (props: AvatarRenderProps) => JSX.Element;
  preview: (props: AvatarRenderProps) => JSX.Element;
}

export const AVATAR_REGISTRY: AvatarDefinition[] = [
  rabbitAvatar,
  // Future avatars: { id: 'fox', ... }, { id: 'owl', ... }
];

export const DEFAULT_AVATAR_ID = "rabbit";

export function getAvatarById(id: string | null | undefined): AvatarDefinition {
  if (!id) return AVATAR_REGISTRY[0];
  return AVATAR_REGISTRY.find((a) => a.id === id) ?? AVATAR_REGISTRY[0];
}

export interface VirtualHubPrefs {
  avatarId: string;
  audioInputId?: string;
  audioOutputId?: string;
}

const PREFS_KEY = "swarm-virtual-hub-prefs";

export function loadHubPrefs(): VirtualHubPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { avatarId: DEFAULT_AVATAR_ID };
    const parsed = JSON.parse(raw) as VirtualHubPrefs;
    return { avatarId: parsed.avatarId || DEFAULT_AVATAR_ID, ...parsed };
  } catch {
    return { avatarId: DEFAULT_AVATAR_ID };
  }
}

export function saveHubPrefs(prefs: VirtualHubPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}