/**
 * MintMe miner master switch. The MintMe miner must never start unless this
 * returns true. Defaults ON; the user's choice persists on this device.
 */
const KEY = "swarm-mintme-miner-enabled";
type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();
let storageFallback: boolean | null = null;

export function getMintMeMinerEnabled(): boolean {
  if (storageFallback !== null) return storageFallback;
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setMintMeMinerEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
    storageFallback = null;
  } catch {
    storageFallback = enabled;
  }
  listeners.forEach((l) => l(enabled));
}

export function onMintMeMinerEnabledChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
