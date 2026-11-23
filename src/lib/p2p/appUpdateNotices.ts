import { namespaceIdentity } from '@/lib/uqrc/namespaceIdentity';
import type { BuildStamp } from './appVersion';

// Actual scene mounts, not URL guesses: /index can also show the entry screen.
const scenes = new Set<symbol>();
const listeners = new Set<() => void>();
export const isBrainUpdateContext = () => scenes.size > 0;
export function subscribeBrainUpdateContext(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function enterBrainUpdateContext() {
  const token = Symbol();
  scenes.add(token);
  listeners.forEach(listener => listener());
  return () => {
    scenes.delete(token);
    listeners.forEach(listener => listener());
  };
}

export const appUpdateNoticeId = (userId: string, build: BuildStamp) =>
  `app-update:${userId}:${build.builtAt}`;

/** Public receiving metadata only; no signing key is requested. */
export async function appUpdateNamespace(userId: string, username: string, address: string | null) {
  const handle = `@${username.replace(/^@/, '')}`;
  if (!address) return handle;
  try {
    const { discriminator } = await namespaceIdentity(userId, address);
    return `${handle}#${discriminator}`;
  } catch { return handle; }
}